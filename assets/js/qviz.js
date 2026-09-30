/* =====================================================================
 * Quantum Lens — Visualisation toolkit (qviz.js)
 *  - Interactive Bloch sphere (canvas, drag to rotate, animated)
 *  - Probability / counts bar chart (SVG, hover tooltips)
 *  - State-vector table (amplitude, magnitude, phase, probability)
 *  - Static circuit diagram renderer (SVG) for lessons & thumbnails
 * No external libraries; colours come from the site palette.
 * ===================================================================== */
(function (root) {
    'use strict';
    const QL = root.QL = root.QL || {};
    const COLORS = { primary: '#260859', accent: '#3d0d8e', exact: '#5b2bb5', measured: '#1f86d9', grid: '#e6e3ee', ink: '#333', muted: '#6b6780', blue: '#4facfe' };
    QL.COLORS = COLORS;
    const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    QL.esc = esc;

    // shared tooltip
    let tip;
    function tooltip() {
        if (!tip) { tip = document.createElement('div'); tip.className = 'ql-tooltip'; tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip); }
        return tip;
    }
    function showTip(html, ev) { const t = tooltip(); t.innerHTML = html; t.style.display = 'block'; const x = ev.clientX + 14, y = ev.clientY + 14; const w = t.offsetWidth, h = t.offsetHeight; t.style.left = Math.min(x, innerWidth - w - 8) + 'px'; t.style.top = Math.min(y, innerHeight - h - 8) + 'px'; }
    function hideTip() { if (tip) tip.style.display = 'none'; }
    QL.showTip = showTip; QL.hideTip = hideTip;

    // -----------------------------------------------------------------
    // Bloch sphere
    // -----------------------------------------------------------------
    class BlochSphere {
        constructor(canvas, opts = {}) {
            this.c = canvas; this.ctx = canvas.getContext('2d');
            this.az = opts.azimuth != null ? opts.azimuth : -0.6; this.el = opts.elevation != null ? opts.elevation : 0.35;
            this.vec = { x: 0, y: 0, z: 1 }; this.target = { x: 0, y: 0, z: 1 }; this.trail = [];
            this.label = opts.label || ''; this.size = opts.size || 220;
            this.resize();
            let drag = null;
            const start = (x, y) => { drag = { x, y, az: this.az, el: this.el }; };
            const move = (x, y) => { if (!drag) return; this.az = drag.az + (x - drag.x) * 0.01; this.el = Math.max(-1.4, Math.min(1.4, drag.el + (y - drag.y) * 0.01)); this.draw(); };
            canvas.addEventListener('mousedown', e => start(e.clientX, e.clientY));
            root.addEventListener('mousemove', e => move(e.clientX, e.clientY));
            root.addEventListener('mouseup', () => drag = null);
            canvas.addEventListener('touchstart', e => { const t = e.touches[0]; start(t.clientX, t.clientY); }, { passive: true });
            canvas.addEventListener('touchmove', e => { const t = e.touches[0]; move(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
            canvas.addEventListener('touchend', () => drag = null);
            canvas.setAttribute('role', 'img');
            canvas.title = 'Drag to rotate the Bloch sphere';
            this.draw();
        }
        resize() { const d = root.devicePixelRatio || 1; this.c.width = this.size * d; this.c.height = this.size * d; this.c.style.width = this.size + 'px'; this.c.style.height = this.size + 'px'; this.ctx.setTransform(d, 0, 0, d, 0, 0); }
        set(v, opts = {}) {
            this.target = { x: v.x, y: v.y, z: v.z };
            if (opts.trail) { this.trail.push({ ...this.vec }); if (this.trail.length > 12) this.trail.shift(); } else this.trail = [];
            const from = { ...this.vec }; const t0 = performance.now(); const dur = opts.instant ? 0 : 450;
            cancelAnimationFrame(this.raf);
            const step = (now) => {
                const k = dur ? Math.min(1, (now - t0) / dur) : 1; const e = 1 - Math.pow(1 - k, 3);
                this.vec = { x: from.x + (this.target.x - from.x) * e, y: from.y + (this.target.y - from.y) * e, z: from.z + (this.target.z - from.z) * e };
                this.draw(); if (k < 1) this.raf = requestAnimationFrame(step);
            };
            this.raf = requestAnimationFrame(step);
            const len = Math.hypot(v.x, v.y, v.z);
            this.c.setAttribute('aria-label', `Bloch vector x=${v.x.toFixed(2)}, y=${v.y.toFixed(2)}, z=${v.z.toFixed(2)}, length ${len.toFixed(2)}`);
        }
        project(p) {
            // physics axes: z up, x toward viewer-left, y right
            const ca = Math.cos(this.az), sa = Math.sin(this.az), ce = Math.cos(this.el), se = Math.sin(this.el);
            const X = p.y * ca - p.x * sa; const Yd = p.y * sa + p.x * ca; // depth
            const Y = p.z * ce - Yd * se; const D = p.z * se + Yd * ce;
            const R = this.size * 0.36, cx = this.size / 2, cy = this.size / 2 + 6;
            return { x: cx + X * R, y: cy - Y * R, d: D };
        }
        draw() {
            const ctx = this.ctx, s = this.size; ctx.clearRect(0, 0, s, s);
            const R = s * 0.36, cx = s / 2, cy = s / 2 + 6;
            const g = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
            g.addColorStop(0, 'rgba(79,172,254,0.16)'); g.addColorStop(1, 'rgba(38,8,89,0.10)');
            ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = 'rgba(38,8,89,0.35)'; ctx.lineWidth = 1; ctx.stroke();
            const circle = (fn, dashedBack) => { const pts = []; for (let i = 0; i <= 72; i++) pts.push(this.project(fn(i / 72 * 2 * Math.PI))); for (let i = 0; i < pts.length - 1; i++) { ctx.beginPath(); ctx.setLineDash(pts[i].d < 0 && dashedBack ? [3, 3] : []); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[i + 1].x, pts[i + 1].y); ctx.strokeStyle = pts[i].d < 0 ? 'rgba(38,8,89,0.15)' : 'rgba(38,8,89,0.35)'; ctx.stroke(); } ctx.setLineDash([]); };
            circle(t => ({ x: Math.cos(t), y: Math.sin(t), z: 0 }), true);
            circle(t => ({ x: Math.cos(t), y: 0, z: Math.sin(t) }), true);
            circle(t => ({ x: 0, y: Math.cos(t), z: Math.sin(t) }), true);
            const axes = [[{ x: 0, y: 0, z: 1.18 }, '|0⟩'], [{ x: 0, y: 0, z: -1.18 }, '|1⟩'], [{ x: 1.22, y: 0, z: 0 }, '|+⟩'], [{ x: -1.22, y: 0, z: 0 }, '|−⟩'], [{ x: 0, y: 1.22, z: 0 }, '|i⟩'], [{ x: 0, y: -1.22, z: 0 }, '|−i⟩']];
            ctx.font = '600 11px "Open Sans", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            axes.forEach(([p, l]) => { const o = this.project({ x: 0, y: 0, z: 0 }), q = this.project({ x: p.x / 1.2, y: p.y / 1.2, z: p.z / 1.2 }); ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(q.x, q.y); ctx.strokeStyle = 'rgba(38,8,89,0.22)'; ctx.stroke(); const t = this.project(p); ctx.fillStyle = t.d < -0.3 ? 'rgba(51,51,51,0.45)' : '#333'; ctx.fillText(l, t.x, t.y); });
            // trail
            this.trail.forEach((v, i) => { const p = this.project(v); ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, 7); ctx.fillStyle = `rgba(79,172,254,${0.15 + 0.5 * i / this.trail.length})`; ctx.fill(); });
            // vector
            const o = this.project({ x: 0, y: 0, z: 0 }), v = this.project(this.vec); const len = Math.hypot(this.vec.x, this.vec.y, this.vec.z);
            ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(v.x, v.y); ctx.strokeStyle = COLORS.accent; ctx.lineWidth = 3; ctx.stroke(); ctx.lineWidth = 1;
            const ang = Math.atan2(v.y - o.y, v.x - o.x);
            if (len > 0.08) { ctx.beginPath(); ctx.moveTo(v.x, v.y); ctx.lineTo(v.x - 10 * Math.cos(ang - 0.4), v.y - 10 * Math.sin(ang - 0.4)); ctx.lineTo(v.x - 10 * Math.cos(ang + 0.4), v.y - 10 * Math.sin(ang + 0.4)); ctx.closePath(); ctx.fillStyle = COLORS.accent; ctx.fill(); }
            ctx.beginPath(); ctx.arc(v.x, v.y, 5, 0, 7); ctx.fillStyle = COLORS.blue; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1;
            if (this.label) { ctx.textAlign = 'left'; ctx.font = '700 12px "Open Sans", sans-serif'; ctx.fillStyle = COLORS.primary; ctx.fillText(this.label, 8, 12); }
        }
    }
    QL.BlochSphere = BlochSphere;

    // -----------------------------------------------------------------
    // Bar chart (probabilities, counts, comparisons). Single axis, hover tooltips.
    //   series: [{ name, color, values: {label: value} }]
    // -----------------------------------------------------------------
    function barChart(el, series, opts = {}) {
        const labels = opts.labels || [...new Set(series.flatMap(s => Object.keys(s.values)))].sort();
        const W = Math.max(opts.minWidth || 300, el.clientWidth || 600), H = opts.height || 240;
        const m = { l: 44, r: 12, t: 12, b: labels.length > 16 ? 58 : 40 };
        const iw = W - m.l - m.r, ih = H - m.t - m.b;
        const dmax = Math.max(1e-9, ...series.flatMap(s => labels.map(l => s.values[l] || 0)));
        const max = opts.max || (opts.format ? dmax * 1.08 : Math.min(1, Math.ceil(dmax * 1.08 * 20) / 20)); // probabilities: round up to 5%, never above 100%
        const fmt = opts.format || (v => (v * 100).toFixed(1) + '%');
        const group = iw / Math.max(1, labels.length); const gap = 2; const inner = Math.min(46, group * 0.78);
        const bw = Math.max(2, (inner - gap * (series.length - 1)) / series.length);
        let svg = `<svg class="ql-chart" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="${esc(opts.title || 'Bar chart')}">`;
        const ticks = 4; for (let i = 0; i <= ticks; i++) { const v = max * i / ticks; const y = m.t + ih - ih * i / ticks; svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}" stroke="${COLORS.grid}" stroke-width="1"/><text x="${m.l - 6}" y="${y + 4}" text-anchor="end" class="ql-axis">${esc(opts.tickFormat ? opts.tickFormat(v) : fmt(v))}</text>`; }
        labels.forEach((lab, i) => {
            const gx = m.l + i * group + (group - inner) / 2;
            series.forEach((s, k) => {
                const v = s.values[lab] || 0; const h = Math.max(v > 0 ? 1.5 : 0, ih * v / max); const x = gx + k * (bw + gap); const y = m.t + ih - h;
                const r = Math.min(4, bw / 2, h);
                const path = h > 0 ? `M${x},${m.t + ih} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + bw - r},${y} Q${x + bw},${y} ${x + bw},${y + r} L${x + bw},${m.t + ih} Z` : '';
                svg += `<path d="${path}" fill="${s.color}"/>`;
            });
            svg += `<rect class="ql-hit" data-i="${i}" x="${m.l + i * group}" y="${m.t}" width="${group}" height="${ih}" fill="transparent"/>`;
            const lx = m.l + i * group + group / 2;
            if (labels.length <= 32 || i % Math.ceil(labels.length / 32) === 0) svg += labels.length > 16 ? `<text transform="translate(${lx},${m.t + ih + 8}) rotate(-60)" text-anchor="end" class="ql-axis ql-mono">${esc(lab)}</text>` : `<text x="${lx}" y="${m.t + ih + 16}" text-anchor="middle" class="ql-axis ql-mono">${esc(opts.labelPrefix || '')}${esc(lab)}${esc(opts.labelSuffix || '')}</text>`;
        });
        svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${m.t + ih}" y2="${m.t + ih}" stroke="#b9b4c9"/>`;
        svg += '</svg>';
        let legend = '';
        if (series.length > 1) legend = `<div class="ql-legend">${series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>`;
        el.innerHTML = legend + svg;
        el.querySelectorAll('.ql-hit').forEach(r => {
            r.addEventListener('mousemove', ev => { const lab = labels[+r.dataset.i]; showTip(`<b class="ql-mono">${esc(opts.labelPrefix || '')}${esc(lab)}${esc(opts.labelSuffix || '')}</b>${series.map(s => `<div><i style="background:${s.color}"></i>${esc(s.name)}: <b>${esc((s.format || fmt)(s.values[lab] || 0))}</b></div>`).join('')}`, ev); r.setAttribute('fill', 'rgba(38,8,89,0.05)'); });
            r.addEventListener('mouseleave', () => { hideTip(); r.setAttribute('fill', 'transparent'); });
        });
    }
    QL.barChart = barChart;

    // -----------------------------------------------------------------
    // State-vector table
    // -----------------------------------------------------------------
    function phaseColor(ph) { return `hsl(${((ph * 180 / Math.PI) + 360) % 360}, 70%, 50%)`; }
    function fmtC(re, im) {
        const r = Math.abs(re) < 5e-7 ? 0 : re, i = Math.abs(im) < 5e-7 ? 0 : im;
        if (!i) return r.toFixed(4); if (!r) return `${i.toFixed(4)}i`;
        return `${r.toFixed(4)} ${i < 0 ? '−' : '+'} ${Math.abs(i).toFixed(4)}i`;
    }
    QL.fmtComplex = fmtC;
    function stateTable(el, amps, n, opts = {}) {
        const rows = amps.map((a, i) => ({ i, a, p: a[0] ** 2 + a[1] ** 2 })).filter(r => opts.showZero || r.p > 1e-10);
        const limit = opts.limit || 64; const shown = rows.slice(0, limit);
        el.innerHTML = `<div class="ql-table-wrap"><table class="ql-table"><thead><tr><th>Basis state</th><th>Amplitude</th><th>|amp|</th><th>Phase</th><th>Probability</th></tr></thead><tbody>${shown.map(r => {
            const ph = Math.atan2(r.a[1], r.a[0]); const deg = Math.round(ph * 180 / Math.PI);
            return `<tr><td class="ql-mono">|${QL.basisLabel(r.i, n)}⟩</td><td class="ql-mono">${fmtC(r.a[0], r.a[1])}</td><td class="ql-mono">${Math.sqrt(r.p).toFixed(4)}</td><td><span class="ql-phase" style="--ph:${deg}deg;background:${phaseColor(ph)}" title="phase ${deg}°"></span> ${deg}°</td><td><div class="ql-pbar"><span style="width:${(r.p * 100).toFixed(2)}%"></span></div><span class="ql-mono">${(r.p * 100).toFixed(2)}%</span></td></tr>`;
        }).join('')}</tbody></table></div>${rows.length > limit ? `<p class="ql-muted">Showing ${limit} of ${rows.length} non-zero amplitudes.</p>` : ''}<p class="ql-muted ql-small">Bit order: right-most bit is q0 (Qiskit convention). Zero amplitudes are hidden.</p>`;
    }
    QL.stateTable = stateTable;

    // -----------------------------------------------------------------
    // Static circuit diagram (SVG)
    // -----------------------------------------------------------------
    function circuitSVG(circuit, opts = {}) {
        const laid = QL.layoutColumns(circuit); const n = circuit.numQubits;
        const cols = Math.max(1, ...laid.map(o => o.col + 1));
        const CW = opts.cw || 46, RH = opts.rh || 40, L = 38, T = 14;
        const W = L + cols * CW + 20, H = T + n * RH;
        let s = `<svg class="ql-circuit-svg" viewBox="0 0 ${W} ${H}" width="${opts.fit ? '100%' : W}" height="${opts.fit ? 'auto' : H}" role="img" aria-label="Circuit diagram with ${n} qubits and ${circuit.ops.length} operations">`;
        for (let q = 0; q < n; q++) { const y = T + q * RH + RH / 2 - 6; s += `<text x="4" y="${y + 4}" class="ql-wire-label">q${q}</text><line x1="${L - 6}" x2="${W - 6}" y1="${y}" y2="${y}" stroke="#9c93b5" stroke-width="1.2"/>`; }
        const yq = q => T + q * RH + RH / 2 - 6;
        laid.forEach(op => {
            const g = QL.GATES[op.gate]; const x = L + op.col * CW + CW / 2;
            if (op.gate === 'barrier') { s += `<line x1="${x}" x2="${x}" y1="${T}" y2="${H - 6}" stroke="#9aa5b1" stroke-dasharray="4 3"/>`; return; }
            const qs = QL.opQubits(op);
            if (qs.length > 1) s += `<line x1="${x}" x2="${x}" y1="${yq(Math.min(...qs))}" y2="${yq(Math.max(...qs))}" stroke="${COLORS.primary}" stroke-width="2"/>`;
            (op.controls || []).forEach(c => s += `<circle cx="${x}" cy="${yq(c)}" r="5" fill="${COLORS.primary}"/>`);
            op.targets.forEach(t => {
                const y = yq(t);
                if ((op.gate === 'cx' || op.gate === 'ccx')) s += `<circle cx="${x}" cy="${y}" r="10" fill="#fff" stroke="${COLORS.primary}" stroke-width="2"/><line x1="${x - 10}" x2="${x + 10}" y1="${y}" y2="${y}" stroke="${COLORS.primary}" stroke-width="2"/><line x1="${x}" x2="${x}" y1="${y - 10}" y2="${y + 10}" stroke="${COLORS.primary}" stroke-width="2"/>`;
                else if (op.gate === 'swap' || op.gate === 'cswap') s += `<path d="M${x - 6},${y - 6}L${x + 6},${y + 6}M${x + 6},${y - 6}L${x - 6},${y + 6}" stroke="${COLORS.primary}" stroke-width="2"/>`;
                else if (op.gate === 'cz') s += `<circle cx="${x}" cy="${y}" r="5" fill="${COLORS.primary}"/>`;
                else {
                    const lab = op.gate === 'measure' ? 'M' : g.label; const col = g.category === 'multi' ? COLORS.primary : g.color;
                    s += `<rect x="${x - 15}" y="${y - 14}" width="30" height="28" rx="5" fill="${col}"/><text x="${x}" y="${y + 4}" text-anchor="middle" class="ql-gate-text">${esc(lab)}</text>`;
                    if (op.params && op.params.length && opts.params !== false) s += `<text x="${x}" y="${y + 24}" text-anchor="middle" class="ql-param-text">${esc(QL.fmtAngleHuman(op.params[0]))}</text>`;
                }
            });
        });
        return s + '</svg>';
    }
    QL.circuitSVG = circuitSVG;

    // Toasts
    QL.toast = (msg, kind = 'info') => {
        let box = document.querySelector('.ql-toasts'); if (!box) { box = document.createElement('div'); box.className = 'ql-toasts'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
        const t = document.createElement('div'); t.className = `ql-toast ql-toast-${kind}`; t.innerHTML = msg; box.appendChild(t);
        setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, 3800);
    };

    // Minimal markdown for tutor answers (bold, code, lists, paragraphs)
    QL.md = (text) => {
        const blocks = String(text).split(/```(\w*)\n?([\s\S]*?)```/g); let html = '';
        for (let i = 0; i < blocks.length; i++) {
            if (i % 3 === 1) continue;
            if (i % 3 === 2) { html += `<pre class="ql-code"><button class="ql-copy" type="button" title="Copy code"><i class="fas fa-copy"></i></button><code>${esc(blocks[i].replace(/\n$/, ''))}</code></pre>`; continue; }
            const paras = blocks[i].trim().split(/\n{2,}/);
            paras.forEach(p => {
                if (!p.trim()) return;
                const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\[([^\]]+)\]\((https?:[^)]+|[\w.-]+\.html[^)]*)\)/g, '<a href="$2">$1</a>');
                if (/^\s*[-•*] /m.test(p) && p.split('\n').every(l => /^\s*[-•*] /.test(l) || !l.trim())) html += `<ul>${p.split('\n').filter(l => l.trim()).map(l => `<li>${inline(l.replace(/^\s*[-•*] /, ''))}</li>`).join('')}</ul>`;
                else if (/^\s*\d+\. /.test(p)) html += `<ol>${p.split('\n').filter(l => l.trim()).map(l => `<li>${inline(l.replace(/^\s*\d+\. /, ''))}</li>`).join('')}</ol>`;
                else html += `<p>${inline(p).replace(/\n/g, '<br>')}</p>`;
            });
        }
        return html;
    };
    document.addEventListener('click', (e) => {
        const b = e.target.closest && e.target.closest('.ql-copy'); if (!b) return;
        const code = b.parentElement.querySelector('code').textContent;
        (navigator.clipboard ? navigator.clipboard.writeText(code) : Promise.reject()).then(() => QL.toast('Code copied to clipboard', 'ok')).catch(() => QL.toast('Select the code and copy it manually', 'warn'));
    });
})(typeof window !== 'undefined' ? window : globalThis);
