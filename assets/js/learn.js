/* =====================================================================
 * Quantum Lens — Learning Hub controller (learn.js)
 * Renders modules, lessons, interactive widgets, quizzes and the
 * personalised learning path from QL.MODULES; records progress.
 * ===================================================================== */
(function () {
    'use strict';
    const QL = window.QL; const $ = (s, el = document) => el.querySelector(s); const $$ = (s, el = document) => [...el.querySelectorAll(s)]; const esc = QL.esc;
    const STATUS = {
        completed: ['ql-badge-ok', 'fa-circle-check', 'Completed'], review: ['ql-badge-warn', 'fa-rotate', 'Review quiz'], 'in-progress': ['ql-badge-info', 'fa-spinner', 'In progress'],
        available: ['ql-badge-purple', 'fa-play', 'Ready'], optional: ['ql-badge-muted', 'fa-forward', 'Optional review'], upcoming: ['ql-badge-muted', 'fa-lock-open', 'Later']
    };
    let currentModule = QL.MODULES[0].id;

    // ------------------------------------------------------------------
    // Path & recommendations
    // ------------------------------------------------------------------
    function renderPath() {
        const p = QL.getProgress(); const s = QL.summary(); const path = QL.learningPath();
        $('#overall-pct').textContent = s.overall + '%'; $('#overall-bar').style.width = s.overall + '%';
        $('#overall-meta').textContent = `${s.modulesCompleted}/8 modules · ${s.challengesPassed} challenges · ${s.level}`;
        $('#path-grid').innerHTML = path.map((x, i) => {
            const [cls, icon, label] = STATUS[x.status];
            return `<a class="ql-path-item${x.recommended ? ' recommended' : ''}" href="#module-${x.id}"><div class="ql-row" style="justify-content:space-between"><span class="ql-step-no">STEP ${i + 1}</span>${x.recommended ? '<span class="ql-badge ql-badge-info"><i class="fas fa-star"></i> Next</span>' : ''}</div><h4><i class="fas ${x.def.icon}"></i> ${esc(x.def.title)}</h4><div class="ql-progress"><span style="width:${x.pct}%"></span></div><div class="ql-row" style="justify-content:space-between"><span class="ql-badge ${cls}"><i class="fas ${icon}"></i> ${label}</span><span class="ql-small ql-muted">${x.pct}%</span></div></a>`;
        }).join('');
        $('#recs').innerHTML = QL.recommendations().map(r => `<a class="ql-rec" href="${r.href}"><i class="fas ${r.icon}"></i><div><b>${esc(r.title)}</b><span>${esc(r.detail)}</span></div></a>`).join('');
        $('#side-nav').innerHTML = '<li><a href="#path">Learning path</a></li>' + path.map(x => `<li><a href="#module-${x.id}">${x.def.num}. ${esc(x.def.title.replace('Standard ', ''))} ${x.status === 'completed' ? '<i class="fas fa-check" style="color:var(--ql-ok)"></i>' : ''}</a></li>`).join('');
        const f = $('#profile-form'); f.name.value = p.profile.name || ''; f.level.value = p.profile.level; f.goal.value = p.profile.goal;
        QL.MODULES.forEach(m => { const mp = QL.moduleProgress(m.id); const el = $(`#mp-${m.id}`); if (el) { el.querySelector('span').style.width = mp.pct + '%'; $(`#mpt-${m.id}`).textContent = `${mp.pct}% · ${mp.completed ? 'completed' : mp.quizBest != null ? `best quiz ${mp.quizBest}%` : 'not started'}`; } });
    }
    function bindProfile() {
        const f = $('#profile-form');
        ['name', 'level', 'goal'].forEach(k => f[k].addEventListener('change', () => { QL.updateProfile({ [k]: f[k].value.trim ? f[k].value.trim() : f[k].value }); renderPath(); QL.toast('Learning path updated', 'ok'); }));
        f.addEventListener('submit', e => e.preventDefault());
    }

    // ------------------------------------------------------------------
    // Modules
    // ------------------------------------------------------------------
    function renderModules() {
        const p = QL.getProgress();
        $('#modules').innerHTML = QL.MODULES.map(m => {
            const viewed = (p.modules[m.id] || {}).lessonsViewed || [];
            const prereq = m.prereqs.length ? `Builds on: ${m.prereqs.map(r => { const d = QL.MODULES.find(x => x.id === r); return `<a href="#module-${r}">${esc(d.title)}</a>`; }).join(', ')}` : 'No prerequisites';
            const chs = m.challenges.map(id => QL.CHALLENGES.find(c => c.id === id));
            return `<section id="module-${m.id}" class="ql-module" data-module="${m.id}">
                <div class="ql-module-head"><div><h2><i class="fas ${m.icon}"></i> ${m.num}. ${esc(m.title)}</h2><div class="ql-module-meta"><span class="ql-badge ${m.level === 'Beginner' ? 'ql-badge-ok' : m.level === 'Intermediate' ? 'ql-badge-warn' : 'ql-badge-err'}">${m.level}</span><span><i class="far fa-clock"></i> ~${m.minutes} min</span><span>${prereq}</span></div></div>
                <div style="min-width:200px"><div class="ql-progress" id="mp-${m.id}"><span style="width:0"></span></div><div class="ql-small ql-muted" id="mpt-${m.id}" style="margin-top:4px"></div></div></div>
                <p>${esc(m.summary)}</p>
                ${m.lessons.map((l, i) => `<details class="ql-lesson" data-lesson="${i}"${i === 0 && !viewed.length ? '' : ''}><summary><span>Lesson ${i + 1}: ${esc(l.title)}</span>${viewed.includes(i) ? '<span class="ql-badge ql-badge-ok"><i class="fas fa-check"></i> Read</span>' : '<span class="ql-badge ql-badge-muted">Read</span>'}</summary><div class="ql-lesson-body">${l.html}</div></details>`).join('')}
                <h3 style="color:var(--accent-purple);margin:18px 0 6px"><i class="fas fa-flask"></i> Try it</h3>
                <div class="ql-widget" id="w-${m.id}"></div>
                <h3 style="color:var(--accent-purple);margin:18px 0 6px"><i class="fas fa-clipboard-question"></i> Module quiz</h3>
                <form class="ql-quiz" id="quiz-${m.id}" novalidate></form>
                ${chs.length ? `<h3 style="color:var(--accent-purple);margin:18px 0 6px"><i class="fas fa-trophy"></i> Practice challenges</h3><div class="ql-grid-3">${chs.map(c => { const r = p.challenges[c.id]; return `<a class="ql-card ql-ch-card" style="text-decoration:none;color:inherit" href="lab.html#challenge=${c.id}"><div class="ql-row"><span class="ql-badge ${c.type === 'code' ? 'ql-badge-info' : 'ql-badge-purple'}">${c.type === 'code' ? 'Coding' : 'Circuit'}</span>${r && r.passed ? `<span class="ql-badge ql-badge-ok"><i class="fas fa-check"></i> ${r.best}/100</span>` : `<span class="ql-badge ql-badge-muted">${c.points} pts</span>`}</div><h4>${esc(c.title)}</h4><p>${esc(c.goal)}</p></a>`; }).join('')}</div>` : ''}
            </section>`;
        }).join('');
        QL.MODULES.forEach(m => { renderWidget(m); renderQuiz(m); });
        $$('.ql-lesson').forEach(d => d.addEventListener('toggle', () => {
            if (!d.open) return; const mid = d.closest('[data-module]').dataset.module; currentModule = mid;
            QL.markLessonViewed(mid, +d.dataset.lesson);
            const b = d.querySelector('summary .ql-badge'); b.className = 'ql-badge ql-badge-ok'; b.innerHTML = '<i class="fas fa-check"></i> Read';
            renderPath();
        }));
        // track which module is on screen for tutor context
        const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) currentModule = e.target.dataset.module; }), { rootMargin: '-40% 0px -50% 0px' });
        $$('.ql-module').forEach(s => io.observe(s));
    }

    // ------------------------------------------------------------------
    // Interactive widgets
    // ------------------------------------------------------------------
    const widgetCircuits = {};
    function renderWidget(m) {
        const el = $(`#w-${m.id}`); const w = m.widget;
        if (w.type === 'bloch-playground') return blochPlayground(el, m.id);
        if (w.type === 'measure-demo') return measureDemo(el, m.id);
        const ex = QL.EXAMPLES[w.example]; widgetCircuits[m.id] = ex.circuit;
        const r = QL.simulate(ex.circuit);
        el.innerHTML = `<div class="ql-card"><div class="ql-row"><b style="color:var(--primary-purple)">${esc(ex.title)}</b><span class="ql-spacer"></span><a class="ql-btn ql-btn-small ql-btn-primary" href="lab.html#example=${w.example}"><i class="fas fa-flask"></i> Open in Lab</a></div><p class="ql-small" style="margin:6px 0 10px;color:#555">${esc(ex.desc)}</p><div class="ql-svg-box">${QL.circuitSVG(ex.circuit)}</div><div class="ql-note ql-note-info" style="margin-top:10px"><b>Result:</b> ${esc(QL.describeState(r.amplitudes, r.numQubits))}</div><div class="ql-chart-box"></div></div>`;
        QL.barChart(el.querySelector('.ql-chart-box'), [{ name: 'Probability', color: QL.COLORS.exact, values: r.marginal }], { height: 190, title: `${ex.title} outcome probabilities` });
    }
    function blochPlayground(el, mid) {
        el.innerHTML = `<div class="ql-card"><div class="ql-playground"><canvas></canvas><div><p class="ql-small" style="color:#555;margin-bottom:8px">Apply gates to a single qubit that starts in |0⟩. Drag the sphere to rotate it.</p><div class="ql-play-btns">${['h', 'x', 'y', 'z', 's', 't', 'sdg'].map(g => `<button type="button" class="ql-gate-tile" style="background:${QL.GATES[g].color}" data-g="${g}" title="${esc(QL.GATES[g].title)}">${esc(QL.GATES[g].label)}</button>`).join('')}${['rx', 'ry', 'rz'].map(g => `<button type="button" class="ql-gate-tile" style="background:${QL.GATES[g].color}" data-g="${g}" title="${esc(QL.GATES[g].title)} by π/4">${g.toUpperCase()}(π/4)</button>`).join('')}<button type="button" class="ql-btn ql-btn-small" data-reset>Reset</button></div><div class="ql-play-state"></div><div class="ql-small ql-muted ql-play-hist" style="margin-top:6px"></div></div></div></div>`;
        const sphere = new QL.BlochSphere(el.querySelector('canvas'), { size: 240 }); const ops = [];
        const update = (trail) => {
            const c = { numQubits: 1, ops }; widgetCircuits[mid] = c; const r = QL.simulate(c); sphere.set(r.bloch[0], { trail });
            const [a, b] = r.amplitudes; el.querySelector('.ql-play-state').innerHTML = `|ψ⟩ = (${QL.fmtComplex(a[0], a[1])})|0⟩ + (${QL.fmtComplex(b[0], b[1])})|1⟩<br>P(0) = ${(r.probabilities[0] * 100).toFixed(1)}% · P(1) = ${(r.probabilities[1] * 100).toFixed(1)}% · ${esc(QL.describeState(r.amplitudes, 1))}`;
            el.querySelector('.ql-play-hist').textContent = ops.length ? 'Gates applied: ' + ops.map(o => QL.GATES[o.gate].label + (o.params.length ? '(π/4)' : '')).join(' → ') : 'No gates yet.';
        };
        $$('[data-g]', el).forEach(b => b.onclick = () => { const g = b.dataset.g; ops.push({ gate: g, targets: [0], controls: [], params: QL.GATES[g].params.length ? [Math.PI / 4] : [] }); update(true); });
        el.querySelector('[data-reset]').onclick = () => { ops.length = 0; update(false); };
        update(false);
    }
    function measureDemo(el, mid) {
        el.innerHTML = `<div class="ql-card"><div class="ql-playground"><canvas></canvas><div><label class="ql-small" style="font-weight:700;color:var(--ql-muted)">Prepare RY(θ)|0⟩ — θ = <span class="th">60</span>°<input type="range" min="0" max="180" value="60" style="width:100%;accent-color:var(--accent-purple)"></label><div class="ql-row" style="margin:8px 0"><label class="ql-small">Shots <select class="ql-select sh"><option>10</option><option selected>100</option><option>1000</option><option>10000</option></select></label><button type="button" class="ql-btn ql-btn-primary ql-btn-small go"><i class="fas fa-dice"></i> Measure</button></div><div class="ql-play-state"></div><div class="ch"></div></div></div></div>`;
        const sphere = new QL.BlochSphere(el.querySelector('canvas'), { size: 220 }); const range = el.querySelector('input'); let counts = null;
        const circ = () => ({ numQubits: 1, ops: [{ gate: 'ry', targets: [0], controls: [], params: [range.value * Math.PI / 180] }, { gate: 'measure', targets: [0], controls: [], params: [] }] });
        const draw = () => {
            const c = circ(); widgetCircuits[mid] = c; const r = QL.simulate(c); sphere.set(r.bloch[0]);
            el.querySelector('.th').textContent = range.value;
            el.querySelector('.ql-play-state').innerHTML = `Born rule: P(1) = sin²(θ/2) = <b>${(r.marginal['1'] || 0).toFixed(3)}</b>`;
            const series = [{ name: 'Exact probability', color: QL.COLORS.exact, values: { '0': r.marginal['0'] || 0, '1': r.marginal['1'] || 0 } }];
            if (counts) { const tot = counts.tot; series.push({ name: `Measured (${tot} shots)`, color: QL.COLORS.measured, values: { '0': (counts['0'] || 0) / tot, '1': (counts['1'] || 0) / tot }, format: v => `${(v * 100).toFixed(1)}% (${Math.round(v * tot)})` }); }
            QL.barChart(el.querySelector('.ch'), series, { labels: ['0', '1'], height: 180, labelPrefix: '|', labelSuffix: '⟩', title: 'Measurement results' });
        };
        range.oninput = () => { counts = null; draw(); };
        el.querySelector('.go').onclick = () => { const shots = +el.querySelector('.sh').value; const r = QL.simulate(circ()); counts = QL.sampleCounts(r.marginal, shots); counts.tot = shots; draw(); QL.logActivity('experiment', mid, { shots }); };
        draw();
    }

    // ------------------------------------------------------------------
    // Quizzes
    // ------------------------------------------------------------------
    function renderQuiz(m, result) {
        const f = $(`#quiz-${m.id}`); const mp = QL.moduleProgress(m.id);
        f.innerHTML = m.quiz.map((q, i) => {
            const item = result && result.items[i];
            return `<fieldset class="ql-q"><legend>Q${i + 1}. ${esc(q.q)}</legend>${q.options.map((o, j) => {
                let cls = ''; if (item) { if (j === q.answer) cls = 'correct'; else if (j === item.chosen) cls = 'wrong'; }
                return `<label class="${cls}"><input type="radio" name="q${i}" value="${j}" ${item && item.chosen === j ? 'checked' : ''} ${item ? 'disabled' : ''}> <span>${esc(o)}</span></label>`;
            }).join('')}${item ? `<div class="ql-explain">${item.correct ? '<b style="color:var(--ql-ok)">Correct.</b>' : '<b style="color:var(--ql-err)">Not quite.</b>'} ${esc(q.explain)}</div>` : ''}</fieldset>`;
        }).join('') + (result ? `<div class="ql-note ${result.passed ? 'ql-note-ok' : 'ql-note-warn'}"><b>Score: ${result.score}%</b> (${result.right}/${result.total}) · best ${result.best}% · attempt ${result.attempts}. ${esc(result.feedback)}</div><div class="ql-row"><button type="button" class="ql-btn ql-btn-primary retake">Retake quiz</button>${result.passed ? '' : `<button type="button" class="ql-btn ask">Ask the tutor to explain ${esc(m.title.toLowerCase())}</button>`}</div>` : `<div class="ql-row"><button type="submit" class="ql-btn ql-btn-primary">Submit answers</button>${mp.quizBest != null ? `<span class="ql-small ql-muted">Best so far: ${mp.quizBest}% · pass mark ${QL.PASS_MARK}%</span>` : `<span class="ql-small ql-muted">Pass mark ${QL.PASS_MARK}%</span>`}</div>`);
        f.onsubmit = (e) => {
            e.preventDefault(); const answers = m.quiz.map((_, i) => { const c = f.querySelector(`input[name=q${i}]:checked`); return c ? +c.value : -1; });
            if (answers.includes(-1)) { QL.toast(`Please answer all ${m.quiz.length} questions.`, 'warn'); return; }
            const r = QL.submitQuiz(m.id, answers); renderQuiz(m, r); renderPath();
            QL.toast(r.passed ? `Quiz passed — ${r.score}%!` : `Score ${r.score}% — review and retry`, r.passed ? 'ok' : 'warn');
        };
        const rt = f.querySelector('.retake'); if (rt) rt.onclick = () => renderQuiz(m);
        const ask = f.querySelector('.ask'); if (ask) ask.onclick = () => { tutorUI.ask(`Explain ${m.topic} simply`); $('#tutor-section').scrollIntoView({ behavior: 'smooth' }); };
    }

    let tutorUI;
    function init() {
        bindProfile(); renderModules(); renderPath();
        tutorUI = QL.mountTutor($('#tutor'), {
            chips: ['Explain superposition simply', 'What is the Bloch sphere?', 'Explain my circuit', 'Write a Bell state in PennyLane', 'What should I learn next?'],
            getContext: () => ({ page: 'learn', module: currentModule, circuit: widgetCircuits[currentModule] || null, framework: 'qiskit' }),
            onAction: (a) => {
                if (a.type === 'loadCircuit') location.href = 'lab.html#circuit=' + QL.encodeCircuit(a.circuit);
                else if (a.type === 'loadCode') { location.href = 'lab.html#circuit=' + QL.encodeCircuit(QL.parse(a.code).circuit); }
            }
        });
        $('#tutor').style.height = '560px';
        QL.on('progress', () => { /* keep path fresh if another tab changes it */ });
        window.addEventListener('storage', (e) => { if (e.key === QL.KEYS.progress) location.reload(); });
        if (location.hash) setTimeout(() => { const t = document.getElementById(location.hash.slice(1)); if (t) t.scrollIntoView(); }, 50);
        QL.api.detect();
    }
    init();
})();
