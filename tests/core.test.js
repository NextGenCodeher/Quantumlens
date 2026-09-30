/* Run with: node tests/core.test.js  — verifies the simulator, parsers, code generation round-trips and optimizer. */
require('../assets/js/qcore.js'); require('../assets/js/qparser.js');
const QL = globalThis.QL; let pass = 0, fail = 0;
function ok(c, msg) { if (c) pass++; else { fail++; console.error('FAIL:', msg); } }
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;

// Bell state
const bell = { numQubits: 2, ops: [{ gate: 'h', targets: [0], controls: [], params: [] }, { gate: 'cx', targets: [1], controls: [0], params: [] }] };
let r = QL.simulate(bell);
ok(near(r.probabilities[0], .5) && near(r.probabilities[3], .5), 'bell probs');
ok(r.bloch.every(b => b.length < 1e-9), 'bell reduced states maximally mixed');
ok(/Φ⁺/.test(QL.describeState(r.amplitudes, 2)), 'bell described: ' + QL.describeState(r.amplitudes, 2));
// little-endian: X on q0 -> index 1 -> label '01'
r = QL.simulate({ numQubits: 2, ops: [{ gate: 'x', targets: [0], controls: [], params: [] }] });
ok(near(r.probabilities[1], 1) && r.marginal['01'] === 1, 'qiskit ordering');
// Bloch of |+>, |i>
r = QL.simulate({ numQubits: 1, ops: [{ gate: 'h', targets: [0], controls: [], params: [] }] }); ok(near(r.bloch[0].x, 1), '|+> bloch x');
r = QL.simulate({ numQubits: 1, ops: [{ gate: 'h', targets: [0], controls: [], params: [] }, { gate: 's', targets: [0], controls: [], params: [] }] }); ok(near(r.bloch[0].y, 1), '|i> bloch y');
r = QL.simulate({ numQubits: 1, ops: [{ gate: 'ry', targets: [0], controls: [], params: [Math.PI / 3] }] }); ok(near(r.bloch[0].z, Math.cos(Math.PI / 3)) && near(r.bloch[0].x, Math.sin(Math.PI / 3)), 'ry bloch');
// SWAP via 3 CNOTs equals SWAP
const sw = { numQubits: 2, ops: [{ gate: 'cx', controls: [0], targets: [1], params: [] }, { gate: 'cx', controls: [1], targets: [0], params: [] }, { gate: 'cx', controls: [0], targets: [1], params: [] }] };
ok(near(QL.unitaryFidelity(sw, { numQubits: 2, ops: [{ gate: 'swap', targets: [0, 1], controls: [], params: [] }] }), 1), 'swap from cnots');
// U gate equals H up to phase: U(pi/2,0,pi)
ok(near(QL.unitaryFidelity({ numQubits: 1, ops: [{ gate: 'u', targets: [0], controls: [], params: [Math.PI / 2, 0, Math.PI] }] }, { numQubits: 1, ops: [{ gate: 'h', targets: [0], controls: [], params: [] }] }), 1), 'u == h');
// Sampling
const counts = QL.sampleCounts({ '00': .5, '11': .5 }, 4000, 42); ok(Math.abs(counts['00'] - 2000) < 200 && !counts['01'], 'sampling ' + JSON.stringify(counts));

// Parsers — each framework's generated code must parse back to the same unitary
const ghz = { numQubits: 3, ops: [{ gate: 'h', targets: [0], controls: [], params: [] }, { gate: 'cx', controls: [0], targets: [1], params: [] }, { gate: 'cx', controls: [1], targets: [2], params: [] }, { gate: 'rz', targets: [2], controls: [], params: [Math.PI / 4] }, { gate: 'cp', controls: [0], targets: [2], params: [Math.PI / 2] }, { gate: 'sdg', targets: [1], controls: [], params: [] }, { gate: 'u', targets: [1], controls: [], params: [0.3, 0.2, 0.1] }, { gate: 'swap', targets: [0, 2], controls: [], params: [] }, { gate: 'ccx', controls: [0, 1], targets: [2], params: [] }, { gate: 'measure', targets: [0], controls: [], params: [] }, { gate: 'measure', targets: [1], controls: [], params: [] }] };
for (const fw of ['qasm', 'qiskit', 'cirq', 'pennylane', 'qbraid']) {
  const code = QL.generateCode(ghz, fw);
  const p = QL.parse(code);
  if (p.errors.length) console.error(fw, p.errors, '\n' + code);
  ok(p.framework === fw && !p.errors.length, fw + ' parses its own output');
  ok(!p.errors.length && near(QL.unitaryFidelity(ghz, p.circuit), 1, 1e-6), fw + ' round-trip unitary');
  ok(JSON.stringify(QL.simulate(p.circuit).measuredQubits) === '[0,1]' || fw === 'pennylane' || fw === 'cirq', fw + ' measured qubits');
}
// Handwritten programs
let p = QL.parse(`from qiskit import QuantumCircuit\nimport numpy as np\nn = 4\nqc = QuantumCircuit(n, n)\nqc.h(0)\nfor i in range(n - 1):\n    qc.cx(i, i + 1)\nqc.rz(np.pi/2, 3)\nqc.measure(range(n), range(n))`);
ok(!p.errors.length && p.circuit.numQubits === 4 && p.circuit.ops.length === 9, 'qiskit loop ' + JSON.stringify(p.errors));
p = QL.parse(`qc = QuantumCircuit(2)\nqc.hadamard(0)`); ok(p.errors.length && /Unsupported/.test(p.errors[0].message) && p.errors[0].line === 2, 'qiskit error line ' + JSON.stringify(p.errors));
p = QL.parse(`qc = QuantumCircuit(2)\nqc.cx(0, 2)`); ok(p.errors.length && /qubit 2/.test(p.errors[0].message), 'out of range ' + JSON.stringify(p.errors));
p = QL.parse(`import cirq\nq0, q1 = cirq.LineQubit.range(2)\ncircuit = cirq.Circuit(cirq.H(q0), cirq.CNOT(q0, q1), (cirq.S**-1)(q1), cirq.rx(0.5)(q0), cirq.measure(q0, q1, key='m'))`);
ok(!p.errors.length && p.circuit.ops.map(o => o.gate).join() === 'h,cx,sdg,rx,measure,measure', 'cirq ' + JSON.stringify(p.errors) + p.circuit.ops.map(o => o.gate));
p = QL.parse(`import pennylane as qml\ndev = qml.device("default.qubit", wires=2)\n@qml.qnode(dev)\ndef c():\n    qml.Hadamard(wires=0)\n    qml.CNOT(wires=[0, 1])\n    qml.Rot(0.1, 0.2, 0.3, wires=1)\n    return qml.expval(qml.PauliZ(0))`);
ok(!p.errors.length && p.circuit.ops.map(o => o.gate).join() === 'h,cx,rz,ry,rz', 'pennylane expval skip ' + p.circuit.ops.map(o => o.gate));
p = QL.parse(`OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[2] q;\nbit[2] c;\nh q[0];\ncx q[0], q[1];\nc = measure q;`);
ok(!p.errors.length && p.circuit.ops.length === 4, 'qasm3 ' + JSON.stringify(p.errors));
p = QL.parse(`OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\nh q;\nfoo q[0];`); ok(p.errors[0] && p.errors[0].line === 5, 'qasm error line ' + JSON.stringify(p.errors));
// Optimizer
const redundant = { numQubits: 2, ops: [['h', 0], ['h', 0], ['x', 1], ['t', 1], ['t', 1], ['rz', 0, .3], ['rz', 0, .4], ['h', 1], ['z', 1], ['h', 1]].map(([g, q, a]) => ({ gate: g, targets: [q], controls: [], params: a != null ? [a] : [] })) };
const o = QL.optimize(redundant);
ok(o.after.gates < o.before.gates && near(QL.unitaryFidelity(redundant, o.circuit), 1, 1e-9), `optimizer ${o.before.gates}->${o.after.gates} ${o.notes.join(' | ')}`);
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
