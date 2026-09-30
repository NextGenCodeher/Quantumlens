/* =====================================================================
 * Quantum Lens — Learning content (qcontent.js)
 * Structured modules, quizzes, challenges, example circuits and the
 * tutor knowledge base. Pure data: add a module or challenge by adding
 * an object here — pages render everything from these definitions.
 * ===================================================================== */
(function (root) {
    'use strict';
    const QL = root.QL = root.QL || {};
    const PI = Math.PI;
    const g = (gate, t, ...params) => ({ gate, targets: [t], controls: [], params });
    const c = (gate, ctrl, t, ...params) => ({ gate, targets: [t], controls: Array.isArray(ctrl) ? ctrl : [ctrl], params });
    const m = (q) => ({ gate: 'measure', targets: [q], controls: [], params: [] });
    const sw = (a, b) => ({ gate: 'swap', targets: [a, b], controls: [], params: [] });
    const circ = (n, ops) => ({ numQubits: n, ops });
    const hAll = (n) => [...Array(n).keys()].map(q => g('h', q));
    const ccz = (a, b, t) => [g('h', t), c('ccx', [a, b], t), g('h', t)];

    // -----------------------------------------------------------------
    // Example circuit library (used by lessons, tutor and the Lab)
    // -----------------------------------------------------------------
    const EXAMPLES = {
        superposition: { title: 'Single-qubit superposition', desc: 'A Hadamard puts |0⟩ into (|0⟩+|1⟩)/√2 — a fair quantum coin.', circuit: circ(1, [g('h', 0), m(0)]) },
        bell: { title: 'Bell state |Φ⁺⟩', desc: 'H + CNOT create the maximally entangled pair (|00⟩+|11⟩)/√2.', circuit: circ(2, [g('h', 0), c('cx', 0, 1), m(0), m(1)]) },
        bell_psi_minus: { title: 'Bell state |Ψ⁻⟩', desc: 'The singlet state (|01⟩−|10⟩)/√2.', circuit: circ(2, [g('x', 0), g('x', 1), g('h', 0), c('cx', 0, 1), m(0), m(1)]) },
        ghz: { title: 'GHZ state (3 qubits)', desc: 'Three-qubit entanglement: (|000⟩+|111⟩)/√2.', circuit: circ(3, [g('h', 0), c('cx', 0, 1), c('cx', 1, 2), m(0), m(1), m(2)]) },
        uniform: { title: 'Uniform superposition', desc: 'H on every qubit gives all 8 outcomes equal probability.', circuit: circ(3, [...hAll(3), m(0), m(1), m(2)]) },
        interference: { title: 'Interference (H·H = I)', desc: 'Two Hadamards cancel: the |1⟩ paths interfere destructively.', circuit: circ(1, [g('h', 0), g('h', 0), m(0)]) },
        phase_kickback: { title: 'Phase kickback', desc: 'The target is |−⟩, so the CNOT kicks a phase back onto the control, flipping it from |+⟩ to |−⟩.', circuit: circ(2, [g('x', 1), g('h', 1), g('h', 0), c('cx', 0, 1), g('h', 0), m(0)]) },
        teleportation: { title: 'Quantum teleportation', desc: 'Teleports the state of q0 onto q2 using a Bell pair (deferred-measurement form).', circuit: circ(3, [g('ry', 0, 1.1), g('h', 1), c('cx', 1, 2), c('cx', 0, 1), g('h', 0), c('cx', 1, 2), c('cz', 0, 2), m(2)]) },
        deutsch_jozsa: { title: 'Deutsch–Jozsa (balanced oracle)', desc: 'One query decides constant vs balanced: any non-zero result means balanced.', circuit: circ(3, [g('x', 2), ...hAll(3), c('cx', 0, 2), c('cx', 1, 2), g('h', 0), g('h', 1), m(0), m(1)]) },
        bernstein_vazirani: { title: 'Bernstein–Vazirani (s = 101)', desc: 'Recovers the hidden bit-string s in a single query.', circuit: circ(4, [g('x', 3), g('h', 3), ...hAll(3), c('cx', 0, 3), c('cx', 2, 3), ...hAll(3), m(0), m(1), m(2)]) },
        grover2: { title: "Grover's search (2 qubits, marks |11⟩)", desc: 'One Grover iteration finds the marked item with certainty.', circuit: circ(2, [g('h', 0), g('h', 1), c('cz', 0, 1), g('h', 0), g('h', 1), g('x', 0), g('x', 1), c('cz', 0, 1), g('x', 0), g('x', 1), g('h', 0), g('h', 1), m(0), m(1)]) },
        grover3: { title: "Grover's search (3 qubits, marks |101⟩)", desc: 'Two iterations amplify the marked state to ≈ 94.5%.', circuit: circ(3, (() => { const it = [g('x', 1), ...ccz(0, 1, 2), g('x', 1), ...hAll(3), g('x', 0), g('x', 1), g('x', 2), ...ccz(0, 1, 2), g('x', 0), g('x', 1), g('x', 2), ...hAll(3)]; return [...hAll(3), ...it, ...it, m(0), m(1), m(2)]; })()) },
        qft3: { title: 'Quantum Fourier Transform (3 qubits)', desc: 'QFT applied to |101⟩ — the result encodes the input in relative phases.', circuit: circ(3, [g('x', 0), g('x', 2), g('h', 2), c('cp', 1, 2, PI / 2), c('cp', 0, 2, PI / 4), g('h', 1), c('cp', 0, 1, PI / 2), g('h', 0), sw(0, 2)]) },
        qrng: { title: 'Quantum random number generator', desc: 'Measuring 3 qubits in superposition gives a uniformly random number 0–7.', circuit: circ(3, [...hAll(3), m(0), m(1), m(2)]) },
        rotation: { title: 'Rotations on the Bloch sphere', desc: 'RY(π/3) then RZ(π/2) tilts and spins the Bloch vector.', circuit: circ(1, [g('ry', 0, PI / 3), g('rz', 0, PI / 2)]) }
    };
    QL.EXAMPLES = EXAMPLES;

    // -----------------------------------------------------------------
    // Learning modules
    // -----------------------------------------------------------------
    const MODULES = [
        {
            id: 'fundamentals', num: 1, title: 'Quantum Computing Fundamentals', icon: 'fa-atom', level: 'Beginner', minutes: 20, prereqs: [], topic: 'fundamentals',
            summary: 'What a quantum computer is, why it is different, and where it helps.',
            lessons: [
                { title: 'Bits vs. qubits', html: `<p>A classical computer stores information in <strong>bits</strong> that are always either 0 or 1. A quantum computer stores information in <strong>qubits</strong>. A qubit can be in the state |0⟩, the state |1⟩, or a <em>superposition</em> of both, described by two complex numbers called <strong>amplitudes</strong>.</p><p>When you measure a qubit you only ever see 0 or 1. The amplitudes decide the <em>probabilities</em> of each result. Quantum algorithms are clever recipes that make the amplitudes of wrong answers cancel out and the amplitudes of right answers add up.</p>` },
                { title: 'Three quantum ingredients', html: `<ul class="ql-list"><li><strong>Superposition</strong> — a register of <em>n</em> qubits is described by 2<sup>n</sup> amplitudes at once.</li><li><strong>Entanglement</strong> — qubits can share correlations that no classical system can reproduce.</li><li><strong>Interference</strong> — amplitudes are waves: they can reinforce or cancel each other.</li></ul><p>None of these alone gives a speed-up; algorithms combine all three.</p>` },
                { title: 'The circuit model', html: `<p>Quantum programs are usually written as <strong>circuits</strong>: horizontal wires are qubits, boxes are <strong>gates</strong> applied left-to-right, and a meter symbol is a <strong>measurement</strong>. Every tool in Quantum Lens — the drag-and-drop builder, the code lab, Qiskit, Cirq, PennyLane and qBraid — describes the same circuits in different notations.</p><div class="info-card"><strong>Where quantum helps:</strong> simulating molecules and materials, certain optimisation and sampling problems, and cryptography-relevant problems such as factoring (Shor's algorithm). For everyday tasks classical computers remain better.</div>` }
            ],
            widget: { type: 'circuit', example: 'superposition' },
            quiz: [
                { q: 'How many possible outcomes do you observe when you measure a single qubit?', options: ['Infinitely many', 'Exactly two: 0 or 1', 'Three: 0, 1 or both', 'It depends on the gate'], answer: 1, explain: 'Measurement always yields a classical bit. The amplitudes only set the probabilities of 0 and 1.' },
                { q: 'How many complex amplitudes describe the state of 3 qubits?', options: ['3', '6', '8', '9'], answer: 2, explain: 'n qubits need 2ⁿ amplitudes: 2³ = 8.' },
                { q: 'Which effect lets quantum algorithms cancel out wrong answers?', options: ['Decoherence', 'Interference', 'Cloning', 'Parallel measurement'], answer: 1, explain: 'Amplitudes can interfere destructively (cancel) or constructively (reinforce).' },
                { q: 'In a circuit diagram, what does a horizontal wire represent?', options: ['A qubit over time', 'A classical bus', 'An electrical connection', 'A measurement'], answer: 0, explain: 'Each wire is one qubit; time flows left to right.' },
                { q: 'Which task is a well-known candidate for quantum advantage?', options: ['Word processing', 'Sorting a short list', 'Simulating molecules', 'Streaming video'], answer: 2, explain: 'Nature is quantum, so simulating molecules and materials is a natural fit.' }
            ],
            challenges: ['c_flip']
        },
        {
            id: 'qubits', num: 2, title: 'Qubits & the Bloch Sphere', icon: 'fa-globe', level: 'Beginner', minutes: 25, prereqs: ['fundamentals'], topic: 'qubits',
            summary: 'State vectors, amplitudes, normalisation and the Bloch sphere picture.',
            lessons: [
                { title: 'The state vector', html: `<p>A single qubit is written |ψ⟩ = α|0⟩ + β|1⟩ where α and β are complex amplitudes. They must satisfy the <strong>normalisation</strong> rule |α|² + |β|² = 1, because the probabilities of measuring 0 (|α|²) and 1 (|β|²) must add to one.</p><p>Example: |+⟩ = (|0⟩ + |1⟩)/√2 has |α|² = |β|² = ½ — a fair coin.</p>` },
                { title: 'The Bloch sphere', html: `<p>Because global phase is unobservable, any single-qubit pure state can be written with two angles: |ψ⟩ = cos(θ/2)|0⟩ + e<sup>iφ</sup> sin(θ/2)|1⟩. Plot θ (latitude) and φ (longitude) on a sphere and you get the <strong>Bloch sphere</strong>.</p><ul class="ql-list"><li>North pole: |0⟩ &nbsp; South pole: |1⟩</li><li>Equator: equal superpositions such as |+⟩ (+X), |−⟩ (−X), |i⟩ (+Y), |−i⟩ (−Y)</li><li>Gates are rotations of the sphere.</li></ul><p>Use the playground below: apply gates and watch the arrow move.</p>` },
                { title: 'Mixed states and the centre', html: `<p>When a qubit is entangled with others, it no longer has its own pure state. Its <strong>reduced density matrix</strong> (obtained with a <em>partial trace</em>) is drawn as an arrow <em>shorter</em> than 1. A maximally entangled qubit sits at the centre of the sphere. Quantum Lens shows this length as <strong>purity</strong>.</p>` }
            ],
            widget: { type: 'bloch-playground' },
            quiz: [
                { q: 'For |ψ⟩ = α|0⟩ + β|1⟩, what must be true?', options: ['α + β = 1', '|α|² + |β|² = 1', 'α = β', 'α·β = 0'], answer: 1, explain: 'Probabilities |α|² and |β|² must sum to one (normalisation).' },
                { q: 'Where is |1⟩ on the Bloch sphere?', options: ['North pole', 'South pole', 'On the equator', 'At the centre'], answer: 1, explain: '|0⟩ is the north pole and |1⟩ the south pole.' },
                { q: 'Which state points along +X on the Bloch sphere?', options: ['|0⟩', '|1⟩', '|+⟩', '|i⟩'], answer: 2, explain: '|+⟩ = (|0⟩+|1⟩)/√2 lies on the equator along +X.' },
                { q: 'What is the probability of measuring 1 for the state (√3/2)|0⟩ + (1/2)|1⟩?', options: ['1/2', '1/4', '3/4', '√3/2'], answer: 1, explain: 'P(1) = |1/2|² = 1/4.' },
                { q: 'A qubit drawn at the centre of the Bloch sphere is…', options: ['in |0⟩', 'maximally mixed (e.g. half of a Bell pair)', 'in |+⟩', 'broken'], answer: 1, explain: 'A zero-length Bloch vector is the maximally mixed state — typical for one half of a maximally entangled pair.' }
            ],
            challenges: ['c_plus', 'c_minus']
        },
        {
            id: 'superposition', num: 3, title: 'Superposition & Interference', icon: 'fa-wave-square', level: 'Beginner', minutes: 25, prereqs: ['qubits'], topic: 'superposition',
            summary: 'Creating superpositions with Hadamard gates and using interference.',
            lessons: [
                { title: 'The Hadamard gate', html: `<p>The Hadamard gate H maps |0⟩ → |+⟩ = (|0⟩+|1⟩)/√2 and |1⟩ → |−⟩ = (|0⟩−|1⟩)/√2. Both give 50/50 measurement statistics, but they differ in the <em>relative phase</em> (the sign) between the two terms.</p><p>Applying H to each of n qubits creates the uniform superposition over all 2<sup>n</sup> bit-strings — the usual first step of many algorithms.</p>` },
                { title: 'Interference', html: `<p>Apply H twice: H·H|0⟩ = |0⟩. Why? The first H splits |0⟩ into two paths. The second H sends both paths to |0⟩ with + signs (they add) and to |1⟩ with opposite signs (they cancel). This cancellation is <strong>destructive interference</strong>.</p><div class="info-card"><strong>Try it:</strong> load the <em>Interference</em> example in the Lab and step through it — the probability of |1⟩ goes 0 → ½ → 0.</div>` },
                { title: 'Relative vs global phase', html: `<p>Multiplying the whole state by e<sup>iγ</sup> (global phase) changes nothing observable. A <em>relative</em> phase between terms — the minus sign in |−⟩ — is physical: it changes how the state interferes later. The Z, S, T and RZ gates change relative phase without changing measurement probabilities in the Z basis.</p>` }
            ],
            widget: { type: 'circuit', example: 'interference' },
            quiz: [
                { q: 'What does H do to |0⟩?', options: ['|1⟩', '|+⟩ = (|0⟩+|1⟩)/√2', '|−⟩', 'Nothing'], answer: 1, explain: 'H|0⟩ = |+⟩.' },
                { q: 'What is H·H|0⟩?', options: ['|0⟩', '|1⟩', '|+⟩', 'A random state'], answer: 0, explain: 'H is its own inverse; the |1⟩ contributions cancel by interference.' },
                { q: 'After applying H to each of 3 qubits starting from |000⟩, the probability of measuring 101 is…', options: ['1/3', '1/8', '1/2', '0'], answer: 1, explain: 'The uniform superposition over 8 states gives each a probability of 1/8.' },
                { q: '|+⟩ and |−⟩ give identical Z-basis statistics. What distinguishes them?', options: ['Their relative phase', 'Their global phase', 'Their normalisation', 'Nothing'], answer: 0, explain: 'The relative sign between |0⟩ and |1⟩ differs; an H gate reveals it.' },
                { q: 'Which gate changes only the relative phase of |1⟩ by 90°?', options: ['X', 'H', 'S', 'SWAP'], answer: 2, explain: 'S = diag(1, i).' }
            ],
            challenges: ['c_uniform', 'k_phase']
        },
        {
            id: 'entanglement', num: 4, title: 'Entanglement', icon: 'fa-link', level: 'Intermediate', minutes: 30, prereqs: ['superposition'], topic: 'entanglement',
            summary: 'Bell states, GHZ states and why entangled qubits cannot be described separately.',
            lessons: [
                { title: 'Creating a Bell pair', html: `<p>Start from |00⟩, apply H to q0 and then a CNOT with q0 as control and q1 as target:</p><p class="ql-eq">|00⟩ → (|0⟩+|1⟩)|0⟩/√2 → (|00⟩+|11⟩)/√2 = |Φ⁺⟩</p><p>Measuring either qubit gives a random bit, but the two results always agree. There is no way to write |Φ⁺⟩ as (state of q0) ⊗ (state of q1) — that is what <strong>entangled</strong> means.</p>` },
                { title: 'The four Bell states', html: `<ul class="ql-list"><li>|Φ⁺⟩ = (|00⟩+|11⟩)/√2</li><li>|Φ⁻⟩ = (|00⟩−|11⟩)/√2</li><li>|Ψ⁺⟩ = (|01⟩+|10⟩)/√2</li><li>|Ψ⁻⟩ = (|01⟩−|10⟩)/√2</li></ul><p>Apply X and/or Z to one qubit of |Φ⁺⟩ to reach the others. In the Lab, notice each qubit's Bloch arrow shrinks to the centre: individually, each qubit is maximally mixed.</p>` },
                { title: 'GHZ states and uses', html: `<p>Chaining CNOTs spreads entanglement: H(q0), CX(q0→q1), CX(q1→q2) makes the GHZ state (|000⟩+|111⟩)/√2. Entanglement powers teleportation, superdense coding, quantum key distribution and error correction.</p><div class="info-card"><strong>No-signalling:</strong> entanglement produces correlations, not faster-than-light communication — each side alone just sees random bits.</div>` }
            ],
            widget: { type: 'circuit', example: 'bell' },
            quiz: [
                { q: 'Which pair of gates creates |Φ⁺⟩ from |00⟩?', options: ['X then Z', 'H on q0 then CNOT(q0→q1)', 'H on both qubits', 'SWAP'], answer: 1, explain: 'H makes q0 a superposition; the CNOT copies the basis value into q1.' },
                { q: 'Measuring |Φ⁺⟩ gives which outcomes?', options: ['00 and 11, 50% each', 'All four equally', 'Always 00', '01 and 10'], answer: 0, explain: '|Φ⁺⟩ = (|00⟩+|11⟩)/√2.' },
                { q: 'What does the Bloch vector of one qubit of a Bell pair look like?', options: ['Length 1 along +Z', 'Length 1 along +X', 'Length 0 (centre)', 'It cannot be computed'], answer: 2, explain: 'The reduced state is I/2 — maximally mixed.' },
                { q: 'Can entanglement send a message faster than light?', options: ['Yes', 'No — local results are random without classical communication', 'Only with GHZ states', 'Only for 2 qubits'], answer: 1, explain: 'No-signalling theorem: correlations only show up when results are compared classically.' },
                { q: 'Which is the singlet state |Ψ⁻⟩?', options: ['(|00⟩+|11⟩)/√2', '(|01⟩−|10⟩)/√2', '(|01⟩+|10⟩)/√2', '|01⟩'], answer: 1, explain: '|Ψ⁻⟩ = (|01⟩−|10⟩)/√2.' }
            ],
            challenges: ['c_bell', 'c_psi_minus', 'c_ghz', 'k_bell', 'k_ghz4']
        },
        {
            id: 'gates', num: 5, title: 'Quantum Gates', icon: 'fa-microchip', level: 'Intermediate', minutes: 35, prereqs: ['superposition'], topic: 'gates',
            summary: 'Pauli, Hadamard, phase, rotation and multi-qubit gates as unitary matrices.',
            lessons: [
                { title: 'Gates are unitary matrices', html: `<p>Every gate is a <strong>unitary</strong> matrix U (U†U = I), so it is reversible and preserves total probability. Single-qubit gates are 2×2 matrices; two-qubit gates are 4×4.</p><ul class="ql-list"><li><strong>X</strong> = [[0,1],[1,0]] — bit flip (quantum NOT)</li><li><strong>Z</strong> = [[1,0],[0,−1]] — phase flip</li><li><strong>Y</strong> = [[0,−i],[i,0]] — both</li><li><strong>H</strong> = (1/√2)[[1,1],[1,−1]] — basis change between Z and X</li><li><strong>S</strong> = diag(1,i), <strong>T</strong> = diag(1,e<sup>iπ/4</sup>)</li></ul>` },
                { title: 'Rotations', html: `<p>RX(θ), RY(θ) and RZ(θ) rotate the Bloch vector by angle θ about the X, Y or Z axis. X, Y and Z are 180° rotations (up to global phase). Any single-qubit gate can be written as U(θ,φ,λ) = RZ(φ)·RY(θ)·RZ(λ).</p>` },
                { title: 'Multi-qubit gates', html: `<p><strong>CNOT</strong> flips the target when the control is |1⟩. <strong>CZ</strong> adds a −1 phase to |11⟩ and is symmetric. <strong>SWAP</strong> exchanges two qubits and equals three CNOTs. <strong>Toffoli (CCX)</strong> flips the target only when both controls are |1⟩ — a reversible AND.</p><div class="info-card"><strong>Universality:</strong> {H, T, CNOT} can approximate any quantum computation to arbitrary accuracy.</div>` }
            ],
            widget: { type: 'bloch-playground' },
            quiz: [
                { q: 'Which property must every quantum gate have?', options: ['It is Hermitian', 'It is unitary', 'It has real entries', 'It is diagonal'], answer: 1, explain: 'Unitarity keeps evolution reversible and probabilities summing to 1.' },
                { q: 'Which gate is the quantum NOT?', options: ['Z', 'H', 'X', 'S'], answer: 2, explain: 'X swaps |0⟩ and |1⟩.' },
                { q: 'How many CNOT gates implement a SWAP?', options: ['1', '2', '3', '4'], answer: 2, explain: 'CX(a→b)·CX(b→a)·CX(a→b) = SWAP.' },
                { q: 'What is S·S?', options: ['I', 'Z', 'T', 'X'], answer: 1, explain: 'diag(1,i)² = diag(1,−1) = Z.' },
                { q: 'H·X·H equals…', options: ['X', 'Y', 'Z', 'I'], answer: 2, explain: 'H swaps the X and Z axes, so H X H = Z.' }
            ],
            challenges: ['c_swap_cnot', 'c_y_from_rot']
        },
        {
            id: 'measurement', num: 6, title: 'Measurement', icon: 'fa-ruler-combined', level: 'Intermediate', minutes: 20, prereqs: ['qubits'], topic: 'measurement',
            summary: 'The Born rule, shots, histograms and measuring in other bases.',
            lessons: [
                { title: 'The Born rule', html: `<p>Measuring in the computational basis returns bit-string x with probability |amplitude(x)|². Afterwards the state <strong>collapses</strong> to |x⟩ — the superposition is gone.</p><p>Because each run gives one random result, we repeat the circuit many times (<strong>shots</strong>) and look at the <strong>histogram</strong> of counts. With 1024 shots of |+⟩ you will see roughly 512 zeros and 512 ones — not exactly, because of statistical noise.</p>` },
                { title: 'Measuring in other bases', html: `<p>Hardware measures in the Z basis. To measure in the X basis, apply H first; for the Y basis apply S† then H. This is why the phase of |+⟩ vs |−⟩ can be detected.</p><div class="info-card"><strong>Bit order:</strong> Quantum Lens follows Qiskit — in the label "01" the right-most bit is q0. Cirq and PennyLane list wire 0 first; the Lab converts all backends to the same order.</div>` }
            ],
            widget: { type: 'measure-demo' },
            quiz: [
                { q: 'For state 0.6|0⟩ + 0.8|1⟩, P(1) is…', options: ['0.8', '0.64', '0.36', '0.2'], answer: 1, explain: '|0.8|² = 0.64.' },
                { q: 'Why do we run a circuit for many shots?', options: ['To heat the chip', 'Each run gives one random sample; many shots estimate probabilities', 'To make it deterministic', 'Qiskit requires exactly 1024'], answer: 1, explain: 'Statistics require repetition.' },
                { q: 'How do you measure a qubit in the X basis?', options: ['Apply H then measure', 'Apply X then measure', 'Apply Z then measure', 'It is impossible'], answer: 0, explain: 'H rotates the X basis onto the Z basis.' },
                { q: 'In Qiskit bit-string "10" for 2 qubits, which qubit is 1?', options: ['q0', 'q1', 'Both', 'Neither'], answer: 1, explain: 'Right-most bit is q0, so "10" means q1 = 1, q0 = 0.' },
                { q: 'After measuring |+⟩ and getting 1, the qubit is in…', options: ['|+⟩', '|1⟩', '|0⟩', 'a superposition'], answer: 1, explain: 'Measurement collapses the state to the observed outcome.' }
            ],
            challenges: ['c_minus_measure', 'k_qrng']
        },
        {
            id: 'circuits', num: 7, title: 'Circuit Design', icon: 'fa-diagram-project', level: 'Intermediate', minutes: 30, prereqs: ['gates', 'measurement'], topic: 'circuits',
            summary: 'Depth, gate count, optimisation, and writing circuits in Qiskit, Cirq, PennyLane and qBraid.',
            lessons: [
                { title: 'Measuring circuit quality', html: `<p>Real hardware is noisy, so smaller circuits are better. Key metrics: <strong>width</strong> (qubits), <strong>gate count</strong>, <strong>two-qubit gate count</strong> (usually the noisiest) and <strong>depth</strong> (the longest path of gates). The Lab reports all of these after every run.</p>` },
                { title: 'Optimisation patterns', html: `<ul class="ql-list"><li>Cancel self-inverse pairs: H·H, X·X, CX·CX = I</li><li>Merge rotations: RZ(a)·RZ(b) = RZ(a+b)</li><li>Replace patterns: H·X·H = Z, S·S = Z, T·T = S</li><li>Drop phase gates right before a Z-basis measurement — they do not change counts</li></ul><p>The AI Tutor's <em>Optimise</em> action applies these rules and shows the before/after metrics.</p>` },
                { title: 'One circuit, many frameworks', html: `<p>Qiskit, Cirq, PennyLane and qBraid express the same circuit differently. Quantum Lens converts between them: build visually, then press <em>Send to Code Lab</em> and pick a framework. qBraid acts as a bridge — its <code>transpile()</code> converts programs between frameworks so one circuit can run on many backends.</p>` }
            ],
            widget: { type: 'circuit', example: 'teleportation' },
            quiz: [
                { q: 'Which gates are usually the noisiest on hardware?', options: ['Single-qubit gates', 'Two-qubit gates', 'Barriers', 'Measurements of |0⟩'], answer: 1, explain: 'Two-qubit gates typically have error rates ~10× higher.' },
                { q: 'RZ(π/4)·RZ(π/4) can be replaced by…', options: ['RZ(π/2)', 'RZ(π/16)', 'RX(π/2)', 'Nothing'], answer: 0, explain: 'Rotations about the same axis add.' },
                { q: 'What is circuit depth?', options: ['Number of qubits', 'Longest sequence of dependent gates', 'Number of measurements', 'Total gate count'], answer: 1, explain: 'Depth counts layers along the critical path.' },
                { q: 'A T gate right before measuring that qubit in the Z basis…', options: ['Changes the counts', 'Has no effect on the counts', 'Causes an error', 'Doubles the probability'], answer: 1, explain: 'Diagonal phase gates do not change Z-basis probabilities.' },
                { q: 'What does qBraid\'s transpile() do?', options: ['Runs on a GPU', 'Converts a program between quantum frameworks', 'Measures qubits', 'Adds noise'], answer: 1, explain: 'qBraid converts e.g. OpenQASM → Cirq or Qiskit → Braket.' }
            ],
            challenges: ['c_teleport_min', 'k_optimize']
        },
        {
            id: 'algorithms', num: 8, title: 'Standard Quantum Algorithms', icon: 'fa-brain', level: 'Advanced', minutes: 45, prereqs: ['entanglement', 'circuits'], topic: 'algorithms',
            summary: 'Deutsch–Jozsa, Bernstein–Vazirani, Grover, QFT and teleportation.',
            lessons: [
                { title: 'Oracle algorithms', html: `<p><strong>Deutsch–Jozsa</strong> decides whether a function f:{0,1}ⁿ→{0,1} is constant or balanced with <em>one</em> query (classically up to 2ⁿ⁻¹+1). <strong>Bernstein–Vazirani</strong> recovers a hidden string s from f(x)=s·x mod 2 in one query. Both rely on <em>phase kickback</em>: with the ancilla in |−⟩, the oracle writes f(x) into the phase, and Hadamards turn phases into a readable bit-string.</p>` },
                { title: "Grover's search", html: `<p>Grover finds a marked item among N in about (π/4)√N queries — a quadratic speed-up. Each iteration = <strong>oracle</strong> (flip the phase of the marked state) + <strong>diffuser</strong> (reflect about the average amplitude). For N=4 one iteration succeeds with certainty; for N=8 two iterations give ≈94.5%.</p>` },
                { title: 'QFT and beyond', html: `<p>The <strong>Quantum Fourier Transform</strong> maps basis states to phase patterns using H and controlled-phase gates. It is the core of <em>phase estimation</em> and <strong>Shor's factoring algorithm</strong>. <strong>Teleportation</strong> moves an unknown state using one Bell pair and two classical bits. Variational algorithms (VQE, QAOA) — natural in PennyLane — combine short circuits with classical optimisers.</p>` }
            ],
            widget: { type: 'circuit', example: 'grover2' },
            quiz: [
                { q: 'How many oracle queries does Deutsch–Jozsa need?', options: ['1', 'n', '2ⁿ', '2ⁿ⁻¹+1'], answer: 0, explain: 'A single query suffices.' },
                { q: "Grover's algorithm gives which speed-up for unstructured search?", options: ['Exponential', 'Quadratic', 'None', 'Linear'], answer: 1, explain: 'O(√N) queries vs O(N).' },
                { q: 'What does the Grover diffuser do?', options: ['Measures', 'Reflects amplitudes about their average', 'Adds noise', 'Swaps qubits'], answer: 1, explain: 'Inversion about the mean amplifies the marked amplitude.' },
                { q: 'Which algorithm is built on the QFT?', options: ["Shor's factoring", 'Deutsch', 'Teleportation', 'Superdense coding'], answer: 0, explain: 'Shor uses phase estimation, which uses the inverse QFT.' },
                { q: 'In Bernstein–Vazirani, why is the ancilla prepared in |−⟩?', options: ['To measure it', 'So the oracle kicks f(x) back as a phase', 'To entangle all qubits', 'It is not needed'], answer: 1, explain: 'Phase kickback turns the output bit into a ±1 phase.' }
            ],
            challenges: ['c_grover2', 'k_bv', 'k_dj']
        }
    ];
    QL.MODULES = MODULES;

    // -----------------------------------------------------------------
    // Challenges (circuit-building & coding) — graded automatically
    //   target.kind: 'state' (fidelity up to global phase)
    //              | 'unitary' (process fidelity)
    //              | 'dist' (distribution over measured qubits, TV distance)
    // -----------------------------------------------------------------
    const CHALLENGES = [
        { id: 'c_flip', type: 'circuit', module: 'fundamentals', title: 'Flip the qubit', difficulty: 'Easy', points: 50, qubits: 1, goal: 'Prepare the state |1⟩ starting from |0⟩.', target: { kind: 'state', circuit: circ(1, [g('x', 0)]) }, optimal: 1, hints: ['Which gate is the quantum NOT?', 'Drop an X gate on q0.'] },
        { id: 'c_plus', type: 'circuit', module: 'qubits', title: 'Point along +X', difficulty: 'Easy', points: 50, qubits: 1, goal: 'Prepare |+⟩ = (|0⟩+|1⟩)/√2 — the Bloch arrow should point along +X.', target: { kind: 'state', circuit: circ(1, [g('h', 0)]) }, optimal: 1, hints: ['A single standard gate does it.', 'Use the Hadamard gate.'] },
        { id: 'c_minus', type: 'circuit', module: 'qubits', title: 'Point along −X', difficulty: 'Easy', points: 60, qubits: 1, goal: 'Prepare |−⟩ = (|0⟩−|1⟩)/√2.', target: { kind: 'state', circuit: circ(1, [g('x', 0), g('h', 0)]) }, optimal: 2, hints: ['H maps |1⟩ to |−⟩.', 'Apply X, then H.'] },
        { id: 'c_uniform', type: 'circuit', module: 'superposition', title: 'Everything at once', difficulty: 'Easy', points: 60, qubits: 3, goal: 'Make all 8 outcomes of 3 qubits equally likely with real, positive amplitudes.', target: { kind: 'state', circuit: circ(3, hAll(3)) }, optimal: 3, hints: ['Each qubit needs its own superposition.', 'Put an H on every qubit.'] },
        { id: 'c_bell', type: 'circuit', module: 'entanglement', title: 'Build a Bell pair', difficulty: 'Medium', points: 80, qubits: 2, goal: 'Prepare |Φ⁺⟩ = (|00⟩+|11⟩)/√2.', target: { kind: 'state', circuit: circ(2, [g('h', 0), c('cx', 0, 1)]) }, optimal: 2, hints: ['First create a superposition on q0.', 'Then use a CNOT with control q0 and target q1.'] },
        { id: 'c_psi_minus', type: 'circuit', module: 'entanglement', title: 'The singlet', difficulty: 'Medium', points: 100, qubits: 2, goal: 'Prepare |Ψ⁻⟩ = (|01⟩−|10⟩)/√2.', target: { kind: 'state', circuit: EXAMPLES.bell_psi_minus.circuit }, optimal: 4, hints: ['Start from a Bell pair and fix the bits and the sign.', 'X on both qubits, then H on q0 and CNOT(q0→q1).'] },
        { id: 'c_ghz', type: 'circuit', module: 'entanglement', title: 'GHZ triplet', difficulty: 'Medium', points: 100, qubits: 3, goal: 'Prepare (|000⟩+|111⟩)/√2.', target: { kind: 'state', circuit: circ(3, [g('h', 0), c('cx', 0, 1), c('cx', 1, 2)]) }, optimal: 3, hints: ['Start like a Bell pair.', 'Add a second CNOT to reach q2.'] },
        { id: 'c_swap_cnot', type: 'circuit', module: 'gates', title: 'SWAP from CNOTs', difficulty: 'Hard', points: 120, qubits: 2, goal: 'Implement a SWAP of q0 and q1 using only CNOT gates.', allowed: ['cx'], target: { kind: 'unitary', circuit: circ(2, [sw(0, 1)]) }, optimal: 3, hints: ['You need three CNOTs.', 'Alternate the control: q0→q1, q1→q0, q0→q1.'] },
        { id: 'c_y_from_rot', type: 'circuit', module: 'gates', title: 'Y without Y', difficulty: 'Medium', points: 90, qubits: 1, goal: 'Build a circuit equal (up to global phase) to the Y gate without using Y.', forbidden: ['y', 'cy', 'u'], target: { kind: 'unitary', circuit: circ(1, [g('y', 0)]) }, optimal: 2, hints: ['Y = i·X·Z.', 'Apply Z then X (or RY(π)).'] },
        { id: 'c_minus_measure', type: 'circuit', module: 'measurement', title: 'Read the phase', difficulty: 'Medium', points: 80, qubits: 1, goal: 'Prepare |−⟩ (X then H), then measure it in the X basis so the result is always 1. Measuring |−⟩ directly would give 50/50.', minCounts: { x: 1, h: 2 }, target: { kind: 'dist', dist: { '1': 1 } }, requireMeasure: true, optimal: 4, hints: ['To measure in the X basis, rotate it onto the Z basis first.', 'X, H (makes |−⟩), then H again and Measure.'] },
        { id: 'c_teleport_min', type: 'circuit', module: 'circuits', title: 'Minimal Bell circuit', difficulty: 'Medium', points: 90, qubits: 2, goal: 'Load or build any circuit producing |Φ⁺⟩ using at most 2 gates (the optimiser can help).', maxGates: 2, target: { kind: 'state', circuit: circ(2, [g('h', 0), c('cx', 0, 1)]) }, optimal: 2, hints: ['Remove anything that cancels.', 'H on q0 and CNOT(q0→q1).'] },
        { id: 'c_grover2', type: 'circuit', module: 'algorithms', title: 'Find |11⟩ with Grover', difficulty: 'Hard', points: 150, qubits: 2, goal: 'Build a 2-qubit Grover search that returns 11 with probability ≥ 99%. Measure both qubits.', target: { kind: 'dist', dist: { '11': 1 } }, requireMeasure: true, optimal: 12, hints: ['Oracle for |11⟩: a CZ gate.', 'Diffuser: H, X on both, CZ, X on both, H.'] },
        // Coding challenges
        { id: 'k_bell', type: 'code', module: 'entanglement', title: 'Code a Bell pair', difficulty: 'Easy', points: 80, goal: 'Write a program (any framework) that prepares |Φ⁺⟩ on 2 qubits.', target: { kind: 'state', circuit: circ(2, [g('h', 0), c('cx', 0, 1)]) }, starter: { qiskit: 'from qiskit import QuantumCircuit\n\nqc = QuantumCircuit(2)\n# your code here\n' }, hints: ['qc.h(0)', 'qc.cx(0, 1)'] },
        { id: 'k_ghz4', type: 'code', module: 'entanglement', title: 'GHZ with a loop', difficulty: 'Medium', points: 110, goal: 'Prepare a 4-qubit GHZ state (|0000⟩+|1111⟩)/√2 using a for-loop.', requireLoop: true, target: { kind: 'state', circuit: circ(4, [g('h', 0), c('cx', 0, 1), c('cx', 1, 2), c('cx', 2, 3)]) }, starter: { qiskit: 'from qiskit import QuantumCircuit\n\nn = 4\nqc = QuantumCircuit(n)\nqc.h(0)\n# add a loop of CNOTs\n' }, hints: ['for i in range(n - 1):', '    qc.cx(i, i + 1)'] },
        { id: 'k_phase', type: 'code', module: 'superposition', title: 'Point along +Y', difficulty: 'Easy', points: 80, goal: 'Prepare (|0⟩ + i|1⟩)/√2 on one qubit.', target: { kind: 'state', circuit: circ(1, [g('h', 0), g('s', 0)]) }, starter: { qiskit: 'from qiskit import QuantumCircuit\n\nqc = QuantumCircuit(1)\n' }, hints: ['Start with a superposition.', 'Then add a 90° phase with S.'] },
        { id: 'k_qrng', type: 'code', module: 'measurement', title: 'Quantum dice (0–7)', difficulty: 'Easy', points: 80, goal: 'Write a 3-qubit random number generator whose measured outcomes are uniformly distributed. Include measurements.', requireMeasure: true, target: { kind: 'dist', dist: Object.fromEntries([...Array(8).keys()].map(i => [i.toString(2).padStart(3, '0'), 1 / 8])) }, starter: { qiskit: 'from qiskit import QuantumCircuit\n\nqc = QuantumCircuit(3, 3)\n' }, hints: ['Put every qubit in superposition.', 'qc.h([0, 1, 2]); qc.measure([0, 1, 2], [0, 1, 2])'] },
        { id: 'k_optimize', type: 'code', module: 'circuits', title: 'Trim the fat', difficulty: 'Medium', points: 100, goal: 'The starter prepares |1⟩ on q0 with 7 gates. Rewrite it to produce the same state with at most 1 gate.', maxGates: 1, target: { kind: 'state', circuit: circ(1, [g('x', 0)]) }, starter: { qiskit: 'from qiskit import QuantumCircuit\n\nqc = QuantumCircuit(1)\nqc.h(0)\nqc.h(0)\nqc.x(0)\nqc.z(0)\nqc.z(0)\nqc.t(0)\nqc.tdg(0)\n' }, hints: ['Ask the tutor to optimise.', 'Only the X gate matters.'] },
        { id: 'k_bv', type: 'code', module: 'algorithms', title: 'Bernstein–Vazirani (s = 110)', difficulty: 'Hard', points: 150, goal: 'Using 3 input qubits (q0–q2) and ancilla q3, implement Bernstein–Vazirani for hidden string s = 110 (q2 q1 q0). Measure q0–q2; the output must be 110.', requireMeasure: true, target: { kind: 'dist', dist: { '110': 1 } }, starter: { qiskit: 'from qiskit import QuantumCircuit\n\nqc = QuantumCircuit(4, 3)\n# 1) ancilla in |->\n# 2) H on inputs\n# 3) oracle: CNOT from each input qubit i with s_i = 1 to the ancilla\n# 4) H on inputs and measure\n' }, hints: ['s = 110 means s_1 = 1 and s_2 = 1 (q0 bit is 0).', 'qc.cx(1, 3); qc.cx(2, 3)'] },
        { id: 'k_dj', type: 'code', module: 'algorithms', title: 'Deutsch–Jozsa: constant oracle', difficulty: 'Medium', points: 110, goal: 'Implement Deutsch–Jozsa on 2 input qubits with a CONSTANT oracle f(x)=1. Measure the inputs; the result must be 00.', requireMeasure: true, target: { kind: 'dist', dist: { '00': 1 } }, starter: { pennylane: 'import pennylane as qml\n\ndev = qml.device("default.qubit", wires=3)\n\n@qml.qnode(dev)\ndef circuit():\n    # ancilla is wire 2\n    return qml.probs(wires=[1, 0])\n' }, hints: ['A constant f(x)=1 oracle is just an X on the ancilla.', 'Put the ancilla in |−⟩ and the inputs in |+⟩, apply the oracle, then H on the inputs.'] }
    ];
    QL.CHALLENGES = CHALLENGES;

    // -----------------------------------------------------------------
    // Tutor knowledge base
    // -----------------------------------------------------------------
    const KB = [
        { id: 'qubit', title: 'Qubit', keys: ['qubit', 'qubits', 'quantum bit'], module: 'qubits', example: 'superposition', text: 'A qubit is the quantum version of a bit. Its state is α|0⟩ + β|1⟩ with complex amplitudes α, β and |α|² + |β|² = 1. Measuring gives 0 with probability |α|² and 1 with probability |β|².', analogy: 'Think of a compass needle that can point anywhere on a globe; measuring forces it to snap to the north or south pole.' },
        { id: 'superposition', title: 'Superposition', keys: ['superposition', 'both 0 and 1', 'plus state', '|+>'], module: 'superposition', example: 'superposition', text: 'Superposition means a qubit\'s state is a weighted combination of |0⟩ and |1⟩. The Hadamard gate turns |0⟩ into (|0⟩+|1⟩)/√2. It is not "secretly 0 or 1" — the amplitudes can interfere.', analogy: 'Like a wave on a pond that is a mix of two ripples; the ripples can add or cancel.' },
        { id: 'entanglement', title: 'Entanglement', keys: ['entangle', 'entanglement', 'entangled', 'bell', 'epr'], module: 'entanglement', example: 'bell', text: 'Entangled qubits share a joint state that cannot be written as separate states per qubit. The Bell state (|00⟩+|11⟩)/√2 gives random but perfectly correlated results. In the Lab, each entangled qubit\'s Bloch arrow shrinks toward the centre.', analogy: 'Two sealed envelopes that always contain matching cards — but the card isn\'t decided until one is opened.' },
        { id: 'interference', title: 'Interference', keys: ['interference', 'interfere', 'cancel'], module: 'superposition', example: 'interference', text: 'Amplitudes behave like waves: paths leading to the same outcome add up (constructive) or cancel (destructive). H·H = I is the simplest example; Grover\'s algorithm uses interference to amplify the right answer.', analogy: 'Noise-cancelling headphones add an inverted wave so the sound cancels.' },
        { id: 'bloch', title: 'Bloch sphere', keys: ['bloch', 'sphere'], module: 'qubits', example: 'rotation', text: 'The Bloch sphere represents a single-qubit state as a point: |0⟩ at the north pole, |1⟩ at the south, superpositions elsewhere. Gates are rotations. For entangled qubits Quantum Lens shows the reduced state, whose arrow is shorter than 1.', analogy: 'A globe where latitude sets the 0/1 probabilities and longitude sets the phase.' },
        { id: 'hadamard', title: 'Hadamard gate', keys: ['hadamard', 'h gate'], module: 'gates', example: 'superposition', text: 'H = (1/√2)[[1,1],[1,−1]]. It maps |0⟩→|+⟩ and |1⟩→|−⟩, switching between the Z and X bases. It is its own inverse.' },
        { id: 'pauli', title: 'Pauli gates', keys: ['pauli', 'x gate', 'y gate', 'z gate', 'not gate', 'bit flip', 'phase flip'], module: 'gates', text: 'X flips |0⟩↔|1⟩ (bit flip), Z flips the sign of |1⟩ (phase flip) and Y does both (with a factor i). Each is a 180° rotation about its axis on the Bloch sphere.' },
        { id: 'cnot', title: 'CNOT gate', keys: ['cnot', 'cx', 'controlled not', 'controlled-not'], module: 'gates', example: 'bell', text: 'CNOT flips the target qubit when the control is |1⟩. Applied to a control in superposition it creates entanglement. Three CNOTs make a SWAP.' },
        { id: 'phase', title: 'Phase gates (S, T, P, RZ)', keys: ['phase', 's gate', 't gate', 'rz', 'relative phase', 'global phase'], module: 'superposition', text: 'Phase gates multiply |1⟩ by e^{iλ}: S (λ=π/2), T (λ=π/4), P(λ). They change interference but not Z-basis probabilities. Global phase (multiplying the whole state) is unobservable; relative phase is physical.' },
        { id: 'rotation', title: 'Rotation gates', keys: ['rotation', 'rx', 'ry', 'rotate'], module: 'gates', example: 'rotation', text: 'RX(θ), RY(θ), RZ(θ) rotate the Bloch vector by θ around the X, Y, Z axes. RY(θ)|0⟩ = cos(θ/2)|0⟩ + sin(θ/2)|1⟩, so RY lets you set any real 0/1 probability.' },
        { id: 'toffoli', title: 'Toffoli & SWAP', keys: ['toffoli', 'ccx', 'swap', 'fredkin', 'cswap'], module: 'gates', text: 'Toffoli (CCX) flips the target only if both controls are 1 — a reversible AND, universal for classical logic. SWAP exchanges two qubits; CSWAP (Fredkin) does it conditionally.' },
        { id: 'measurement', title: 'Measurement', keys: ['measure', 'measurement', 'collapse', 'born rule', 'shots', 'histogram', 'counts'], module: 'measurement', example: 'qrng', text: 'Measurement returns bit-string x with probability |amplitude(x)|² and collapses the state. Running many shots produces a histogram that estimates these probabilities; small deviations are sampling noise.' },
        { id: 'bitorder', title: 'Bit ordering', keys: ['bit order', 'endian', 'ordering', 'reversed', 'backwards'], module: 'measurement', text: 'Qiskit is little-endian: in "01" the right-most bit is q0. Cirq and PennyLane list the first qubit/wire on the left. Quantum Lens normalises every backend to the Qiskit convention so results can be compared.' },
        { id: 'statevector', title: 'State vector', keys: ['state vector', 'statevector', 'amplitude', 'amplitudes', 'wavefunction'], module: 'qubits', text: 'The state vector lists one complex amplitude per basis state (2ⁿ for n qubits). The Lab\'s State Vector tab shows each amplitude, its magnitude, phase and probability.' },
        { id: 'density', title: 'Density matrix & partial trace', keys: ['density', 'partial trace', 'mixed state', 'reduced', 'purity'], module: 'qubits', text: 'A density matrix ρ describes pure and mixed states. Tracing out the other qubits gives one qubit\'s reduced state; its Bloch vector length tells you purity. A length below 1 on a pure global state signals entanglement.' },
        { id: 'decoherence', title: 'Noise & decoherence', keys: ['noise', 'decoherence', 'error', 'nisq', 't1', 't2'], module: 'circuits', text: 'Real qubits lose their quantum information through interaction with the environment (decoherence) and imperfect gates. That is why shallow circuits with few two-qubit gates perform better on today\'s NISQ hardware.' },
        { id: 'nocloning', title: 'No-cloning theorem', keys: ['clone', 'cloning', 'copy a qubit'], module: 'entanglement', text: 'No unitary can copy an arbitrary unknown quantum state. A CNOT copies basis states (|0⟩,|1⟩) but on a superposition it creates entanglement instead of a copy.' },
        { id: 'teleportation', title: 'Quantum teleportation', keys: ['teleport'], module: 'algorithms', example: 'teleportation', text: 'Teleportation transfers an unknown qubit state using a shared Bell pair and two classical bits. The Lab example uses the deferred-measurement form (CNOT and CZ corrections) so you can see q2 end up with q0\'s Bloch vector.' },
        { id: 'dj', title: 'Deutsch–Jozsa algorithm', keys: ['deutsch', 'jozsa', 'constant', 'balanced'], module: 'algorithms', example: 'deutsch_jozsa', text: 'Decides whether f is constant or balanced with one query. Prepare inputs in |+⟩ and the ancilla in |−⟩, apply the oracle, then H on the inputs: all zeros means constant, anything else balanced.' },
        { id: 'bv', title: 'Bernstein–Vazirani', keys: ['bernstein', 'vazirani', 'hidden string', 'secret string'], module: 'algorithms', example: 'bernstein_vazirani', text: 'Finds a hidden string s from f(x)=s·x mod 2 with one query. The oracle is a CNOT from every input qubit where s_i = 1 onto the |−⟩ ancilla.' },
        { id: 'grover', title: "Grover's algorithm", keys: ['grover', 'search', 'amplitude amplification', 'oracle', 'diffuser'], module: 'algorithms', example: 'grover2', text: 'Grover searches N items in ~(π/4)√N steps. Each iteration flips the phase of the marked state (oracle) and reflects all amplitudes about their mean (diffuser), gradually amplifying the answer.' },
        { id: 'qft', title: 'Quantum Fourier Transform', keys: ['qft', 'fourier', 'phase estimation', 'shor'], module: 'algorithms', example: 'qft3', text: 'The QFT maps |x⟩ to a superposition whose relative phases encode x. It uses H and controlled-phase gates plus final SWAPs, and underlies phase estimation and Shor\'s factoring algorithm.' },
        { id: 'variational', title: 'VQE & QAOA', keys: ['vqe', 'qaoa', 'variational', 'ansatz', 'hybrid'], module: 'algorithms', text: 'Variational algorithms run a parameterised circuit on the quantum device and let a classical optimiser tune the angles. PennyLane is designed for this: its qnodes are differentiable.' },
        { id: 'qiskit', title: 'Qiskit & Aer', keys: ['qiskit', 'aer', 'ibm'], module: 'circuits', text: 'Qiskit is IBM\'s open-source SDK. Build with QuantumCircuit, simulate with qiskit_aer.AerSimulator, and run on IBM Quantum hardware. Since Qiskit 1.0 use sim.run(transpile(qc, sim)) instead of execute().' },
        { id: 'cirq', title: 'Cirq', keys: ['cirq', 'google'], module: 'circuits', text: 'Cirq is Google\'s Python framework. Qubits are objects such as cirq.LineQubit.range(n); gates are applied as cirq.H(q[0]) and collected in a cirq.Circuit. Measurements need a key.' },
        { id: 'pennylane', title: 'PennyLane', keys: ['pennylane', 'xanadu', 'qml', 'qnode'], module: 'circuits', text: 'PennyLane (Xanadu) focuses on quantum machine learning. A @qml.qnode function applies gates like qml.Hadamard(wires=0) and returns measurements like qml.probs(); gradients come for free.' },
        { id: 'qbraid', title: 'qBraid', keys: ['qbraid', 'transpile', 'braket'], module: 'circuits', text: 'qBraid is a platform and SDK that connects frameworks and hardware providers. qbraid.transpile(program, "cirq") converts between Qiskit, Cirq, Braket, PyTKET and OpenQASM, and qBraid Runtime submits jobs to many devices.' },
        { id: 'qasm', title: 'OpenQASM', keys: ['qasm', 'openqasm', 'assembly'], module: 'circuits', text: 'OpenQASM is a text format for circuits: "qreg q[2]; h q[0]; cx q[0],q[1];". Every framework can import or export it, so it is the lingua franca between tools.' },
        { id: 'depth', title: 'Circuit depth & optimisation', keys: ['depth', 'optimi', 'gate count', 'simplify', 'reduce'], module: 'circuits', text: 'Depth is the number of gate layers on the critical path. Optimisation cancels inverse pairs, merges rotations and removes gates that do not affect results — the Tutor\'s Optimise button does this for your circuit.' }
    ];
    QL.KB = KB;
})(typeof window !== 'undefined' ? window : globalThis);
