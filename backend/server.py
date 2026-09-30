"""
Quantum Lens — optional Python backend
=======================================

Runs Quantum Lens circuits on real quantum-computing frameworks and
powers the LLM mode of the AI Quantum Tutor and class sync for the
instructor dashboard. The web app works without this server (it falls
back to its in-browser statevector engine); start the server to unlock:

  * Multi-backend simulation: Qiskit Aer, PennyLane (default.qubit),
    Cirq (cirq.Simulator) and qBraid (qBraid SDK transpile -> simulator)
  * AI tutor answers from Claude (set ANTHROPIC_API_KEY)
  * Class progress sync for the instructor dashboard + saved circuits

Run:
    pip install -r backend/requirements.txt
    python backend/server.py            # serves the app + API on http://localhost:8000

All results are normalised to Qiskit (little-endian) bit order so every
backend can be compared with every other one.
"""
from __future__ import annotations

import json
import math
import os
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

VERSION = "1.0.0"
ROOT = Path(__file__).resolve().parent.parent  # the web app folder
DATA = Path(os.environ.get("QLENS_DATA_DIR", Path(__file__).resolve().parent / "data"))
DATA.mkdir(parents=True, exist_ok=True)
MAX_QUBITS = int(os.environ.get("QLENS_MAX_QUBITS", "20"))
MAX_SHOTS = 100_000
# Qiskit's Rust core can overflow the small default stack of worker threads
# (FastAPI runs sync endpoints in a thread pool) — give new threads more room.
threading.stack_size(64 * 1024 * 1024)
# Framework calls are serialised on ONE dedicated worker thread: several simulators
# (and their native extensions) are not safe to drive from many pool threads at once.
from concurrent.futures import ThreadPoolExecutor  # noqa: E402
import asyncio  # noqa: E402
SIM_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="qlens-sim")

# ----------------------------------------------------------------------------
# Request models (the same circuit IR used by the web app)
# ----------------------------------------------------------------------------
GATE_ARITY = {  # gate: (controls, targets, params)
    "id": (0, 1, 0), "x": (0, 1, 0), "y": (0, 1, 0), "z": (0, 1, 0), "h": (0, 1, 0),
    "s": (0, 1, 0), "sdg": (0, 1, 0), "t": (0, 1, 0), "tdg": (0, 1, 0), "sx": (0, 1, 0),
    "rx": (0, 1, 1), "ry": (0, 1, 1), "rz": (0, 1, 1), "p": (0, 1, 1), "u": (0, 1, 3),
    "cx": (1, 1, 0), "cy": (1, 1, 0), "cz": (1, 1, 0), "ch": (1, 1, 0), "cp": (1, 1, 1),
    "crx": (1, 1, 1), "cry": (1, 1, 1), "crz": (1, 1, 1), "ccx": (2, 1, 0),
    "swap": (0, 2, 0), "cswap": (1, 2, 0), "measure": (0, 1, 0), "barrier": (0, 0, 0), "reset": (0, 1, 0),
}


class Op(BaseModel):
    gate: str
    targets: List[int] = Field(default_factory=list)
    controls: List[int] = Field(default_factory=list)
    params: List[float] = Field(default_factory=list)


class Circuit(BaseModel):
    num_qubits: int
    ops: List[Op]


class SimRequest(BaseModel):
    backend: str
    circuit: Circuit
    shots: int = 1024


class TutorRequest(BaseModel):
    message: str
    context: Dict[str, Any] = Field(default_factory=dict)


class ProgressRequest(BaseModel):
    learner_id: str
    name: str = "Anonymous learner"
    class_code: str
    progress: Dict[str, Any]


class CircuitSave(BaseModel):
    owner: str
    circuit: Dict[str, Any]


def validate(c: Circuit) -> None:
    if not 1 <= c.num_qubits <= MAX_QUBITS:
        raise HTTPException(400, f"num_qubits must be between 1 and {MAX_QUBITS}")
    for i, op in enumerate(c.ops):
        if op.gate not in GATE_ARITY:
            raise HTTPException(400, f"op {i}: unsupported gate '{op.gate}'")
        nc, nt, npar = GATE_ARITY[op.gate]
        if op.gate == "barrier":
            continue
        if len(op.controls) != nc or len(op.targets) != nt or len(op.params) < npar:
            raise HTTPException(400, f"op {i}: {op.gate} needs {nc} control(s), {nt} target(s), {npar} param(s)")
        qs = op.controls + op.targets
        if len(set(qs)) != len(qs) or any(not 0 <= q < c.num_qubits for q in qs):
            raise HTTPException(400, f"op {i}: invalid qubit indices {qs}")
        if any(not math.isfinite(p) for p in op.params):
            raise HTTPException(400, f"op {i}: parameters must be finite numbers")


def split_measurements(c: Circuit):
    """Measurements are terminal (matches the web engine). Returns (unitary ops, measured qubits ascending)."""
    measured = sorted({op.targets[0] for op in c.ops if op.gate == "measure"})
    ops = [op for op in c.ops if op.gate != "measure"]
    return ops, (measured or list(range(c.num_qubits)))


def u_matrix(theta: float, phi: float, lam: float) -> np.ndarray:
    c, s = math.cos(theta / 2), math.sin(theta / 2)
    return np.array([[c, -np.exp(1j * lam) * s], [np.exp(1j * phi) * s, np.exp(1j * (phi + lam)) * c]])


def finish(sv: np.ndarray, counts: Dict[str, int], n: int, t0: float, version: str, notes: List[str]):
    sv = np.asarray(sv, dtype=complex).reshape(-1)
    probs = np.abs(sv) ** 2
    return {
        "statevector": [[float(a.real), float(a.imag)] for a in sv],
        "probabilities": [float(p) for p in probs],
        "counts": {k: int(v) for k, v in sorted(counts.items())},
        "num_qubits": n,
        "time_ms": round((time.perf_counter() - t0) * 1000, 2),
        "framework_version": version,
        "notes": notes,
    }


# ----------------------------------------------------------------------------
# Qiskit Aer
# ----------------------------------------------------------------------------
def build_qiskit(c: Circuit, ops, measured, with_measure=True):
    from qiskit import QuantumCircuit

    qc = QuantumCircuit(c.num_qubits, len(measured) if with_measure else 0)
    for op in ops:
        g, p, q = op.gate, op.params, op.controls + op.targets
        if g == "barrier":
            qc.barrier()
        elif g == "u":
            qc.u(p[0], p[1], p[2], q[0])
        else:
            getattr(qc, g)(*p[: GATE_ARITY[g][2]], *q)
    return qc


def run_qiskit(c: Circuit, shots: int):
    import qiskit_aer
    from qiskit import transpile
    from qiskit_aer import AerSimulator

    t0 = time.perf_counter()
    ops, measured = split_measurements(c)
    qc = build_qiskit(c, ops, measured)
    qc.save_statevector()
    for i, q in enumerate(measured):
        qc.measure(q, i)
    sim = AerSimulator(method="statevector")
    seed = int(os.environ["QLENS_SEED"]) if os.environ.get("QLENS_SEED") else None
    # optimization_level=0: higher levels may elide final SWAPs, which would permute the saved statevector
    res = sim.run(transpile(qc, sim, optimization_level=0), shots=shots, seed_simulator=seed).result()
    sv = np.asarray(res.get_statevector())
    counts = {k.replace(" ", ""): v for k, v in res.get_counts().items()}
    return finish(sv, counts, c.num_qubits, t0, qiskit_aer.__version__, [f"Executed on qiskit_aer.AerSimulator(method='statevector') with {shots} shots."])


# ----------------------------------------------------------------------------
# Cirq
# ----------------------------------------------------------------------------
def build_cirq(c: Circuit, ops):
    import cirq

    q = cirq.LineQubit.range(c.num_qubits)
    single = {"id": cirq.I, "x": cirq.X, "y": cirq.Y, "z": cirq.Z, "h": cirq.H, "s": cirq.S, "sdg": cirq.S ** -1,
              "t": cirq.T, "tdg": cirq.T ** -1, "sx": cirq.X ** 0.5}
    circuit = cirq.Circuit()
    for op in ops:
        g, p = op.gate, op.params
        qs = [q[i] for i in op.controls + op.targets]
        if g == "barrier":
            continue
        if g in single:
            gate = single[g]
        elif g in ("rx", "ry", "rz"):
            gate = getattr(cirq, g)(p[0])
        elif g == "p":
            gate = cirq.ZPowGate(exponent=p[0] / math.pi)
        elif g == "u":
            gate = cirq.MatrixGate(u_matrix(*p[:3]))
        elif g == "cx":
            gate = cirq.CNOT
        elif g == "cz":
            gate = cirq.CZ
        elif g == "cy":
            gate = cirq.Y.controlled()
        elif g == "ch":
            gate = cirq.H.controlled()
        elif g == "cp":
            gate = cirq.CZPowGate(exponent=p[0] / math.pi)
        elif g in ("crx", "cry", "crz"):
            gate = getattr(cirq, g[1:])(p[0]).controlled()
        elif g == "swap":
            gate = cirq.SWAP
        elif g == "ccx":
            gate = cirq.TOFFOLI
        elif g == "cswap":
            gate = cirq.FREDKIN
        elif g == "reset":
            gate = cirq.ResetChannel()
        else:
            raise HTTPException(400, f"Cirq: unsupported gate {g}")
        circuit.append(gate.on(*qs))
    return circuit, q


def cirq_counts(circuit, q, measured, shots):
    import cirq

    order = [q[i] for i in sorted(measured, reverse=True)]  # highest qubit first == Qiskit bit order
    mc = circuit + cirq.Circuit(cirq.measure(*order, key="m"))
    seed = int(os.environ["QLENS_SEED"]) if os.environ.get("QLENS_SEED") else None
    hist = cirq.Simulator(seed=seed).run(mc, repetitions=shots).histogram(key="m")
    return {format(k, f"0{len(order)}b"): v for k, v in hist.items()}


def run_cirq(c: Circuit, shots: int):
    import cirq

    t0 = time.perf_counter()
    ops, measured = split_measurements(c)
    circuit, q = build_cirq(c, ops)
    # qubit_order reversed => q[n-1] is the most significant bit (Qiskit convention)
    sv = cirq.Simulator(dtype=np.complex128).simulate(circuit, qubit_order=list(reversed(q))).final_state_vector
    counts = cirq_counts(circuit, q, measured, shots)
    return finish(sv, counts, c.num_qubits, t0, cirq.__version__, [f"Executed on cirq.Simulator() with {shots} repetitions; bit order converted to Qiskit convention."])


# ----------------------------------------------------------------------------
# PennyLane
# ----------------------------------------------------------------------------
def run_pennylane(c: Circuit, shots: int):
    import pennylane as qml

    t0 = time.perf_counter()
    n = c.num_qubits
    ops, measured = split_measurements(c)
    if any(op.gate == "reset" for op in ops):
        raise HTTPException(400, "PennyLane backend: reset is not supported inside a qnode")
    w = lambda k: n - 1 - k  # IR qubit k -> wire n-1-k so PennyLane's big-endian index matches Qiskit order
    names = {"id": "Identity", "x": "PauliX", "y": "PauliY", "z": "PauliZ", "h": "Hadamard", "s": "S", "t": "T", "sx": "SX",
             "rx": "RX", "ry": "RY", "rz": "RZ", "p": "PhaseShift", "u": "U3", "cx": "CNOT", "cy": "CY", "cz": "CZ", "ch": "CH",
             "cp": "ControlledPhaseShift", "crx": "CRX", "cry": "CRY", "crz": "CRZ", "swap": "SWAP", "ccx": "Toffoli", "cswap": "CSWAP"}

    def body():
        for op in ops:
            g = op.gate
            wires = [w(i) for i in op.controls + op.targets]
            if g == "barrier":
                continue
            if g == "sdg":
                qml.adjoint(qml.S)(wires=wires)
            elif g == "tdg":
                qml.adjoint(qml.T)(wires=wires)
            else:
                getattr(qml, names[g])(*op.params[: GATE_ARITY[g][2]], wires=wires)

    dev = qml.device("default.qubit", wires=n)

    @qml.qnode(dev)
    def state():
        body()
        return qml.state()

    mwires = [w(k) for k in sorted(measured, reverse=True)]

    @qml.qnode(dev)
    def counts_fn():
        body()
        return qml.counts(wires=mwires)

    sv = np.asarray(state())
    try:
        counts = qml.set_shots(counts_fn, shots=shots)()
    except AttributeError:  # older PennyLane
        dev_s = qml.device("default.qubit", wires=n, shots=shots)
        counts = qml.QNode(counts_fn.func, dev_s)()
    counts = {str(k): int(v) for k, v in counts.items()}
    return finish(sv, counts, n, t0, qml.__version__, [f"Executed on PennyLane default.qubit with {shots} shots; wires mapped so bit order matches Qiskit."])


# ----------------------------------------------------------------------------
# qBraid — transpile with the qBraid SDK, then execute the transpiled program
# ----------------------------------------------------------------------------
def qbraid_qubits(cc, n):
    """Return the converted circuit's qubits indexed like the source (q_0 / LineQubit(0) ...),
    re-creating idle qubits that the conversion dropped."""
    import re
    import cirq

    found = sorted(cc.all_qubits())
    if found and all(isinstance(q, cirq.NamedQubit) and re.fullmatch(r"q_(\d+)", q.name) for q in found):
        return [cirq.NamedQubit(f"q_{i}") for i in range(n)]
    if all(isinstance(q, cirq.LineQubit) for q in found):
        return cirq.LineQubit.range(n)
    if len(found) == n:
        return found
    raise ValueError(f"qBraid conversion returned an unexpected qubit layout: {found}")


def run_qbraid(c: Circuit, shots: int):
    import cirq
    import qbraid
    from qbraid import transpile as qb_transpile

    t0 = time.perf_counter()
    ops, measured = split_measurements(c)
    qk = build_qiskit(c, ops, measured, with_measure=False)
    cc = qb_transpile(qk, "cirq")  # qBraid SDK conversion Qiskit -> Cirq
    qubits = qbraid_qubits(cc, c.num_qubits)
    sv = cirq.Simulator(dtype=np.complex128).simulate(cc, qubit_order=list(reversed(qubits))).final_state_vector
    counts = cirq_counts(cc, qubits, measured, shots)
    notes = [f"Transpiled Qiskit → Cirq with the qBraid SDK (v{qbraid.__version__}) and executed on cirq.Simulator().",
             "Set QBRAID_API_KEY and use qbraid.runtime.QbraidProvider to target qBraid-hosted devices."]
    return finish(sv, counts, c.num_qubits, t0, qbraid.__version__, notes)


RUNNERS = {"qiskit_aer": run_qiskit, "cirq": run_cirq, "pennylane": run_pennylane, "qbraid": run_qbraid}
MODULES = {"qiskit_aer": ("qiskit_aer", "qiskit"), "cirq": ("cirq",), "pennylane": ("pennylane",), "qbraid": ("qbraid", "cirq", "qiskit")}


def backend_status():
    out = {}
    for name, mods in MODULES.items():
        try:
            m = [__import__(x) for x in mods]
            out[name] = {"available": True, "version": getattr(m[0], "__version__", "?")}
        except Exception as e:  # noqa: BLE001
            out[name] = {"available": False, "error": f"{type(e).__name__}: {e}"}
    return out


_STATUS = None

# ----------------------------------------------------------------------------
# Tiny JSON store for class progress & saved circuits
# ----------------------------------------------------------------------------
_lock = threading.Lock()


def _load(name: str) -> dict:
    p = DATA / name
    try:
        return json.loads(p.read_text()) if p.exists() else {}
    except json.JSONDecodeError:
        return {}


def _save(name: str, obj: dict) -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    tmp = DATA / (name + ".tmp")
    tmp.write_text(json.dumps(obj))
    tmp.replace(DATA / name)


# ----------------------------------------------------------------------------
# LLM tutor (Anthropic Messages API, no SDK dependency)
# ----------------------------------------------------------------------------
TUTOR_SYSTEM = """You are the AI Quantum Tutor inside Quantum Lens, a beginner-friendly quantum computing learning platform.
Explain concepts clearly with intuition first and maths second, using |ket⟩ notation. When writing code, produce complete runnable
programs for the framework the learner asks for (Qiskit ≥1.0 with qiskit_aer.AerSimulator, Cirq, PennyLane, qBraid or OpenQASM 2).
When debugging, point to the exact line, explain the cause and show the corrected code. When optimising, list concrete gate-level
changes and their effect on gate count/depth. Qiskit bit order (q0 right-most) is used for all results. Keep answers concise
(under ~250 words unless code is needed) and encouraging. The learner's current circuit, code, errors and progress are provided as context."""


def ask_llm(message: str, context: dict) -> str:
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise HTTPException(503, "LLM tutor not configured (set ANTHROPIC_API_KEY)")
    model = os.environ.get("QLENS_TUTOR_MODEL", "claude-sonnet-5-5")
    ctx = json.dumps(context, ensure_ascii=False)[:12000]
    body = json.dumps({
        "model": model, "max_tokens": 1200, "system": TUTOR_SYSTEM,
        "messages": [{"role": "user", "content": f"Context (JSON):\n{ctx}\n\nLearner question:\n{message}"}],
    }).encode()
    req = urllib.request.Request("https://api.anthropic.com/v1/messages", data=body, headers={
        "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise HTTPException(502, f"LLM request failed: {e.code} {e.read()[:300]!r}") from e
    return "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")


# ----------------------------------------------------------------------------
# API
# ----------------------------------------------------------------------------
app = FastAPI(title="Quantum Lens API", version=VERSION)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/api/health")
def health():
    global _STATUS
    if _STATUS is None:
        _STATUS = backend_status()
    return {"service": "quantum-lens", "version": VERSION, "backends": _STATUS,
            "tutor_llm": bool(os.environ.get("ANTHROPIC_API_KEY")), "max_qubits": MAX_QUBITS}


@app.post("/api/simulate")
async def simulate(req: SimRequest):
    validate(req.circuit)
    if req.backend not in RUNNERS:
        raise HTTPException(400, f"Unknown backend '{req.backend}'. Choose one of {list(RUNNERS)}")
    if not health()["backends"][req.backend]["available"]:
        raise HTTPException(503, f"Backend '{req.backend}' is not installed on the server")
    shots = max(1, min(MAX_SHOTS, req.shots))
    try:
        loop = asyncio.get_running_loop()
        out = await loop.run_in_executor(SIM_EXECUTOR, RUNNERS[req.backend], req.circuit, shots)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"{req.backend} failed: {type(e).__name__}: {e}") from e
    out["backend"] = req.backend
    out["shots"] = shots
    return out


@app.post("/api/tutor")
def tutor(req: TutorRequest):
    return {"reply": ask_llm(req.message, req.context), "source": "llm"}


@app.post("/api/progress")
def save_progress(req: ProgressRequest):
    with _lock:
        db = _load("progress.json")
        cls = db.setdefault(req.class_code.strip().upper(), {})
        cls[req.learner_id] = {"name": req.name, "updated": time.time(), "progress": req.progress}
        _save("progress.json", db)
    return {"ok": True}


@app.get("/api/class/{code}")
def get_class(code: str):
    db = _load("progress.json")
    cls = db.get(code.strip().upper(), {})
    return {"class_code": code.upper(), "learners": [dict(learner_id=k, **v) for k, v in cls.items()]}


@app.get("/api/circuits")
def list_circuits(owner: str):
    return {"circuits": list(_load("circuits.json").get(owner, {}).values())}


@app.post("/api/circuits")
def save_circuit(req: CircuitSave):
    cid = str(req.circuit.get("id") or "")
    if not cid:
        raise HTTPException(400, "circuit.id is required")
    with _lock:
        db = _load("circuits.json")
        db.setdefault(req.owner, {})[cid] = req.circuit
        _save("circuits.json", db)
    return {"ok": True}


@app.delete("/api/circuits/{cid}")
def delete_circuit(cid: str, owner: str):
    with _lock:
        db = _load("circuits.json")
        db.get(owner, {}).pop(cid, None)
        _save("circuits.json", db)
    return {"ok": True}


# Serve the web app itself (index.html, lab.html, ...) from the project root
app.mount("/", StaticFiles(directory=str(ROOT), html=True), name="site")

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "8000")))
