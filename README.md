# Quantum Lens — Quantum Learning Platform

Quantum Lens is an interactive toolkit for building, visualising and analysing quantum circuits.
This release keeps the original site (home page, Celestial Toolkit simulators, tutorials, FAQ and
Quantum Assistant chatbot) and adds an **AI-powered quantum learning platform** on top of it.

| Page | What's there |
|---|---|
| `index.html` | Original home page, plus a new **Quantum Academy** section, two new FAQs and links to the new pages |
| `tutorial.html` | Original tutorials, plus **Interactive Modules** and **Practice & Assessment** sections |
| `learn.html` | **Learning Hub**: 8 modules, 23 lessons, interactive widgets, 40 quiz questions, personalised learning path |
| `lab.html` | **Quantum Lab**: drag-and-drop circuit builder, code lab, multi-backend runs, visualisations, challenges, saved circuits, AI tutor |
| `dashboard.html` | **My Progress** and **Instructor Dashboard** |
| `docs.html` | Full documentation and the **Delivery Table (Expected Deliverables)** |

## Quick start

**No install:** open `index.html` in a browser (or put the folder on any static host). Everything runs on
the built-in JavaScript statevector engine; progress and circuits are stored in the browser.

**With real quantum frameworks** (Qiskit Aer, PennyLane, Cirq, qBraid):

```bash
pip install -r backend/requirements.txt
python backend/server.py          # serves the site + API at http://localhost:8000
```

Optional environment variables: `ANTHROPIC_API_KEY` (Claude answers open tutor questions),
`QLENS_TUTOR_MODEL`, `PORT`, `HOST`, `QLENS_MAX_QUBITS`, `QLENS_SEED`, `QLENS_DATA_DIR`.

## Delivery Table (Expected Deliverables)

| # | Deliverable | Delivered as | Where |
|---|---|---|---|
| 1 | Interactive Quantum Learning Platform | 8 modules (fundamentals → algorithms), 23 lessons, live widgets | `learn.html`, `tutorial.html#learning-path` |
| 2 | Quantum Circuit Builder | Drag-and-drop / click-to-place, 26 palette gates, 1–8 qubits, inspector, undo/redo, examples, step-through | `lab.html` → Circuit Builder |
| 3 | Quantum Code Lab | Qiskit, Cirq, PennyLane, qBraid, OpenQASM 2/3 editor with live parsing, line-level errors and fix hints, conversion between frameworks | `lab.html` → Code Lab |
| 4 | Multi-Backend Simulation | Qiskit Aer, PennyLane, Cirq, qBraid (Python backend) + browser engine fallback, backend comparison | `backend/server.py`, Lab → Backend comparison |
| 5 | Quantum Visualization | Bloch spheres (reduced states), probabilities vs. counts, state vector with phases, execution results, circuit diagrams | Lab results, Learn widgets |
| 6 | AI Quantum Tutor | Concept explanations, circuit walkthroughs, code generation, debugging & error detection, optimisation, recommendations, hints; optional Claude mode | Lab & Learn tutor panels |
| 7 | Assessment Module | 40 quiz questions, 12 circuit-building + 7 coding challenges, automatic grading, scores and feedback | Learn quizzes, Lab → Challenges |
| 8 | Progress Tracking | Module progress, quiz history, challenge scores, points, streaks, activity, export/import | `dashboard.html` → My Progress |
| 9 | Personalized Learning | Path adapted to goal & level; recommendations from weak topics and results | `learn.html#path` |
| 10 | Instructor Dashboard | Cohort KPIs, completion & quiz charts, hardest topics, challenge analytics, roster, drill-down, CSV | `dashboard.html#instructor` |
| 11 | Scalable/Modular Architecture | Shared circuit IR, separate engine/parser/content/state/viz/tutor modules, pluggable backends, REST API, tests | see below |
| 12 | Documentation | `docs.html`, this README, code comments | `docs.html` |

## Project structure

```
index.html  tutorial.html  style.css  script.js  *.png      original site (extended additively)
learn.html  lab.html  dashboard.html  docs.html             new pages
assets/css/quantum.css      new components (reuses style.css variables)
assets/js/qcore.js          circuit IR, gates, statevector simulator, Bloch vectors, optimiser, code generation
assets/js/qparser.js        Qiskit / Cirq / PennyLane / qBraid / OpenQASM → IR with line-numbered errors
assets/js/qcontent.js       modules, lessons, quizzes, challenges, examples, tutor knowledge base
assets/js/qstore.js         storage, progress, grading, learning paths, saved circuits, backend client
assets/js/qviz.js           Bloch sphere, charts, state table, circuit SVG
assets/js/qtutor.js         AI tutor engine + chat component
assets/js/lab.js  learn.js  dashboard.js                    page controllers
backend/server.py           FastAPI service (simulate, tutor, class progress, circuits)
backend/test_backends.py    cross-backend verification
tests/*.test.js             engine, content and tutor tests
```

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Installed backends and versions, LLM availability |
| `POST /api/simulate` | `{backend, shots, circuit:{num_qubits, ops}}` → statevector, probabilities, counts |
| `POST /api/tutor` | `{message, context}` → LLM reply (needs `ANTHROPIC_API_KEY`) |
| `POST /api/progress`, `GET /api/class/{code}` | Class progress sync for the instructor dashboard |
| `GET/POST /api/circuits`, `DELETE /api/circuits/{id}` | Saved-circuit mirror |

All backends return results in Qiskit bit order (right-most bit = q0).

## Tests

```bash
node tests/core.test.js
node tests/content.test.js
node tests/tutor.test.js
python backend/test_backends.py     # needs the Python frameworks installed
```

## Notes

Simulations are ideal (noise-free) and measurements are treated as terminal. The browser parser covers the
common learning subset of each framework. The instructor view has no authentication; put a login in front of
the backend before using it with real classes. The Streamlit simulators and the Botpress assistant are unchanged.
