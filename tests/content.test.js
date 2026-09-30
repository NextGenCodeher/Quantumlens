/* node tests/content.test.js — every challenge must be solvable by its reference solution; examples must simulate. */
globalThis.localStorage = undefined;
require('../assets/js/qcore.js'); require('../assets/js/qparser.js'); require('../assets/js/qcontent.js'); require('../assets/js/qstore.js');
const QL = globalThis.QL; let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL', m); } };
const S = {
  c_minus_measure: { numQubits: 1, ops: [['x'], ['h'], ['h'], ['measure']].map(([g]) => ({ gate: g, targets: [0], controls: [], params: [] })) },
  c_grover2: QL.EXAMPLES.grover2.circuit,
  c_y_from_rot: { numQubits: 1, ops: [{ gate: 'z', targets: [0], controls: [], params: [] }, { gate: 'x', targets: [0], controls: [], params: [] }] },
  c_swap_cnot: { numQubits: 2, ops: [[0, 1], [1, 0], [0, 1]].map(([a, b]) => ({ gate: 'cx', controls: [a], targets: [b], params: [] })) },
};
const code = {
  k_ghz4: 'from qiskit import QuantumCircuit\nn = 4\nqc = QuantumCircuit(n)\nqc.h(0)\nfor i in range(n - 1):\n    qc.cx(i, i + 1)\n',
  k_qrng: 'from qiskit import QuantumCircuit\nqc = QuantumCircuit(3, 3)\nqc.h([0, 1, 2])\nqc.measure([0, 1, 2], [0, 1, 2])\n',
  k_bv: 'from qiskit import QuantumCircuit\nqc = QuantumCircuit(4, 3)\nqc.x(3)\nqc.h(3)\nqc.h([0,1,2])\nqc.cx(1, 3)\nqc.cx(2, 3)\nqc.h([0,1,2])\nqc.measure([0,1,2],[0,1,2])\n',
  k_dj: 'import pennylane as qml\ndev = qml.device("default.qubit", wires=3)\n@qml.qnode(dev)\ndef circuit():\n    qml.PauliX(wires=2)\n    qml.Hadamard(wires=2)\n    qml.Hadamard(wires=0)\n    qml.Hadamard(wires=1)\n    qml.PauliX(wires=2)\n    qml.Hadamard(wires=0)\n    qml.Hadamard(wires=1)\n    return qml.probs(wires=[1, 0])\n',
};
for (const ch of QL.CHALLENGES) {
  let circ, meta = {};
  if (code[ch.id]) { const p = QL.parse(code[ch.id]); ok(!p.errors.length, ch.id + ' parse ' + JSON.stringify(p.errors)); circ = p.circuit; meta.code = code[ch.id]; }
  else circ = S[ch.id] || ch.target.circuit;
  const r = QL.gradeChallenge(ch, circ, meta);
  ok(r.passed, ch.id + ' ' + JSON.stringify(r.checks));
  // an empty circuit must fail
  const empty = QL.gradeChallenge(ch, { numQubits: circ.numQubits, ops: [] }, {});
  ok(!empty.passed, ch.id + ' empty should fail');
}
for (const [k, e] of Object.entries(QL.EXAMPLES)) { const r = QL.simulate(e.circuit); ok(Math.abs(r.probabilities.reduce((a, b) => a + b, 0) - 1) < 1e-9, k); }
const g3 = QL.simulate(QL.EXAMPLES.grover3.circuit).marginal; ok(g3['101'] > 0.94, 'grover3 ' + g3['101']);
const tp = QL.simulate(QL.EXAMPLES.teleportation.circuit); const src = QL.simulate({ numQubits: 1, ops: [{ gate: 'ry', targets: [0], controls: [], params: [1.1] }] });
ok(Math.abs(tp.bloch[2].z - src.bloch[0].z) < 1e-9 && Math.abs(tp.bloch[2].x - src.bloch[0].x) < 1e-9, 'teleportation');
ok(QL.simulate(QL.EXAMPLES.phase_kickback.circuit).marginal['1'] > 0.999, 'kickback');
ok(QL.simulate(QL.EXAMPLES.deutsch_jozsa.circuit).marginal['11'] > 0.999, 'dj');
ok(QL.simulate(QL.EXAMPLES.bernstein_vazirani.circuit).marginal['101'] > 0.999, 'bv');
// quiz + path
const q = QL.submitQuiz('fundamentals', [1, 2, 1, 0, 2]); ok(q.score === 100, 'quiz');
[0, 1, 2].forEach(i => QL.markLessonViewed('fundamentals', i)); ok(QL.moduleProgress('fundamentals').completed, 'module complete');
const path = QL.learningPath(); ok(path[0].status === 'completed' && path.find(p => p.recommended).id === 'qubits', 'path');
ok(QL.recommendations().length > 0, 'recs');
QL.MODULES.forEach(m => ok(m.quiz.every(x => x.answer < x.options.length) && m.challenges.every(c => QL.CHALLENGES.find(cc => cc.id === c)), 'module refs ' + m.id));
const enc = QL.encodeCircuit(QL.EXAMPLES.qft3.circuit); ok(QL.unitaryFidelity(QL.decodeCircuit(enc), QL.EXAMPLES.qft3.circuit) > 0.999999, 'share link');
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
