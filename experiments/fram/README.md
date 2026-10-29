# experiments/fram/

Harness for the RESS paper that converts published FRAM models into CASCADE
models (plan: `docs/paper/FRAM/PLAN.md`, gitignored). It calls the real engine
(`engine.propagation.run`); no propagation logic lives here. The conversion itself is the product's FMV importer (`CASCADE-backend/core/importers/xfmv/`, ADR-0026): `framkit` re-exports it, so the paper evaluates the code users run.

| File | What it is |
|---|---|
| `TRANSLATION.md` | translation v2, per-case mappings, RQ2 protocol, declaration log |
| `REPORT.md` | results for V1, RQ1–RQ3 and the demonstration |
| `framkit/` | readers for the published models (data path `FRAM_DATA`, default `docs/paper/FRAM`), the FRAM model and translation (re-exported from the importer), engine call, oracles (FMI, Kaya VPN, Khakzad FT, Kim simulation), Kim formula rules |
| `run_v1.py` | verification: FMI fixed points, fault tree |
| `run_rq1.py` | RQ1: every case, S0 vs v2 |
| `run_rq2.py` | RQ2: exact importance, Kim interventions, expert claims (v2 and the S0 baseline), Vitality vs topology; exploratory alternative path (Wenzhou) |
| `run_cumulative.py` | sensitivity: cumulative worsening (v2+3, v2+c) beside v2, on RQ1 and the claims |
| `check_falegnami.py` | Falegnami et al. 2020's Katz ranking reproduced from the authors' private edge list, then with structure only |
| `check_kim.py` | Kim & Yoon's "F11 is critical" on our re-implementation of their simulation (a footnote) |
| `export_bundles.py` | the core cases as projects to check in the platform, each with its event as Events and each claim's edit applied, plus `CHECKS.md` (what to fire, what to expect); written to the gitignored `docs/paper/FRAM/bundles/` |
| `demo_zheng.py` | demonstration: Zheng with telecom, crews and fire water; writes `demo/*.json` (open in the app) |
| `data/` | the redistributable inputs (Zheng, Grabbe: CC BY) and the frozen RQ2 claim list; sources and licences in `data/README.md` |
| private inputs | Falegnami 2020 and Simone 2025 (FMV files, phenotype sheets), shared by A. Tomassi and A. Falegnami for this study only: kept in the gitignored `docs/paper/FRAM/models/`, never redistributed; `run_v1.py` and `check_falegnami.py` skip them when absent |
| `results/` | CSV outputs |

The other transcriptions stay in the gitignored paper folder, as their licences do not allow redistribution; results derived from them are tracked.
Run from the repository root, e.g. `CASCADE-backend/.venv/bin/python experiments/fram/run_rq1.py`.
