/* node tests/tutor.test.js — tutor generators produce correct algorithms; intents route correctly. */
globalThis.localStorage = undefined;
['qcore', 'qparser', 'qcontent', 'qstore', 'qtutor'].forEach(f => require(`../assets/js/${f}.js`));
const QL = globalThis.QL; let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL', m); } };
const G = QL.TUTOR_GENERATORS;
for (const t of ['00', '01', '10', '11', '000', '011', '101', '110', '111']) { const r = QL.simulate(G.grover.build({ secret: t })).marginal; ok(r[t] > 0.94, 'grover ' + t + ' ' + r[t]); }
for (const s of ['1', '10', '1011', '0110']) ok(QL.simulate(G.bv.build({ secret: s })).marginal[s] > 0.999, 'bv ' + s);
ok(QL.simulate(G.dj.build({ n: 3, constant: true })).marginal['000'] > 0.999, 'dj constant');
ok(!QL.simulate(G.dj.build({ n: 3 })).marginal['000'], 'dj balanced');
ok(QL.simulate(G.superdense.build()).marginal['11'] > 0.999, 'superdense');
const qft = G.qft.build({ n: 3 }); ok(QL.simulate(qft).probabilities.every(p => Math.abs(p - 1 / 8) < 1e-9), 'qft uniform on |0>');
const T = new QL.Tutor({ getContext: () => ctx }); let ctx = { circuit: QL.EXAMPLES.bell.circuit, framework: 'qiskit' };
const route = (q) => T.local(q.toLowerCase(), q, ctx);
ok(route('what is entanglement?').topic === 'entanglement', 'kb');
ok(route('Generate Grover search for 101 in Cirq').topic === 'generate' && /cirq/.test(route('Generate Grover search for 101 in Cirq').text), 'gen');
const gc = route('write a 4-qubit GHZ in pennylane'); ok(/qml\.CNOT/.test(gc.text) && QL.parse(gc.actions[0].code).circuit.numQubits === 4, 'ghz pennylane');
ok(route('explain my circuit').topic === 'explain-circuit' && /Φ⁺/.test(route('explain my circuit').text), 'explain');
ctx = { circuit: { numQubits: 2, ops: [{ gate: 'h', targets: [0], controls: [], params: [] }, { gate: 'h', targets: [0], controls: [], params: [] }, { gate: 'cx', controls: [1], targets: [0], params: [] }] }, code: 'qc = QuantumCircuit(2)\nqc.hadamrd(0)', framework: 'qiskit' };
ctx.parse = QL.parse(ctx.code);
const d = route('why does my code fail?'); ok(/Line 2/.test(d.text) && /qc\.h\(/.test(d.text) && /never fires/.test(d.text), 'debug ' + d.text);
const o = route('optimise my circuit'); ok(o.actions.length && o.actions[0].circuit.ops.length === 1, 'optimize ' + o.text);
ok(route('what should I learn next?').topic === 'recommend', 'recommend');
ok(route('asdkjh qwe').fallback, 'fallback');
// every generator in every framework parses back to the same unitary
for (const [k, gen] of Object.entries(G)) for (const fw of ['qiskit', 'cirq', 'pennylane', 'qasm', 'qbraid']) { const c = gen.build({}); const p = QL.parse(QL.generateCode(c, fw)); ok(!p.errors.length && QL.unitaryFidelity(p.circuit, c) > 0.999999, `${k}/${fw} ${JSON.stringify(p.errors)}`); }
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
