/* =====================================================================
 * Quantum Lens — Multi-framework code parser (qparser.js)
 * ---------------------------------------------------------------------
 * Converts OpenQASM 2/3, Qiskit, Cirq, PennyLane and qBraid programs
 * into the shared circuit IR so they can be simulated, visualised and
 * loaded into the drag-and-drop builder. It understands the common
 * subset used in learning material: variables, numpy/math constants,
 * `for ... in range(...)` loops, registers and broadcasting.
 * Every problem is reported with a line number and a fix hint so the
 * AI tutor can use it for debugging.
 * ===================================================================== */
(function (root) {
    'use strict';
    const QL = root.QL = root.QL || {};

    class ParseError extends Error { constructor(msg, line, hint) { super(msg); this.line = line; this.hint = hint; } }

    // -----------------------------------------------------------------
    // Tiny expression language (Python/QASM-flavoured)
    // -----------------------------------------------------------------
    const CONSTS = { pi: Math.PI, 'np.pi': Math.PI, 'math.pi': Math.PI, 'numpy.pi': Math.PI, 'π': Math.PI, 'pnp.pi': Math.PI, e: Math.E, 'np.e': Math.E, 'math.e': Math.E, tau: 2 * Math.PI, 'math.tau': 2 * Math.PI, True: 1, False: 0 };
    const FUNCS = {
        sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp, log: Math.log, abs: Math.abs,
        arcsin: Math.asin, arccos: Math.acos, arctan: Math.atan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
        int: Math.trunc, float: Number, round: Math.round,
        range: (a, b, s) => { if (b === undefined) { b = a; a = 0; } s = s || 1; const r = []; for (let i = a; s > 0 ? i < b : i > b; i += s) r.push(i); return r; },
        list: (x) => Array.isArray(x) ? x.slice() : [x], len: (x) => Array.isArray(x) ? x.length : (x && x.size) || 0,
        reversed: (x) => x.slice().reverse()
    };

    function tokenize(src) {
        const toks = []; let i = 0;
        while (i < src.length) {
            const ch = src[i];
            if (/\s/.test(ch)) { i++; continue; }
            if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] || ''))) {
                const m = /^(\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?)j?/.exec(src.slice(i));
                if (m) { toks.push({ t: 'num', v: parseFloat(m[1]) }); i += m[0].length; continue; }
            }
            if (/[A-Za-z_π]/.test(ch)) {
                const m = /^[A-Za-z_π][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/.exec(src.slice(i));
                toks.push({ t: 'name', v: m[0] }); i += m[0].length; continue;
            }
            if (ch === '"' || ch === "'") {
                let j = i + 1; while (j < src.length && src[j] !== ch) j++;
                toks.push({ t: 'str', v: src.slice(i + 1, j) }); i = j + 1; continue;
            }
            const two = src.slice(i, i + 2);
            if (two === '**' || two === '//') { toks.push({ t: 'op', v: two }); i += 2; continue; }
            if ('+-*/%()[],=^'.includes(ch)) { toks.push({ t: 'op', v: ch }); i++; continue; }
            throw new Error(`Unexpected character "${ch}"`);
        }
        return toks;
    }

    function evaluate(src, env) {
        const toks = tokenize(String(src)); let p = 0;
        const peek = () => toks[p]; const next = () => toks[p++];
        const expect = (v) => { const t = next(); if (!t || t.v !== v) throw new Error(`Expected "${v}"`); };
        function primary() {
            const t = next();
            if (!t) throw new Error('Unexpected end of expression');
            if (t.t === 'num') return t.v;
            if (t.t === 'str') return t.v;
            if (t.t === 'op' && t.v === '(') { const v = expr(); expect(')'); return v; }
            if (t.t === 'op' && t.v === '[') {
                const arr = []; if (peek() && peek().v === ']') { next(); return arr; }
                do { arr.push(expr()); } while (peek() && peek().v === ',' && next());
                expect(']'); return arr;
            }
            if (t.t === 'name') {
                let name = t.v; let val;
                const short = name.replace(/^(np|numpy|math|pnp)\./, '');
                if (peek() && peek().v === '(') {
                    next(); const args = [];
                    if (peek() && peek().v !== ')') { do { args.push(expr()); } while (peek() && peek().v === ',' && next()); }
                    expect(')');
                    const f = FUNCS[short] || FUNCS[name];
                    if (!f) throw new Error(`Unknown function "${name}"`);
                    val = f(...args);
                } else if (env && Object.prototype.hasOwnProperty.call(env, name)) val = env[name];
                else if (name in CONSTS) val = CONSTS[name];
                else throw new Error(`Unknown name "${name}"`);
                while (peek() && peek().v === '[') {
                    next(); const idx = expr(); expect(']');
                    if (val && val.type === 'qreg') { const k = idx < 0 ? val.size + idx : idx; if (k < 0 || k >= val.size) throw new Error(`Index ${idx} is out of range for register "${name}" of size ${val.size}`); val = { type: 'qubit', index: val.offset + k }; }
                    else if (Array.isArray(val)) { const k = idx < 0 ? val.length + idx : idx; if (k < 0 || k >= val.length) throw new Error(`Index ${idx} out of range`); val = val[k]; }
                    else throw new Error(`"${name}" cannot be indexed`);
                }
                return val;
            }
            throw new Error(`Unexpected "${t.v}"`);
        }
        function unary() { const t = peek(); if (t && t.t === 'op' && (t.v === '-' || t.v === '+')) { next(); const v = unary(); return t.v === '-' ? -v : v; } return power(); }
        function power() { const b = primary(); if (peek() && (peek().v === '**' || peek().v === '^')) { next(); return Math.pow(b, unary()); } return b; }
        function term() { let v = unary(); while (peek() && ['*', '/', '//', '%'].includes(peek().v)) { const o = next().v; const r = unary(); v = o === '*' ? v * r : o === '/' ? v / r : o === '//' ? Math.floor(v / r) : v % r; } return v; }
        function expr() { let v = term(); while (peek() && (peek().v === '+' || peek().v === '-')) { const o = next().v; const r = term(); v = o === '+' ? v + r : v - r; } return v; }
        const v = expr(); if (p < toks.length) throw new Error(`Unexpected "${toks[p].v}"`); return v;
    }
    QL.evaluate = evaluate;

    /** Split a call argument string on top-level commas; returns {pos:[], kw:{}} */
    function splitArgs(s) {
        const parts = []; let depth = 0, cur = '', q = null;
        for (const ch of s) {
            if (q) { cur += ch; if (ch === q) q = null; continue; }
            if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
            if ('([{'.includes(ch)) depth++; if (')]}'.includes(ch)) depth--;
            if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; } else cur += ch;
        }
        if (cur.trim()) parts.push(cur.trim());
        const pos = [], kw = {};
        parts.forEach(pt => { const m = /^([A-Za-z_]\w*)\s*=(?!=)\s*([\s\S]+)$/.exec(pt); if (m) kw[m[1]] = m[2]; else pos.push(pt); });
        return { pos, kw };
    }
    /** Find matching close paren starting at index of '(' */
    function matchParen(s, i) { let d = 0, q = null; for (let k = i; k < s.length; k++) { const ch = s[k]; if (q) { if (ch === q) q = null; continue; } if (ch === '"' || ch === "'") { q = ch; continue; } if (ch === '(' || ch === '[') d++; else if (ch === ')' || ch === ']') { d--; if (d === 0) return k; } } return -1; }

    function toQubitList(v, what) {
        if (typeof v === 'number') { if (!Number.isInteger(v)) throw new Error(`${what} must be an integer qubit index`); return [v]; }
        if (v && v.type === 'qubit') return [v.index];
        if (v && v.type === 'qreg') return [...Array(v.size).keys()].map(k => v.offset + k);
        if (Array.isArray(v)) return v.flatMap(x => toQubitList(x, what));
        throw new Error(`Could not understand ${what}`);
    }

    // -----------------------------------------------------------------
    // Python pre-processing: comments, continuation lines, loops
    // -----------------------------------------------------------------
    function pythonLines(code) {
        const raw = code.replace(/\r/g, '').split('\n');
        const out = []; let buf = '', startLine = 0, depth = 0, indent = 0;
        raw.forEach((line, idx) => {
            let s = ''; let q = null;
            for (const ch of line) { if (q) { s += ch; if (ch === q) q = null; continue; } if (ch === '"' || ch === "'") { q = ch; s += ch; continue; } if (ch === '#') break; s += ch; }
            if (!buf) { startLine = idx + 1; indent = (/^\s*/.exec(s)[0].replace(/\t/g, '    ')).length; }
            buf += (buf ? ' ' : '') + s.trim();
            for (const ch of s) { if ('([{'.includes(ch)) depth++; if (')]}'.includes(ch)) depth--; }
            if (depth <= 0 && !/\\$/.test(buf)) { if (buf.trim()) out.push({ text: buf.trim(), line: startLine, indent }); buf = ''; depth = 0; }
            else buf = buf.replace(/\\$/, '');
        });
        if (buf.trim()) out.push({ text: buf.trim(), line: startLine, indent });
        return out;
    }

    /** Execute python-ish lines, expanding for-loops; calls handler(stmt, env) for each simple statement */
    function runPython(lines, env, handler, errors) {
        function block(start, parentIndent) { let i = start; const body = []; while (i < lines.length && lines[i].indent > parentIndent) { body.push(lines[i]); i++; } return { body, end: i }; }
        function exec(ls) {
            let i = 0;
            while (i < ls.length) {
                const L = ls[i];
                const mFor = /^for\s+([A-Za-z_]\w*)\s+in\s+(.+):$/.exec(L.text);
                if (mFor) {
                    const { body, end } = block(i + 1, L.indent);
                    let it;
                    try { it = evaluate(mFor[2], env); if (it && it.type === 'qreg') it = toQubitList(it); if (!Array.isArray(it)) throw new Error('loop target is not iterable'); }
                    catch (e) { errors.push({ line: L.line, message: `Could not evaluate loop "${mFor[2]}": ${e.message}`, hint: 'Loops over range(...), lists or qubit registers are supported.' }); i = end; continue; }
                    if (it.length > 256) { errors.push({ line: L.line, message: 'Loop is too long for the learning simulator (max 256 iterations).' }); i = end; continue; }
                    const saved = env[mFor[1]];
                    it.forEach(v => { env[mFor[1]] = v; exec(body); });
                    if (saved === undefined) delete env[mFor[1]]; else env[mFor[1]] = saved;
                    i = end; continue;
                }
                if (/^(if|elif|else|while|with|try|except|finally|class)\b.*:$/.test(L.text)) {
                    const kw = L.text.split(/\s|:/)[0];
                    if (kw === 'with' || kw === 'try' || kw === 'finally') { i++; continue; } // transparent
                    const { end } = block(i + 1, L.indent);
                    if (kw !== 'else' && kw !== 'except' && kw !== 'elif') errors.push({ line: L.line, message: `"${kw}" blocks are not executed by the in-browser parser — their contents were skipped.`, hint: 'Unroll the logic or run on the Python backend.', severity: 'warning' });
                    i = end; continue;
                }
                if (/^(def)\s+/.test(L.text) || /^@/.test(L.text)) { i++; continue; } // function bodies are executed inline
                handler(L, env);
                i++;
            }
        }
        exec(lines);
    }

    function tryAssign(L, env) {
        const m = /^([A-Za-z_]\w*)\s*=(?!=)\s*(.+)$/.exec(L.text);
        if (!m) return false;
        try { const v = evaluate(m[2], env); if (typeof v === 'number' || Array.isArray(v)) { env[m[1]] = v; return true; } } catch (e) { /* not a numeric assignment */ }
        return false;
    }

    // -----------------------------------------------------------------
    // QASM (2.0 + common 3.0 syntax)
    // -----------------------------------------------------------------
    const QASM_ALIASES = { cnot: 'cx', CX: 'cx', u1: 'p', phase: 'p', u3: 'u', U: 'u', cu1: 'cp', cphase: 'cp', toffoli: 'ccx', fredkin: 'cswap', i: 'id' };

    function parseQASM(code, baseLine = 0) {
        const errors = [], warnings = []; const regs = {}; const cregs = {}; let nq = 0; const ops = [];
        const src = code.replace(/\r/g, '').replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length)).replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
        let pos = 0; const stmts = [];
        src.split(';').forEach(chunk => { const lead = chunk.length - chunk.trimStart().length; const line = src.slice(0, pos + lead).split('\n').length + baseLine; stmts.push({ text: chunk.trim(), line }); pos += chunk.length + 1; });
        const env = {};
        const qargs = (s, line) => s.split(',').map(a => a.trim()).filter(Boolean).map(a => {
            const m = /^([A-Za-z_]\w*)(?:\[(\d+)\])?$/.exec(a);
            if (!m || !regs[m[1]]) throw new ParseError(`Unknown qubit "${a}"`, line, 'Declare it first, e.g. "qreg q[2];" (QASM 2) or "qubit[2] q;" (QASM 3).');
            const r = regs[m[1]];
            if (m[2] === undefined) return [...Array(r.size).keys()].map(k => r.offset + k);
            const k = +m[2]; if (k >= r.size) throw new ParseError(`Index ${k} is out of range for register ${m[1]}[${r.size}]`, line, `Valid indices are 0–${r.size - 1}.`);
            return [r.offset + k];
        });
        stmts.forEach(({ text, line }) => {
            if (!text) return;
            try {
                let m;
                if (/^OPENQASM\s/.test(text) || /^include\s/.test(text)) return;
                if ((m = /^qreg\s+([A-Za-z_]\w*)\s*\[\s*(\d+)\s*\]$/.exec(text)) || (m = /^qubit\s*\[\s*(\d+)\s*\]\s*([A-Za-z_]\w*)$/.exec(text))) {
                    const [name, size] = /^qreg/.test(text) ? [m[1], +m[2]] : [m[2], +m[1]];
                    regs[name] = { type: 'qreg', offset: nq, size }; nq += size; env[name] = regs[name]; return;
                }
                if ((m = /^qubit\s+([A-Za-z_]\w*)$/.exec(text))) { regs[m[1]] = { type: 'qreg', offset: nq, size: 1 }; nq += 1; return; }
                if ((m = /^creg\s+([A-Za-z_]\w*)\s*\[\s*(\d+)\s*\]$/.exec(text)) || (m = /^bit\s*\[\s*(\d+)\s*\]\s*([A-Za-z_]\w*)$/.exec(text))) { cregs[/^creg/.test(text) ? m[1] : m[2]] = true; return; }
                if (/^gate\s/.test(text) || /^opaque\s/.test(text)) throw new ParseError('Custom gate definitions are not supported by the in-browser parser.', line, 'Inline the gate body, or run the program on the Python backend.');
                if (/^if\s*\(/.test(text)) throw new ParseError('Classically-controlled operations (if) are not supported in the learning simulator.', line, 'Remove the condition or use the Python backend.');
                if ((m = /^measure\s+(.+?)\s*->\s*(.+)$/.exec(text)) || (m = /^(?:[A-Za-z_]\w*(?:\[\d+\])?)\s*=\s*measure\s+(.+)$/.exec(text))) {
                    qargs(m[1], line).flat().forEach(q => ops.push({ gate: 'measure', targets: [q], controls: [], params: [], line })); return;
                }
                if ((m = /^barrier\b(.*)$/.exec(text))) { ops.push({ gate: 'barrier', targets: [], controls: [], params: [], line }); return; }
                if ((m = /^reset\s+(.+)$/.exec(text))) { qargs(m[1], line).flat().forEach(q => ops.push({ gate: 'reset', targets: [q], controls: [], params: [], line })); return; }
                m = /^([A-Za-z_]\w*)\s*(?:\(([^)]*)\))?\s+(.+)$/.exec(text);
                if (!m) throw new ParseError(`Could not understand "${text}"`, line, 'Statements look like: "h q[0];", "cx q[0],q[1];", "rz(pi/2) q[1];"');
                let name = QASM_ALIASES[m[1]] || m[1];
                let params = m[2] ? splitArgs(m[2]).pos.map(e => { try { return evaluate(e, env); } catch (err) { throw new ParseError(`Bad parameter "${e}": ${err.message}`, line, 'Use numbers and pi, e.g. rz(pi/4) q[0];'); } }) : [];
                if (name === 'u2') { name = 'u'; params = [Math.PI / 2, params[0], params[1]]; }
                const g = QL.GATES[name];
                if (!g || g.category === 'special') throw new ParseError(`Unsupported gate "${m[1]}"`, line, `Supported: ${Object.keys(QL.GATES).filter(k => QL.GATES[k].category !== 'special').join(', ')}.`);
                if (params.length !== g.params.length) throw new ParseError(`${g.title} expects ${g.params.length} parameter(s) but got ${params.length}`, line, g.params.length ? `Example: ${name}(pi/2) q[0];` : `Example: ${name} ${'q[0]'.repeat(1)};`);
                const lists = qargs(m[3], line);
                const need = g.nC + g.nT;
                if (lists.length !== need) throw new ParseError(`${g.title} acts on ${need} qubit(s) but ${lists.length} were given`, line, need === 2 ? `Example: ${name} q[0],q[1];` : undefined);
                const width = Math.max(...lists.map(l => l.length));
                for (let k = 0; k < width; k++) {
                    const qs = lists.map(l => l.length === 1 ? l[0] : l[k]);
                    ops.push({ gate: name, controls: qs.slice(0, g.nC), targets: qs.slice(g.nC), params: params.slice(), line });
                }
            } catch (e) {
                errors.push({ line: e.line || line, message: e.message, hint: e.hint });
            }
        });
        if (!nq && !errors.length) errors.push({ line: 1 + baseLine, message: 'No quantum register declared.', hint: 'Add "qreg q[2];" after the include line.' });
        return { circuit: { numQubits: nq, ops }, errors, warnings };
    }

    // -----------------------------------------------------------------
    // Qiskit
    // -----------------------------------------------------------------
    const QISKIT_MAP = { h: 'h', x: 'x', y: 'y', z: 'z', s: 's', sdg: 'sdg', t: 't', tdg: 'tdg', sx: 'sx', id: 'id', i: 'id', rx: 'rx', ry: 'ry', rz: 'rz', p: 'p', u1: 'p', u: 'u', u3: 'u', cx: 'cx', cnot: 'cx', cy: 'cy', cz: 'cz', ch: 'ch', cp: 'cp', cu1: 'cp', crx: 'crx', cry: 'cry', crz: 'crz', ccx: 'ccx', toffoli: 'ccx', swap: 'swap', cswap: 'cswap', fredkin: 'cswap', reset: 'reset' };
    const QISKIT_IGNORE = new Set(['draw', 'save_statevector', 'save_probabilities', 'save_counts', 'remove_final_measurements', 'decompose', 'depth', 'size', 'count_ops', 'copy', 'name', 'qasm', 'num_qubits', 'width', 'inverse', 'to_gate', 'assign_parameters', 'bind_parameters']);

    function parseQiskit(code) {
        const errors = [], warnings = []; const ops = []; let nq = 0; const env = {}; let cvar = null;
        if (/\bexecute\s*\(/.test(code)) warnings.push({ line: lineOf(code, /\bexecute\s*\(/), message: '`execute()` was removed in Qiskit 1.0.', hint: 'Use: sim = AerSimulator(); sim.run(transpile(qc, sim), shots=1024).result()' });
        if (/from\s+qiskit\s+import\s+[^\n]*\bAer\b/.test(code)) warnings.push({ line: lineOf(code, /from\s+qiskit\s+import\s+[^\n]*\bAer\b/), message: '`from qiskit import Aer` no longer works in Qiskit ≥ 1.0.', hint: 'Install qiskit-aer and use: from qiskit_aer import AerSimulator' });
        if (/\bnp\./.test(code) && !/import\s+numpy(\s+as\s+np)?/.test(code)) warnings.push({ line: lineOf(code, /\bnp\./), message: '`np` is used but numpy is never imported.', hint: 'Add "import numpy as np" at the top.' });
        const lines = pythonLines(code);
        runPython(lines, env, (L) => {
            let m;
            if ((m = /^([A-Za-z_]\w*)\s*=\s*QuantumRegister\((.*)\)$/.exec(L.text))) {
                try { const a = splitArgs(m[2]); const size = evaluate(a.pos[0] || a.kw.size, env); env[m[1]] = { type: 'qreg', offset: nq, size }; nq += size; } catch (e) { errors.push({ line: L.line, message: `QuantumRegister: ${e.message}` }); }
                return;
            }
            if ((m = /^([A-Za-z_]\w*)\s*=\s*ClassicalRegister\(/.exec(L.text))) return;
            if ((m = /^([A-Za-z_]\w*)\s*=\s*QuantumCircuit\((.*)\)$/.exec(L.text))) {
                cvar = m[1];
                try {
                    const a = splitArgs(m[2]);
                    if (a.pos.length) {
                        const first = evaluate(a.pos[0], env);
                        if (typeof first === 'number') { nq = first; env.__q = { type: 'qreg', offset: 0, size: first }; }
                        else if (first && first.type === 'qreg') { /* registers already counted */ }
                    }
                } catch (e) { if (!/Unknown name/.test(e.message) || !nq) errors.push({ line: L.line, message: `QuantumCircuit(...): ${e.message}`, hint: 'Use QuantumCircuit(n) or QuantumCircuit(n, m) with integer sizes.' }); }
                return;
            }
            if (tryAssign(L, env)) return;
            if (!cvar) return;
            const re = new RegExp('^' + cvar + '\\.([A-Za-z_]\\w*)\\s*\\(');
            if (!(m = re.exec(L.text))) return;
            const method = m[1]; const open = L.text.indexOf('(', m[0].length - 1); const close = matchParen(L.text, open);
            if (close < 0) { errors.push({ line: L.line, message: 'Unbalanced parentheses.', hint: 'Check that every "(" has a matching ")".' }); return; }
            const args = splitArgs(L.text.slice(open + 1, close));
            try {
                if (QISKIT_IGNORE.has(method)) return;
                if (method === 'measure_all' || method === 'measure_active') { for (let q = 0; q < nq; q++) ops.push({ gate: 'measure', targets: [q], controls: [], params: [], line: L.line }); return; }
                if (method === 'barrier') { ops.push({ gate: 'barrier', targets: [], controls: [], params: [], line: L.line }); return; }
                if (method === 'measure') {
                    if (!args.pos.length) throw new ParseError('measure() needs qubit and classical-bit arguments.', L.line, 'Example: qc.measure(0, 0) or qc.measure([0,1], [0,1])');
                    toQubitList(evaluate(args.pos[0], env), 'measure qubit').forEach(q => ops.push({ gate: 'measure', targets: [q], controls: [], params: [], line: L.line }));
                    return;
                }
                const gate = QISKIT_MAP[method];
                if (!gate) {
                    const COMMON = { hadamard: 'h', paulix: 'x', pauli_x: 'x', not: 'x', pauliy: 'y', pauliz: 'z', phase: 'p', cnot: 'cx', toffoli: 'ccx', rotx: 'rx', roty: 'ry', rotz: 'rz', measure: 'measure', measureall: 'measure_all' };
                    const near = Object.keys(COMMON).find(k => lev(method.toLowerCase(), k) <= 2);
                    throw new ParseError(`Unsupported or unknown QuantumCircuit method "${method}".`, L.line, near ? `Did you mean "${cvar}.${COMMON[near]}(...)"? (Qiskit uses short gate names.)` : similar(method, Object.keys(QISKIT_MAP)));
                }
                const g = QL.GATES[gate];
                const vals = args.pos.map(e => evaluate(e, env));
                // keyword qubit args (qc.cx(control_qubit=0, target_qubit=1))
                ['theta', 'phi', 'lam'].forEach(k => { if (args.kw[k]) vals.splice(['theta', 'phi', 'lam'].indexOf(k), 0, evaluate(args.kw[k], env)); });
                ['control_qubit', 'target_qubit', 'qubit'].forEach(k => { if (args.kw[k]) vals.push(evaluate(args.kw[k], env)); });
                const np_ = g.params.length; const need = g.nC + g.nT;
                if (vals.length !== np_ + need) throw new ParseError(`${method}() expects ${np_ ? np_ + ' parameter(s) and ' : ''}${need} qubit argument(s), got ${vals.length} argument(s).`, L.line, exampleCall(cvar, method, g));
                const params = vals.slice(0, np_); params.forEach(v => { if (typeof v !== 'number') throw new ParseError(`Parameter of ${method}() must be a number.`, L.line, 'Parameters come first, e.g. qc.rx(np.pi/2, 0)'); });
                const qlists = vals.slice(np_).map(v => toQubitList(v, `${method} qubit`));
                const width = Math.max(...qlists.map(l => l.length));
                for (let k = 0; k < width; k++) { const qs = qlists.map(l => l.length === 1 ? l[0] : l[k]); ops.push({ gate, controls: qs.slice(0, g.nC), targets: qs.slice(g.nC), params, line: L.line }); }
            } catch (e) { errors.push({ line: e.line || L.line, message: e.message, hint: e.hint }); }
        }, errors);
        if (!cvar) errors.push({ line: 1, message: 'No QuantumCircuit found.', hint: 'Create one with: qc = QuantumCircuit(2)' });
        return { circuit: { numQubits: nq, ops }, errors, warnings };
    }

    // -----------------------------------------------------------------
    // Cirq
    // -----------------------------------------------------------------
    const CIRQ_MAP = { H: 'h', X: 'x', Y: 'y', Z: 'z', S: 's', T: 't', I: 'id', CNOT: 'cx', CX: 'cx', CZ: 'cz', SWAP: 'swap', TOFFOLI: 'ccx', CCX: 'ccx', CCNOT: 'ccx', FREDKIN: 'cswap', CSWAP: 'cswap', rx: 'rx', ry: 'ry', rz: 'rz', Rx: 'rx', Ry: 'ry', Rz: 'rz' };
    const CIRQ_SKIP = new Set(['LineQubit', 'LineQubit.range', 'NamedQubit', 'GridQubit', 'Circuit', 'Moment', 'Simulator', 'DensityMatrixSimulator', 'unitary', 'final_state_vector', 'dirac_notation', 'InsertStrategy', 'InsertStrategy.NEW', 'InsertStrategy.EARLIEST', 'plot_state_histogram', 'measure_each', 'MatrixGate', 'ResetChannel', 'sample', 'google']);

    function parseCirq(code) {
        const errors = [], warnings = []; const ops = []; let nq = 0; const env = {};
        const lines = pythonLines(code);
        runPython(lines, env, (L) => {
            let m;
            if ((m = /^([A-Za-z_][\w\s,]*)=\s*cirq\.LineQubit\.range\((.*)\)$/.exec(L.text))) {
                try {
                    const a = splitArgs(m[2]).pos.map(e => evaluate(e, env)); const n = a.length === 1 ? a[0] : a[1] - a[0];
                    const names = m[1].split(',').map(s => s.trim()).filter(Boolean);
                    if (names.length === 1) env[names[0]] = { type: 'qreg', offset: nq, size: n };
                    else names.forEach((nm, k) => env[nm] = { type: 'qubit', index: nq + k });
                    nq += n;
                } catch (e) { errors.push({ line: L.line, message: `LineQubit.range: ${e.message}` }); }
                return;
            }
            if ((m = /^([A-Za-z_]\w*)\s*=\s*cirq\.(?:LineQubit|NamedQubit|GridQubit)\((.*)\)$/.exec(L.text))) { env[m[1]] = { type: 'qubit', index: nq++ }; return; }
            if ((m = /^([A-Za-z_]\w*)\s*=\s*\[\s*cirq\.(?:LineQubit|NamedQubit)\((.*)\)\s+for\s+\w+\s+in\s+range\((.+)\)\s*\]$/.exec(L.text))) {
                try { const n = evaluate(m[3], env); env[m[1]] = { type: 'qreg', offset: nq, size: n }; nq += n; } catch (e) { errors.push({ line: L.line, message: e.message }); }
                return;
            }
            if (tryAssign(L, env)) return;
            // scan for cirq.<Name> occurrences
            const text = L.text; let idx = 0;
            while ((idx = text.indexOf('cirq.', idx)) >= 0) {
                const nm = /^cirq\.([A-Za-z_][\w.]*)/.exec(text.slice(idx)); const name = nm[1];
                let after = idx + nm[0].length;
                try {
                    if (CIRQ_SKIP.has(name) || CIRQ_SKIP.has(name.split('.')[0])) { idx = after; continue; }
                    if (name === 'measure') {
                        const close = matchParen(text, after); const a = splitArgs(text.slice(after + 1, close));
                        a.pos.forEach(e => { const expr = e.replace(/^\*/, ''); toQubitList(evaluate(expr, env), 'measured qubit').forEach(q => ops.push({ gate: 'measure', targets: [q], controls: [], params: [], line: L.line })); });
                        if (!a.kw.key) warnings.push({ line: L.line, message: 'cirq.measure(...) has no key.', hint: "Add key='m' so you can read results with result.histogram(key='m')." });
                        idx = close + 1; continue;
                    }
                    let base = name; let exponent = 1; let params = [];
                    if (name === 'ZPowGate' || name === 'CZPowGate') { // cirq.ZPowGate(exponent=e)(q) -> P(pi*e)
                        const c1 = matchParen(text, after); const a = splitArgs(text.slice(after + 1, c1)); const e = evaluate(a.kw.exponent || a.pos[0] || '1', env);
                        const c2 = matchParen(text, c1 + 1); const qs = splitArgs(text.slice(c1 + 2, c2)).pos.flatMap(x => toQubitList(evaluate(x, env), 'qubit'));
                        if (name === 'ZPowGate') qs.forEach(q => ops.push({ gate: 'p', targets: [q], controls: [], params: [Math.PI * e], line: L.line }));
                        else ops.push({ gate: 'cp', controls: [qs[0]], targets: [qs[1]], params: [Math.PI * e], line: L.line });
                        idx = c2 + 1; continue;
                    }
                    // cirq.X**0.5  /  cirq.S**-1
                    const pw = /^\s*\*\*\s*(-?[\d.]+)/.exec(text.slice(after));
                    if (pw) { exponent = parseFloat(pw[1]); after += pw[0].length; while (text[after] === ')' || text[after] === ' ') after++; }
                    let gate = CIRQ_MAP[base.replace(/\.on$/, '')];
                    if (name.endsWith('.on')) base = name.slice(0, -3);
                    gate = CIRQ_MAP[base];
                    if (!gate) throw new ParseError(`Unsupported Cirq operation "cirq.${name}".`, L.line, similar(base, Object.keys(CIRQ_MAP)));
                    const g = QL.GATES[gate];
                    if (g.params.length) { // rx(theta)(q)
                        const close = matchParen(text, after); params = splitArgs(text.slice(after + 1, close)).pos.map(e => evaluate(e, env)); after = close + 1;
                    }
                    if (text.slice(after, after + 4) === '.on(') after += 3;
                    if (text[after] !== '(') { idx = after; continue; } // gate object referenced, not applied
                    const close = matchParen(text, after);
                    const qv = splitArgs(text.slice(after + 1, close)).pos.map(e => { const star = e.startsWith('*'); const v = evaluate(e.replace(/^\*/, ''), env); return star ? toQubitList(v, 'qubit') : toQubitList(v, 'qubit'); });
                    const flat = qv.flat(); const need = g.nC + g.nT;
                    if (exponent !== 1) {
                        if (gate === 's' && exponent === -1) gate = 'sdg'; else if (gate === 't' && exponent === -1) gate = 'tdg';
                        else if (gate === 'x' && exponent === 0.5) gate = 'sx';
                        else if (gate === 'z') { gate = 'p'; params = [Math.PI * exponent]; }
                        else throw new ParseError(`Gate power cirq.${base}**${exponent} is not supported in the browser.`, L.line, 'Use rx/ry/rz rotations instead.');
                    }
                    if (need === 1 && flat.length > 1 && qv.length === 1) flat.forEach(q => ops.push({ gate, targets: [q], controls: [], params, line: L.line }));
                    else {
                        if (flat.length !== need) throw new ParseError(`cirq.${base} acts on ${need} qubit(s) but got ${flat.length}.`, L.line);
                        const G2 = QL.GATES[gate]; ops.push({ gate, controls: flat.slice(0, G2.nC), targets: flat.slice(G2.nC), params, line: L.line });
                    }
                    idx = close + 1;
                } catch (e) { errors.push({ line: e.line || L.line, message: e.message, hint: e.hint }); idx = after; }
            }
        }, errors);
        if (!nq) errors.push({ line: 1, message: 'No qubits declared.', hint: 'Declare qubits with: q = cirq.LineQubit.range(2)' });
        return { circuit: { numQubits: nq, ops }, errors, warnings };
    }

    // -----------------------------------------------------------------
    // PennyLane
    // -----------------------------------------------------------------
    const PL_MAP = { Hadamard: 'h', PauliX: 'x', PauliY: 'y', PauliZ: 'z', X: 'x', Y: 'y', Z: 'z', S: 's', T: 't', SX: 'sx', Identity: 'id', RX: 'rx', RY: 'ry', RZ: 'rz', PhaseShift: 'p', U1: 'p', U3: 'u', CNOT: 'cx', CY: 'cy', CZ: 'cz', CH: 'ch', SWAP: 'swap', Toffoli: 'ccx', CSWAP: 'cswap', ControlledPhaseShift: 'cp', CPhase: 'cp', CRX: 'crx', CRY: 'cry', CRZ: 'crz', Rot: 'rot' };
    const PL_MEAS = new Set(['probs', 'sample', 'counts', 'expval', 'var', 'state', 'density_matrix', 'measure']);
    const PL_SKIP = new Set(['device', 'qnode', 'QNode', 'draw', 'draw_mpl', 'numpy', 'math', 'grad', 'GradientDescentOptimizer', 'AdamOptimizer', 'specs', 'set_shots', 'workflow']);

    function parsePennyLane(code) {
        const errors = [], warnings = []; const ops = []; let nq = 0; const env = {}; let measuredAny = false;
        if (/qml\./.test(code) && !/@qml\.qnode/.test(code) && !/qml\.QNode/.test(code)) warnings.push({ line: lineOf(code, /def\s+\w+/) || 1, message: 'No @qml.qnode decorator found.', hint: 'Decorate the circuit function with @qml.qnode(dev) so PennyLane executes it on the device.' });
        const lines = pythonLines(code);
        runPython(lines, env, (L) => {
            let m;
            if ((m = /qml\.device\((.*)\)/.exec(L.text))) {
                const a = splitArgs(m[1]);
                try { const w = evaluate(a.kw.wires || a.pos[1], env); nq = Array.isArray(w) ? w.length : w; } catch (e) { errors.push({ line: L.line, message: `qml.device: could not read wires (${e.message}).`, hint: 'Example: dev = qml.device("default.qubit", wires=2)' }); }
                return;
            }
            if (/^return\b/.test(L.text) === false && tryAssign(L, env)) return;
            const text = L.text; let idx = 0;
            while ((idx = text.indexOf('qml.', idx)) >= 0) {
                const nm = /^qml\.([A-Za-z_][\w.]*)/.exec(text.slice(idx)); const name = nm[1]; let after = idx + nm[0].length;
                try {
                    if (PL_SKIP.has(name.split('.')[0])) { idx = after; continue; }
                    if (PL_MEAS.has(name)) {
                        const close = matchParen(text, after); const a = splitArgs(text.slice(after + 1, close));
                        if (name === 'probs' || name === 'sample' || name === 'counts') {
                            const w = a.kw.wires || a.pos[0];
                            const qs = w ? toQubitList(evaluate(w, env), 'wires') : [...Array(nq).keys()];
                            qs.forEach(q => ops.push({ gate: 'measure', targets: [q], controls: [], params: [], line: L.line })); measuredAny = true;
                        }
                        idx = close + 1; continue; // skip observables inside expval/var
                    }
                    let adjoint = false;
                    if (name === 'adjoint') { // qml.adjoint(qml.S)(wires=0)
                        const close = matchParen(text, after); const inner = /qml\.(\w+)/.exec(text.slice(after, close)); after = close + 1; adjoint = true;
                        if (!inner) throw new ParseError('Could not read qml.adjoint(...)', L.line);
                        var baseName = inner[1];
                    } else var baseName = name;
                    let gate = PL_MAP[baseName];
                    if (!gate) throw new ParseError(`Unsupported PennyLane operation "qml.${baseName}".`, L.line, similar(baseName, Object.keys(PL_MAP)));
                    if (text[after] !== '(') { idx = after; continue; }
                    const close = matchParen(text, after); const a = splitArgs(text.slice(after + 1, close));
                    let wiresExpr = a.kw.wires; const pos = a.pos.slice(); if (!wiresExpr) wiresExpr = pos.pop();
                    if (!wiresExpr) throw new ParseError(`qml.${baseName} needs wires.`, L.line, `Example: qml.${baseName}(${gate === 'rot' ? 'a, b, c, ' : QL.GATES[gate] && QL.GATES[gate].params.length ? 'np.pi/2, ' : ''}wires=0)`);
                    const qs = toQubitList(evaluate(wiresExpr, env), 'wires'); const params = pos.map(e => evaluate(e, env));
                    if (gate === 'rot') { // Rot(phi, theta, omega) = RZ(omega) RY(theta) RZ(phi)
                        ops.push({ gate: 'rz', targets: [qs[0]], controls: [], params: [params[0]], line: L.line }, { gate: 'ry', targets: [qs[0]], controls: [], params: [params[1]], line: L.line }, { gate: 'rz', targets: [qs[0]], controls: [], params: [params[2]], line: L.line });
                        idx = close + 1; continue;
                    }
                    if (adjoint) { const inv = { s: 'sdg', t: 'tdg', sdg: 's', tdg: 't' }[gate]; if (inv) gate = inv; else if (QL.GATES[gate].selfInverse) { /* same */ } else if (QL.GATES[gate].rotation) params[0] = -params[0]; else throw new ParseError(`qml.adjoint(qml.${baseName}) is not supported in the browser.`, L.line); }
                    const g = QL.GATES[gate];
                    if (params.length !== g.params.length) throw new ParseError(`qml.${baseName} expects ${g.params.length} parameter(s), got ${params.length}.`, L.line);
                    if (qs.length !== g.nC + g.nT) throw new ParseError(`qml.${baseName} acts on ${g.nC + g.nT} wire(s) but got ${qs.length}.`, L.line, g.nC + g.nT > 1 ? `Example: qml.${baseName}(wires=[0, 1])` : undefined);
                    ops.push({ gate, controls: qs.slice(0, g.nC), targets: qs.slice(g.nC), params, line: L.line });
                    idx = close + 1;
                } catch (e) { errors.push({ line: e.line || L.line, message: e.message, hint: e.hint }); idx = after; }
            }
        }, errors);
        if (!nq) errors.push({ line: 1, message: 'No PennyLane device found.', hint: 'Create one with: dev = qml.device("default.qubit", wires=2)' });
        if (!measuredAny && !/qml\.(state|expval|var|density_matrix)/.test(code)) warnings.push({ line: lineOf(code, /def\s+\w+/) || 1, message: 'The circuit returns no measurement.', hint: 'End the qnode with e.g. "return qml.probs(wires=[0, 1])".' });
        return { circuit: { numQubits: nq, ops }, errors, warnings };
    }

    // -----------------------------------------------------------------
    // qBraid — programs wrap another framework; we parse the embedded one
    // -----------------------------------------------------------------
    function parseQBraid(code) {
        const tq = /("""|''')([\s\S]*?)\1/.exec(code);
        if (tq && /OPENQASM/.test(tq[2])) {
            const baseLine = code.slice(0, tq.index).split('\n').length - 1;
            const r = parseQASM(tq[2], baseLine); r.inner = 'qasm'; return r;
        }
        const fw = detectFramework(code.replace(/qbraid/gi, ''));
        if (fw && fw !== 'qbraid') { const r = PARSERS[fw](code); r.inner = fw; return r; }
        return { circuit: { numQubits: 0, ops: [] }, errors: [{ line: 1, message: 'No circuit found in the qBraid program.', hint: 'Put an OpenQASM string in program = """...""" or build a Qiskit/Cirq circuit, then call qbraid.transpile(...).' }], warnings: [] };
    }

    // -----------------------------------------------------------------
    // Utilities
    // -----------------------------------------------------------------
    function lineOf(code, re) { const m = re.exec(code); return m ? code.slice(0, m.index).split('\n').length : 0; }
    function similar(word, options) {
        const w = word.toLowerCase(); let best = null, bd = 99;
        options.forEach(o => { const d = lev(w, o.toLowerCase()); if (d < bd) { bd = d; best = o; } });
        return best && bd <= 3 ? `Did you mean "${best}"?` : undefined;
    }
    function lev(a, b) { const d = [...Array(a.length + 1)].map((_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; }
    function exampleCall(v, m, g) { const ps = g.params.map(() => 'np.pi/2'); const qs = [...Array(g.nC + g.nT).keys()]; return `Example: ${v}.${m}(${[...ps, ...qs].join(', ')})`; }

    function detectFramework(code) {
        const c = code || '';
        if (/^\s*(\/\/[^\n]*\n\s*)*OPENQASM/.test(c)) return 'qasm';
        if (/\bqbraid\b/i.test(c)) return 'qbraid';
        if (/import\s+pennylane|qml\./.test(c)) return 'pennylane';
        if (/import\s+cirq|cirq\./.test(c)) return 'cirq';
        if (/QuantumCircuit|from\s+qiskit/.test(c)) return 'qiskit';
        if (/\bqreg\b|\bqubit\s*\[/.test(c)) return 'qasm';
        return null;
    }

    const PARSERS = { qasm: parseQASM, qiskit: parseQiskit, cirq: parseCirq, pennylane: parsePennyLane, qbraid: parseQBraid };

    /** Parse code into the IR. framework: 'auto' | qasm | qiskit | cirq | pennylane | qbraid */
    function parse(code, framework = 'auto') {
        const fw = framework === 'auto' ? detectFramework(code) : framework;
        if (!fw) return { framework: null, circuit: { numQubits: 0, ops: [] }, errors: [{ line: 1, message: 'Could not recognise the framework.', hint: 'Start from a template (OpenQASM, Qiskit, Cirq, PennyLane or qBraid).' }], warnings: [] };
        let r;
        try { r = PARSERS[fw](code); } catch (e) { r = { circuit: { numQubits: 0, ops: [] }, errors: [{ line: 1, message: e.message }], warnings: [] }; }
        r.framework = fw;
        // Split soft warnings that were pushed into errors
        r.warnings = (r.warnings || []).concat(r.errors.filter(e => e.severity === 'warning'));
        r.errors = r.errors.filter(e => e.severity !== 'warning');
        if (!r.errors.length) {
            if (r.circuit.numQubits > QL.MAX_QUBITS) r.errors.push({ line: 1, message: `This program uses ${r.circuit.numQubits} qubits; the in-browser engine supports up to ${QL.MAX_QUBITS}.`, hint: 'Reduce the qubit count or run it on the Python backend.' });
            QL.validateCircuit(r.circuit).forEach(msg => r.errors.push({ line: 1, message: msg }));
        }
        return r;
    }

    QL.parse = parse; QL.detectFramework = detectFramework; QL.parseQASM = parseQASM;
})(typeof window !== 'undefined' ? window : globalThis);
