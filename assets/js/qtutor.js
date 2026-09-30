/* =====================================================================
 * Quantum Lens — AI Quantum Tutor (qtutor.js)
 * ---------------------------------------------------------------------
 * A context-aware tutor that can see the learner's current circuit,
 * code, parse errors, results, active challenge and progress. It:
 *   • explains concepts (knowledge base + analogies + live examples)
 *   • explains the learner's own circuit step by step
 *   • generates circuits/code for standard algorithms in any framework
 *   • debugs code (syntax/semantic errors with line numbers & fixes)
 *   • detects logical issues and suggests optimisations
 *   • recommends what to learn next from the learner's progress
 * When the Python backend is running with ANTHROPIC_API_KEY set, open
 * questions are answered by Claude with the same context attached;
 * otherwise the built-in engine answers everything locally.
 * ===================================================================== */
(function (root) {
    'use strict';
    const QL = root.QL = root.QL || {};
    const PI = Math.PI;
    const g = (gate, t, ...params) => ({ gate, targets: [t], controls: [], params });
    const c = (gate, ctrl, t, ...params) => ({ gate, targets: [t], controls: Array.isArray(ctrl) ? ctrl : [ctrl], params });
    const m = (q) => ({ gate: 'measure', targets: [q], controls: [], params: [] });
    const range = (n) => [...Array(n).keys()];
    const measureAll = (n) => range(n).map(m);

    // -----------------------------------------------------------------
    // Circuit generators for code generation
    // -----------------------------------------------------------------
    function mcz(qs) { // multi-controlled Z on 2 or 3 qubits
        if (qs.length === 2) return [c('cz', qs[0], qs[1])];
        const [a, b, t] = qs; return [g('h', t), c('ccx', [a, b], t), g('h', t)];
    }
    const GEN = {
        bell: { title: 'Bell state |Φ⁺⟩', build: () => ({ numQubits: 2, ops: [g('h', 0), c('cx', 0, 1), ...measureAll(2)] }), explain: 'H puts q0 into superposition; the CNOT copies its value into q1, giving (|00⟩+|11⟩)/√2. You should measure 00 and 11 about half the time each, never 01 or 10.' },
        ghz: { title: 'GHZ state', build: (o) => { const n = Math.min(8, Math.max(3, o.n || 3)); return { numQubits: n, ops: [g('h', 0), ...range(n - 1).map(i => c('cx', i, i + 1)), ...measureAll(n)] }; }, explain: 'A chain of CNOTs spreads the superposition of q0 to every qubit: (|0…0⟩+|1…1⟩)/√2.' },
        uniform: { title: 'Uniform superposition', build: (o) => { const n = Math.min(8, Math.max(1, o.n || 3)); return { numQubits: n, ops: [...range(n).map(q => g('h', q)), ...measureAll(n)] }; }, explain: 'A Hadamard on every qubit makes all 2ⁿ bit-strings equally likely.' },
        qrng: { title: 'Quantum random number generator', build: (o) => { const n = Math.min(8, Math.max(1, o.n || 3)); return { numQubits: n, ops: [...range(n).map(q => g('h', q)), ...measureAll(n)] }; }, explain: 'Measuring qubits in equal superposition produces truly random bits — each shot gives a random integer from 0 to 2ⁿ−1.' },
        teleport: { title: 'Quantum teleportation', build: () => ({ numQubits: 3, ops: [g('ry', 0, 1.1), g('h', 1), c('cx', 1, 2), c('cx', 0, 1), g('h', 0), c('cx', 1, 2), c('cz', 0, 2), m(2)] }), explain: 'q0 holds the state to send (here RY(1.1)|0⟩). q1–q2 share a Bell pair. After the Bell measurement on q0,q1 (written with deferred measurement as CNOT/CZ corrections) q2 carries the original state — compare the Bloch spheres of q0 before and q2 after.' },
        dj: { title: 'Deutsch–Jozsa', build: (o) => { const n = Math.min(4, Math.max(1, o.n || 2)); const anc = n; const ops = [g('x', anc), ...range(n + 1).map(q => g('h', q))]; if (o.constant) ops.push(g('x', anc)); else range(n).forEach(q => ops.push(c('cx', q, anc))); range(n).forEach(q => ops.push(g('h', q))); range(n).forEach(q => ops.push(m(q))); return { numQubits: n + 1, ops }; }, explain: 'Inputs start in |+⟩, the ancilla in |−⟩. The oracle writes f(x) into the phase (phase kickback); final Hadamards give all zeros if f is constant and a non-zero string if balanced.' },
        bv: { title: 'Bernstein–Vazirani', build: (o) => { const s = o.secret || '101'; const n = s.length; const anc = n; const ops = [g('x', anc), g('h', anc), ...range(n).map(q => g('h', q))]; range(n).forEach(q => { if (s[n - 1 - q] === '1') ops.push(c('cx', q, anc)); }); range(n).forEach(q => ops.push(g('h', q))); range(n).forEach(q => ops.push(m(q))); return { numQubits: n + 1, ops }; }, explain: 'The oracle is a CNOT from every input qubit whose secret bit is 1 onto the |−⟩ ancilla. One query reveals the whole secret string.' },
        grover: { title: "Grover's search", build: (o) => { const target = o.secret && (o.secret.length === 2 || o.secret.length === 3) ? o.secret : '11'; const n = target.length; const qs = range(n); const oracle = []; qs.forEach(q => { if (target[n - 1 - q] === '0') oracle.push(g('x', q)); }); const flip = oracle.slice(); const diff = [...qs.map(q => g('h', q)), ...qs.map(q => g('x', q)), ...mcz(qs), ...qs.map(q => g('x', q)), ...qs.map(q => g('h', q))]; const iter = [...flip, ...mcz(qs), ...flip, ...diff]; const k = n === 2 ? 1 : 2; let ops = qs.map(q => g('h', q)); for (let i = 0; i < k; i++) ops = ops.concat(iter); return { numQubits: n, ops: [...ops, ...measureAll(n)], meta: { target } }; }, explain: 'Oracle: flip the phase of the marked state (X gates map it to |1…1⟩, then a multi-controlled Z). Diffuser: reflect all amplitudes about their mean. Repeat ≈ (π/4)√N times.' },
        qft: { title: 'Quantum Fourier Transform', build: (o) => { const n = Math.min(6, Math.max(2, o.n || 3)); const ops = []; for (let j = n - 1; j >= 0; j--) { ops.push(g('h', j)); for (let k = j - 1; k >= 0; k--) ops.push(c('cp', k, j, PI / Math.pow(2, j - k))); } for (let i = 0; i < Math.floor(n / 2); i++) ops.push({ gate: 'swap', targets: [i, n - 1 - i], controls: [], params: [] }); return { numQubits: n, ops }; }, explain: 'Hadamards plus controlled-phase rotations of π/2, π/4, … and final swaps implement the QFT. Apply X gates first to transform a basis state and inspect the phases in the State Vector tab.' },
        kickback: { title: 'Phase kickback', build: () => ({ numQubits: 2, ops: [g('x', 1), g('h', 1), g('h', 0), c('cx', 0, 1), g('h', 0), m(0)] }), explain: 'With the target in |−⟩, the CNOT leaves the target unchanged but flips the control from |+⟩ to |−⟩; the final H turns that into a measured 1.' },
        superdense: { title: 'Superdense coding (sending "11")', build: () => ({ numQubits: 2, ops: [g('h', 0), c('cx', 0, 1), g('z', 0), g('x', 0), c('cx', 0, 1), g('h', 0), m(0), m(1)] }), explain: 'Alice encodes two classical bits into her half of a Bell pair with Z and X; Bob decodes with CNOT + H and reads "11".' }
    };
    const GEN_KEYS = [
        [/bell|epr/, 'bell'], [/ghz/, 'ghz'], [/teleport/, 'teleport'], [/deutsch|jozsa/, 'dj'], [/bernstein|vazirani|hidden string|secret/, 'bv'],
        [/grover|search|amplitude amplification/, 'grover'], [/qft|fourier/, 'qft'], [/random|rng|dice|coin/, 'qrng'], [/kickback/, 'kickback'],
        [/superdense|dense coding/, 'superdense'], [/uniform|superposition|hadamard/, 'uniform'], [/entangle/, 'bell']
    ];
    QL.TUTOR_GENERATORS = GEN;

    // -----------------------------------------------------------------
    // Circuit analysis (error / logic detection)
    // -----------------------------------------------------------------
    function analyzeCircuit(circ) {
        const out = []; if (!circ || !circ.numQubits) return out;
        const met = QL.metrics(circ);
        if (!circ.ops.length) { out.push({ level: 'info', text: 'The circuit is empty — every qubit stays in |0⟩.' }); return out; }
        if (!met.measurements) out.push({ level: 'info', text: 'No measurements: the Lab shows exact probabilities, but shot counts sample all qubits. Add Measure gates to choose what is read out (real hardware needs them).' });
        if (met.unusedQubits.length) out.push({ level: 'info', text: `Qubit(s) ${met.unusedQubits.map(q => 'q' + q).join(', ')} are never used — you could remove them to save resources.` });
        const measured = new Set(); const touched = new Set();
        circ.ops.forEach((op, i) => {
            const qs = QL.opQubits(op); const G = QL.GATES[op.gate];
            if (op.gate === 'measure') { measured.add(op.targets[0]); return; }
            if (op.gate === 'barrier') return;
            const after = qs.filter(q => measured.has(q));
            if (after.length) out.push({ level: 'warn', text: `Step ${i + 1}: ${G.title} acts on q${after.join(', q')} after it was measured. Quantum Lens treats measurements as terminal, so move the measurement to the end.` });
            (op.controls || []).forEach(cq => { if (!touched.has(cq)) out.push({ level: 'warn', text: `Step ${i + 1}: the control qubit q${cq} of ${G.title} is still |0⟩, so this gate never fires. Did you forget an H or X on q${cq} first?` }); });
            if (G.rotation && Math.abs(op.params[0]) < 1e-9) out.push({ level: 'warn', text: `Step ${i + 1}: ${G.title} has angle 0 and does nothing.` });
            qs.forEach(q => touched.add(q));
        });
        const opt = QL.optimize(circ);
        if (opt.notes.length) out.push({ level: 'tip', text: `The circuit can be simplified (${opt.before.gates} → ${opt.after.gates} gates). Ask me to “optimise” to see how.` });
        opt.advice.forEach(a => out.push({ level: 'tip', text: a }));
        return out;
    }
    QL.analyzeCircuit = analyzeCircuit;

    function explainCircuit(circ) {
        if (!circ || !circ.numQubits) return 'There is no circuit yet. Drag gates onto the wires in the **Circuit Builder** or write code in the **Code Lab**, then ask me again.';
        const unitary = circ.ops.filter(o => o.gate !== 'barrier');
        const met = QL.metrics(circ);
        let s = `**Your circuit:** ${circ.numQubits} qubit(s), ${met.gates} gate(s), depth ${met.depth}${met.twoQubitGates ? `, ${met.twoQubitGates} two-qubit gate(s)` : ''}.\n\n`;
        if (circ.numQubits <= 5 && unitary.length <= 16) {
            s += '**Step by step** (starting from |' + '0'.repeat(circ.numQubits) + '⟩):\n';
            const lines = []; let k = 0;
            circ.ops.forEach((op, i) => {
                if (op.gate === 'barrier') return;
                const G = QL.GATES[op.gate]; k++;
                const where = op.controls && op.controls.length ? `control q${op.controls.join(',q')} → target q${op.targets.join(',q')}` : `q${op.targets.join(', q')}`;
                const par = op.params && op.params.length ? `(${op.params.map(QL.fmtAngleHuman).join(', ')})` : '';
                if (op.gate === 'measure') { lines.push(`${k}. **Measure** q${op.targets[0]} — reads 0 or 1 with the probabilities below.`); return; }
                const st = QL.simulate(circ, { upto: i + 1 });
                lines.push(`${k}. **${G.title}${par}** on ${where} → ${QL.describeState(st.amplitudes, circ.numQubits)}`);
            });
            s += lines.join('\n') + '\n\n';
        }
        const r = QL.simulate(circ);
        s += `**Final state:** ${QL.describeState(r.amplitudes, circ.numQubits)}.\n\n`;
        const top = Object.entries(r.marginal).sort((a, b) => b[1] - a[1]).slice(0, 6);
        s += `**Measurement outcomes** (${r.explicitMeasurement ? 'measured qubits' : 'all qubits'}, q0 right-most): ${top.map(([k, v]) => `\`${k}\` ${(v * 100).toFixed(1)}%`).join(', ')}.`;
        const ent = QL.entangledQubits(r);
        if (ent.length) s += `\n\n**Entanglement:** q${ent.join(', q')} ${ent.length > 1 ? 'are' : 'is'} entangled — their individual Bloch vectors are shorter than 1 (purity < 1).`;
        return s;
    }
    QL.explainCircuit = explainCircuit;

    // -----------------------------------------------------------------
    // Tutor engine
    // -----------------------------------------------------------------
    function detectFramework(t, fallback) {
        if (/qiskit|aer|ibm/.test(t)) return 'qiskit'; if (/cirq|google/.test(t)) return 'cirq'; if (/pennylane|penny lane|qml/.test(t)) return 'pennylane';
        if (/qbraid/.test(t)) return 'qbraid'; if (/qasm/.test(t)) return 'qasm'; return fallback && fallback !== 'auto' ? fallback : 'qiskit';
    }
    function kbSearch(t) {
        let best = null, bs = 0;
        QL.KB.forEach(k => { let s = 0; k.keys.forEach(key => { if (t.includes(key)) s += key.length + 3; }); if (t.includes(k.title.toLowerCase())) s += 5; if (s > bs) { bs = s; best = k; } });
        return best;
    }

    class Tutor {
        constructor(opts = {}) { this.getContext = opts.getContext || (() => ({})); this.useLLM = true; this.hintIndex = {}; }
        async ask(question) {
            const t = question.toLowerCase().trim(); const ctx = this.getContext() || {};
            const reply = this.local(t, question, ctx);
            if (reply.fallback && this.useLLM && QL.api.status.llm) {
                try { const r = await QL.api.tutor(question, this.contextPayload(ctx)); QL.countTutor('llm'); return { text: r.reply, source: 'Claude (via Quantum Lens backend)', actions: [] }; }
                catch (e) { reply.text += `\n\n_(The LLM tutor could not be reached: ${e.message})_`; }
            }
            QL.countTutor(reply.topic);
            return reply;
        }
        contextPayload(ctx) {
            return {
                page: ctx.page, framework: ctx.framework, code: (ctx.code || '').slice(0, 6000),
                circuit_qasm: ctx.circuit && ctx.circuit.numQubits ? QL.toQASM(ctx.circuit) : null,
                parse_errors: ctx.parse ? ctx.parse.errors : [], challenge: ctx.challenge ? { title: ctx.challenge.title, goal: ctx.challenge.goal } : null,
                progress: (() => { const s = QL.summary(); return { overall: s.overall, avg_quiz: s.avgQuiz, level: QL.getProgress().profile.level, modules: s.modules.map(x => ({ id: x.id, pct: x.pct, quiz: x.quizBest })) }; })()
            };
        }
        local(t, raw, ctx) {
            const R = (text, topic, actions = [], extra = {}) => Object.assign({ text, topic, actions, source: 'Quantum Lens tutor engine' }, extra);
            const circ = ctx.circuit;
            if (!t || /^(hi|hello|hey|help|what can you do)\b/.test(t)) return R(`Hi! I'm your AI Quantum Tutor. I can see your current circuit${ctx.code ? ' and code' : ''}. Try:\n- **Explain** a concept — “what is entanglement?”\n- **Explain my circuit** step by step\n- **Generate** code — “Grover search for 101 in Cirq”\n- **Debug** — “why doesn't my code run?”\n- **Optimise** my circuit\n- **What should I learn next?**`, 'help');

            // Hints for active challenge
            if (/\bhint\b/.test(t) && ctx.challenge) {
                const ch = ctx.challenge; const i = this.hintIndex[ch.id] = Math.min((this.hintIndex[ch.id] || 0), ch.hints.length - 1);
                this.hintIndex[ch.id] = i + 1; if (ctx.onHint) ctx.onHint(i + 1);
                return R(`**Hint ${i + 1}/${ch.hints.length} for “${ch.title}”:** ${ch.hints[i]}\n\n_Each hint used lowers the maximum score by 10 points._`, 'hint');
            }
            // Recommendations
            if (/(learn next|what next|recommend|should i (study|learn|do)|my progress|weak|study plan|learning path)/.test(t)) {
                const recs = QL.recommendations(); const s = QL.summary();
                return R(`You're **${s.overall}%** through the learning path (${s.modulesCompleted}/8 modules complete${s.avgQuiz != null ? `, average quiz ${s.avgQuiz}%` : ''}). Here's what I recommend:\n\n${recs.map((r, i) => `${i + 1}. **${r.title}** — ${r.detail} [Open](${r.href})`).join('\n')}`, 'recommend');
            }
            // Debugging
            if (/(debug|error|bug|fix|broken|not work|doesn.?t work|won.?t run|fail|wrong|mistake|issue|problem)/.test(t)) {
                const lines = []; let code = ctx.code && ctx.parse;
                if (code) {
                    const p = ctx.parse;
                    if (p.errors.length) {
                        lines.push(`I found **${p.errors.length} error(s)** in your ${QL.FRAMEWORKS[p.framework] ? QL.FRAMEWORKS[p.framework].label : ''} code:`);
                        p.errors.slice(0, 6).forEach(e => lines.push(`- **Line ${e.line}:** ${e.message}${e.hint ? ` — ${e.hint}` : ''}`));
                    }
                    if (p.warnings && p.warnings.length) { lines.push('\n**Warnings:**'); p.warnings.slice(0, 6).forEach(w => lines.push(`- Line ${w.line}: ${w.message}${w.hint ? ` — ${w.hint}` : ''}`)); }
                    if (!p.errors.length && !(p.warnings || []).length) lines.push('Your code parses cleanly — no syntax or API errors.');
                }
                const an = analyzeCircuit(circ);
                if (an.length) { lines.push('\n**Logic check of the circuit:**'); an.forEach(a => lines.push(`- ${a.level === 'warn' ? '⚠️' : a.level === 'tip' ? '💡' : 'ℹ️'} ${a.text}`)); }
                if (ctx.challenge && ctx.lastGrade && !ctx.lastGrade.passed) {
                    lines.push(`\n**Challenge “${ctx.challenge.title}”:** ${ctx.lastGrade.checks.filter(x => !x.pass).map(x => `${x.label} (${x.detail})`).join('; ')}. Type **hint** for a nudge.`);
                }
                if (!lines.length) lines.push('I could not find a circuit or code to check. Build a circuit or paste code in the Code Lab, then ask again.');
                const actions = [];
                if (code && ctx.parse.errors.length && ctx.parse.errors[0].line) actions.push({ label: `Go to line ${ctx.parse.errors[0].line}`, type: 'gotoLine', line: ctx.parse.errors[0].line });
                return R(lines.join('\n'), 'debug', actions);
            }
            // Optimisation
            if (/(optimi[sz]|simplif|reduce|shorter|fewer gates|make .* (smaller|faster)|improve my)/.test(t)) {
                if (!circ || !circ.ops.length) return R('Build or load a circuit first, then I can optimise it.', 'optimize');
                const o = QL.optimize(circ);
                if (!o.notes.length && !o.advice.length) return R(`Your circuit is already minimal for my peephole rules: **${o.before.gates} gates, depth ${o.before.depth}**.\n\nIdeas for bigger savings:\n- Fewer two-qubit gates (they're the noisiest on hardware)\n- Re-order independent gates to reduce depth\n- Use native rotations instead of long gate sequences`, 'optimize');
                return R(`**Optimisation report**\n\n${o.notes.map(n => '- ' + n).join('\n')}${o.advice.length ? '\n' + o.advice.map(n => '- 💡 ' + n).join('\n') : ''}\n\n- Gates: **${o.before.gates} → ${o.after.gates}**\n- Depth: **${o.before.depth} → ${o.after.depth}**\n- Two-qubit gates: **${o.before.twoQubitGates} → ${o.after.twoQubitGates}**\n\nThe optimised circuit performs the same operation (up to an unobservable global phase).`, 'optimize', o.notes.length ? [{ label: 'Apply optimised circuit', type: 'loadCircuit', circuit: o.circuit }] : []);
            }
            // Explain my circuit / results
            if (/(my|this|current) (circuit|code|result|state|histogram)|what does (it|this|my)|explain (it|this|the result)/.test(t)) return R(explainCircuit(circ), 'explain-circuit');
            // Code generation
            const wantsCode = /(generate|write|code|create|build|make|implement|show me|give me|program|template|example)/.test(t);
            const genKey = (GEN_KEYS.find(([re]) => re.test(t)) || [])[1];
            if (wantsCode && genKey) {
                const fw = detectFramework(t, ctx.framework);
                const nMatch = /(\d+)[- ]?qubit/.exec(t) || /\bn\s*=\s*(\d+)/.exec(t); const bits = /\b([01]{2,6})\b/.exec(t);
                const opts = { n: nMatch ? +nMatch[1] : undefined, secret: bits ? bits[1] : undefined, constant: /constant/.test(t) };
                const G = GEN[genKey]; const circuit = G.build(opts); const code = QL.generateCode(circuit, fw);
                const r = QL.simulate(circuit); const top = Object.entries(r.marginal).sort((a, b) => b[1] - a[1]).slice(0, 4);
                return R(`Here is **${G.title}** in **${QL.FRAMEWORKS[fw].label}**${circuit.meta && circuit.meta.target ? ` (marked state \`${circuit.meta.target}\`)` : ''}:\n\n\`\`\`${QL.FRAMEWORKS[fw].lang}\n${code}\`\`\`\n\n**How it works:** ${G.explain}\n\n**Expected outcome:** ${top.map(([k, v]) => `\`${k}\` ≈ ${(v * 100).toFixed(1)}%`).join(', ')}.`, 'generate', [
                    { label: 'Open in Code Lab', type: 'loadCode', code, framework: fw }, { label: 'Load into Builder', type: 'loadCircuit', circuit }]);
            }
            // Concepts
            const k = kbSearch(t);
            if (k && (/(what|explain|how|why|tell|meaning|define|difference|understand|is)/.test(t) || t.split(' ').length <= 4)) {
                const mod = QL.MODULES.find(x => x.id === k.module);
                const actions = [];
                if (k.example && QL.EXAMPLES[k.example]) actions.push({ label: `Try it: ${QL.EXAMPLES[k.example].title}`, type: 'loadCircuit', circuit: QL.EXAMPLES[k.example].circuit });
                if (mod) actions.push({ label: `Lesson: ${mod.title}`, type: 'link', href: `learn.html#module-${mod.id}` });
                return R(`**${k.title}**\n\n${k.text}${k.analogy ? `\n\n**Analogy:** ${k.analogy}` : ''}`, k.id, actions);
            }
            if (wantsCode) {
                const fw = detectFramework(t, ctx.framework);
                return R(`I can generate these in ${QL.FRAMEWORKS[fw].label}: Bell state, GHZ (n qubits), uniform superposition, random number generator, teleportation, superdense coding, phase kickback, Deutsch–Jozsa, Bernstein–Vazirani (e.g. “secret 1011”), Grover (e.g. “Grover for 101”) and QFT (n qubits). Which one would you like?`, 'generate', [], { fallback: true });
            }
            return R(`I'm not sure about that one yet. I can explain concepts (try “what is superposition?”), explain or debug your circuit, optimise it, generate algorithm code, or suggest what to learn next.${QL.api.status.connected && !QL.api.status.llm ? '\n\n_Tip: set ANTHROPIC_API_KEY on the backend to let Claude answer open-ended questions._' : ''}`, 'unknown', [], { fallback: true });
        }
    }
    QL.Tutor = Tutor;

    // -----------------------------------------------------------------
    // Chat UI component
    // -----------------------------------------------------------------
    QL.mountTutor = (el, opts = {}) => {
        const tutor = new Tutor({ getContext: opts.getContext });
        const chips = opts.chips || ['Explain my circuit', 'Find errors in my code', 'Optimise my circuit', 'Generate Grover search in Cirq', 'What is entanglement?', 'What should I learn next?'];
        el.classList.add('ql-tutor');
        el.innerHTML = `
            <div class="ql-tutor-head"><div><i class="fas fa-robot"></i> <strong>AI Quantum Tutor</strong></div><span class="ql-tutor-mode" title="Which engine answers open questions"></span></div>
            <div class="ql-tutor-log" aria-live="polite"></div>
            <div class="ql-tutor-chips">${chips.map(c => `<button type="button" class="ql-chip">${QL.esc(c)}</button>`).join('')}</div>
            <form class="ql-tutor-form"><label class="ql-sr" for="${el.id}-in">Ask the tutor</label><input id="${el.id}-in" type="text" placeholder="Ask about concepts, your code, errors…" autocomplete="off"><button type="submit" class="ql-btn ql-btn-primary" aria-label="Send"><i class="fas fa-paper-plane"></i></button></form>`;
        const log = el.querySelector('.ql-tutor-log'); const input = el.querySelector('input'); const mode = el.querySelector('.ql-tutor-mode');
        const setMode = () => { mode.textContent = QL.api.status.llm ? 'Claude + local engine' : 'Local engine'; mode.classList.toggle('on', !!QL.api.status.llm); };
        setMode(); QL.on('backend', setMode);
        function add(role, html, actions, source) {
            const d = document.createElement('div'); d.className = `ql-msg ql-msg-${role}`;
            d.innerHTML = `<div class="ql-msg-body">${html}</div>${source ? `<div class="ql-msg-src">${QL.esc(source)}</div>` : ''}`;
            if (actions && actions.length) {
                const bar = document.createElement('div'); bar.className = 'ql-msg-actions';
                actions.forEach(a => { const b = document.createElement('button'); b.type = 'button'; b.className = 'ql-btn ql-btn-small'; b.textContent = a.label; b.onclick = () => { if (a.type === 'link') location.href = a.href; else if (opts.onAction) opts.onAction(a); }; bar.appendChild(b); });
                d.appendChild(bar);
            }
            log.appendChild(d); log.scrollTop = log.scrollHeight; return d;
        }
        async function send(q) {
            if (!q.trim()) return;
            add('user', QL.esc(q));
            const wait = add('bot', '<span class="ql-typing"><i></i><i></i><i></i></span>');
            try { const r = await tutor.ask(q); wait.remove(); add('bot', QL.md(r.text), r.actions, r.source); }
            catch (e) { wait.remove(); add('bot', `<p>Sorry — something went wrong: ${QL.esc(e.message)}</p>`); }
        }
        el.querySelector('form').addEventListener('submit', e => { e.preventDefault(); const q = input.value; input.value = ''; send(q); });
        el.querySelectorAll('.ql-chip').forEach(b => b.addEventListener('click', () => send(b.textContent)));
        add('bot', QL.md(opts.greeting || "Hi! I'm your **AI Quantum Tutor**. Ask me to explain a concept, walk through your circuit, find bugs, optimise, or generate code in Qiskit, Cirq, PennyLane, qBraid or OpenQASM."));
        return { ask: send, tutor };
    };
})(typeof window !== 'undefined' ? window : globalThis);
