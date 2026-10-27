# experiments/fram/

Harness for the RESS paper that converts published FRAM models into CASCADE
models (plan: `docs/paper/FRAM/PLAN.md`, gitignored). It calls the real engine
(`engine.propagation.run`); no propagation logic lives here.

| File | What it is |
|---|---|
| `TRANSLATION.md` | translation v2, per-case mappings, RQ2 protocol, declaration log |
| `REPORT.md` | results for V1, RQ1–RQ3 and the demonstration |
| `framkit/` | FRAM model, readers (data path `FRAM_DATA`, default `docs/paper/FRAM`), translation, engine call, oracles (FMI, Kaya VPN, Khakzad FT, Kim simulation), Kim formula rules |
| `run_v1.py` | verification: FMI fixed points, fault tree |
| `run_rq1.py` | RQ1: every case, S0 vs v2 |
| `run_rq2.py` | RQ2: exact importance, Kim interventions, expert claims, Vitality vs topology; exploratory alternative path (Wenzhou) |
| `run_cumulative.py` | sensitivity: cumulative worsening (v2+3, v2+c) beside v2, on RQ1 and the claims |
| `check_kim.py` | Kim & Yoon's "F11 is critical" on our re-implementation of their simulation (a footnote) |
| `demo_zheng.py` | demonstration: Zheng with telecom, crews and fire water; writes `demo/*.json` (open in the app) |
| `data/` | the redistributable inputs (Zheng, Grabbe: CC BY) and the frozen RQ2 claim list; sources and licences in `data/README.md` |
| `results/` | CSV outputs |

The other transcriptions stay in the gitignored paper folder, as their licences do not allow redistribution; results derived from them are tracked.
Run from the repository root, e.g. `CASCADE-backend/.venv/bin/python experiments/fram/run_rq1.py`.
