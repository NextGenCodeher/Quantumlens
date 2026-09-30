/* =====================================================================
 * Quantum Lens — Quantum Core Engine (qcore.js)
 * ---------------------------------------------------------------------
 * Framework-neutral circuit model (IR), gate library, statevector
 * simulator, analysis (Bloch vectors, entanglement, depth), circuit
 * optimizer and multi-framework code generation (Qiskit, Cirq,
 * PennyLane, qBraid, OpenQASM).
 *
 * Circuit IR:
 *   { numQubits: n, ops: [ { gate:'cx', targets:[1], controls:[0],
 *                            params:[..numbers], col?:k } ] }
 *
 * Qubit ordering follows Qiskit (little-endian): in a basis label the
 * right-most bit is q0. All backends are normalised to this convention.
 * ===================================================================== */
(function (root) {
    'use strict';
    const QL = root.QL = root.QL || {};
    const PI = Math.PI;
    const S2 = Math.SQRT1_2;

    // ---------------------------------------------------------------
    // Complex helpers: complex number = [re, im]
    // ---------------------------------------------------------------
    const C = (re, im = 0) => [re, im];
    const cexp = (t) => [Math.cos(t), Math.sin(t)];

    // ---------------------------------------------------------------
    // Gate library
    //   nT = number of target qubits, nC = number of controls,
    //   params = parameter names, matrix(params) = 2x2 base matrix for
    //   single-target gates (controlled variants reuse the base matrix)
    // ---------------------------------------------------------------
    const G = {};
    function def(name, o) { G[name] = Object.assign({ name, nT: 1, nC: 0, params: [], category: 'single' }, o); }

    def('id', { label: 'I', title: 'Identity', desc: 'Leaves the qubit unchanged.', matrix: () => [[C(1), C(0)], [C(0), C(1)]], color: '#9aa5b1' });
    def('x', { label: 'X', title: 'Pauli-X (NOT)', desc: 'Flips |0⟩ ↔ |1⟩. A 180° rotation about the X axis of the Bloch sphere.', matrix: () => [[C(0), C(1)], [C(1), C(0)]], color: '#e5484d', selfInverse: true });
    def('y', { label: 'Y', title: 'Pauli-Y', desc: 'Bit flip and phase flip together. A 180° rotation about the Y axis.', matrix: () => [[C(0), C(0, -1)], [C(0, 1), C(0)]], color: '#e5484d', selfInverse: true });
    def('z', { label: 'Z', title: 'Pauli-Z', desc: 'Phase flip: leaves |0⟩, maps |1⟩ → −|1⟩. A 180° rotation about Z.', matrix: () => [[C(1), C(0)], [C(0), C(-1)]], color: '#e5484d', selfInverse: true, diagonal: true });
    def('h', { label: 'H', title: 'Hadamard', desc: 'Creates an equal superposition: |0⟩ → |+⟩, |1⟩ → |−⟩.', matrix: () => [[C(S2), C(S2)], [C(S2), C(-S2)]], color: '#4facfe', selfInverse: true });
    def('s', { label: 'S', title: 'S (√Z) phase', desc: 'Adds a 90° phase to |1⟩.', matrix: () => [[C(1), C(0)], [C(0), C(0, 1)]], color: '#8e6bd8', diagonal: true, inverse: 'sdg' });
    def('sdg', { label: 'S†', title: 'S-dagger', desc: 'Adds a −90° phase to |1⟩ (inverse of S).', matrix: () => [[C(1), C(0)], [C(0), C(0, -1)]], color: '#8e6bd8', diagonal: true, inverse: 's' });
    def('t', { label: 'T', title: 'T (π/8) phase', desc: 'Adds a 45° phase to |1⟩.', matrix: () => [[C(1), C(0)], [C(0), cexp(PI / 4)]], color: '#8e6bd8', diagonal: true, inverse: 'tdg' });
    def('tdg', { label: 'T†', title: 'T-dagger', desc: 'Adds a −45° phase to |1⟩ (inverse of T).', matrix: () => [[C(1), C(0)], [C(0), cexp(-PI / 4)]], color: '#8e6bd8', diagonal: true, inverse: 't' });
    def('sx', { label: '√X', title: 'Square-root of X', desc: 'Half of an X gate; two in a row equal X.', matrix: () => [[C(0.5, 0.5), C(0.5, -0.5)], [C(0.5, -0.5), C(0.5, 0.5)]], color: '#e5484d' });
    def('rx', { label: 'RX', title: 'Rotation about X', desc: 'Rotates the Bloch vector by θ around the X axis.', params: ['θ'], matrix: ([t]) => [[C(Math.cos(t / 2)), C(0, -Math.sin(t / 2))], [C(0, -Math.sin(t / 2)), C(Math.cos(t / 2))]], color: '#f5a524', rotation: 'x' });
    def('ry', { label: 'RY', title: 'Rotation about Y', desc: 'Rotates the Bloch vector by θ around the Y axis. Real amplitudes only.', params: ['θ'], matrix: ([t]) => [[C(Math.cos(t / 2)), C(-Math.sin(t / 2))], [C(Math.sin(t / 2)), C(Math.cos(t / 2))]], color: '#f5a524', rotation: 'y' });
    def('rz', { label: 'RZ', title: 'Rotation about Z', desc: 'Rotates the Bloch vector by θ around the Z axis (changes relative phase).', params: ['θ'], matrix: ([t]) => [[cexp(-t / 2), C(0)], [C(0), cexp(t / 2)]], color: '#f5a524', rotation: 'z', diagonal: true });
    def('p', { label: 'P', title: 'Phase P(λ)', desc: 'Adds phase λ to |1⟩. P(π/2)=S, P(π/4)=T.', params: ['λ'], matrix: ([l]) => [[C(1), C(0)], [C(0), cexp(l)]], color: '#8e6bd8', diagonal: true, rotation: 'p' });
    def('u', { label: 'U', title: 'General U(θ,φ,λ)', desc: 'The most general single-qubit gate.', params: ['θ', 'φ', 'λ'], matrix: ([t, f, l]) => {
        const c = Math.cos(t / 2), s = Math.sin(t / 2);
        const el = cexp(l), ef = cexp(f), efl = cexp(f + l);
        return [[C(c), C(-el[0] * s, -el[1] * s)], [C(ef[0] * s, ef[1] * s), C(efl[0] * c, efl[1] * c)]];
    }, color: '#f5a524' });
    // Controlled gates
    def('cx', { label: '⊕', title: 'CNOT (CX)', desc: 'Flips the target when the control is |1⟩. The workhorse of entanglement.', nC: 1, base: 'x', category: 'multi', color: '#260859', selfInverse: true });
    def('cy', { label: 'Y', title: 'Controlled-Y', desc: 'Applies Y to the target when the control is |1⟩.', nC: 1, base: 'y', category: 'multi', color: '#260859', selfInverse: true });
    def('cz', { label: 'Z', title: 'Controlled-Z', desc: 'Flips the phase of |11⟩. Symmetric in its two qubits.', nC: 1, base: 'z', category: 'multi', color: '#260859', selfInverse: true, diagonal: true });
    def('ch', { label: 'H', title: 'Controlled-H', desc: 'Applies H to the target when the control is |1⟩.', nC: 1, base: 'h', category: 'multi', color: '#260859', selfInverse: true });
    def('cp', { label: 'P', title: 'Controlled phase', desc: 'Adds phase λ to |11⟩. Used heavily in the QFT.', nC: 1, base: 'p', params: ['λ'], category: 'multi', color: '#260859', diagonal: true });
    def('crx', { label: 'RX', title: 'Controlled-RX', desc: 'Controlled rotation about X.', nC: 1, base: 'rx', params: ['θ'], category: 'multi', color: '#260859' });
    def('cry', { label: 'RY', title: 'Controlled-RY', desc: 'Controlled rotation about Y.', nC: 1, base: 'ry', params: ['θ'], category: 'multi', color: '#260859' });
    def('crz', { label: 'RZ', title: 'Controlled-RZ', desc: 'Controlled rotation about Z.', nC: 1, base: 'rz', params: ['θ'], category: 'multi', color: '#260859', diagonal: true });
    def('ccx', { label: '⊕', title: 'Toffoli (CCX)', desc: 'Flips the target only when both controls are |1⟩. A reversible AND.', nC: 2, base: 'x', category: 'multi', color: '#260859', selfInverse: true });
    def('swap', { label: '×', title: 'SWAP', desc: 'Exchanges the states of two qubits.', nT: 2, category: 'multi', color: '#260859', selfInverse: true });
    def('cswap', { label: '×', title: 'Fredkin (CSWAP)', desc: 'Swaps two targets when the control is |1⟩.', nT: 2, nC: 1, category: 'multi', color: '#260859', selfInverse: true });
    // Non-unitary / structural
    def('measure', { label: 'M', title: 'Measure', desc: 'Reads the qubit in the computational basis. Treated as a terminal measurement.', category: 'special', color: '#1f2933' });
    def('barrier', { label: '┆', title: 'Barrier', desc: 'Visual/compiler separator. Has no effect on the state.', category: 'special', color: '#9aa5b1' });
    def('reset', { label: '|0⟩', title: 'Reset', desc: 'Resets the qubit to |0⟩ (non-unitary).', category: 'special', color: '#1f2933' });

    QL.GATES = G;
    QL.PALETTE = [
        { group: 'Basic', gates: ['h', 'x', 'y', 'z'] },
        { group: 'Phase', gates: ['s', 'sdg', 't', 'tdg', 'p'] },
        { group: 'Rotation', gates: ['rx', 'ry', 'rz', 'sx', 'u'] },
        { group: 'Multi-qubit', gates: ['cx', 'cz', 'cy', 'ch', 'cp', 'crz', 'swap', 'ccx', 'cswap'] },
        { group: 'Other', gates: ['measure', 'barrier', 'reset'] }
    ];

    // ---------------------------------------------------------------
    // Circuit helpers
    // ---------------------------------------------------------------
    function opQubits(op) { return [...(op.controls || []), ...(op.targets || [])]; }
    function cloneCircuit(c) { return JSON.parse(JSON.stringify(c)); }
    function emptyCircuit(n) { return { numQubits: n, ops: [] }; }

    function validateCircuit(c) {
        const errors = [];
        if (!c || !Number.isInteger(c.numQubits) || c.numQubits < 1) errors.push('Circuit must have at least one qubit.');
        if (c.numQubits > QL.MAX_QUBITS) errors.push(`The in-browser engine supports up to ${QL.MAX_QUBITS} qubits.`);
        (c.ops || []).forEach((op, i) => {
            const g = G[op.gate];
            if (!g) { errors.push(`Operation ${i + 1}: unknown gate "${op.gate}".`); return; }
            if (op.gate === 'barrier') return;
            const qs = opQubits(op);
            qs.forEach(q => { if (!(q >= 0 && q < c.numQubits)) errors.push(`${g.title} uses qubit ${q}, but the circuit only has qubits 0–${c.numQubits - 1}.`); });
            if (new Set(qs).size !== qs.length) errors.push(`${g.title} uses the same qubit more than once (${qs.join(', ')}).`);
            if ((op.targets || []).length !== g.nT) errors.push(`${g.title} needs ${g.nT} target qubit(s).`);
            if ((op.controls || []).length !== g.nC) errors.push(`${g.title} needs ${g.nC} control qubit(s).`);
            if ((op.params || []).length < g.params.length || (op.params || []).some(p => typeof p !== 'number' || !isFinite(p))) errors.push(`${g.title} needs numeric parameter(s): ${g.params.join(', ')}.`);
        });
        return errors;
    }
    QL.MAX_QUBITS = 10;

    // ---------------------------------------------------------------
    // Statevector simulator
    // ---------------------------------------------------------------
    class StateVector {
        constructor(n) {
            this.n = n; this.dim = 1 << n;
            this.re = new Float64Array(this.dim); this.im = new Float64Array(this.dim);
            this.re[0] = 1;
        }
        clone() { const s = new StateVector(this.n); s.re.set(this.re); s.im.set(this.im); return s; }
        static fromBasis(n, idx) { const s = new StateVector(n); s.re[0] = 0; s.re[idx] = 1; return s; }
        apply1(m, t, controls = []) {
            const bit = 1 << t; let cmask = 0; controls.forEach(c => cmask |= (1 << c));
            const { re, im } = this;
            const [[a, b], [c, d]] = m;
            for (let i = 0; i < this.dim; i++) {
                if (i & bit) continue;
                if ((i & cmask) !== cmask) continue;
                const j = i | bit;
                const xr = re[i], xi = im[i], yr = re[j], yi = im[j];
                re[i] = a[0] * xr - a[1] * xi + b[0] * yr - b[1] * yi;
                im[i] = a[0] * xi + a[1] * xr + b[0] * yi + b[1] * yr;
                re[j] = c[0] * xr - c[1] * xi + d[0] * yr - d[1] * yi;
                im[j] = c[0] * xi + c[1] * xr + d[0] * yi + d[1] * yr;
            }
        }
        swap(q1, q2, controls = []) {
            const b1 = 1 << q1, b2 = 1 << q2; let cmask = 0; controls.forEach(c => cmask |= (1 << c));
            const { re, im } = this;
            for (let i = 0; i < this.dim; i++) {
                if ((i & cmask) !== cmask) continue;
                if ((i & b1) && !(i & b2)) {
                    const j = (i & ~b1) | b2;
                    let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t;
                }
            }
        }
        reset(q) {
            // Project onto |0> for qubit q (keep |1> branch moved to |0>) and renormalise — deterministic reset.
            const bit = 1 << q; const { re, im } = this;
            for (let i = 0; i < this.dim; i++) {
                if (i & bit) {
                    const j = i & ~bit;
                    // combine as a mixed state is impossible in a pure simulator; we keep the dominant pure approximation
                    re[j] = Math.hypot(re[j], im[j], re[i], im[i]) * Math.sign(re[j] || 1); im[j] = 0; re[i] = 0; im[i] = 0;
                }
            }
            this.normalize();
        }
        normalize() { let s = 0; for (let i = 0; i < this.dim; i++) s += this.re[i] ** 2 + this.im[i] ** 2; s = Math.sqrt(s) || 1; for (let i = 0; i < this.dim; i++) { this.re[i] /= s; this.im[i] /= s; } }
        applyOp(op) {
            const g = G[op.gate];
            if (!g) throw new Error(`Unknown gate "${op.gate}"`);
            if (op.gate === 'measure' || op.gate === 'barrier' || op.gate === 'id') return;
            if (op.gate === 'reset') { this.reset(op.targets[0]); return; }
            if (op.gate === 'swap' || op.gate === 'cswap') { this.swap(op.targets[0], op.targets[1], op.controls || []); return; }
            const base = g.base ? G[g.base] : g;
            this.apply1(base.matrix(op.params || []), op.targets[0], op.controls || []);
        }
        probabilities() { const p = new Float64Array(this.dim); for (let i = 0; i < this.dim; i++) p[i] = this.re[i] ** 2 + this.im[i] ** 2; return p; }
        amplitudes() { const a = []; for (let i = 0; i < this.dim; i++) a.push([this.re[i], this.im[i]]); return a; }
        /** Reduced single-qubit density matrix -> Bloch vector */
        bloch(q) {
            const bit = 1 << q; let p0 = 0, p1 = 0, r01 = 0, i01 = 0;
            for (let i = 0; i < this.dim; i++) {
                const pr = this.re[i] ** 2 + this.im[i] ** 2;
                if (i & bit) { p1 += pr; continue; }
                p0 += pr;
                const j = i | bit; // rho01 += a_i * conj(a_j)
                r01 += this.re[i] * this.re[j] + this.im[i] * this.im[j];
                i01 += this.im[i] * this.re[j] - this.re[i] * this.im[j];
            }
            const x = 2 * r01, y = -2 * i01, z = p0 - p1;
            const len = Math.min(1, Math.sqrt(x * x + y * y + z * z));
            return { x, y, z, length: len, purity: (1 + len * len) / 2, p0, p1, theta: Math.acos(Math.max(-1, Math.min(1, len ? z / len : 1))), phi: Math.atan2(y, x) };
        }
    }
    QL.StateVector = StateVector;

    /** Run a circuit. Returns statevector + helpers. upto: number of ops to apply (for stepping). */
    function simulate(circuit, opts = {}) {
        const errs = validateCircuit(circuit);
        if (errs.length) { const e = new Error(errs[0]); e.errors = errs; throw e; }
        const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        const sv = opts.initial ? opts.initial.clone() : new StateVector(circuit.numQubits);
        const ops = circuit.ops.slice(0, opts.upto == null ? circuit.ops.length : opts.upto);
        const measured = new Set();
        const warnings = [];
        ops.forEach(op => {
            if (op.gate === 'measure') { measured.add(op.targets[0]); return; }
            if (opQubits(op).some(q => measured.has(q)) && op.gate !== 'barrier') {
                warnings.push(`${G[op.gate].title} acts on qubit ${opQubits(op).filter(q => measured.has(q)).join(',')} after it was measured; measurements are treated as terminal.`);
            }
            sv.applyOp(op);
        });
        const probs = sv.probabilities();
        const measuredQubits = measured.size ? [...measured].sort((a, b) => a - b) : [...Array(circuit.numQubits).keys()];
        const t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        return {
            numQubits: circuit.numQubits, state: sv, amplitudes: sv.amplitudes(), probabilities: Array.from(probs),
            measuredQubits, explicitMeasurement: measured.size > 0, warnings,
            bloch: [...Array(circuit.numQubits).keys()].map(q => sv.bloch(q)),
            marginal: marginal(probs, measuredQubits), timeMs: t1 - t0
        };
    }
    QL.simulate = simulate;

    /** Marginal distribution over a subset of qubits; keys ordered highest qubit first (Qiskit style). */
    function marginal(probs, qubits) {
        const out = {}; const sorted = [...qubits].sort((a, b) => b - a);
        for (let i = 0; i < probs.length; i++) {
            if (probs[i] < 1e-15) continue;
            const key = sorted.map(q => (i >> q) & 1).join('');
            out[key] = (out[key] || 0) + probs[i];
        }
        return out;
    }
    QL.marginal = marginal;

    /** Seeded PRNG (mulberry32) so results can be reproduced */
    function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
    function sampleCounts(dist, shots, seed) {
        const r = rng(seed == null ? (Date.now() & 0xffffffff) : seed);
        const keys = Object.keys(dist).sort(); const cum = []; let acc = 0;
        keys.forEach(k => { acc += dist[k]; cum.push(acc); });
        const counts = {};
        for (let s = 0; s < shots; s++) {
            const u = r() * acc; let lo = 0, hi = cum.length - 1;
            while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < u) lo = mid + 1; else hi = mid; }
            counts[keys[lo]] = (counts[keys[lo]] || 0) + 1;
        }
        return counts;
    }
    QL.sampleCounts = sampleCounts;

    // ---------------------------------------------------------------
    // Comparisons / grading helpers
    // ---------------------------------------------------------------
    /** |<a|b>|^2 between two amplitude arrays [[re,im],...] */
    function fidelity(a, b) {
        if (a.length !== b.length) return 0;
        let r = 0, i = 0;
        for (let k = 0; k < a.length; k++) { r += a[k][0] * b[k][0] + a[k][1] * b[k][1]; i += a[k][0] * b[k][1] - a[k][1] * b[k][0]; }
        return r * r + i * i;
    }
    QL.fidelity = fidelity;

    /** Unitary as array of columns (each column = amplitudes after applying circuit to |i>) */
    function unitaryColumns(circuit) {
        const cols = []; const dim = 1 << circuit.numQubits;
        const unitaryOps = circuit.ops.filter(o => o.gate !== 'measure' && o.gate !== 'barrier');
        for (let i = 0; i < dim; i++) cols.push(simulate({ numQubits: circuit.numQubits, ops: unitaryOps }, { initial: StateVector.fromBasis(circuit.numQubits, i) }).amplitudes);
        return cols;
    }
    /** Process fidelity |Tr(U†V)|/d — equal to 1 iff unitaries match up to global phase */
    function unitaryFidelity(c1, c2) {
        const A = unitaryColumns(c1), B = unitaryColumns(c2);
        let r = 0, i = 0;
        for (let k = 0; k < A.length; k++) for (let j = 0; j < A[k].length; j++) { r += A[k][j][0] * B[k][j][0] + A[k][j][1] * B[k][j][1]; i += A[k][j][0] * B[k][j][1] - A[k][j][1] * B[k][j][0]; }
        return Math.hypot(r, i) / A.length;
    }
    QL.unitaryFidelity = unitaryFidelity;

    function totalVariation(p, q) {
        const keys = new Set([...Object.keys(p), ...Object.keys(q)]); let d = 0;
        keys.forEach(k => d += Math.abs((p[k] || 0) - (q[k] || 0)));
        return d / 2;
    }
    QL.totalVariation = totalVariation;

    // ---------------------------------------------------------------
    // Circuit metrics & layout
    // ---------------------------------------------------------------
    /** Assign each op to the earliest column that is free across its qubit span */
    function layoutColumns(circuit) {
        const n = circuit.numQubits; const level = new Array(n).fill(0);
        return circuit.ops.map(op => {
            let qs = op.gate === 'barrier' ? [...Array(n).keys()] : opQubits(op);
            if (!qs.length) qs = [...Array(n).keys()];
            const lo = Math.min(...qs), hi = Math.max(...qs);
            let col = 0; for (let q = lo; q <= hi; q++) col = Math.max(col, level[q]);
            for (let q = lo; q <= hi; q++) level[q] = col + 1;
            return Object.assign({}, op, { col });
        });
    }
    QL.layoutColumns = layoutColumns;

    function metrics(circuit) {
        const n = circuit.numQubits; const lv = new Array(n).fill(0);
        let gates = 0, twoQ = 0, meas = 0; const byGate = {};
        circuit.ops.forEach(op => {
            if (op.gate === 'barrier') return;
            if (op.gate === 'measure') { meas++; }
            else { gates++; if (opQubits(op).length > 1) twoQ++; }
            byGate[op.gate] = (byGate[op.gate] || 0) + 1;
            const qs = opQubits(op); const d = Math.max(...qs.map(q => lv[q])) + 1; qs.forEach(q => lv[q] = d);
        });
        const used = new Set(); circuit.ops.forEach(op => opQubits(op).forEach(q => used.add(q)));
        return { qubits: n, gates, twoQubitGates: twoQ, measurements: meas, depth: Math.max(0, ...lv), byGate, unusedQubits: [...Array(n).keys()].filter(q => !used.has(q)) };
    }
    QL.metrics = metrics;

    // ---------------------------------------------------------------
    // Parameter formatting
    // ---------------------------------------------------------------
    function fmtAngle(v, style = 'py') {
        const piName = style === 'qasm' ? 'pi' : style === 'np' ? 'np.pi' : style === 'cirq' ? 'np.pi' : 'np.pi';
        if (Math.abs(v) < 1e-12) return '0';
        const r = v / PI;
        const fracs = [[1, 1], [1, 2], [1, 3], [2, 3], [1, 4], [3, 4], [1, 6], [5, 6], [1, 8], [3, 8], [5, 8], [7, 8], [1, 16], [3, 2], [5, 4], [7, 4], [2, 1]];
        for (const [a, b] of fracs) {
            for (const sgn of [1, -1]) {
                if (Math.abs(r - sgn * a / b) < 1e-9) {
                    const s = sgn < 0 ? '-' : '';
                    const num = a === 1 ? piName : `${a}*${piName}`;
                    return b === 1 ? `${s}${num}` : `${s}${num}/${b}`;
                }
            }
        }
        return (+v.toFixed(6)).toString();
    }
    QL.fmtAngle = fmtAngle;
    function fmtAngleHuman(v) { return fmtAngle(v, 'qasm').replace(/pi/g, 'π').replace(/\*/g, ''); }
    QL.fmtAngleHuman = fmtAngleHuman;

    // ---------------------------------------------------------------
    // Code generation
    // ---------------------------------------------------------------
    const FRAMEWORKS = {
        qiskit: { label: 'Qiskit (Aer)', lang: 'python' },
        cirq: { label: 'Cirq', lang: 'python' },
        pennylane: { label: 'PennyLane', lang: 'python' },
        qbraid: { label: 'qBraid', lang: 'python' },
        qasm: { label: 'OpenQASM 2.0', lang: 'qasm' }
    };
    QL.FRAMEWORKS = FRAMEWORKS;

    function measuredOf(c) { return [...new Set(c.ops.filter(o => o.gate === 'measure').map(o => o.targets[0]))].sort((a, b) => a - b); }

    function toQASM(c) {
        const lines = ['OPENQASM 2.0;', 'include "qelib1.inc";', `qreg q[${c.numQubits}];`];
        const measured = measuredOf(c);
        if (measured.length) lines.push(`creg c[${c.numQubits}];`);
        c.ops.forEach(op => {
            const q = (i) => `q[${i}]`;
            const ps = (op.params || []).length ? `(${op.params.map(p => fmtAngle(p, 'qasm')).join(',')})` : '';
            switch (op.gate) {
                case 'measure': lines.push(`measure q[${op.targets[0]}] -> c[${op.targets[0]}];`); break;
                case 'barrier': lines.push(`barrier q;`); break;
                case 'p': lines.push(`u1${ps} ${q(op.targets[0])};`); break;
                case 'u': lines.push(`u3${ps} ${q(op.targets[0])};`); break;
                case 'cp': lines.push(`cu1${ps} ${q(op.controls[0])},${q(op.targets[0])};`); break;
                default: lines.push(`${op.gate}${ps} ${[...(op.controls || []), ...op.targets].map(q).join(',')};`);
            }
        });
        return lines.join('\n') + '\n';
    }

    function toQiskit(c, opts = {}) {
        const measured = measuredOf(c);
        const L = ['from qiskit import QuantumCircuit, transpile', 'from qiskit_aer import AerSimulator'];
        const usesPi = c.ops.some(o => (o.params || []).length);
        if (usesPi) L.push('import numpy as np');
        L.push('', `qc = QuantumCircuit(${c.numQubits}${measured.length ? ', ' + c.numQubits : ''})`);
        c.ops.forEach(op => {
            const ps = (op.params || []).map(p => fmtAngle(p, 'np'));
            const qs = [...(op.controls || []), ...op.targets];
            switch (op.gate) {
                case 'measure': L.push(`qc.measure(${op.targets[0]}, ${op.targets[0]})`); break;
                case 'barrier': L.push('qc.barrier()'); break;
                case 'u': L.push(`qc.u(${[...ps, ...qs].join(', ')})`); break;
                default: L.push(`qc.${op.gate}(${[...ps, ...qs].join(', ')})`);
            }
        });
        if (opts.run !== false) {
            if (!measured.length) L.push('qc.measure_all()');
            L.push('', '# Run on the Qiskit Aer simulator', 'sim = AerSimulator()', 'result = sim.run(transpile(qc, sim), shots=1024).result()', 'print(result.get_counts())', 'print(qc.draw())');
        }
        return L.join('\n') + '\n';
    }

    function toCirq(c, opts = {}) {
        // Cirq is big-endian: IR qubit k -> LineQubit(k) but we measure in descending order so bitstrings match Qiskit order.
        const L = ['import cirq'];
        if (c.ops.some(o => (o.params || []).length)) L.push('import numpy as np');
        L.push('', `q = cirq.LineQubit.range(${c.numQubits})`, 'circuit = cirq.Circuit()');
        const measured = measuredOf(c);
        const name = { h: 'H', x: 'X', y: 'Y', z: 'Z', s: 'S', t: 'T', cx: 'CNOT', cz: 'CZ', swap: 'SWAP', ccx: 'TOFFOLI', cswap: 'FREDKIN', id: 'I' };
        c.ops.forEach(op => {
            const qs = [...(op.controls || []), ...op.targets].map(i => `q[${i}]`).join(', ');
            const p = (op.params || []).map(v => fmtAngle(v, 'np'));
            let expr = null;
            if (name[op.gate]) expr = `cirq.${name[op.gate]}(${qs})`;
            else switch (op.gate) {
                case 'sdg': expr = `(cirq.S**-1)(${qs})`; break;
                case 'tdg': expr = `(cirq.T**-1)(${qs})`; break;
                case 'sx': expr = `(cirq.X**0.5)(${qs})`; break;
                case 'rx': case 'ry': case 'rz': expr = `cirq.${op.gate}(${p[0]})(${qs})`; break;
                case 'p': expr = `cirq.ZPowGate(exponent=${p[0]}/np.pi)(${qs})`; break;
                case 'u': // U(θ,φ,λ) = RZ(φ)·RY(θ)·RZ(λ) up to a global phase
                    L.push(`circuit.append(cirq.rz(${p[2]})(${qs}))`, `circuit.append(cirq.ry(${p[0]})(${qs}))`); expr = `cirq.rz(${p[1]})(${qs})`; break;
                case 'cy': expr = `cirq.Y.controlled()(${qs})`; break;
                case 'ch': expr = `cirq.H.controlled()(${qs})`; break;
                case 'cp': expr = `cirq.CZPowGate(exponent=${p[0]}/np.pi)(${qs})`; break;
                case 'crx': case 'cry': case 'crz': expr = `cirq.${op.gate.slice(1)}(${p[0]}).controlled()(${qs})`; break;
                case 'reset': expr = `cirq.ResetChannel()(${qs})`; break;
                case 'measure': case 'barrier': expr = null; break;
            }
            if (expr) L.push(`circuit.append(${expr})`);
        });
        const mq = (measured.length ? measured : [...Array(c.numQubits).keys()]).slice().sort((a, b) => b - a);
        L.push(`circuit.append(cirq.measure(${mq.map(i => `q[${i}]`).join(', ')}, key='m'))  # highest qubit first = Qiskit bit order`);
        if (opts.run !== false) L.push('', 'sim = cirq.Simulator()', 'result = sim.run(circuit, repetitions=1024)', `print(result.histogram(key='m'))`, 'print(circuit)');
        return L.join('\n') + '\n';
    }

    function toPennyLane(c, opts = {}) {
        // PennyLane wire 0 is the most significant bit; we map IR qubit k -> wire k and ask for probs on reversed wires
        const n = c.numQubits;
        const L = ['import pennylane as qml'];
        if (c.ops.some(o => (o.params || []).length)) L.push('import numpy as np');
        L.push('', `dev = qml.device("default.qubit", wires=${n})`, '', '@qml.qnode(dev)', 'def circuit():');
        const name = { h: 'Hadamard', x: 'PauliX', y: 'PauliY', z: 'PauliZ', s: 'S', t: 'T', sx: 'SX', id: 'Identity', rx: 'RX', ry: 'RY', rz: 'RZ', p: 'PhaseShift', cx: 'CNOT', cy: 'CY', cz: 'CZ', ch: 'CH', swap: 'SWAP', ccx: 'Toffoli', cswap: 'CSWAP', cp: 'ControlledPhaseShift', crx: 'CRX', cry: 'CRY', crz: 'CRZ', u: 'U3' };
        let body = 0;
        c.ops.forEach(op => {
            const qs = [...(op.controls || []), ...op.targets];
            const w = qs.length === 1 ? `wires=${qs[0]}` : `wires=[${qs.join(', ')}]`;
            const p = (op.params || []).map(v => fmtAngle(v, 'np'));
            if (op.gate === 'measure' || op.gate === 'barrier') return;
            if (op.gate === 'sdg') { L.push(`    qml.adjoint(qml.S)(${w})`); body++; return; }
            if (op.gate === 'tdg') { L.push(`    qml.adjoint(qml.T)(${w})`); body++; return; }
            if (op.gate === 'reset') { L.push(`    # reset on wire ${qs[0]} is not supported inside a PennyLane qnode`); return; }
            L.push(`    qml.${name[op.gate]}(${[...p, w].join(', ')})`); body++;
        });
        const measured = measuredOf(c); const mq = (measured.length ? measured : [...Array(n).keys()]).slice().sort((a, b) => b - a);
        L.push(`    return qml.probs(wires=[${mq.join(', ')}])  # highest qubit first = Qiskit bit order`);
        if (opts.run !== false) L.push('', 'print(circuit())', 'print(qml.draw(circuit)())');
        return L.join('\n') + '\n';
    }

    function toQBraid(c) {
        const qasm = toQASM(c).trim();
        return [
            'from qbraid import transpile',
            'import cirq',
            '',
            '# qBraid works with any framework: we describe the circuit in OpenQASM 2',
            '# and let the qBraid SDK transpile it to the target framework.',
            'program = """',
            qasm,
            '"""',
            '',
            'cirq_circuit = transpile(program, "cirq")',
            'result = cirq.Simulator().run(cirq_circuit, repetitions=1024)',
            'print(result.histogram(key="c") if "c" in result.measurements else result)',
            '',
            '# To run on qBraid-hosted devices (requires a qBraid account/API key):',
            '# from qbraid.runtime import QbraidProvider',
            '# device = QbraidProvider().get_device("qbraid_qir_simulator")',
            '# job = device.run(program, shots=1024); print(job.result().data.get_counts())'
        ].join('\n') + '\n';
    }

    function generateCode(circuit, framework, opts) {
        switch (framework) {
            case 'qiskit': return toQiskit(circuit, opts);
            case 'cirq': return toCirq(circuit, opts);
            case 'pennylane': return toPennyLane(circuit, opts);
            case 'qbraid': return toQBraid(circuit, opts);
            case 'qasm': default: return toQASM(circuit);
        }
    }
    QL.generateCode = generateCode;
    QL.toQASM = toQASM;

    // ---------------------------------------------------------------
    // Optimizer — peephole passes that preserve the unitary (up to phase)
    // ---------------------------------------------------------------
    function sameQubits(a, b) { return JSON.stringify(a.controls || []) === JSON.stringify(b.controls || []) && JSON.stringify(a.targets) === JSON.stringify(b.targets); }
    function symmetricMatch(a, b) {
        if (sameQubits(a, b)) return true;
        if ((a.gate === 'cz' || a.gate === 'swap' || a.gate === 'cp') && a.gate === b.gate) {
            const sa = opQubits(a).slice().sort().join(','), sb = opQubits(b).slice().sort().join(',');
            return sa === sb;
        }
        return false;
    }
    function norm2pi(v) { const t = 2 * PI * 2; let r = v % t; if (r > t / 2) r -= t; if (r < -t / 2) r += t; return r; }

    function optimize(circuit) {
        let ops = circuit.ops.map(o => Object.assign({}, o, { col: undefined }));
        const notes = [];
        let changed = true, guard = 0;
        while (changed && guard++ < 50) {
            changed = false;
            for (let i = 0; i < ops.length && !changed; i++) {
                const a = ops[i]; if (a.gate === 'barrier' || a.gate === 'measure' || a.gate === 'reset') continue;
                // find the next op touching any of a's qubits
                const qa = opQubits(a); let j = i + 1;
                while (j < ops.length && !opQubits(ops[j]).some(q => qa.includes(q)) && ops[j].gate !== 'barrier') j++;
                if (j >= ops.length) continue;
                const b = ops[j];
                const bq = opQubits(b);
                // Only combine when b touches exactly the same qubit set
                if (bq.length !== qa.length || !bq.every(q => qa.includes(q))) {
                    // identity rotations
                    continue;
                }
                const g = G[a.gate];
                // 1) Self-inverse pairs cancel
                if (a.gate === b.gate && g.selfInverse && symmetricMatch(a, b)) {
                    notes.push(`Removed ${g.title} pair on qubit(s) ${qa.join(',')} — they cancel (${g.label}·${g.label} = I).`);
                    ops.splice(j, 1); ops.splice(i, 1); changed = true; break;
                }
                // 2) Inverse pairs S·S†, T·T†
                if (g.inverse && b.gate === g.inverse && sameQubits(a, b)) {
                    notes.push(`Removed ${g.title} followed by its inverse on qubit ${qa[0]}.`);
                    ops.splice(j, 1); ops.splice(i, 1); changed = true; break;
                }
                // 3) Merge rotations about the same axis
                if (g.rotation && a.gate === b.gate && sameQubits(a, b)) {
                    const sum = a.params[0] + b.params[0];
                    notes.push(`Merged two ${g.title} gates on qubit(s) ${qa.join(',')} into one with angle ${fmtAngleHuman(sum)}.`);
                    ops.splice(j, 1); ops[i] = Object.assign({}, a, { params: [sum] }); changed = true; break;
                }
                // 4) S·S = Z, T·T = S
                if ((a.gate === 's' && b.gate === 's') || (a.gate === 't' && b.gate === 't') || (a.gate === 'sdg' && b.gate === 'sdg') || (a.gate === 'tdg' && b.gate === 'tdg')) {
                    const to = { s: 'z', t: 's', sdg: 'z', tdg: 'sdg' }[a.gate];
                    notes.push(`Replaced ${g.label}·${g.label} on qubit ${qa[0]} with a single ${G[to].label} gate.`);
                    ops.splice(j, 1); ops[i] = { gate: to, targets: a.targets.slice(), controls: [], params: [] }; changed = true; break;
                }
                // 5) H X H = Z,  H Z H = X
                if (a.gate === 'h' && (b.gate === 'x' || b.gate === 'z') && qa.length === 1) {
                    let k = j + 1; while (k < ops.length && !opQubits(ops[k]).includes(qa[0])) k++;
                    if (k < ops.length && ops[k].gate === 'h' && sameQubits(ops[k], a)) {
                        const to = b.gate === 'x' ? 'z' : 'x';
                        notes.push(`Replaced H·${b.gate.toUpperCase()}·H on qubit ${qa[0]} with ${to.toUpperCase()} (basis-change identity).`);
                        ops.splice(k, 1); ops.splice(j, 1); ops[i] = { gate: to, targets: a.targets.slice(), controls: [], params: [] }; changed = true; break;
                    }
                }
            }
            // remove zero rotations
            for (let i = 0; i < ops.length && !changed; i++) {
                const g = G[ops[i].gate];
                if (g.rotation && Math.abs(norm2pi(ops[i].params[0])) < 1e-9) {
                    notes.push(`Removed ${g.title} with angle ≈ 0 on qubit ${ops[i].targets[0]} (does nothing).`);
                    ops.splice(i, 1); changed = true;
                }
                if (ops[i] && ops[i].gate === 'id') { notes.push(`Removed identity gate on qubit ${ops[i].targets[0]}.`); ops.splice(i, 1); changed = true; }
            }
        }
        // 6) Phase-only gates right before a measurement don't change counts
        const measureAdvice = [];
        const n = circuit.numQubits;
        for (let q = 0; q < n; q++) {
            const touching = ops.map((o, i) => [o, i]).filter(([o]) => opQubits(o).includes(q));
            for (let k = touching.length - 1; k > 0; k--) {
                const [o] = touching[k];
                if (o.gate === 'measure') {
                    const [prev] = touching[k - 1];
                    const pg = G[prev.gate];
                    if (pg && pg.diagonal && opQubits(prev).length === 1) measureAdvice.push(`${pg.title} on qubit ${q} just before its measurement only changes phase — it cannot change the measured counts.`);
                    break;
                }
            }
        }
        const out = { numQubits: circuit.numQubits, ops };
        return { circuit: out, notes, advice: measureAdvice, before: metrics(circuit), after: metrics(out) };
    }
    QL.optimize = optimize;

    // ---------------------------------------------------------------
    // State recognition — used by the tutor to describe results
    // ---------------------------------------------------------------
    function describeState(amps, n) {
        const nz = amps.map((a, i) => ({ i, a, p: a[0] ** 2 + a[1] ** 2 })).filter(x => x.p > 1e-9);
        const lab = (i) => i.toString(2).padStart(n, '0');
        const fmtAmp = (a) => {
            const [r, im] = a; const m = Math.hypot(r, im);
            const known = [[1, '1'], [S2, '1/√2'], [0.5, '1/2'], [1 / Math.sqrt(8), '1/(2√2)'], [0.25, '1/4']];
            let ms = m.toFixed(3); for (const [v, s] of known) if (Math.abs(m - v) < 1e-6) ms = s;
            const ph = Math.atan2(im, r);
            let ps = '';
            if (Math.abs(ph) < 1e-6) ps = ''; else if (Math.abs(Math.abs(ph) - PI) < 1e-6) ps = '−'; else if (Math.abs(ph - PI / 2) < 1e-6) ps = 'i·'; else if (Math.abs(ph + PI / 2) < 1e-6) ps = '−i·'; else ps = `e^(i${fmtAngleHuman(ph)})·`;
            return { ms, ps };
        };
        if (nz.length > 16) return `a superposition over ${nz.length} basis states`;
        const terms = nz.map(x => { const { ms, ps } = fmtAmp(x.a); return `${ps}${ms === '1' ? '' : ms}|${lab(x.i)}⟩`; });
        let s = terms.join(' + ').replace(/\+ −/g, '− ');
        const named = {};
        if (n === 2) {
            named['0,3:+'] = 'the Bell state |Φ⁺⟩'; named['0,3:-'] = 'the Bell state |Φ⁻⟩'; named['1,2:+'] = 'the Bell state |Ψ⁺⟩'; named['1,2:-'] = 'the Bell state |Ψ⁻⟩';
        }
        if (nz.length === 2 && Math.abs(nz[0].p - 0.5) < 1e-6) {
            const rel = Math.atan2(nz[1].a[1], nz[1].a[0]) - Math.atan2(nz[0].a[1], nz[0].a[0]);
            const sign = Math.abs(Math.cos(rel) - 1) < 1e-6 ? '+' : Math.abs(Math.cos(rel) + 1) < 1e-6 ? '-' : '?';
            const key = `${nz[0].i},${nz[1].i}:${sign}`;
            if (named[key]) return `${named[key]} = ${s}`;
            if (n >= 3 && nz[0].i === 0 && nz[1].i === (1 << n) - 1) return `a ${n}-qubit GHZ state = ${s}`;
        }
        if (nz.length === (1 << n) && nz.every(x => Math.abs(x.p - 1 / (1 << n)) < 1e-6) && nz.every(x => Math.abs(x.a[1]) < 1e-9 && x.a[0] > 0)) return n === 1 ? 'the |+⟩ state (0 and 1 equally likely)' : `the uniform superposition |+⟩^⊗${n} (all ${1 << n} outcomes equally likely)`;
        if (nz.length === 1) return `the basis state |${lab(nz[0].i)}⟩`;
        return s;
    }
    QL.describeState = describeState;

    /** Detect product vs entangled (for pure states: any qubit with Bloch length < 1 is entangled) */
    QL.entangledQubits = (sim) => sim.bloch.map((b, q) => ({ q, b })).filter(x => x.b.length < 0.999).map(x => x.q);

    QL.opQubits = opQubits; QL.cloneCircuit = cloneCircuit; QL.emptyCircuit = emptyCircuit; QL.validateCircuit = validateCircuit;
    QL.basisLabel = (i, n) => i.toString(2).padStart(n, '0');
})(typeof window !== 'undefined' ? window : globalThis);
