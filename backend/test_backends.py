"""Cross-checks every installed backend against Qiskit Aer (and the browser engine, when Node.js is available).
Run:  python backend/test_backends.py
"""
import json, math, os, random, shutil, subprocess, sys, time, urllib.error, urllib.request
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import numpy as np
ROOT = Path(__file__).resolve().parent.parent
GATES1 = ["h", "x", "y", "z", "s", "sdg", "t", "tdg", "sx"]
ROT = ["rx", "ry", "rz", "p"]
TWO = ["cx", "cy", "cz", "ch", "cp", "crx", "cry", "crz", "swap"]


def random_circuit(n, depth, rng):
    ops = []
    for _ in range(depth):
        kind = rng.random()
        if kind < 0.35:
            ops.append({"gate": rng.choice(GATES1), "targets": [rng.randrange(n)]})
        elif kind < 0.55:
            ops.append({"gate": rng.choice(ROT), "targets": [rng.randrange(n)], "params": [rng.uniform(-3, 3)]})
        elif kind < 0.6:
            ops.append({"gate": "u", "targets": [rng.randrange(n)], "params": [rng.uniform(-3, 3) for _ in range(3)]})
        elif n >= 3 and kind < 0.68:
            a, b, c = rng.sample(range(n), 3)
            if rng.random() < .5:
                ops.append({"gate": "cswap", "controls": [a], "targets": [b, c]})
            else:
                ops.append({"gate": "ccx", "controls": [a, b], "targets": [c]})
        elif n >= 2:
            a, b = rng.sample(range(n), 2)
            g = rng.choice(TWO)
            params = [rng.uniform(-3, 3)] if g in ("cp", "crx", "cry", "crz") else []
            ops.append({"gate": g, "targets": [a, b], "controls": []} if g == "swap" else {"gate": g, "controls": [a], "targets": [b], "params": params})
    k = rng.randrange(1, n + 1)
    for q in sorted(rng.sample(range(n), k)):
        ops.append({"gate": "measure", "targets": [q]})
    for o in ops:
        o.setdefault("controls", []); o.setdefault("params", [])
    return {"num_qubits": n, "ops": ops}


class Http:
    """Minimal HTTP client with a requests-like interface."""
    class R:
        def __init__(self, code, body): self.status_code, self.text = code, body
        def json(self): return json.loads(self.text)

    def __init__(self, base): self.base = base

    def _do(self, path, data=None):
        req = urllib.request.Request(self.base + path, data=None if data is None else json.dumps(data).encode(), headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return self.R(r.status, r.read().decode())
        except urllib.error.HTTPError as e:
            return self.R(e.code, e.read().decode())

    def get(self, path): return self._do(path)
    def post(self, path, json=None): return self._do(path, json)


def fid(a, b):
    a = np.array([complex(*x) for x in a]); b = np.array([complex(*x) for x in b])
    return abs(np.vdot(a, b)) ** 2


def main():
    # Node runs *before* the quantum frameworks are imported: forking a process that already runs
    # Aer/OpenMP worker threads can crash the parent on some systems.
    rng = random.Random(7)
    circuits = [random_circuit(rng.randint(1, 4), rng.randint(3, 14), rng) for _ in range(25)]
    js = None
    if shutil.which("node"):
        script = ("require('./assets/js/qcore.js');const cs=JSON.parse(require('fs').readFileSync(0,'utf8'));"
                  "console.log(JSON.stringify(cs.map(c=>{const r=QL.simulate({numQubits:c.num_qubits,ops:c.ops});return {sv:r.amplitudes,m:r.marginal};})))")
        js = json.loads(subprocess.run(["node", "-e", script], input=json.dumps(circuits), capture_output=True, text=True, cwd=ROOT, check=True).stdout)
    # Exercise the real HTTP server (the same way the web app talks to it)
    port = 8765
    env = dict(os.environ, PORT=str(port))
    srv = subprocess.Popen([sys.executable, str(Path(__file__).with_name("server.py"))], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    client = Http(f"http://127.0.0.1:{port}")
    for _ in range(120):
        try:
            h = client.get("/api/health").json(); break
        except OSError:
            time.sleep(0.5)
    else:
        srv.kill(); sys.exit("server did not start")
    try:
        run_checks(client, h, circuits, js)
    finally:
        srv.terminate()


def run_checks(client, h, circuits, js):
    avail = [k for k, v in h["backends"].items() if v["available"]]
    print("available backends:", {k: h["backends"][k].get("version") for k in avail})
    failures = 0
    for i, c in enumerate(circuits):
        ref = None
        for b in avail:
            r = client.post("/api/simulate", json={"backend": b, "circuit": c, "shots": 4000})
            if r.status_code != 200:
                print("FAIL", i, b, r.text); failures += 1; continue
            r = r.json()
            ref = ref or r
            f = fid(ref["statevector"], r["statevector"])
            if f < 1 - 1e-6:
                print(f"FAIL circuit {i}: {b} vs {avail[0]} fidelity {f}"); failures += 1
            if js is not None and fid(js[i]["sv"], r["statevector"]) < 1 - 1e-6:
                print(f"FAIL circuit {i}: {b} vs browser engine"); failures += 1
            # counts must be consistent with the browser marginal (loose statistical check)
            if js is not None:
                tv = 0.5 * sum(abs(js[i]["m"].get(k, 0) - r["counts"].get(k, 0) / 4000) for k in set(js[i]["m"]) | set(r["counts"]))
                if tv > 0.08:
                    print(f"FAIL circuit {i}: {b} counts far from browser distribution (TV={tv:.3f}) {r['counts']} vs {js[i]['m']}"); failures += 1
    print(f"{len(circuits)} random circuits x {len(avail)} backends checked — {failures} failure(s)")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
