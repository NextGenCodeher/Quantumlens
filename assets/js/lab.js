/* =====================================================================
 * Quantum Lens — Quantum Lab page controller (lab.js)
 * Drag-and-drop circuit builder · Code Lab · multi-backend runs ·
 * visualisations · challenges · saved circuits · AI tutor wiring
 * ===================================================================== */
(function () {
    'use strict';
    const QL = window.QL;
    const $ = (s, el = document) => el.querySelector(s);
    const $$ = (s, el = document) => [...el.querySelectorAll(s)];
    const esc = QL.esc;
    const PI = Math.PI;

    // Geometry of the builder canvas
    const LW = 64, CW = 58, RH = 58, TOP = 10, MAX_BUILDER_QUBITS = 8;

    const S = {
        n: 2, ops: [], selected: null, armed: null, history: [], future: [],
        source: 'builder', codeCircuit: null, parse: null, step: null,
        lastRun: null, challenge: null, hintsUsed: 0, lastGrade: null, savedId: null, activeTab: 'builder', resultTab: 'bloch'
    };
    let nextId = 1;
    const newId = () => 'op' + (nextId++);

    // ------------------------------------------------------------------
    // Circuit model helpers
    // ------------------------------------------------------------------
    function builderCircuit() {
        const ops = S.ops.slice().sort((a, b) => a.col - b.col || Math.min(...span(a)) - Math.min(...span(b)));
        return { numQubits: S.n, ops: ops.map(o => ({ gate: o.gate, targets: o.targets.slice(), controls: (o.controls || []).slice(), params: (o.params || []).slice() })) };
    }
    function currentCircuit() { return S.source === 'code' && S.codeCircuit ? S.codeCircuit : builderCircuit(); }
    function span(op) { if (op.gate === 'barrier') return [0, S.n - 1]; const qs = QL.opQubits(op); return [Math.min(...qs), Math.max(...qs)]; }
    function overlaps(a, b) { const [a0, a1] = span(a), [b0, b1] = span(b); return a0 <= b1 && b0 <= a1; }
    function compact() {
        const cols = [...new Set(S.ops.map(o => o.col))].sort((a, b) => a - b);
        const map = new Map(cols.map((c, i) => [c, i])); S.ops.forEach(o => o.col = map.get(o.col));
    }
    function snapshot() { return JSON.stringify({ n: S.n, ops: S.ops }); }
    function mutate(fn) {
        S.history.push(snapshot()); if (S.history.length > 100) S.history.shift(); S.future = [];
        fn(); compact(); S.source = 'builder'; S.savedIdDirty = true; S.step = null;
        renderGrid(); renderInspector(); onChange();
    }
    function restore(snap) { const d = JSON.parse(snap); S.n = d.n; S.ops = d.ops; S.selected = null; renderGrid(); renderInspector(); onChange(); }
    function setBuilderCircuit(circuit, opts = {}) {
        if (circuit.numQubits > MAX_BUILDER_QUBITS) { QL.toast(`The builder shows up to ${MAX_BUILDER_QUBITS} qubits — this circuit stays in the Code Lab.`, 'warn'); return false; }
        mutate(() => {
            S.n = Math.max(1, circuit.numQubits);
            S.ops = QL.layoutColumns(circuit).map(o => ({ id: newId(), gate: o.gate, targets: o.targets.slice(), controls: (o.controls || []).slice(), params: (o.params || []).slice(), col: o.col }));
            S.selected = null;
        });
        if (!opts.keepSaved) S.savedId = null;
        return true;
    }

    // ------------------------------------------------------------------
    // Palette
    // ------------------------------------------------------------------
    function renderPalette() {
        const pal = $('#palette');
        pal.innerHTML = QL.PALETTE.map(grp => `<div class="ql-pal-group"><span>${grp.group}</span><div>${grp.gates.map(gname => {
            const G = QL.GATES[gname];
            const bg = G.category === 'multi' ? 'var(--primary-purple)' : G.color;
            return `<button type="button" class="ql-gate-tile" draggable="true" data-gate="${gname}" style="background:${bg}" title="${esc(G.title)} — ${esc(G.desc)}" aria-label="${esc(G.title)}">${esc(labelFor(gname))}</button>`;
        }).join('')}</div></div>`).join('') + `<div class="ql-pal-hint"><i class="fas fa-hand-pointer"></i> Drag a gate onto a wire — or click a gate, then click a spot on the circuit. Click a placed gate to edit it; drag it back here (or press Delete) to remove it.</div>`;
        $$('.ql-gate-tile', pal).forEach(t => {
            t.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', 'new:' + t.dataset.gate); e.dataTransfer.effectAllowed = 'copy'; });
            t.addEventListener('click', () => { S.armed = S.armed === t.dataset.gate ? null : t.dataset.gate; $$('.ql-gate-tile').forEach(x => x.classList.toggle('armed', x.dataset.gate === S.armed)); if (S.armed) QL.toast(`${QL.GATES[S.armed].title} selected — click a wire to place it`); });
        });
        pal.addEventListener('dragover', e => { if (dragKind === 'move') { e.preventDefault(); pal.classList.add('trash-active'); } });
        pal.addEventListener('dragleave', () => pal.classList.remove('trash-active'));
        pal.addEventListener('drop', e => { pal.classList.remove('trash-active'); const d = e.dataTransfer.getData('text/plain'); if (d.startsWith('move:')) { e.preventDefault(); deleteOp(d.slice(5)); } });
    }
    function labelFor(g) { const G = QL.GATES[g]; if (g === 'cx') return 'CX'; if (g === 'ccx') return 'CCX'; if (g === 'swap') return 'SWAP'; if (g === 'cswap') return 'CSWAP'; if (G.category === 'multi') return 'C' + G.label; return G.label; }
    let dragKind = null;
    document.addEventListener('dragstart', e => { const d = e.target && e.target.dataset; dragKind = d && d.gate ? 'new' : 'move'; });
    document.addEventListener('dragend', () => { dragKind = null; hideGhost(); });

    // ------------------------------------------------------------------
    // Grid rendering
    // ------------------------------------------------------------------
    const yc = (q) => TOP + q * RH + RH / 2;
    function renderGrid() {
        const grid = $('#grid');
        const maxCol = S.ops.reduce((m, o) => Math.max(m, o.col), -1);
        const cols = Math.max(10, maxCol + 3);
        const W = LW + cols * CW + 16, H = TOP * 2 + S.n * RH;
        grid.style.width = W + 'px'; grid.style.height = H + 'px';
        let html = '';
        for (let c = 0; c < cols; c++) html += `<div class="ql-colguide" style="left:${LW + c * CW + CW / 2}px"></div>`;
        for (let q = 0; q < S.n; q++) html += `<div class="ql-wire" style="top:${yc(q) - 1}px;left:${LW - 8}px"></div><div class="ql-wire-lab" style="top:${yc(q)}px">q${q} <span style="font-weight:400;color:#9a93b3">|0⟩</span></div>`;
        html += '<div class="ql-ghost" id="ghost"></div>';
        // step highlighting
        const order = sortedOps();
        const stepIdx = S.step == null || S.source !== 'builder' ? Infinity : S.step;
        order.forEach((op, i) => { html += opHTML(op, i >= stepIdx); });
        if (S.step != null && S.source === 'builder') {
            const colAt = stepIdx >= order.length ? maxCol + 1 : order[stepIdx] ? order[stepIdx].col : maxCol + 1;
            html += `<div class="ql-stepline" style="left:${LW + colAt * CW - 2}px"></div>`;
        }
        grid.innerHTML = html;
        $('#q-num').textContent = S.n;
        $$('.ql-op [data-op]', grid).forEach(el => {
            el.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', 'move:' + el.dataset.op); e.dataTransfer.effectAllowed = 'move'; dragKind = 'move'; });
            el.addEventListener('click', e => { e.stopPropagation(); S.selected = el.dataset.op; renderGrid(); renderInspector(); });
            el.addEventListener('dblclick', e => { e.stopPropagation(); deleteOp(el.dataset.op); });
            el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); S.selected = el.dataset.op; renderGrid(); renderInspector(); } });
        });
    }
    function sortedOps() { return S.ops.slice().sort((a, b) => a.col - b.col || Math.min(...span(a)) - Math.min(...span(b))); }

    function opHTML(op, future) {
        const G = QL.GATES[op.gate]; const cx = CW / 2; const sel = S.selected === op.id ? ' selected' : '';
        const attr = `data-op="${op.id}" draggable="true" tabindex="0" role="button" aria-label="${esc(G.title)} on qubit ${QL.opQubits(op).join(',')}" title="${esc(G.title)}${op.params && op.params.length ? ' (' + op.params.map(QL.fmtAngleHuman).join(', ') + ')' : ''} — click to edit, double-click to delete"`;
        let s = `<div class="ql-op${sel}${future ? ' future' : ''}" style="left:${LW + op.col * CW}px;top:0;width:${CW}px;height:100%;pointer-events:none">`;
        if (op.gate === 'barrier') return s + `<div class="ql-barrier" ${attr} style="left:${cx - 1}px;top:${TOP}px;height:${S.n * RH}px;pointer-events:auto;width:12px;margin-left:-5px;border-left-width:2px;cursor:grab"></div></div>`;
        const qs = QL.opQubits(op);
        if (qs.length > 1) s += `<div class="ql-vline" style="left:${cx - 1}px;top:${yc(Math.min(...qs))}px;height:${yc(Math.max(...qs)) - yc(Math.min(...qs))}px"></div>`;
        (op.controls || []).forEach(c => s += `<div class="ql-ctrl" ${attr} style="left:${cx - 7}px;top:${yc(c) - 7}px;pointer-events:auto;cursor:grab"></div>`);
        op.targets.forEach(t => {
            const y = yc(t);
            if (op.gate === 'cx' || op.gate === 'ccx') s += `<div class="ql-oplus" ${attr} style="left:${cx - 15}px;top:${y - 15}px;pointer-events:auto;cursor:grab"></div>`;
            else if (op.gate === 'cz') s += `<div class="ql-ctrl" ${attr} style="left:${cx - 7}px;top:${y - 7}px;pointer-events:auto;cursor:grab"></div>`;
            else if (op.gate === 'swap' || op.gate === 'cswap') s += `<div class="ql-x" ${attr} style="left:${cx - 10}px;top:${y - 11}px;pointer-events:auto;cursor:grab">×</div>`;
            else {
                const bg = G.category === 'multi' ? 'var(--primary-purple)' : G.color;
                const lab = esc(G.label);
                const p = op.params && op.params.length ? `<small>${esc(op.params.length === 1 ? QL.fmtAngleHuman(op.params[0]) : op.params.map(v => QL.fmtAngleHuman(v)).join(','))}</small>` : '';
                s += `<div class="ql-box" ${attr} style="left:${cx - 20}px;top:${y - 20}px;background:${bg};pointer-events:auto">${lab}${p}</div>`;
            }
        });
        return s + '</div>';
    }

    // Ghost & drop target
    function cellFromEvent(e) {
        const r = $('#grid').getBoundingClientRect();
        const x = e.clientX - r.left, y = e.clientY - r.top;
        return { col: Math.max(0, Math.floor((x - LW) / CW)), row: Math.max(0, Math.min(S.n - 1, Math.floor((y - TOP) / RH))) };
    }
    function showGhost(col, row) { const g = $('#ghost'); if (!g) return; g.style.display = 'block'; g.style.left = (LW + col * CW + 4) + 'px'; g.style.top = (TOP + row * RH + 4) + 'px'; g.style.width = (CW - 8) + 'px'; g.style.height = (RH - 8) + 'px'; }
    function hideGhost() { const g = $('#ghost'); if (g) g.style.display = 'none'; }
    function bindGrid() {
        const grid = $('#grid');
        grid.addEventListener('dragover', e => { e.preventDefault(); const { col, row } = cellFromEvent(e); showGhost(col, row); });
        grid.addEventListener('dragleave', e => { if (!grid.contains(e.relatedTarget)) hideGhost(); });
        grid.addEventListener('drop', e => {
            e.preventDefault(); hideGhost(); const d = e.dataTransfer.getData('text/plain'); const { col, row } = cellFromEvent(e);
            if (d.startsWith('new:')) placeNew(d.slice(4), col, row); else if (d.startsWith('move:')) moveOp(d.slice(5), col, row);
        });
        grid.addEventListener('mousemove', e => { if (S.armed) { const { col, row } = cellFromEvent(e); showGhost(col, row); } });
        grid.addEventListener('mouseleave', () => { if (S.armed) hideGhost(); });
        grid.addEventListener('click', e => {
            const { col, row } = cellFromEvent(e);
            if (S.armed) { placeNew(S.armed, col, row); return; }
            if (S.selected) { S.selected = null; renderGrid(); renderInspector(); }
        });
    }

    function defaultParams(g) { return { rx: [PI / 2], ry: [PI / 2], rz: [PI / 2], p: [PI / 4], cp: [PI / 2], crx: [PI / 2], cry: [PI / 2], crz: [PI / 2], u: [PI / 2, 0, PI] }[g] || []; }
    function placeNew(gate, col, row) {
        const G = QL.GATES[gate]; const need = G.nC + G.nT;
        if (gate !== 'barrier' && need > S.n) { QL.toast(`${G.title} needs ${need} qubits — add more qubits first.`, 'warn'); return; }
        const others = [...Array(S.n).keys()].filter(q => q !== row).sort((a, b) => Math.abs(a - row) - Math.abs(b - row) || a - b);
        let op = { id: newId(), gate, targets: [row], controls: [], params: defaultParams(gate), col };
        if (gate === 'barrier') op.targets = [];
        else if (gate === 'swap') op.targets = [row, others[0]];
        else if (gate === 'cswap') { op.controls = [others[0]]; op.targets = [row, others[1]]; }
        else if (G.nC === 1) op.controls = [others[0]];
        else if (G.nC === 2) op.controls = others.slice(0, 2).sort((a, b) => a - b);
        mutate(() => { insertAt(op, col); S.selected = op.id; });
        if (S.armed && !(window.event && window.event.shiftKey)) { S.armed = null; $$('.ql-gate-tile').forEach(x => x.classList.remove('armed')); hideGhost(); }
    }
    function insertAt(op, col) {
        op.col = col;
        if (S.ops.some(o => o.col === col && overlaps(o, op))) S.ops.forEach(o => { if (o.col >= col) o.col++; });
        S.ops.push(op);
    }
    function moveOp(id, col, row) {
        const op = S.ops.find(o => o.id === id); if (!op) return;
        const anchor = op.targets.length ? op.targets[0] : row; const d = row - anchor;
        const nt = op.targets.map(q => q + d), nc = (op.controls || []).map(q => q + d);
        if ([...nt, ...nc].some(q => q < 0 || q >= S.n)) { QL.toast('That position would put part of the gate off the circuit.', 'warn'); return; }
        mutate(() => { S.ops = S.ops.filter(o => o.id !== id); const moved = Object.assign({}, op, { targets: nt, controls: nc }); insertAt(moved, col); S.selected = id; });
    }
    function deleteOp(id) { mutate(() => { S.ops = S.ops.filter(o => o.id !== id); if (S.selected === id) S.selected = null; }); }

    // ------------------------------------------------------------------
    // Inspector
    // ------------------------------------------------------------------
    function renderInspector() {
        const el = $('#inspector'); const op = S.ops.find(o => o.id === S.selected);
        if (!op) { el.innerHTML = ''; return; }
        const G = QL.GATES[op.gate]; const qopts = (v) => [...Array(S.n).keys()].map(q => `<option value="${q}" ${q === v ? 'selected' : ''}>q${q}</option>`).join('');
        let fields = '';
        (op.controls || []).forEach((c, i) => fields += `<label>Control ${op.controls.length > 1 ? i + 1 : ''}<select class="ql-select" data-k="controls" data-i="${i}">${qopts(c)}</select></label>`);
        op.targets.forEach((t, i) => fields += `<label>Target ${op.targets.length > 1 ? i + 1 : ''}<select class="ql-select" data-k="targets" data-i="${i}">${qopts(t)}</select></label>`);
        G.params.forEach((p, i) => fields += `<label>${p} (e.g. pi/4)<input class="ql-input" data-k="params" data-i="${i}" value="${esc(QL.fmtAngle(op.params[i], 'qasm'))}" style="width:120px"></label>`);
        el.innerHTML = `<div class="ql-card"><div class="ql-row"><h3 style="margin:0">${esc(G.title)}</h3><span class="ql-spacer"></span><button class="ql-btn ql-btn-small" id="i-explain"><i class="fas fa-robot"></i> Ask tutor</button><button class="ql-btn ql-btn-small ql-btn-danger" id="i-del"><i class="fas fa-trash"></i> Delete</button></div><p class="ql-muted ql-small" style="margin:6px 0 10px">${esc(G.desc)}</p><div class="ql-row">${fields || '<span class="ql-muted ql-small">No settings for this gate.</span>'}</div><p class="ql-small ql-muted" id="i-err" style="color:var(--ql-err)"></p></div>`;
        $('#i-del').onclick = () => deleteOp(op.id);
        $('#i-explain').onclick = () => tutorUI.ask(`What does the ${G.title} gate do?`);
        $$('[data-k]', el).forEach(inp => inp.addEventListener('change', () => {
            const k = inp.dataset.k, i = +inp.dataset.i; let v;
            if (k === 'params') { try { v = QL.evaluate(inp.value, {}); if (typeof v !== 'number' || !isFinite(v)) throw new Error('not a number'); } catch (e) { $('#i-err').textContent = `“${inp.value}” is not a valid angle. Use numbers and pi, e.g. pi/4 or 0.5.`; return; } }
            else v = +inp.value;
            const draft = JSON.parse(JSON.stringify(op)); draft[k][i] = v;
            const qs = QL.opQubits(draft); if (new Set(qs).size !== qs.length) { $('#i-err').textContent = 'A gate cannot use the same qubit twice.'; inp.value = op[k][i]; return; }
            mutate(() => { const o = S.ops.find(x => x.id === op.id); o[k][i] = v; if (k !== 'params' && S.ops.some(x => x !== o && x.col === o.col && overlaps(x, o))) { S.ops.forEach(x => { if (x !== o && x.col >= o.col) x.col++; }); } });
        }));
    }

    // ------------------------------------------------------------------
    // Code Lab
    // ------------------------------------------------------------------
    const code = () => $('#code');
    let parseTimer;
    function setCode(text, fw) {
        code().value = text; if (fw) $('#c-framework').value = fw;
        parseCode(true); S.source = 'code'; onChange();
    }
    function parseCode(silent) {
        const txt = code().value; const fw = $('#c-framework').value;
        updateGutter();
        if (!txt.trim()) { S.parse = null; S.codeCircuit = null; renderProblems(); return; }
        S.parse = QL.parse(txt, fw);
        S.codeCircuit = S.parse.errors.length ? null : S.parse.circuit;
        renderProblems(); updateGutter();
        if (!silent && S.activeTab === 'code') { S.source = 'code'; S.step = null; onChange(); }
    }
    function updateGutter() {
        const lines = code().value.split('\n').length; const errs = new Set((S.parse && S.parse.errors || []).map(e => e.line)); const warns = new Set((S.parse && S.parse.warnings || []).map(e => e.line));
        let h = ''; for (let i = 1; i <= lines; i++) h += `<div class="${errs.has(i) ? 'err' : warns.has(i) ? 'warn' : ''}">${i}</div>`;
        $('#gutter').innerHTML = h; $('#gutter').scrollTop = code().scrollTop;
    }
    function renderProblems() {
        const el = $('#problems'); const p = S.parse;
        if (!p) { el.innerHTML = `<div class="p-ok"><i class="fas fa-circle-info"></i> Write code or insert a template to begin.</div>`; return; }
        const fwName = p.framework ? QL.FRAMEWORKS[p.framework].label + (p.inner ? ` (embedded ${QL.FRAMEWORKS[p.inner].label})` : '') : 'unknown';
        let h = '';
        p.errors.forEach(e => h += `<div class="p-err" data-line="${e.line}"><b><i class="fas fa-circle-xmark" style="color:var(--ql-err)"></i> Line ${e.line}</b><span>${esc(e.message)}${e.hint ? ` <em class="ql-muted">— ${esc(e.hint)}</em>` : ''}</span></div>`);
        (p.warnings || []).forEach(e => h += `<div class="p-warn" data-line="${e.line}"><b><i class="fas fa-triangle-exclamation" style="color:#a15c00"></i> Line ${e.line}</b><span>${esc(e.message)}${e.hint ? ` <em class="ql-muted">— ${esc(e.hint)}</em>` : ''}</span></div>`);
        if (!p.errors.length) { const m = QL.metrics(p.circuit); h = `<div class="p-ok"><i class="fas fa-circle-check" style="color:var(--ql-ok)"></i> <span>${esc(fwName)} · ${m.qubits} qubit(s), ${m.gates} gate(s), depth ${m.depth}. Results below update live.</span></div>` + h; }
        el.innerHTML = h;
        $$('[data-line]', el).forEach(d => d.addEventListener('click', () => gotoLine(+d.dataset.line)));
    }
    function gotoLine(line) {
        S.activeTab !== 'code' && switchTab('code');
        const ta = code(); const lines = ta.value.split('\n'); let pos = 0; for (let i = 0; i < line - 1 && i < lines.length; i++) pos += lines[i].length + 1;
        ta.focus(); ta.setSelectionRange(pos, pos + (lines[line - 1] || '').length);
        ta.scrollTop = Math.max(0, (line - 4) * 21);
    }
    function codeFramework() { const f = $('#c-framework').value; return f === 'auto' ? (S.parse && S.parse.framework) || 'qiskit' : f; }
    function bindCode() {
        const ta = code();
        ta.addEventListener('input', () => { clearTimeout(parseTimer); updateGutter(); parseTimer = setTimeout(() => parseCode(false), 250); saveDraft(); });
        ta.addEventListener('scroll', () => { $('#gutter').scrollTop = ta.scrollTop; });
        ta.addEventListener('keydown', e => {
            if (e.key === 'Tab') { e.preventDefault(); const s = ta.selectionStart; ta.setRangeText('    ', s, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); }
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); }
        });
        $('#c-framework').addEventListener('change', () => {
            const target = $('#c-framework').value;
            if (target !== 'auto' && S.codeCircuit && S.parse && S.parse.framework !== target && confirm(`Convert the current program to ${QL.FRAMEWORKS[target].label}? (Comments and unsupported extras are not kept.)`)) {
                setCode(QL.generateCode(S.codeCircuit, target), target); QL.toast(`Converted to ${QL.FRAMEWORKS[target].label}`, 'ok'); return;
            }
            parseCode(false);
        });
        const tpl = $('#c-template');
        tpl.innerHTML = '<option value="">Insert template…</option><option value="__blank">Blank program</option>' + Object.entries(QL.EXAMPLES).map(([k, e]) => `<option value="${k}">${esc(e.title)}</option>`).join('');
        tpl.addEventListener('change', () => {
            const k = tpl.value; tpl.value = ''; if (!k) return;
            const fw = codeFramework();
            if (k === '__blank') { setCode(QL.generateCode({ numQubits: 2, ops: [] }, fw), fw); return; }
            setCode(QL.generateCode(QL.EXAMPLES[k].circuit, fw), $('#c-framework').value === 'auto' ? 'auto' : fw);
        });
        $('#c-frombuilder').onclick = () => { const fw = codeFramework(); setCode(QL.generateCode(builderCircuit(), fw), fw); QL.toast(`Generated ${QL.FRAMEWORKS[fw].label} code from the builder`, 'ok'); };
        $('#c-tobuilder').onclick = () => {
            if (!S.codeCircuit) { QL.toast('Fix the errors in your code first.', 'err'); return; }
            if (setBuilderCircuit(S.codeCircuit)) { switchTab('builder'); QL.toast('Loaded into the Circuit Builder', 'ok'); }
        };
        $('#c-download').onclick = () => { const fw = codeFramework(); download(`quantum_circuit.${fw === 'qasm' ? 'qasm' : 'py'}`, code().value); };
        $('#c-run').onclick = () => { S.source = 'code'; run(); };
    }

    // ------------------------------------------------------------------
    // Results
    // ------------------------------------------------------------------
    const blochs = [];
    let changeTimer;
    function onChange() {
        clearTimeout(changeTimer);
        changeTimer = setTimeout(() => { updateResults(); saveDraft(); }, 30);
    }
    function sig(c) { return JSON.stringify(c); }
    function updateResults() {
        const circ = currentCircuit();
        $('#r-source').textContent = S.source === 'code' ? `Showing: Code Lab program (${S.parse && S.parse.framework ? QL.FRAMEWORKS[S.parse.framework].label : ''})` : 'Showing: Circuit Builder';
        const errs = QL.validateCircuit(circ);
        if (S.source === 'code' && !S.codeCircuit) { $('#state-desc').innerHTML = 'Fix the errors in the Code Lab to see results.'; return; }
        if (errs.length) { $('#state-desc').innerHTML = esc(errs[0]); return; }
        const stepMax = circ.ops.length; const slider = $('#r-step'); slider.max = stepMax;
        if (S.step == null) slider.value = stepMax;
        const upto = S.step == null ? stepMax : S.step;
        $('#r-step-label').textContent = S.step == null || upto >= stepMax ? `All ${stepMax} step(s)` : `After step ${upto} of ${stepMax}${upto > 0 ? ` (${QL.GATES[circ.ops[upto - 1].gate].title})` : ' — initial state'}`;
        const sim = QL.simulate(circ, { upto });
        S.sim = sim; S.simCircuit = circ;
        renderBloch(sim, S.step != null);
        renderProb(sim, circ);
        QL.stateTable($('#sv-table'), sim.amplitudes, circ.numQubits);
        renderExec(circ);
        if (S.source === 'builder' && S.step != null) renderGrid();
    }
    function renderBloch(sim, trail) {
        const grid = $('#bloch-grid'); const n = sim.numQubits;
        if (blochs.length !== n || !grid.children.length) {
            grid.innerHTML = ''; blochs.length = 0;
            for (let q = 0; q < n; q++) {
                const card = document.createElement('div'); card.className = 'ql-bloch-card';
                const cv = document.createElement('canvas'); card.appendChild(cv);
                const meta = document.createElement('div'); meta.className = 'ql-bloch-meta'; card.appendChild(meta);
                grid.appendChild(card);
                blochs.push({ sphere: new QL.BlochSphere(cv, { size: n > 4 ? 170 : 210, label: `q${q}` }), meta });
            }
        }
        const ent = QL.entangledQubits(sim);
        sim.bloch.forEach((b, q) => {
            blochs[q].sphere.set(b, { trail });
            blochs[q].meta.innerHTML = `x ${b.x.toFixed(2)} · y ${b.y.toFixed(2)} · z ${b.z.toFixed(2)}<br>P(1) ${(b.p1 * 100).toFixed(1)}% · purity ${b.purity.toFixed(2)} ${ent.includes(q) ? '<span class="ql-badge ql-badge-purple">entangled</span>' : ''}`;
        });
        $('#state-desc').innerHTML = `<b>State:</b> ${esc(QL.describeState(sim.amplitudes, sim.numQubits))}${ent.length ? ` · <b>Entangled qubits:</b> q${ent.join(', q')} (their arrows shrink toward the centre)` : ''}${sim.warnings.length ? `<br><span style="color:var(--ql-warn)">${esc(sim.warnings[0])}</span>` : ''}`;
    }
    function renderProb(sim, circ) {
        const showAll = $('#prob-all').checked; const mq = sim.measuredQubits; const m = mq.length;
        let labels = Object.keys(sim.marginal).sort();
        if (showAll && m <= 7) labels = [...Array(1 << m).keys()].map(i => i.toString(2).padStart(m, '0'));
        const series = [{ name: 'Exact probability', color: QL.COLORS.exact, values: sim.marginal }];
        const lr = S.lastRun && S.lastRun.sig === sig(circ) && S.step == null ? S.lastRun.r : null;
        if (lr && lr.counts) {
            const tot = Object.values(lr.counts).reduce((a, b) => a + b, 0) || 1;
            const vals = {}; Object.entries(lr.counts).forEach(([k, v]) => vals[k] = v / tot);
            series.push({ name: `Measured (${tot} shots, ${QL.BACKENDS[lr.backend].label})`, color: QL.COLORS.measured, values: vals, format: v => `${(v * 100).toFixed(1)}% (${Math.round(v * tot)} counts)` });
            labels = [...new Set([...labels, ...Object.keys(vals)])].sort();
        }
        if (labels.length > 64) labels = labels.sort((a, b) => (sim.marginal[b] || 0) - (sim.marginal[a] || 0)).slice(0, 64).sort();
        $('#prob-caption').textContent = `Outcomes of ${sim.explicitMeasurement ? 'measured qubits' : 'all qubits (no Measure gates)'} q${mq.slice().reverse().join(' q')} — right-most bit is q${mq[0]}.${lr ? '' : ' Press Run to add measured shot counts.'}`;
        QL.barChart($('#prob-chart'), series, { labels, title: 'Measurement probabilities', height: 260 });
    }
    function renderExec(circ) {
        const met = QL.metrics(circ); const lr = S.lastRun && S.lastRun.sig === sig(circ) ? S.lastRun : null;
        let h = `<div class="ql-kv"><div><span>Qubits</span><b>${met.qubits}</b></div><div><span>Gates</span><b>${met.gates}</b></div><div><span>Two-qubit gates</span><b>${met.twoQubitGates}</b></div><div><span>Depth</span><b>${met.depth}</b></div><div><span>Measurements</span><b>${met.measurements}</b></div></div>`;
        if (lr) {
            const r = lr.r;
            h += `<div class="ql-kv"><div><span>Backend</span><b style="font-size:.95rem">${esc(r.engineLabel)}</b></div><div><span>Executed on</span><b style="font-size:.95rem">${r.executedOn === 'server' ? 'Python server' : 'Your browser'}</b></div><div><span>Shots</span><b>${r.shots}</b></div><div><span>Time</span><b>${(r.serverTimeMs != null ? r.serverTimeMs : r.timeMs).toFixed(1)} ms</b></div></div>`;
            (r.notes || []).forEach(n => h += `<div class="ql-note ${r.executedOn === 'server' ? 'ql-note-ok' : 'ql-note-info'}">${esc(n)}</div>`);
            const top = Object.entries(r.counts || {}).sort((a, b) => b[1] - a[1]);
            h += `<h3 style="color:var(--primary-purple);margin:14px 0 6px;font-size:1rem">Counts</h3><div class="ql-table-wrap"><table class="ql-table"><thead><tr><th>Outcome</th><th>Counts</th><th>Frequency</th></tr></thead><tbody>${top.slice(0, 32).map(([k, v]) => `<tr><td class="ql-mono">${k}</td><td>${v}</td><td>${(100 * v / r.shots).toFixed(2)}%</td></tr>`).join('')}</tbody></table></div>`;
            h += `<div class="ql-row" style="margin-top:12px"><button class="ql-btn ql-btn-small" id="dl-results"><i class="fas fa-download"></i> Download results (JSON)</button><button class="ql-btn ql-btn-small" id="ask-results"><i class="fas fa-robot"></i> Explain these results</button></div>`;
        } else h += `<div class="ql-note ql-note-info">Press <b>Run</b> to execute the circuit with shots on the selected backend. Visualisations above already show the exact (noise-free) state.</div>`;
        $('#exec').innerHTML = h;
        const dl = $('#dl-results'); if (dl) dl.onclick = () => download('quantum_results.json', JSON.stringify({ circuit: circ, backend: lr.r.backend, engine: lr.r.engineLabel, shots: lr.r.shots, counts: lr.r.counts, probabilities: lr.r.probabilities, statevector: lr.r.amplitudes, qasm: QL.toQASM(circ) }, null, 2), 'application/json');
        const ask = $('#ask-results'); if (ask) ask.onclick = () => tutorUI.ask('Explain my circuit and its results');
    }

    async function run() {
        if (S.activeTab === 'code') { parseCode(true); S.source = 'code'; if (!S.codeCircuit) { QL.toast('Your code has errors — see the Problems list.', 'err'); return; } }
        else if (S.activeTab === 'builder') S.source = 'builder';
        const circ = currentCircuit(); const errs = QL.validateCircuit(circ);
        if (errs.length) { QL.toast(esc(errs[0]), 'err'); return; }
        const backend = $('#r-backend').value; const shots = Math.max(1, Math.min(100000, +$('#r-shots').value || 1024));
        QL.saveSettings({ shots, defaultBackend: backend });
        const btn = $('#r-run'); btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Running…';
        try {
            const r = await QL.run(circ, backend, shots);
            S.lastRun = { r, sig: sig(circ), at: Date.now() }; S.step = null;
            QL.countRun(); QL.logActivity('run', QL.BACKENDS[backend].label, { executedOn: r.executedOn });
            updateResults(); switchResultTab('prob');
            QL.toast(`Ran ${shots} shots on ${esc(r.engineLabel)}`, r.executedOn === 'server' ? 'ok' : 'info');
        } catch (e) { QL.toast('Run failed: ' + esc(e.message), 'err'); }
        finally { btn.disabled = false; btn.innerHTML = '<i class="fas fa-play"></i> Run'; }
    }

    async function compareBackends() {
        const circ = currentCircuit(); const errs = QL.validateCircuit(circ); if (errs.length) { QL.toast(esc(errs[0]), 'err'); return; }
        switchResultTab('cmp'); const el = $('#cmp'); el.innerHTML = '<div class="ql-empty"><i class="fas fa-spinner fa-spin"></i>Running on every backend…</div>';
        const shots = Math.max(1, Math.min(100000, +$('#r-shots').value || 1024)); const exact = QL.simulate(circ).marginal;
        const rows = [];
        for (const b of ['browser', 'qiskit_aer', 'cirq', 'pennylane', 'qbraid']) {
            if (b !== 'browser' && !QL.api.available(b)) { rows.push({ b, skipped: true }); continue; }
            try { const r = await QL.run(circ, b, shots); const tot = Object.values(r.counts).reduce((a, c) => a + c, 0); const freq = {}; Object.entries(r.counts).forEach(([k, v]) => freq[k] = v / tot); rows.push({ b, r, freq, tv: QL.totalVariation(freq, exact), fid: r.executedOn === 'server' ? QL.fidelity(r.amplitudes, QL.simulate(circ).amplitudes) : 1 }); }
            catch (e) { rows.push({ b, error: e.message }); }
        }
        const keys = Object.keys(exact).sort((a, b) => exact[b] - exact[a]).slice(0, 6).sort();
        el.innerHTML = `<p class="ql-muted ql-small" style="margin-bottom:8px">Same circuit, ${shots} shots per backend. <b>TV distance</b> = how far the sampled frequencies are from the exact distribution (0 = identical; small values are normal shot noise). <b>State fidelity</b> compares each backend's statevector with the browser engine.</p>
        <div class="ql-table-wrap"><table class="ql-table"><thead><tr><th>Backend</th><th>Executed on</th>${keys.map(k => `<th class="ql-mono">${k}</th>`).join('')}<th>TV distance</th><th>State fidelity</th><th>Time</th></tr></thead><tbody>
        <tr><td><b>Exact (theory)</b></td><td>—</td>${keys.map(k => `<td>${(exact[k] * 100).toFixed(1)}%</td>`).join('')}<td>0</td><td>1.000</td><td>—</td></tr>
        ${rows.map(x => x.skipped ? `<tr><td>${esc(QL.BACKENDS[x.b].label)}</td><td colspan="${keys.length + 4}" class="ql-muted">Not connected — start the Python backend to include it (<a href="docs.html#backends">how</a>).</td></tr>` : x.error ? `<tr><td>${esc(QL.BACKENDS[x.b].label)}</td><td colspan="${keys.length + 4}" style="color:var(--ql-err)">${esc(x.error)}</td></tr>` : `<tr><td><b>${esc(QL.BACKENDS[x.b].label)}</b><div class="ql-muted ql-small">${esc(x.r.engineLabel)}</div></td><td>${x.r.executedOn === 'server' ? '<span class="ql-badge ql-badge-ok">Python server</span>' : '<span class="ql-badge ql-badge-info">Browser</span>'}</td>${keys.map(k => `<td>${((x.freq[k] || 0) * 100).toFixed(1)}%</td>`).join('')}<td>${x.tv.toFixed(3)}</td><td>${x.fid.toFixed(4)}</td><td>${(x.r.serverTimeMs != null ? x.r.serverTimeMs : x.r.timeMs).toFixed(1)} ms</td></tr>`).join('')}
        </tbody></table></div>`;
        QL.logActivity('compare', 'backends');
    }

    // ------------------------------------------------------------------
    // Tabs
    // ------------------------------------------------------------------
    function switchTab(name) {
        S.activeTab = name;
        ['builder', 'code', 'challenges', 'saved'].forEach(t => { $('#tab-' + t).setAttribute('aria-selected', t === name); $('#panel-' + t).hidden = t !== name; });
        if (name === 'builder' && S.source !== 'builder') { S.source = 'builder'; S.step = null; onChange(); }
        if (name === 'code' && S.codeCircuit && S.source !== 'code') { S.source = 'code'; S.step = null; onChange(); }
        if (name === 'challenges') renderChallenges();
        if (name === 'saved') renderSaved();
    }
    function switchResultTab(name) {
        S.resultTab = name;
        ['bloch', 'prob', 'sv', 'exec', 'cmp'].forEach(t => { $('#rt-' + t).setAttribute('aria-selected', t === name); $('#rp-' + t).hidden = t !== name; });
        if (name === 'prob' && S.sim) renderProb(S.sim, S.simCircuit);
    }
    function bindTabs() {
        ['builder', 'code', 'challenges', 'saved'].forEach(t => $('#tab-' + t).addEventListener('click', () => switchTab(t)));
        ['bloch', 'prob', 'sv', 'exec', 'cmp'].forEach(t => $('#rt-' + t).addEventListener('click', () => switchResultTab(t)));
        $$('[role=tablist]').forEach(list => list.addEventListener('keydown', e => {
            if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return; const tabs = $$('[role=tab]', list); const i = tabs.indexOf(document.activeElement); if (i < 0) return;
            const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; n.focus(); n.click();
        }));
    }

    // ------------------------------------------------------------------
    // Challenges
    // ------------------------------------------------------------------
    function renderChallenges() {
        const p = QL.getProgress(); const f = $('#ch-filter').value;
        const list = QL.CHALLENGES.filter(c => f === 'all' || c.type === f || (f === 'open' && !(p.challenges[c.id] && p.challenges[c.id].passed)));
        const solved = QL.CHALLENGES.filter(c => p.challenges[c.id] && p.challenges[c.id].passed).length;
        $('#ch-summary').textContent = `${solved}/${QL.CHALLENGES.length} solved · ${Object.values(p.challenges).reduce((s, c) => s + (c.best || 0), 0)} points`;
        $('#ch-count').textContent = `${solved}/${QL.CHALLENGES.length}`;
        $('#ch-list').innerHTML = list.map(c => {
            const r = p.challenges[c.id]; const mod = QL.MODULES.find(m => m.id === c.module);
            const dcls = c.difficulty === 'Easy' ? 'ql-badge-ok' : c.difficulty === 'Medium' ? 'ql-badge-warn' : 'ql-badge-err';
            return `<div class="ql-card ql-ch-card"><div class="ql-row"><span class="ql-badge ${c.type === 'code' ? 'ql-badge-info' : 'ql-badge-purple'}"><i class="fas ${c.type === 'code' ? 'fa-code' : 'fa-puzzle-piece'}"></i> ${c.type === 'code' ? 'Coding' : 'Circuit'}</span><span class="ql-badge ${dcls}">${c.difficulty}</span></div><h4>${esc(c.title)}</h4><p>${esc(c.goal)}</p><div class="ql-muted ql-small">Module ${mod.num}: ${esc(mod.title)} · ${c.points} pts</div><div class="ql-row">${r && r.passed ? `<span class="ql-badge ql-badge-ok"><i class="fas fa-check"></i> Solved · ${r.best}/100</span>` : r ? `<span class="ql-badge ql-badge-muted">${r.attempts} attempt(s)</span>` : '<span></span>'}<button class="ql-btn ql-btn-small ql-btn-primary" data-start="${c.id}">${r && r.passed ? 'Retry' : 'Start'}</button></div></div>`;
        }).join('') || '<div class="ql-empty"><i class="fas fa-trophy"></i>No challenges match this filter — great job!</div>';
        $$('[data-start]').forEach(b => b.onclick = () => startChallenge(b.dataset.start));
    }
    function startChallenge(id) {
        const ch = QL.CHALLENGES.find(c => c.id === id); if (!ch) return;
        S.challenge = ch; S.hintsUsed = 0; S.lastGrade = null; if (tutorUI) tutorUI.tutor.hintIndex[ch.id] = 0;
        if (ch.type === 'circuit') {
            switchTab('builder');
            mutate(() => { S.n = ch.qubits; S.ops = []; S.selected = null; });
        } else {
            const [fw, starter] = Object.entries(ch.starter || { qiskit: '' })[0];
            switchTab('code'); setCode(starter, fw);
        }
        renderActiveChallenge();
        QL.logActivity('challenge-start', ch.id);
        window.scrollTo({ top: $('.ql-lab-main').offsetTop - 90, behavior: 'smooth' });
    }
    function renderActiveChallenge() {
        const el = $('#active-challenge'); const ch = S.challenge;
        if (!ch) { el.innerHTML = ''; return; }
        const cons = [ch.allowed ? `only ${ch.allowed.join(', ').toUpperCase()}` : '', ch.forbidden ? `no ${ch.forbidden.join(', ').toUpperCase()}` : '', ch.maxGates != null ? `≤ ${ch.maxGates} gate(s)` : '', ch.requireMeasure ? 'must measure' : '', ch.requireLoop ? 'use a for-loop' : ''].filter(Boolean);
        el.innerHTML = `<div class="ql-active-ch"><div class="ql-row"><h4><i class="fas fa-flag-checkered"></i> ${esc(ch.title)}</h4><span class="ql-badge ql-badge-purple">${ch.points} pts</span><span class="ql-spacer"></span><button class="ql-btn ql-btn-small" id="ch-hint"><i class="fas fa-lightbulb"></i> Hint (${S.hintsUsed}/${ch.hints.length})</button><button class="ql-btn ql-btn-small ql-btn-primary" id="ch-check"><i class="fas fa-check-double"></i> Check solution</button><button class="ql-btn ql-btn-small" id="ch-exit" aria-label="Exit challenge"><i class="fas fa-xmark"></i></button></div><p style="margin:6px 0 0">${esc(ch.goal)}</p>${cons.length ? `<p class="ql-small ql-muted" style="margin-top:4px">Rules: ${esc(cons.join(' · '))}</p>` : ''}<div id="ch-hints" class="ql-small" style="margin-top:6px">${ch.hints.slice(0, S.hintsUsed).map((h, i) => `<div>💡 <b>Hint ${i + 1}:</b> ${esc(h)}</div>`).join('')}</div></div>`;
        $('#ch-exit').onclick = () => { S.challenge = null; renderActiveChallenge(); };
        $('#ch-hint').onclick = () => { if (S.hintsUsed < ch.hints.length) { S.hintsUsed++; renderActiveChallenge(); } };
        $('#ch-check').onclick = checkChallenge;
    }
    function checkChallenge() {
        const ch = S.challenge; let circ;
        if (ch.type === 'code') { parseCode(true); if (!S.codeCircuit) { QL.toast('Your code has errors — fix them first (see Problems).', 'err'); return; } circ = S.codeCircuit; }
        else circ = builderCircuit();
        const g = QL.gradeChallenge(ch, circ, { code: ch.type === 'code' ? code().value : null, hintsUsed: S.hintsUsed });
        S.lastGrade = g; QL.recordChallenge(ch, g, S.hintsUsed);
        $('#grade-body').innerHTML = `<h3>${g.passed ? '<i class="fas fa-trophy" style="color:#f5a524"></i> Challenge solved!' : '<i class="fas fa-circle-exclamation" style="color:var(--ql-err)"></i> Not solved yet'}</h3><div class="ql-row"><span class="ql-score">${g.score}</span><span class="ql-muted">/ 100 · ${esc(ch.title)}</span></div><ul class="ql-checks">${g.checks.map(c => `<li class="${c.pass ? 'pass' : 'fail'}"><i class="fas ${c.pass ? 'fa-circle-check' : 'fa-circle-xmark'}"></i> ${esc(c.label)}${c.detail ? ` <span class="ql-muted">— ${esc(c.detail)}</span>` : ''}</li>`).join('')}</ul>${g.feedback.map(f => `<p class="ql-note ${g.passed ? 'ql-note-ok' : 'ql-note-warn'}">${esc(f)}</p>`).join('')}`;
        $('#dlg-grade').showModal();
        renderChallenges();
    }

    // ------------------------------------------------------------------
    // Saved circuits
    // ------------------------------------------------------------------
    function renderSaved() {
        const q = ($('#s-search').value || '').toLowerCase();
        const all = QL.circuits.list(); $('#saved-count').textContent = all.length || '';
        const list = all.filter(e => !q || e.name.toLowerCase().includes(q) || (e.tags || []).some(t => t.toLowerCase().includes(q)) || (e.description || '').toLowerCase().includes(q));
        $('#saved-list').innerHTML = list.map(e => {
            const m = QL.metrics(e.circuit);
            return `<div class="ql-card"><div class="ql-thumb">${QL.circuitSVG(e.circuit, { cw: 30, rh: 26, params: false })}</div><div class="ql-row"><b style="color:var(--primary-purple)">${esc(e.name)}</b><span class="ql-spacer"></span><span class="ql-muted ql-small">${new Date(e.updated).toLocaleDateString()}</span></div>${e.description ? `<p class="ql-small" style="color:#555">${esc(e.description)}</p>` : ''}<div class="ql-muted ql-small">${m.qubits} qubits · ${m.gates} gates · depth ${m.depth}</div><div class="ql-row">${(e.tags || []).map(t => `<span class="ql-badge ql-badge-purple">${esc(t)}</span>`).join('')}</div><div class="ql-row"><button class="ql-btn ql-btn-small ql-btn-primary" data-open="${e.id}"><i class="fas fa-layer-group"></i> Open</button><button class="ql-btn ql-btn-small" data-code="${e.id}" title="Open as code"><i class="fas fa-code"></i></button><button class="ql-btn ql-btn-small" data-rename="${e.id}" title="Rename"><i class="fas fa-pen"></i></button><button class="ql-btn ql-btn-small" data-dup="${e.id}" title="Duplicate"><i class="fas fa-clone"></i></button><button class="ql-btn ql-btn-small" data-export="${e.id}" title="Export"><i class="fas fa-download"></i></button><button class="ql-btn ql-btn-small ql-btn-danger" data-del="${e.id}" title="Delete"><i class="fas fa-trash"></i></button></div></div>`;
        }).join('') || `<div class="ql-empty" style="grid-column:1/-1"><i class="fas fa-folder-open"></i>${all.length ? 'No circuits match your search.' : 'No saved circuits yet. Build something and press <b>Save</b> in the Circuit Builder.'}</div>`;
        const get = (id) => QL.circuits.get(id);
        $$('[data-open]').forEach(b => b.onclick = () => { const e = get(b.dataset.open); if (setBuilderCircuit(e.circuit)) { S.savedId = e.id; switchTab('builder'); QL.toast(`Opened “${esc(e.name)}”`, 'ok'); } });
        $$('[data-code]').forEach(b => b.onclick = () => { const e = get(b.dataset.code); switchTab('code'); const fw = codeFramework(); setCode(QL.generateCode(e.circuit, fw), $('#c-framework').value); });
        $$('[data-rename]').forEach(b => b.onclick = () => { const e = get(b.dataset.rename); const name = prompt('New name', e.name); if (name && name.trim()) { QL.circuits.save({ id: e.id, name: name.trim().slice(0, 80) }); renderSaved(); } });
        $$('[data-dup]').forEach(b => b.onclick = () => { const e = get(b.dataset.dup); QL.circuits.save({ name: e.name + ' (copy)', description: e.description, tags: e.tags, circuit: e.circuit }); renderSaved(); });
        $$('[data-export]').forEach(b => b.onclick = () => { const e = get(b.dataset.export); download(`${e.name.replace(/[^\w-]+/g, '_')}.json`, JSON.stringify(e, null, 2), 'application/json'); });
        $$('[data-del]').forEach(b => b.onclick = () => { const e = get(b.dataset.del); if (confirm(`Delete “${e.name}”? This cannot be undone.`)) { QL.circuits.remove(e.id); if (S.savedId === e.id) S.savedId = null; renderSaved(); } });
    }
    function bindSaved() {
        $('#s-search').addEventListener('input', renderSaved);
        $('#s-exportall').onclick = () => download('quantum_lens_circuits.json', JSON.stringify(QL.circuits.list(), null, 2), 'application/json');
        $('#s-import').addEventListener('change', async (ev) => {
            const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
            const text = await f.text(); let n = 0;
            try {
                if (/\.qasm$/i.test(f.name) || /^\s*OPENQASM/.test(text)) { const p = QL.parse(text, 'qasm'); if (p.errors.length) throw new Error(`Line ${p.errors[0].line}: ${p.errors[0].message}`); QL.circuits.save({ name: f.name.replace(/\.\w+$/, ''), description: 'Imported from OpenQASM', tags: ['imported'], circuit: p.circuit }); n = 1; }
                else {
                    const data = JSON.parse(text); const items = Array.isArray(data) ? data : [data];
                    items.forEach(it => { const circuit = it.circuit || it; if (QL.validateCircuit(circuit).length) throw new Error('File does not contain a valid Quantum Lens circuit.'); QL.circuits.save({ name: it.name || f.name.replace(/\.\w+$/, ''), description: it.description || '', tags: it.tags || ['imported'], circuit }); n++; });
                }
                QL.toast(`Imported ${n} circuit(s)`, 'ok'); renderSaved();
            } catch (e) { QL.toast('Import failed: ' + esc(e.message), 'err'); }
        });
        const dlg = $('#dlg-save');
        $('#b-save').onclick = () => {
            const existing = S.savedId && QL.circuits.get(S.savedId); const f = dlg.querySelector('form');
            f.name.value = existing ? existing.name : (S.challenge ? S.challenge.title : `My circuit ${QL.circuits.list().length + 1}`);
            f.description.value = existing ? existing.description || '' : ''; f.tags.value = existing ? (existing.tags || []).join(', ') : '';
            dlg.showModal(); f.name.select();
        };
        dlg.addEventListener('close', () => {
            if (dlg.returnValue !== 'ok') return; const f = dlg.querySelector('form');
            const e = QL.circuits.save({ id: S.savedId || undefined, name: f.name.value.trim() || 'Untitled circuit', description: f.description.value.trim(), tags: f.tags.value.split(',').map(t => t.trim()).filter(Boolean), circuit: builderCircuit() });
            S.savedId = e.id; QL.toast(`Saved “${esc(e.name)}” to My Circuits`, 'ok'); $('#saved-count').textContent = QL.circuits.list().length;
        });
    }

    // ------------------------------------------------------------------
    // Backend status
    // ------------------------------------------------------------------
    function renderBackendSelect() {
        const sel = $('#r-backend'); const cur = sel.value || QL.settings.defaultBackend || 'qiskit_aer';
        sel.innerHTML = Object.entries(QL.BACKENDS).map(([k, b]) => `<option value="${k}">${b.label} — ${k === 'browser' ? b.sub : QL.api.available(k) ? b.sub : 'browser emulation'}</option>`).join('');
        sel.value = QL.BACKENDS[cur] ? cur : 'qiskit_aer';
        const st = QL.api.status; const pill = $('#backend-pill');
        const n = Object.values(st.backends || {}).filter(b => b.available).length;
        pill.classList.toggle('on', st.connected);
        $('#backend-pill-text').textContent = !st.checked ? 'Checking backends…' : st.connected ? `Python backend connected · ${n} framework(s)` : 'Browser engine · Python backend offline';
    }
    function bindBackend() {
        const dlg = $('#dlg-backend');
        $('#backend-pill').onclick = () => {
            const st = QL.api.status; dlg.querySelector('form').url.value = QL.settings.backendUrl || '';
            $('#backend-status').innerHTML = `<table class="ql-table"><thead><tr><th>Backend</th><th>Status</th></tr></thead><tbody>${['qiskit_aer', 'pennylane', 'cirq', 'qbraid'].map(k => { const b = (st.backends || {})[k]; return `<tr><td><b>${QL.BACKENDS[k].label}</b> <span class="ql-muted ql-small">${QL.BACKENDS[k].sub}</span></td><td>${b && b.available ? `<span class="ql-badge ql-badge-ok">v${esc(b.version)}</span>` : st.connected ? `<span class="ql-badge ql-badge-err" title="${esc(b ? b.error : '')}">not installed</span>` : '<span class="ql-badge ql-badge-muted">browser emulation</span>'}</td></tr>`; }).join('')}<tr><td><b>Browser engine</b> <span class="ql-muted ql-small">JS statevector, ≤ ${QL.MAX_QUBITS} qubits</span></td><td><span class="ql-badge ql-badge-ok">always on</span></td></tr><tr><td><b>AI tutor (Claude)</b></td><td>${st.llm ? '<span class="ql-badge ql-badge-ok">enabled</span>' : '<span class="ql-badge ql-badge-muted">local engine only</span>'}</td></tr></tbody></table>`;
            dlg.showModal();
        };
        dlg.addEventListener('close', async () => { if (dlg.returnValue !== 'ok') return; QL.saveSettings({ backendUrl: dlg.querySelector('form').url.value.trim() }); $('#backend-pill-text').textContent = 'Reconnecting…'; await QL.api.detect(true); renderBackendSelect(); QL.toast(QL.api.status.connected ? 'Python backend connected' : 'Backend not reachable — using the browser engine', QL.api.status.connected ? 'ok' : 'warn'); });
        QL.on('backend', renderBackendSelect);
        $('#r-backend').addEventListener('change', () => QL.saveSettings({ defaultBackend: $('#r-backend').value }));
    }

    // ------------------------------------------------------------------
    // Misc
    // ------------------------------------------------------------------
    function download(name, text, type = 'text/plain') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
    function saveDraft() { QL.storage.set(QL.KEYS.draft, { n: S.n, ops: S.ops, code: code().value, fw: $('#c-framework').value }); }
    function loadDraft() { const d = QL.storage.get(QL.KEYS.draft, null); if (!d) return false; S.n = d.n || 2; S.ops = d.ops || []; nextId = 1 + S.ops.reduce((m, o) => Math.max(m, +String(o.id).replace('op', '') || 0), 0); if (d.code) { code().value = d.code; $('#c-framework').value = d.fw || 'auto'; parseCode(true); } return true; }

    function handleHash() {
        const h = decodeURIComponent(location.hash.slice(1)); if (!h) return false;
        const [k, v] = h.split('=');
        if (k === 'example' && QL.EXAMPLES[v]) { setBuilderCircuit(QL.EXAMPLES[v].circuit); switchTab('builder'); QL.toast(`Loaded example: ${esc(QL.EXAMPLES[v].title)}`); return true; }
        if (k === 'challenge') { startChallenge(v); return true; }
        if (k === 'circuit') { try { setBuilderCircuit(QL.decodeCircuit(v)); switchTab('builder'); QL.toast('Loaded shared circuit', 'ok'); } catch (e) { QL.toast('The shared link is invalid.', 'err'); } return true; }
        if (k === 'tab' && ['builder', 'code', 'challenges', 'saved'].includes(v)) { switchTab(v); return true; }
        return false;
    }

    let tutorUI;
    function mountTutor() {
        tutorUI = QL.mountTutor($('#tutor'), {
            getContext: () => {
                const codeActive = S.activeTab === 'code' || S.source === 'code';
                return { page: 'lab', circuit: S.source === 'code' && S.codeCircuit ? S.codeCircuit : (codeActive && S.parse && !S.codeCircuit ? S.parse.circuit : builderCircuit()), code: codeActive ? code().value : null, parse: codeActive ? S.parse : null, framework: codeFramework(), challenge: S.challenge, lastGrade: S.lastGrade, onHint: (k) => { S.hintsUsed = Math.max(S.hintsUsed, k); renderActiveChallenge(); } };
            },
            onAction: (a) => {
                if (a.type === 'loadCircuit') { if (setBuilderCircuit(a.circuit)) { switchTab('builder'); QL.toast('Loaded into the Circuit Builder', 'ok'); } }
                else if (a.type === 'loadCode') { switchTab('code'); setCode(a.code, a.framework); QL.toast('Opened in the Code Lab', 'ok'); }
                else if (a.type === 'gotoLine') gotoLine(a.line);
            }
        });
    }

    function bindToolbar() {
        $('#q-plus').onclick = () => { if (S.n >= MAX_BUILDER_QUBITS) { QL.toast(`The builder supports up to ${MAX_BUILDER_QUBITS} qubits (use the Code Lab for up to ${QL.MAX_QUBITS}).`, 'warn'); return; } mutate(() => S.n++); };
        $('#q-minus').onclick = () => {
            if (S.n <= 1) return; const last = S.n - 1; const affected = S.ops.filter(o => o.gate !== 'barrier' && QL.opQubits(o).includes(last));
            if (affected.length && !confirm(`Removing q${last} also removes ${affected.length} gate(s) on it. Continue?`)) return;
            mutate(() => { S.ops = S.ops.filter(o => !affected.includes(o)); S.n--; });
        };
        $('#b-undo').onclick = () => { if (!S.history.length) return; S.future.push(snapshot()); restore(S.history.pop()); };
        $('#b-redo').onclick = () => { if (!S.future.length) return; S.history.push(snapshot()); restore(S.future.pop()); };
        $('#b-clear').onclick = () => { if (!S.ops.length) return; mutate(() => { S.ops = []; S.selected = null; }); S.savedId = null; };
        const ex = $('#b-example'); ex.innerHTML = '<option value="">Load example…</option>' + Object.entries(QL.EXAMPLES).map(([k, e]) => `<option value="${k}">${esc(e.title)}</option>`).join('');
        ex.onchange = () => { const k = ex.value; ex.value = ''; if (k) { setBuilderCircuit(QL.EXAMPLES[k].circuit); QL.toast(esc(QL.EXAMPLES[k].desc)); } };
        $('#b-share').onclick = () => { const url = location.origin + location.pathname + '#circuit=' + QL.encodeCircuit(builderCircuit()); (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => QL.toast('Share link copied to clipboard', 'ok')).catch(() => prompt('Copy this link:', url)); };
        $('#b-tocode').onclick = () => { const fw = codeFramework(); switchTab('code'); setCode(QL.generateCode(builderCircuit(), fw), $('#c-framework').value === 'auto' ? fw : $('#c-framework').value); QL.toast(`Generated ${QL.FRAMEWORKS[fw].label} code — pick another framework to convert`, 'ok'); };
        $('#r-run').onclick = run; $('#r-compare').onclick = compareBackends;
        $('#r-step').addEventListener('input', e => { const v = +e.target.value; S.step = v >= +e.target.max ? null : v; updateResults(); if (S.source === 'builder') renderGrid(); });
        $('#prob-all').addEventListener('change', () => S.sim && renderProb(S.sim, S.simCircuit));
        $('#grade-close').onclick = () => $('#dlg-grade').close();
        $('#ch-filter').onchange = renderChallenges;
        $('#r-shots').value = QL.settings.shots || 1024;
        document.addEventListener('keydown', e => {
            const inField = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
            if (inField || S.activeTab !== 'builder') return;
            if ((e.key === 'Delete' || e.key === 'Backspace') && S.selected) { e.preventDefault(); deleteOp(S.selected); }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); $(e.shiftKey ? '#b-redo' : '#b-undo').click(); }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); $('#b-redo').click(); }
            if (e.key === 'Escape') { S.armed = null; S.selected = null; $$('.ql-gate-tile').forEach(x => x.classList.remove('armed')); hideGhost(); renderGrid(); renderInspector(); }
        });
        let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => S.sim && renderProb(S.sim, S.simCircuit), 150); });
        window.addEventListener('hashchange', handleHash);
    }

    // ------------------------------------------------------------------
    // Init
    // ------------------------------------------------------------------
    function init() {
        renderPalette(); bindGrid(); bindTabs(); bindCode(); bindSaved(); bindBackend(); bindToolbar(); mountTutor();
        const restored = loadDraft();
        if (!restored) { S.n = 2; S.ops = QL.layoutColumns(QL.EXAMPLES.bell.circuit).map(o => Object.assign({ id: newId() }, o)); code().value = QL.generateCode(QL.EXAMPLES.bell.circuit, 'qiskit'); $('#c-framework').value = 'auto'; parseCode(true); }
        renderGrid(); renderProblems(); renderBackendSelect();
        $('#saved-count').textContent = QL.circuits.list().length || '';
        renderChallenges();
        if (!handleHash()) onChange();
        QL.api.detect().then(renderBackendSelect);
    }
    init();
})();
