/* =====================================================================
 * Quantum Lens — State, persistence, assessment & backend client
 * (qstore.js)
 *  - Safe localStorage wrapper (falls back to memory)
 *  - Learner progress model, scoring and activity log
 *  - Assessment engine (quiz scoring + challenge grading)
 *  - Personalised learning-path recommendations
 *  - Saved-circuit library
 *  - Optional Python backend client (multi-backend simulation,
 *    LLM tutor, class sync for the instructor dashboard)
 * ===================================================================== */
(function (root) {
    'use strict';
    const QL = root.QL = root.QL || {};

    // ---------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------
    const mem = {};
    const store = {
        get(k, def) { try { const v = root.localStorage.getItem(k); return v == null ? (k in mem ? mem[k] : def) : JSON.parse(v); } catch (e) { return k in mem ? mem[k] : def; } },
        set(k, v) { mem[k] = v; try { root.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode / quota: keep in memory */ } }
    };
    QL.storage = store;
    const KEYS = { progress: 'qlens.progress.v1', circuits: 'qlens.circuits.v1', settings: 'qlens.settings.v1', draft: 'qlens.labdraft.v1' };
    QL.KEYS = KEYS;

    // tiny event bus
    const listeners = {};
    QL.on = (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); };
    QL.emit = (ev, data) => (listeners[ev] || []).forEach(fn => { try { fn(data); } catch (e) { console.error(e); } });

    const uid = () => 'xxxxxxxx'.replace(/x/g, () => (Math.random() * 16 | 0).toString(16)) + Date.now().toString(16).slice(-4);
    QL.uid = uid;

    // ---------------------------------------------------------------
    // Settings
    // ---------------------------------------------------------------
    QL.settings = Object.assign({ backendUrl: '', shots: 1024, defaultBackend: 'qiskit_aer', seed: null }, store.get(KEYS.settings, {}));
    QL.saveSettings = (patch) => { Object.assign(QL.settings, patch); store.set(KEYS.settings, QL.settings); };

    // ---------------------------------------------------------------
    // Progress model
    // ---------------------------------------------------------------
    function blankProgress() {
        return { version: 1, learnerId: uid(), profile: { name: '', level: 'beginner', goal: 'foundations', classCode: '' }, created: Date.now(), updated: Date.now(), modules: {}, challenges: {}, topicStats: {}, activity: [], counters: { runs: 0, tutorQuestions: 0, circuitsSaved: 0 } };
    }
    let progress = Object.assign(blankProgress(), store.get(KEYS.progress, {}));
    QL.getProgress = () => progress;
    function saveProgress() { progress.updated = Date.now(); store.set(KEYS.progress, progress); QL.emit('progress', progress); if (QL.api && QL.api.status.connected && progress.profile.classCode) QL.api.syncProgress().catch(() => { }); }
    QL.saveProgress = saveProgress;
    QL.resetProgress = () => { const id = progress.learnerId, profile = progress.profile; progress = blankProgress(); progress.learnerId = id; progress.profile = profile; saveProgress(); };
    QL.importProgress = (obj) => { if (!obj || obj.version !== 1 || !obj.modules) throw new Error('Not a Quantum Lens progress file.'); progress = Object.assign(blankProgress(), obj); saveProgress(); };
    QL.updateProfile = (patch) => { Object.assign(progress.profile, patch); saveProgress(); };

    function log(type, id, extra) {
        progress.activity.unshift(Object.assign({ t: Date.now(), type, id }, extra || {}));
        if (progress.activity.length > 300) progress.activity.length = 300;
    }
    QL.logActivity = (type, id, extra) => { log(type, id, extra); saveProgress(); };
    QL.countRun = () => { progress.counters.runs++; saveProgress(); };
    QL.countTutor = (topic) => { progress.counters.tutorQuestions++; if (topic) log('tutor', topic); saveProgress(); };

    function mod(id) { return progress.modules[id] = progress.modules[id] || { lessonsViewed: [], quiz: null, completedAt: null }; }
    QL.markLessonViewed = (moduleId, idx) => {
        const m = mod(moduleId);
        if (!m.lessonsViewed.includes(idx)) { m.lessonsViewed.push(idx); log('lesson', moduleId, { lesson: idx }); checkModuleComplete(moduleId); saveProgress(); }
    };
    function checkModuleComplete(moduleId) {
        const def = QL.MODULES.find(x => x.id === moduleId); const m = mod(moduleId);
        if (!m.completedAt && m.lessonsViewed.length >= def.lessons.length && m.quiz && m.quiz.best >= QL.PASS_MARK) { m.completedAt = Date.now(); log('module-complete', moduleId); }
    }
    QL.PASS_MARK = 70;

    // ---------------------------------------------------------------
    // Assessment: quizzes
    // ---------------------------------------------------------------
    /** answers: array of chosen option indices. Returns detailed result and records it. */
    QL.submitQuiz = (moduleId, answers) => {
        const def = QL.MODULES.find(x => x.id === moduleId);
        const items = def.quiz.map((q, i) => ({ q, chosen: answers[i], correct: answers[i] === q.answer }));
        const right = items.filter(x => x.correct).length;
        const score = Math.round(100 * right / items.length);
        const m = mod(moduleId);
        const prev = m.quiz || { best: 0, attempts: 0, history: [] };
        m.quiz = { best: Math.max(prev.best, score), last: score, attempts: prev.attempts + 1, history: [...(prev.history || []), { score, t: Date.now() }].slice(-20) };
        const topic = def.topic; const ts = progress.topicStats[topic] = progress.topicStats[topic] || { right: 0, wrong: 0 };
        ts.right += right; ts.wrong += items.length - right;
        log('quiz', moduleId, { score });
        checkModuleComplete(moduleId); saveProgress();
        const feedback = score === 100 ? 'Perfect score — excellent work!' : score >= QL.PASS_MARK ? 'Passed! Review the explanations for the ones you missed.' : `Not passed yet (need ${QL.PASS_MARK}%). Revisit the lessons, then try again — questions and explanations are below.`;
        return { score, right, total: items.length, passed: score >= QL.PASS_MARK, items, feedback, best: m.quiz.best, attempts: m.quiz.attempts };
    };

    // ---------------------------------------------------------------
    // Assessment: challenge grading
    // ---------------------------------------------------------------
    QL.gradeChallenge = (ch, circuit, meta = {}) => {
        const fb = []; let ok = true;
        const errs = QL.validateCircuit(circuit);
        if (errs.length) return { passed: false, score: 0, fidelity: 0, feedback: errs, checks: [] };
        const met = QL.metrics(circuit);
        const checks = [];
        const add = (label, pass, detail) => { checks.push({ label, pass, detail }); if (!pass) ok = false; };
        const expectQ = ch.target.circuit ? ch.target.circuit.numQubits : (ch.qubits || null);
        if (expectQ && circuit.numQubits !== expectQ && ch.target.kind !== 'dist') add(`Uses ${expectQ} qubit(s)`, false, `Your circuit has ${circuit.numQubits}.`);
        if (ch.allowed) { const bad = circuit.ops.filter(o => !ch.allowed.includes(o.gate) && o.gate !== 'barrier' && o.gate !== 'measure'); add(`Only ${ch.allowed.join(', ').toUpperCase()} gates`, !bad.length, bad.length ? `Not allowed: ${[...new Set(bad.map(o => o.gate.toUpperCase()))].join(', ')}` : ''); }
        if (ch.forbidden) { const bad = circuit.ops.filter(o => ch.forbidden.includes(o.gate)); add(`Without ${ch.forbidden.join(', ').toUpperCase()}`, !bad.length, bad.length ? 'A forbidden gate was used.' : ''); }
        if (ch.maxGates != null) add(`At most ${ch.maxGates} gate(s)`, met.gates <= ch.maxGates, `You used ${met.gates}.`);
        if (ch.minCounts) Object.entries(ch.minCounts).forEach(([gname, k]) => add(`Uses at least ${k}× ${gname.toUpperCase()}`, (met.byGate[gname] || 0) >= k, `Found ${met.byGate[gname] || 0}.`));
        if (ch.requireMeasure) add('Includes measurement', met.measurements > 0, met.measurements ? '' : 'Add measurement gates.');
        if (ch.requireLoop) add('Uses a for-loop', !!(meta.code && /\bfor\s+\w+\s+in\b/.test(meta.code)), 'Write the repeated gates with a for-loop.');
        let fid = 0;
        if (!checks.some(c => !c.pass && /qubit/.test(c.label))) {
            if (ch.target.kind === 'state') {
                const a = QL.simulate({ numQubits: circuit.numQubits, ops: circuit.ops.filter(o => o.gate !== 'measure') }).amplitudes;
                const b = QL.simulate(ch.target.circuit).amplitudes;
                fid = QL.fidelity(a, b);
                add('Target state reached (fidelity ≥ 0.99)', fid >= 0.99, `Fidelity ${(fid * 100).toFixed(1)}%`);
            } else if (ch.target.kind === 'unitary') {
                fid = QL.unitaryFidelity(circuit, ch.target.circuit);
                add('Same operation as the target (process fidelity ≥ 0.99)', fid >= 0.99, `Process fidelity ${(fid * 100).toFixed(1)}%`);
            } else if (ch.target.kind === 'dist') {
                const r = QL.simulate(circuit);
                const tv = QL.totalVariation(r.marginal, ch.target.dist);
                fid = 1 - tv;
                add('Output distribution matches (≥ 99%)', fid >= 0.99, `Overlap ${(fid * 100).toFixed(1)}% — got ${Object.entries(r.marginal).map(([k, v]) => `${k}: ${(v * 100).toFixed(1)}%`).join(', ')}`);
            }
        }
        const hintsUsed = meta.hintsUsed || 0;
        let score = 0;
        if (ok) {
            score = 100;
            if (ch.optimal && met.gates > ch.optimal) score -= Math.min(30, 5 * (met.gates - ch.optimal));
            score -= hintsUsed * 10;
            score = Math.max(50, score);
            fb.push(score === 100 ? 'Perfect — optimal solution with no hints!' : `Solved! ${ch.optimal && met.gates > ch.optimal ? `An optimal solution uses ${ch.optimal} gate(s); you used ${met.gates}. ` : ''}${hintsUsed ? `−${hintsUsed * 10} for hints.` : ''}`);
        } else {
            fb.push('Not quite yet. Check the failing items below — the AI Tutor can explain what your circuit does right now.');
        }
        return { passed: ok, score, fidelity: fid, checks, feedback: fb, metrics: met };
    };

    QL.recordChallenge = (ch, result, hintsUsed) => {
        const r = progress.challenges[ch.id] = progress.challenges[ch.id] || { attempts: 0, best: 0, passed: false, hintsUsed: 0 };
        r.attempts++; r.hintsUsed = Math.max(r.hintsUsed, hintsUsed || 0);
        if (result.passed) { r.best = Math.max(r.best, result.score); if (!r.passed) r.passedAt = Date.now(); r.passed = true; }
        const ts = progress.topicStats[QL.MODULES.find(m => m.id === ch.module).topic] = progress.topicStats[QL.MODULES.find(m => m.id === ch.module).topic] || { right: 0, wrong: 0 };
        if (result.passed) ts.right++; else ts.wrong++;
        log('challenge', ch.id, { score: result.score, passed: result.passed });
        saveProgress();
    };

    // ---------------------------------------------------------------
    // Progress summaries
    // ---------------------------------------------------------------
    QL.moduleProgress = (id, p = progress) => {
        const def = QL.MODULES.find(x => x.id === id); const m = p.modules[id] || { lessonsViewed: [] };
        const lessons = Math.min(1, (m.lessonsViewed || []).length / def.lessons.length);
        const quiz = m.quiz ? (m.quiz.best >= QL.PASS_MARK ? 1 : m.quiz.best / 100) : 0;
        const chs = def.challenges || []; const passed = chs.filter(c => p.challenges[c] && p.challenges[c].passed).length;
        const chal = chs.length ? passed / chs.length : 1;
        return { pct: Math.round(100 * (0.5 * lessons + 0.3 * quiz + 0.2 * chal)), lessons, quizBest: m.quiz ? m.quiz.best : null, attempts: m.quiz ? m.quiz.attempts : 0, challengesPassed: passed, challengesTotal: chs.length, completed: !!m.completedAt, started: (m.lessonsViewed || []).length > 0 || !!m.quiz };
    };
    QL.summary = (p = progress) => {
        const mods = QL.MODULES.map(m => Object.assign({ id: m.id, title: m.title }, QL.moduleProgress(m.id, p)));
        const quizScores = mods.filter(m => m.quizBest != null).map(m => m.quizBest);
        const chPassed = Object.values(p.challenges).filter(c => c.passed);
        const points = chPassed.reduce((s, c) => s + c.best, 0) + quizScores.reduce((s, v) => s + v, 0);
        const lastActive = p.activity.length ? p.activity[0].t : p.updated;
        return {
            overall: Math.round(mods.reduce((s, m) => s + m.pct, 0) / mods.length), modules: mods,
            modulesCompleted: mods.filter(m => m.completed).length, avgQuiz: quizScores.length ? Math.round(quizScores.reduce((a, b) => a + b, 0) / quizScores.length) : null,
            challengesPassed: chPassed.length, challengesTotal: QL.CHALLENGES.length, points, lastActive,
            level: points > 1500 ? 'Quantum Practitioner' : points > 700 ? 'Circuit Builder' : points > 200 ? 'Qubit Explorer' : 'Newcomer',
            streak: streakDays(p.activity)
        };
    };
    function streakDays(act) {
        const days = new Set(act.map(a => new Date(a.t).toDateString())); let n = 0; const d = new Date();
        while (days.has(d.toDateString())) { n++; d.setDate(d.getDate() - 1); }
        return n;
    }

    // ---------------------------------------------------------------
    // Personalised learning path
    // ---------------------------------------------------------------
    const PATH_ORDER = {
        foundations: ['fundamentals', 'qubits', 'superposition', 'measurement', 'entanglement', 'gates', 'circuits', 'algorithms'],
        algorithms: ['fundamentals', 'qubits', 'superposition', 'gates', 'entanglement', 'measurement', 'algorithms', 'circuits'],
        coding: ['fundamentals', 'qubits', 'gates', 'circuits', 'superposition', 'measurement', 'entanglement', 'algorithms']
    };
    const OPTIONAL = { beginner: [], intermediate: ['fundamentals', 'qubits'], advanced: ['fundamentals', 'qubits', 'superposition', 'measurement'] };

    QL.learningPath = (p = progress) => {
        const order = PATH_ORDER[p.profile.goal] || PATH_ORDER.foundations;
        const optional = OPTIONAL[p.profile.level] || [];
        let recommendedSet = false;
        return order.map(id => {
            const def = QL.MODULES.find(m => m.id === id); const mp = QL.moduleProgress(id, p);
            const prereqsDone = def.prereqs.every(r => (QL.moduleProgress(r, p).completed) || optional.includes(r));
            let status;
            if (mp.completed) status = 'completed';
            else if (mp.quizBest != null && mp.quizBest < QL.PASS_MARK) status = 'review';
            else if (mp.started) status = 'in-progress';
            else if (optional.includes(id)) status = 'optional';
            else status = prereqsDone ? 'available' : 'upcoming';
            let recommended = false;
            if (!recommendedSet && ['review', 'in-progress', 'available'].includes(status)) { recommended = true; recommendedSet = true; }
            return Object.assign({ id, def, status, recommended, prereqsDone }, mp);
        });
    };

    QL.recommendations = (p = progress) => {
        const recs = []; const path = QL.learningPath(p);
        path.filter(x => x.status === 'review').forEach(x => recs.push({ kind: 'review', icon: 'fa-rotate', title: `Review “${x.def.title}”`, detail: `Your best quiz score is ${x.quizBest}%. Re-read the lessons and retake the quiz (pass mark ${QL.PASS_MARK}%).`, href: `learn.html#module-${x.id}`, priority: 1 }));
        Object.entries(p.topicStats).forEach(([topic, s]) => {
            const n = s.right + s.wrong; if (n >= 4 && s.wrong / n > 0.4) {
                const m = QL.MODULES.find(mm => mm.topic === topic);
                if (!recs.some(r => r.href === `learn.html#module-${m.id}`)) recs.push({ kind: 'weak', icon: 'fa-bullseye', title: `Strengthen: ${m.title}`, detail: `You've missed ${Math.round(100 * s.wrong / n)}% of ${topic} questions/challenges. Ask the AI Tutor to explain ${topic} or try the interactive example.`, href: `learn.html#module-${m.id}`, priority: 2 });
            }
        });
        const cur = path.find(x => x.status === 'in-progress');
        if (cur) {
            const nextLesson = cur.def.lessons.findIndex((_, i) => !((p.modules[cur.id] || {}).lessonsViewed || []).includes(i));
            recs.push({ kind: 'continue', icon: 'fa-play', title: `Continue “${cur.def.title}”`, detail: nextLesson >= 0 ? `Next up: lesson ${nextLesson + 1} — ${cur.def.lessons[nextLesson].title}.` : 'All lessons read — take the module quiz.', href: `learn.html#module-${cur.id}`, priority: 3 });
        }
        const next = path.find(x => (x.status === 'available' || x.status === 'upcoming') && !x.started);
        if (next) recs.push({ kind: 'start', icon: 'fa-flag', title: `Start “${next.def.title}”`, detail: next.prereqsDone ? next.def.summary : `Recommended after: ${next.def.prereqs.map(r => QL.MODULES.find(m => m.id === r).title).join(', ')}.`, href: `learn.html#module-${next.id}`, priority: 4 });
        const doneMods = path.filter(x => x.completed || x.quizBest >= QL.PASS_MARK).map(x => x.id);
        const openCh = QL.CHALLENGES.filter(c => doneMods.includes(c.module) && !(p.challenges[c.id] && p.challenges[c.id].passed));
        openCh.slice(0, 2).forEach(c => recs.push({ kind: 'challenge', icon: c.type === 'code' ? 'fa-code' : 'fa-puzzle-piece', title: `Challenge: ${c.title}`, detail: `${c.difficulty} · ${c.points} pts — ${c.goal}`, href: `lab.html#challenge=${c.id}`, priority: 5 }));
        if (!recs.length) recs.push({ kind: 'explore', icon: 'fa-rocket', title: 'Explore advanced circuits', detail: 'You have completed the path! Try the 3-qubit Grover or QFT examples in the Lab and compare backends.', href: 'lab.html#example=grover3', priority: 6 });
        return recs.sort((a, b) => a.priority - b.priority).slice(0, 5);
    };

    // ---------------------------------------------------------------
    // Saved circuits
    // ---------------------------------------------------------------
    QL.circuits = {
        list() { return store.get(KEYS.circuits, []); },
        save(entry) {
            const all = this.list(); const now = Date.now();
            if (entry.id) { const i = all.findIndex(x => x.id === entry.id); if (i >= 0) { all[i] = Object.assign(all[i], entry, { updated: now }); store.set(KEYS.circuits, all); return all[i]; } }
            const e = Object.assign({ id: uid(), created: now, updated: now, tags: [] }, entry); all.unshift(e); store.set(KEYS.circuits, all);
            progress.counters.circuitsSaved++; log('save', e.name); saveProgress();
            if (QL.api.status.connected) QL.api.saveCircuit(e).catch(() => { });
            return e;
        },
        remove(id) { store.set(KEYS.circuits, this.list().filter(x => x.id !== id)); if (QL.api.status.connected) QL.api.deleteCircuit(id).catch(() => { }); },
        get(id) { return this.list().find(x => x.id === id); }
    };

    // Share links: circuit encoded in the URL hash
    QL.encodeCircuit = (c) => { const s = JSON.stringify({ n: c.numQubits, o: c.ops.map(o => [o.gate, o.targets, o.controls || [], o.params || []]) }); return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
    QL.decodeCircuit = (str) => { const s = decodeURIComponent(escape(atob(str.replace(/-/g, '+').replace(/_/g, '/')))); const d = JSON.parse(s); return { numQubits: d.n, ops: d.o.map(([gate, targets, controls, params]) => ({ gate, targets, controls, params })) }; };

    // ---------------------------------------------------------------
    // Backend client (optional Python server — see backend/server.py)
    // ---------------------------------------------------------------
    const BACKENDS = {
        qiskit_aer: { label: 'Qiskit Aer', sub: 'aer_simulator', framework: 'qiskit' },
        pennylane: { label: 'PennyLane', sub: 'default.qubit', framework: 'pennylane' },
        cirq: { label: 'Cirq', sub: 'cirq.Simulator', framework: 'cirq' },
        qbraid: { label: 'qBraid', sub: 'transpile → local sim', framework: 'qbraid' },
        browser: { label: 'Browser engine', sub: 'JS statevector', framework: 'qasm' }
    };
    QL.BACKENDS = BACKENDS;

    async function fetchJSON(url, opts = {}, timeout = 15000) {
        const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const t = setTimeout(() => ctl && ctl.abort(), timeout);
        try {
            const r = await fetch(url, Object.assign({ headers: { 'Content-Type': 'application/json' }, signal: ctl && ctl.signal }, opts));
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j.detail || j.error || `HTTP ${r.status}`);
            return j;
        } finally { clearTimeout(t); }
    }

    QL.api = {
        base: null,
        status: { connected: false, checked: false, backends: {}, llm: false, version: null },
        async detect(force) {
            if (this.status.checked && !force) return this.status;
            const candidates = [];
            if (QL.settings.backendUrl) candidates.push(QL.settings.backendUrl.replace(/\/$/, ''));
            if (root.location && /^https?:/.test(root.location.protocol)) candidates.push('');
            candidates.push('http://localhost:8000');
            for (const base of [...new Set(candidates)]) {
                try {
                    const h = await fetchJSON(`${base}/api/health`, {}, 1500);
                    if (h && h.service === 'quantum-lens') { this.base = base; this.status = { connected: true, checked: true, backends: h.backends || {}, llm: !!h.tutor_llm, version: h.version, base }; QL.emit('backend', this.status); return this.status; }
                } catch (e) { /* try next */ }
            }
            this.status = { connected: false, checked: true, backends: {}, llm: false };
            QL.emit('backend', this.status); return this.status;
        },
        available(backend) { return this.status.connected && this.status.backends[backend] && this.status.backends[backend].available; },
        async simulate(backend, circuit, shots) {
            return fetchJSON(`${this.base}/api/simulate`, { method: 'POST', body: JSON.stringify({ backend, shots, circuit: { num_qubits: circuit.numQubits, ops: circuit.ops.map(o => ({ gate: o.gate, targets: o.targets, controls: o.controls || [], params: o.params || [] })) } }) }, 60000);
        },
        async tutor(message, context) { return fetchJSON(`${this.base}/api/tutor`, { method: 'POST', body: JSON.stringify({ message, context }) }, 60000); },
        async syncProgress() {
            const p = progress; if (!p.profile.classCode) return;
            return fetchJSON(`${this.base}/api/progress`, { method: 'POST', body: JSON.stringify({ learner_id: p.learnerId, name: p.profile.name || 'Anonymous learner', class_code: p.profile.classCode, progress: p }) });
        },
        async getClass(code) { return fetchJSON(`${this.base}/api/class/${encodeURIComponent(code)}`); },
        async saveCircuit(e) { return fetchJSON(`${this.base}/api/circuits`, { method: 'POST', body: JSON.stringify({ owner: progress.learnerId, circuit: e }) }); },
        async deleteCircuit(id) { return fetchJSON(`${this.base}/api/circuits/${encodeURIComponent(id)}?owner=${encodeURIComponent(progress.learnerId)}`, { method: 'DELETE' }); }
    };

    /** Unified run: server backend when available, otherwise the in-browser engine. */
    QL.run = async (circuit, backend, shots) => {
        shots = shots || QL.settings.shots || 1024;
        const local = QL.simulate(circuit);
        const seed = QL.settings.seed;
        if (backend !== 'browser' && QL.api.available(backend)) {
            try {
                const r = await QL.api.simulate(backend, circuit, shots);
                return Object.assign({}, local, {
                    backend, executedOn: 'server', engineLabel: `${BACKENDS[backend].label} ${r.framework_version ? 'v' + r.framework_version : ''} (Python backend)`,
                    amplitudes: r.statevector || local.amplitudes, probabilities: r.probabilities || local.probabilities, counts: r.counts, shots,
                    serverTimeMs: r.time_ms, notes: r.notes || []
                });
            } catch (e) {
                const counts = QL.sampleCounts(local.marginal, shots, seed);
                return Object.assign({}, local, { backend, executedOn: 'browser', engineLabel: 'Browser engine (server error — fell back)', counts, shots, notes: [`The ${BACKENDS[backend].label} backend returned an error: ${e.message}. Results come from the in-browser engine.`] });
            }
        }
        const counts = QL.sampleCounts(local.marginal, shots, seed);
        const notes = [];
        if (backend !== 'browser') notes.push(`${BACKENDS[backend].label} is not connected, so this ran on the in-browser statevector engine, which computes the same ideal (noise-free) result. Start the Python backend (see Docs) to execute with real ${BACKENDS[backend].label}.`);
        return Object.assign({}, local, { backend, executedOn: 'browser', engineLabel: backend === 'browser' ? 'Browser statevector engine' : `Browser engine (emulating ${BACKENDS[backend].label})`, counts, shots, notes });
    };
})(typeof window !== 'undefined' ? window : globalThis);
