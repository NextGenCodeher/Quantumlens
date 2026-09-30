/* =====================================================================
 * Quantum Lens — Dashboard controller (dashboard.js)
 * Learner view: stats, module progress, assessments, activity, class.
 * Instructor view: cohort analytics from the backend (class code),
 * imported learner files, or a clearly-labelled sample cohort.
 * ===================================================================== */
(function () {
    'use strict';
    const QL = window.QL; const $ = (s, el = document) => el.querySelector(s); const $$ = (s, el = document) => [...el.querySelectorAll(s)]; const esc = QL.esc;
    const ago = (t) => { const s = (Date.now() - t) / 1000; if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago'; if (s < 86400) return Math.floor(s / 3600) + ' h ago'; return Math.floor(s / 86400) + ' d ago'; };
    const pctFmt = (v) => Math.round(v) + '%';
    const shortTitle = (m) => `${m.num}. ${m.title.replace('Quantum Computing ', '').replace('Standard Quantum ', '').replace(' & the Bloch Sphere', '').replace(' & Interference', '')}`;
    function download(name, text, type = 'application/json') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }

    // ------------------------------------------------------------------
    // Learner view
    // ------------------------------------------------------------------
    const ICON = { lesson: 'fa-book-open', quiz: 'fa-clipboard-question', challenge: 'fa-trophy', 'challenge-start': 'fa-flag', run: 'fa-play', tutor: 'fa-robot', save: 'fa-floppy-disk', 'module-complete': 'fa-graduation-cap', compare: 'fa-code-compare', experiment: 'fa-dice' };
    function describe(a) {
        const mod = QL.MODULES.find(m => m.id === a.id); const ch = QL.CHALLENGES.find(c => c.id === a.id);
        switch (a.type) {
            case 'lesson': return `Read lesson ${a.lesson + 1} of <b>${esc(mod ? mod.title : a.id)}</b>`;
            case 'quiz': return `Quiz <b>${esc(mod ? mod.title : a.id)}</b> — ${a.score}%`;
            case 'module-complete': return `Completed module <b>${esc(mod ? mod.title : a.id)}</b> 🎓`;
            case 'challenge': return `${a.passed ? 'Solved' : 'Attempted'} challenge <b>${esc(ch ? ch.title : a.id)}</b>${a.passed ? ` — ${a.score}/100` : ''}`;
            case 'challenge-start': return `Started challenge <b>${esc(ch ? ch.title : a.id)}</b>`;
            case 'run': return `Ran a circuit on <b>${esc(a.id)}</b>${a.executedOn === 'server' ? ' (Python backend)' : ''}`;
            case 'compare': return 'Compared all simulation backends';
            case 'tutor': return `Asked the AI tutor (${esc(a.id)})`;
            case 'save': return `Saved circuit <b>${esc(a.id)}</b>`;
            case 'experiment': return `Ran a ${a.shots}-shot measurement experiment`;
            default: return esc(a.type + ' ' + (a.id || ''));
        }
    }
    function renderMe() {
        const p = QL.getProgress(); const s = QL.summary();
        $('#me-title').textContent = p.profile.name ? `${p.profile.name}'s progress` : 'My progress';
        $('#me-stats').innerHTML = [
            ['Overall progress', s.overall + '%', `${s.modulesCompleted}/8 modules completed`],
            ['Average quiz', s.avgQuiz != null ? s.avgQuiz + '%' : '—', `pass mark ${QL.PASS_MARK}%`],
            ['Challenges', `${s.challengesPassed}/${s.challengesTotal}`, 'solved'],
            ['Points', s.points, s.level],
            ['Circuits run', p.counters.runs, `${p.counters.circuitsSaved} saved`],
            ['Day streak', s.streak, `${p.counters.tutorQuestions} tutor questions`]
        ].map(([k, v, sub]) => `<div class="ql-stat"><span>${k}</span><b>${esc(v)}</b><small>${esc(sub)}</small></div>`).join('');
        QL.barChart($('#me-modules'), [{ name: 'Progress', color: QL.COLORS.exact, values: Object.fromEntries(s.modules.map(m => [String(QL.MODULES.find(x => x.id === m.id).num), m.pct / 100])) }], { labels: QL.MODULES.map(m => String(m.num)), height: 220, max: 1, labelPrefix: 'M', title: 'Progress per module', format: v => pctFmt(v * 100) });
        $('#me-modules').insertAdjacentHTML('beforeend', `<p class="ql-small ql-muted">${QL.MODULES.map(m => `M${m.num} ${esc(m.title)}`).join(' · ')}</p>`);
        $('#me-recs').innerHTML = QL.recommendations().map(r => `<a class="ql-rec" href="${r.href}"><i class="fas ${r.icon}"></i><div><b>${esc(r.title)}</b><span>${esc(r.detail)}</span></div></a>`).join('');
        const quizRows = QL.MODULES.map(m => { const mp = QL.moduleProgress(m.id); const q = (p.modules[m.id] || {}).quiz; return `<tr><td>${esc(shortTitle(m))}</td><td>${q ? `<b>${q.best}%</b>` : '—'}</td><td>${q ? q.last + '%' : '—'}</td><td>${q ? q.attempts : 0}</td><td>${mp.completed ? '<span class="ql-badge ql-badge-ok">Completed</span>' : q && q.best < QL.PASS_MARK ? '<span class="ql-badge ql-badge-warn">Review</span>' : mp.started ? '<span class="ql-badge ql-badge-info">In progress</span>' : '<span class="ql-badge ql-badge-muted">Not started</span>'}</td></tr>`; }).join('');
        const chRows = QL.CHALLENGES.filter(c => p.challenges[c.id]).map(c => { const r = p.challenges[c.id]; return `<tr><td><a href="lab.html#challenge=${c.id}">${esc(c.title)}</a></td><td>${c.type === 'code' ? 'Coding' : 'Circuit'}</td><td>${r.passed ? `<b>${r.best}</b>/100` : '—'}</td><td>${r.attempts}</td><td>${r.passed ? '<span class="ql-badge ql-badge-ok">Solved</span>' : '<span class="ql-badge ql-badge-warn">Open</span>'}</td></tr>`; }).join('');
        $('#me-assess').innerHTML = `<div class="ql-table-wrap"><table class="ql-table"><thead><tr><th>Module quiz</th><th>Best</th><th>Last</th><th>Attempts</th><th>Status</th></tr></thead><tbody>${quizRows}</tbody></table></div><h3 style="margin-top:16px">Challenges</h3>${chRows ? `<div class="ql-table-wrap"><table class="ql-table"><thead><tr><th>Challenge</th><th>Type</th><th>Score</th><th>Attempts</th><th>Status</th></tr></thead><tbody>${chRows}</tbody></table></div>` : '<p class="ql-muted ql-small">No challenges attempted yet — <a href="lab.html#tab=challenges">try one in the Lab</a>.</p>'}`;
        $('#me-activity').innerHTML = p.activity.slice(0, 40).map(a => `<li><i class="fas ${ICON[a.type] || 'fa-circle'}"></i><span>${describe(a)}</span><time datetime="${new Date(a.t).toISOString()}">${ago(a.t)}</time></li>`).join('') || '<li class="ql-muted">No activity yet — start with the <a href="learn.html">Learning Hub</a>.</li>';
        const f = $('#join-form'); f.name.value = p.profile.name || ''; f.code.value = p.profile.classCode || '';
    }
    function bindMe() {
        $('#me-export').onclick = () => { const p = QL.getProgress(); download(`quantum_lens_progress_${(p.profile.name || 'learner').replace(/\W+/g, '_')}.json`, JSON.stringify(p, null, 2)); };
        $('#me-import').addEventListener('change', async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { QL.importProgress(JSON.parse(await f.text())); renderMe(); QL.toast('Progress imported', 'ok'); } catch (err) { QL.toast(esc(err.message), 'err'); } });
        $('#me-reset').onclick = () => { if (confirm('Reset all your learning progress? Saved circuits are kept.')) { QL.resetProgress(); renderMe(); QL.toast('Progress reset'); } };
        $('#join-form').addEventListener('submit', async e => {
            e.preventDefault(); const f = e.target; QL.updateProfile({ name: f.name.value.trim(), classCode: f.code.value.trim().toUpperCase() });
            const st = await QL.api.detect();
            if (st.connected && QL.getProgress().profile.classCode) { try { await QL.api.syncProgress(); $('#join-status').textContent = `Synced to class ${QL.getProgress().profile.classCode} ✓`; } catch (err) { $('#join-status').textContent = 'Sync failed: ' + err.message; } }
            else $('#join-status').textContent = 'Saved. Backend offline — use Export progress to share your file.';
            renderMe();
        });
    }

    // ------------------------------------------------------------------
    // Instructor view
    // ------------------------------------------------------------------
    let cohort = []; let cohortSource = ''; let sortKey = 'progress'; let sortDir = -1;

    function sampleCohort() {
        // Deterministic synthetic learners — clearly labelled as sample data in the UI.
        let seed = 42; const r = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
        const names = ['Aarav S.', 'Bianca R.', 'Chen W.', 'Divya P.', 'Elias K.', 'Fatima Z.', 'Gabriel M.', 'Hana T.', 'Ishaan V.', 'Julia N.', 'Kofi A.', 'Lena B.', 'Mateo G.', 'Nisha D.'];
        const now = Date.now();
        return names.map((name, i) => {
            const skill = 0.5 + 0.48 * r(); const reach = Math.min(8, Math.max(1, Math.round(1 + r() * 8 * skill + 1)));
            const p = { version: 1, learnerId: 'sample-' + i, profile: { name, level: ['beginner', 'intermediate', 'advanced'][Math.floor(r() * 3)], goal: 'foundations', classCode: 'SAMPLE' }, modules: {}, challenges: {}, topicStats: {}, activity: [], counters: { runs: Math.round(r() * 80), tutorQuestions: Math.round(r() * 30), circuitsSaved: Math.round(r() * 6) } };
            QL.MODULES.forEach((m, k) => {
                if (k >= reach) return;
                const difficulty = [0, .05, .1, .25, .2, .1, .2, .35][k];
                const lessons = k < reach - 1 ? m.lessons.length : Math.max(1, Math.round(r() * m.lessons.length));
                const best = Math.min(100, Math.max(20, Math.round((skill - difficulty * 0.6 + r() * 0.25) * 100 / 20) * 20));
                const attempts = best >= 70 ? 1 + Math.floor(r() * 2) : 1 + Math.floor(r() * 3);
                const quiz = k < reach - 1 || r() > .4 ? { best, last: best, attempts, history: [] } : null;
                p.modules[m.id] = { lessonsViewed: [...Array(lessons).keys()], quiz, completedAt: quiz && quiz.best >= 70 && lessons === m.lessons.length ? now - (reach - k) * 86400000 * 2 : null };
                const right = quiz ? Math.round(best / 20) : 0; p.topicStats[m.topic] = { right, wrong: quiz ? 5 - right : 0 };
                m.challenges.forEach(cid => { if (r() < skill - difficulty) { const pass = r() < skill; p.challenges[cid] = { attempts: 1 + Math.floor(r() * 3), best: pass ? 60 + Math.round(r() * 40) : 0, passed: pass, hintsUsed: Math.floor(r() * 2) }; if (!pass) p.topicStats[m.topic].wrong++; } });
            });
            const last = now - Math.floor(r() * r() * r() * 16) * 86400000 - Math.floor(r() * 36e5 * 8);
            p.activity = [{ t: last, type: 'quiz', id: QL.MODULES[Math.min(reach, 8) - 1].id, score: 80 }];
            p.updated = last;
            return { learner_id: p.learnerId, name, progress: p };
        });
    }
    function learnerRow(l) {
        const p = l.progress; const s = QL.summary(p);
        const last = p.activity && p.activity.length ? p.activity[0].t : (p.updated || 0);
        const inactiveDays = (Date.now() - last) / 86400000;
        const needs = QL.MODULES.filter(m => { const q = (p.modules[m.id] || {}).quiz; return q && q.best < QL.PASS_MARK; });
        let status = 'On track', cls = 'ql-badge-ok';
        if (inactiveDays > 10) { status = 'Inactive'; cls = 'ql-badge-muted'; }
        else if (needs.length >= 2 || (s.avgQuiz != null && s.avgQuiz < 60)) { status = 'Needs attention'; cls = 'ql-badge-err'; }
        else if (needs.length === 1) { status = 'Review 1 quiz'; cls = 'ql-badge-warn'; }
        return { l, name: l.name || p.profile.name || 'Learner', s, last, status, cls, needs, progress: s.overall, avgQuiz: s.avgQuiz == null ? -1 : s.avgQuiz, challenges: s.challengesPassed, modules: s.modulesCompleted };
    }
    function renderInst() {
        const body = $('#inst-body'); $('#inst-csv').disabled = $('#inst-clear').disabled = !cohort.length;
        if (!cohort.length) { body.innerHTML = '<div class="ql-empty"><i class="fas fa-chalkboard-user"></i>No learner data loaded yet.</div>'; $('#inst-source').textContent = 'Load a class from the backend by code, import progress files exported by learners, or explore with a clearly-labelled sample cohort.'; return; }
        $('#inst-source').innerHTML = cohortSource;
        const rows = cohort.map(learnerRow);
        const n = rows.length;
        const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
        const quizAll = rows.flatMap(r => QL.MODULES.map(m => (r.l.progress.modules[m.id] || {}).quiz).filter(Boolean).map(q => q.best));
        const chAttempts = rows.flatMap(r => Object.values(r.l.progress.challenges || {}));
        const passRate = chAttempts.length ? 100 * chAttempts.filter(c => c.passed).length / chAttempts.length : null;
        const atRisk = rows.filter(r => r.status === 'Needs attention' || r.status === 'Inactive').length;
        // Per-module analytics
        const perModule = QL.MODULES.map(m => {
            const qs = rows.map(r => (r.l.progress.modules[m.id] || {}).quiz).filter(Boolean);
            const done = rows.filter(r => QL.moduleProgress(m.id, r.l.progress).completed).length;
            return { m, avgQuiz: avg(qs.map(q => q.best)), attempted: qs.length, passRate: qs.length ? 100 * qs.filter(q => q.best >= QL.PASS_MARK).length / qs.length : null, completion: 100 * done / n, avgAttempts: avg(qs.map(q => q.attempts)) };
        });
        const topics = QL.MODULES.map(m => { let right = 0, wrong = 0; rows.forEach(r => { const t = (r.l.progress.topicStats || {})[m.topic]; if (t) { right += t.right; wrong += t.wrong; } }); return { m, right, wrong, acc: right + wrong ? 100 * right / (right + wrong) : null }; }).filter(t => t.acc != null).sort((a, b) => a.acc - b.acc);
        const chStats = QL.CHALLENGES.map(c => { const a = rows.map(r => (r.l.progress.challenges || {})[c.id]).filter(Boolean); return { c, tried: a.length, solved: a.filter(x => x.passed).length, avgScore: avg(a.filter(x => x.passed).map(x => x.best)), attempts: a.reduce((s, x) => s + x.attempts, 0) }; }).filter(x => x.tried);
        rows.sort((a, b) => (sortKey === 'name' ? a.name.localeCompare(b.name) : (a[sortKey] - b[sortKey])) * sortDir);
        const th = (k, label) => `<th><button class="ql-btn ql-btn-small" style="border:none;background:none;padding:0;color:inherit;font:inherit;text-transform:inherit;letter-spacing:inherit" data-sort="${k}" aria-label="Sort by ${label}">${label} ${sortKey === k ? (sortDir < 0 ? '▾' : '▴') : ''}</button></th>`;
        body.innerHTML = `
            <div class="ql-stats">
                <div class="ql-stat"><span>Learners</span><b>${n}</b><small>${rows.filter(r => (Date.now() - r.last) < 7 * 864e5).length} active this week</small></div>
                <div class="ql-stat"><span>Avg completion</span><b>${Math.round(avg(rows.map(r => r.progress)))}%</b><small>across 8 modules</small></div>
                <div class="ql-stat"><span>Avg quiz score</span><b>${quizAll.length ? Math.round(avg(quizAll)) + '%' : '—'}</b><small>${quizAll.length} quiz results</small></div>
                <div class="ql-stat"><span>Challenge pass rate</span><b>${passRate != null ? Math.round(passRate) + '%' : '—'}</b><small>${chAttempts.length} challenge records</small></div>
                <div class="ql-stat"><span>Need attention</span><b>${atRisk}</b><small>low scores or inactive</small></div>
            </div>
            <div class="ql-grid-2">
                <div class="ql-card"><h3>Module completion (% of learners)</h3><div id="ch-completion"></div></div>
                <div class="ql-card"><h3>Average best quiz score per module</h3><div id="ch-quiz"></div></div>
            </div>
            <p class="ql-small ql-muted" style="margin:6px 0 16px">${QL.MODULES.map(m => `M${m.num} ${esc(m.title)}`).join(' · ')}</p>
            <div class="ql-grid-2">
                <div class="ql-card"><h3><i class="fas fa-triangle-exclamation" style="color:#f5a524"></i> Hardest topics</h3><p class="ql-small ql-muted" style="margin-bottom:8px">Accuracy on quiz questions and challenges, lowest first — good candidates for a review session.</p><div class="ql-table-wrap"><table class="ql-table"><thead><tr><th>Topic</th><th>Accuracy</th><th>Answers</th></tr></thead><tbody>${topics.slice(0, 8).map(t => `<tr><td>${esc(t.m.title)}</td><td><div class="ql-pbar"><span style="width:${t.acc.toFixed(0)}%;background:${t.acc < 60 ? 'var(--ql-err)' : t.acc < 75 ? '#f5a524' : 'var(--ql-ok)'}"></span></div>${t.acc.toFixed(0)}%</td><td>${t.right + t.wrong}</td></tr>`).join('')}</tbody></table></div></div>
                <div class="ql-card"><h3><i class="fas fa-trophy" style="color:#f5a524"></i> Challenge performance</h3><div class="ql-table-wrap"><table class="ql-table"><thead><tr><th>Challenge</th><th>Solved</th><th>Avg score</th><th>Attempts</th></tr></thead><tbody>${chStats.sort((a, b) => a.solved / a.tried - b.solved / b.tried).map(x => `<tr><td>${esc(x.c.title)} <span class="ql-muted ql-small">${x.c.difficulty}</span></td><td>${x.solved}/${x.tried}</td><td>${x.avgScore != null ? Math.round(x.avgScore) : '—'}</td><td>${x.attempts}</td></tr>`).join('') || '<tr><td colspan="4" class="ql-muted">No challenge data.</td></tr>'}</tbody></table></div></div>
            </div>
            <div class="ql-card" style="margin-top:18px"><h3><i class="fas fa-users"></i> Learners</h3><div class="ql-table-wrap"><table class="ql-table"><thead><tr>${th('name', 'Learner')}${th('progress', 'Progress')}${th('modules', 'Modules')}${th('avgQuiz', 'Avg quiz')}${th('challenges', 'Challenges')}${th('last', 'Last active')}<th>Status</th></tr></thead><tbody>${rows.map((r, i) => `<tr style="cursor:pointer" data-row="${i}" tabindex="0"><td><b>${esc(r.name)}</b><div class="ql-small ql-muted">${esc(r.l.progress.profile.level || '')}</div></td><td><div class="ql-pbar"><span style="width:${r.progress}%"></span></div>${r.progress}%</td><td>${r.modules}/8</td><td>${r.avgQuiz >= 0 ? r.avgQuiz + '%' : '—'}</td><td>${r.challenges}</td><td>${r.last ? ago(r.last) : '—'}</td><td><span class="ql-badge ${r.cls}">${r.status}</span></td></tr>`).join('')}</tbody></table></div></div>
            <div id="learner-detail"></div>`;
        const mLabels = QL.MODULES.map(m => String(m.num));
        QL.barChart($('#ch-completion'), [{ name: 'Completed', color: QL.COLORS.exact, values: Object.fromEntries(perModule.map(x => [String(x.m.num), x.completion / 100])) }], { labels: mLabels, max: 1, height: 220, labelPrefix: 'M', format: v => pctFmt(v * 100), title: 'Module completion' });
        QL.barChart($('#ch-quiz'), [{ name: 'Avg best score', color: QL.COLORS.measured, values: Object.fromEntries(perModule.filter(x => x.avgQuiz != null).map(x => [String(x.m.num), x.avgQuiz / 100])) }], { labels: mLabels, max: 1, height: 220, labelPrefix: 'M', format: v => pctFmt(v * 100), title: 'Average quiz score' });
        $$('[data-sort]').forEach(b => b.onclick = () => { const k = b.dataset.sort; if (sortKey === k) sortDir *= -1; else { sortKey = k; sortDir = k === 'name' ? 1 : -1; } renderInst(); });
        $$('[data-row]').forEach(tr => { const open = () => showLearner(rows[+tr.dataset.row]); tr.onclick = open; tr.onkeydown = e => { if (e.key === 'Enter') open(); }; });
        S.rows = rows;
    }
    const S = {};
    function showLearner(r) {
        const p = r.l.progress; const recs = QL.recommendations(p);
        $('#learner-detail').innerHTML = `<div class="ql-card" style="margin-top:18px"><div class="ql-row"><h3 style="margin:0">${esc(r.name)}</h3><span class="ql-badge ${r.cls}">${r.status}</span><span class="ql-spacer"></span><button class="ql-btn ql-btn-small" id="ld-close" aria-label="Close learner detail"><i class="fas fa-xmark"></i></button></div>
            <div class="ql-grid-2" style="margin-top:12px"><div><div class="ql-table-wrap"><table class="ql-table"><thead><tr><th>Module</th><th>Progress</th><th>Best quiz</th><th>Attempts</th></tr></thead><tbody>${QL.MODULES.map(m => { const mp = QL.moduleProgress(m.id, p); return `<tr><td>${esc(shortTitle(m))}</td><td><div class="ql-pbar"><span style="width:${mp.pct}%"></span></div>${mp.pct}%</td><td>${mp.quizBest != null ? `<span style="color:${mp.quizBest < QL.PASS_MARK ? 'var(--ql-err)' : 'inherit'}">${mp.quizBest}%</span>` : '—'}</td><td>${mp.attempts}</td></tr>`; }).join('')}</tbody></table></div></div>
            <div><h3>Suggested next steps for this learner</h3><div class="ql-recs">${recs.map(x => `<div class="ql-rec"><i class="fas ${x.icon}"></i><div><b>${esc(x.title)}</b><span>${esc(x.detail)}</span></div></div>`).join('')}</div><p class="ql-small ql-muted" style="margin-top:10px">Runs: ${p.counters ? p.counters.runs : 0} · tutor questions: ${p.counters ? p.counters.tutorQuestions : 0} · saved circuits: ${p.counters ? p.counters.circuitsSaved : 0}</p></div></div></div>`;
        $('#ld-close').onclick = () => $('#learner-detail').innerHTML = '';
        $('#learner-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    function bindInst() {
        const valid = (p) => p && p.version === 1 && p.modules;
        $('#inst-demo').onclick = () => { cohort = sampleCohort(); cohortSource = '<span class="ql-badge ql-badge-warn">SAMPLE DATA</span> A synthetic cohort of 14 learners for exploring the dashboard — not real students.'; renderInst(); };
        $('#inst-me').onclick = () => { const p = QL.getProgress(); cohort = cohort.filter(c => c.learner_id !== p.learnerId).concat([{ learner_id: p.learnerId, name: p.profile.name || 'Me', progress: JSON.parse(JSON.stringify(p)) }]); cohortSource = cohortSource || 'Your own progress'; renderInst(); };
        $('#inst-import').addEventListener('change', async e => {
            const files = [...e.target.files]; e.target.value = ''; let added = 0, bad = 0;
            for (const f of files) { try { const d = JSON.parse(await f.text()); const items = Array.isArray(d) ? d : [d]; items.forEach(it => { const p = it.progress || it; if (!valid(p)) { bad++; return; } cohort = cohort.filter(c => c.learner_id !== p.learnerId).concat([{ learner_id: p.learnerId, name: it.name || p.profile.name || f.name.replace(/\.json$/, ''), progress: p }]); added++; }); } catch (err) { bad++; } }
            if (/SAMPLE/.test(cohortSource)) cohort = cohort.filter(c => !String(c.learner_id).startsWith('sample-'));
            cohortSource = `Imported learner files (${cohort.length} learner${cohort.length === 1 ? '' : 's'}).`;
            QL.toast(`Imported ${added} learner file(s)${bad ? `, ${bad} skipped` : ''}`, bad ? 'warn' : 'ok'); renderInst();
        });
        $('#class-form').addEventListener('submit', async e => {
            e.preventDefault(); const code = $('#class-code').value.trim().toUpperCase(); if (!code) return;
            const st = await QL.api.detect();
            if (!st.connected) { QL.toast('The Quantum Lens backend is not running — import learner files or start the server (see Docs).', 'warn'); return; }
            try { const d = await QL.api.getClass(code); cohort = d.learners.map(l => ({ learner_id: l.learner_id, name: l.name, progress: l.progress })); cohortSource = `Class <b>${esc(code)}</b> from the Quantum Lens backend · ${cohort.length} learner(s) · refreshed ${new Date().toLocaleTimeString()}`; renderInst(); if (!cohort.length) QL.toast(`No learners have joined ${esc(code)} yet.`, 'warn'); }
            catch (err) { QL.toast('Could not load class: ' + esc(err.message), 'err'); }
        });
        $('#inst-clear').onclick = () => { cohort = []; cohortSource = ''; renderInst(); };
        $('#inst-csv').onclick = () => {
            const rows = cohort.map(learnerRow); const head = ['name', 'progress_pct', 'modules_completed', 'avg_quiz', 'challenges_solved', 'status', 'last_active', ...QL.MODULES.map(m => `quiz_${m.id}`)];
            const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
            const csv = [head.join(',')].concat(rows.map(r => [q(r.name), r.progress, r.modules, r.avgQuiz >= 0 ? r.avgQuiz : '', r.challenges, q(r.status), r.last ? new Date(r.last).toISOString() : '', ...QL.MODULES.map(m => { const x = (r.l.progress.modules[m.id] || {}).quiz; return x ? x.best : ''; })].join(','))).join('\n');
            download('quantum_lens_class_report.csv', csv, 'text/csv');
        };
    }

    function switchTab(t) { ['me', 'inst'].forEach(k => { $('#tab-' + k).setAttribute('aria-selected', k === t); $('#panel-' + k).hidden = k !== t; }); if (t === 'inst') renderInst(); else renderMe(); history.replaceState(null, '', t === 'inst' ? '#instructor' : '#me'); }

    function init() {
        bindMe(); bindInst(); renderMe();
        $('#tab-me').onclick = () => switchTab('me'); $('#tab-inst').onclick = () => switchTab('inst');
        if (location.hash === '#instructor') switchTab('inst');
        QL.api.detect();
        window.addEventListener('storage', e => { if (e.key === QL.KEYS.progress) location.reload(); });
    }
    init();
})();
