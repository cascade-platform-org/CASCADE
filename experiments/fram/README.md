# experiments/fram/

Harness for the RESS paper that converts published FRAM models into CASCADE
models (plan: `docs/paper/FRAM/PLAN.md`, gitignored). It calls the real engine
(`engine.propagation.run`); no propagation logic lives here. The conversion itself is the product's FMV importer (`CASCADE-backend/core/importers/xfmv/`, ADR-0026): `framkit` re-exports it, so the paper evaluates the code users run.

| File | What it is |
|---|---|
| `TRANSLATION.md` | translation v2, per-case mappings, RQ2 protocol, declaration log |
| `REPORT.md` | results for V1, RQ1–RQ3, the ablations and the decision model |
| `framkit/` | readers for the published models (where each file sits: below), the FRAM model and translation (re-exported from the importer), engine call, oracles (FMI, Kaya VPN, Khakzad FT, Kim simulation), Kim formula rules |
| `run_v1.py` | verification: FMI fixed points, fault tree |
| `run_rq1.py` | RQ1: every case, S0 vs v2 |
| `run_rq2.py` | RQ2: exact importance, Kim interventions, expert claims (v2 and the S0 baseline), Vitality vs topology; exploratory alternative path (Wenzhou) |
| `run_ablation.py` | the ablation family (9 semantics) on RQ1 with the event-severity grid, the claims by tier, and the engine against the printed formula (`framkit.oracles.conversion_levels`) |
| `run_newcases.py` | the two new held-out cases (Adhita & Furusho 2021, Nayak et al. 2022) under the ablation family, with the §4c decision rule |
| `run_cumulative.py` | sensitivity: cumulative worsening (v2+3, v2+c) beside v2, on RQ1 and the claims |
| `check_falegnami.py` | Falegnami et al. 2020's Katz ranking reproduced from the authors' private edge list, then with structure only |
| `check_kim.py` | Kim & Yoon's "F11 is critical" on our re-implementation of their simulation (a footnote) |
| `export_bundles.py` | the core cases as projects to check in the platform, each with its event as Events and each claim's edit applied, plus `CHECKS.md` (what to fire, what to expect); written by licence to `CASCADE-app/samples/public/fram/` (CC BY sources) or the gitignored `samples/private/fram/` |
| `decide_zheng.py` | decision model: Zheng's recommendations compared under firefighters and time, and its scale sensitivity (N = 7). Each option is a project whose Temporal Simulation has the three unknowns as Parameters; every grid point is one run of the app's step operator (`ts/run_timeline.ts`, through `engine_worker.py`: needs `npx tsx`, about 6 min). Writes `CASCADE-app/samples/public/fram/zheng_I*.json` (open in the app; Compare sweeps one Parameter) |
| `decide_rules.py` | the Zheng and Koriyama decision models rebuilt under every rule of the ablation family |
| `run_stats.py` | how much the six RQ1 cases establish: no-rule scores (Fig. 2), exact chance baselines, credible intervals, paired comparison, fragility, leave-one-case-out (pure functions in `framkit/stats.py`, tests in `test_stats.py`) |
| `scale_limit.py` | the decision thresholds at N = 4, 7, 10, 13 and their closed-form limits |
| `ts/run_timeline.ts`, `engine_worker.py` | a Temporal Simulation run outside the app: the app's `lib/step-operator.ts` with the engine behind `POST /api/propagate` |
| `decide_koriyama.py` | decision model on structure alone: Togawa's two recommendations under two readings of the call load, the severity grid and N = 7 |
| `data/` | the transcriptions (Zheng, Zinetullina: CC BY) and the frozen RQ2 claim list; sources and licences in `data/README.md` |
| `results/` | CSV outputs |

**Where the inputs are, by licence.** A file is tracked only if its licence lets it be redistributed, and so is anything built from it; results (numbers) are tracked for every case.

| Kind | Tracked (CC BY, or ours) | Never tracked (`private/`, each with its own `.gitignore`) |
|---|---|---|
| FMV files (importable) | `raw-networks/fram/`: Grabbe 2022 | `raw-networks/fram/private/`: Falegnami 2020, Simone 2025, the FMV example library |
| transcriptions | `data/`: Zheng 2024, Zinetullina 2021, the claim lists | `data/private/`: Kaya, Kim, Li 2025, Li 2026, Smith, Tian (© Elsevier), Togawa (CC BY-NC-ND), the Falegnami and Simone phenotype sheets |
| CASCADE projects | `CASCADE-app/samples/public/fram/`: the Zheng checks and decision model | `CASCADE-app/samples/private/fram/`: the other check bundles |

Falegnami 2020 and Simone 2025 were shared by A. Tomassi and A. Falegnami for this study only, never to be redistributed; `run_v1.py` and `check_falegnami.py` skip them when absent. A fresh checkout runs the CC BY cases; the others need the private files.
Run from the repository root, e.g. `CASCADE-backend/.venv/bin/python experiments/fram/run_rq1.py`.
