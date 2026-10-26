# experiments/fram/

Harness for the RESS paper that executes published FRAM models in CASCADE
(plan: `docs/paper/FRAM/PLAN.md`, gitignored). Calls the real engine
(`engine.propagation.run`); no propagation logic lives here.

| File | What it is |
|---|---|
| `TRANSLATION.md` | the frozen translation and per-case mappings (protocol) |
| `REPORT.md` | latest results, issues, open choices |
| `framkit/model.py` | FRAM model: functions, couplings by output text, FMI profiles |
| `framkit/readers.py` | xfmv and CSV readers; data path `FRAM_DATA` (default `docs/paper/FRAM`) |
| `framkit/translate.py` | FRAM → CASCADE project (output nodes, aspect → `dependency_level`) |
| `framkit/engine.py` | one engine call with starting levels |
| `framkit/oracles.py` | FMI fixed points, Kaya VPN (exact), Khakzad fault tree |
| `run_v1.py` | verification: FMI equivalence, fault tree |
| `run_e1.py` | RQ1: Zheng, Kaya (+ declared variants) |
| `run_e2.py` | RQ2: Vitality vs published rankings and baselines |
| `data/` | open-licence transcriptions (Grabbe Table A4) |
| `results/` | CSV outputs |

The © Elsevier transcriptions (Kaya 2020, Li 2026) stay in the gitignored paper
folder; results derived from them are tracked.

Run from the repository root with the backend venv, e.g.
`CASCADE-backend/.venv/bin/python experiments/fram/run_v1.py`.
