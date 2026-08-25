# experiments/

Validation experiments for the CompleNet paper: run the CASCADE flow module and
a WNTR pressure-driven ground truth on real/benchmark water networks, then score
how well the module's predicted service loss matches reality.

**`benchmark-protocol.md`** is the full spec — every assumption, every knob,
why each decision was made. **`ATTEMPTS.md`** is the narrative log of every
attempt and dead end (read §10–§11 for the current setup). This README is the
map of *what each file is*.

---

## TL;DR — the canonical result

| | |
|---|---|
| **Result data** | **`final_benchmark.csv`** — the 8-network numbers in the paper (uniform design-velocity capacity, **no priority** — best precision) |
| **Priority ablation** | `final_benchmark_priority.csv` — contingency priority ON, the optional recall lever (paper Supp. §S1) |
| **Capacity ablation** | `final_benchmark_drill.csv` — the old sweep-drill capacity method, *worse* than the constant (paper Supp. §S2) |
| **Read the numbers** | `python3 aggregate_final.py [csv]` |
| **Paper placeholders** | `python3 paper_numbers.py` |

There is exactly one results file per arm — no versioned/duplicate CSVs.
Everything else is either how that data was produced or a diagnostic.

---

## How `final_benchmark.csv` was made

`run_final_benchmark.sh` ran all 8 networks once (2026-07-22). That run had a
bug: a tank-supply modeling error made the module falsely flag ~everything on
CTown as critical. The fix (`pump_fed_tanks`, `core/importers/inp/sim.py`) only
changes supply for **3** of the 8 networks — Net1, Tarcento, CTown — so instead
of re-running everything, only those 3 were re-run and folded back into the
original file, replacing their rows in place. `final_benchmark.csv` has been
the single, current file ever since; the pre-fix version and the merge tooling
are preserved for provenance under `archive/pumpfed-fix-2026-07-23/`
(`pre-fix_final_benchmark.csv`, `final_benchmark_fixed.csv`, `merge_pumpfed.py`
— see `ATTEMPTS.md` §11 for the full diagnosis).

The canonical config was set on 2026-07-28 (see `ATTEMPTS.md` §12–13):
**uniform design-velocity capacity (area × 2.5 m/s) + no priority ordering.**
Two findings drove it:

- **Capacity:** a flat design velocity does *as well or better* than the old
  per-pipe hydraulic "drill" (F1 0.794 vs 0.737, precision 0.682 vs 0.599) —
  simpler *and* better. `run_capacity_drill_ablation.sh` → `final_benchmark_drill.csv`.
- **Priority:** the cycle-aware contingency priority is a **recall lever, not a
  precision fix** — turning it on lifts recall 0.95→0.98 at a precision cost
  (0.68→0.63). So the canonical leaves it off (best precision), and the
  priority-on arm is an ablation. `run_priority_ablation.sh` → `final_benchmark_priority.csv`.

```
run_final_benchmark.sh            →  final_benchmark.csv          (CANONICAL: uniform + no priority)
run_priority_ablation.sh          →  final_benchmark_priority.csv (contingency priority ON)
run_capacity_drill_ablation.sh    →  final_benchmark_drill.csv    (--capacity-drill, old method)
```

---

## Files

### Scripts — run these
| File | What it does |
|---|---|
| `run_final_benchmark.sh` | CANONICAL runner: 8 networks, four families, uniform design-velocity capacity, **no priority**. Writes `final_benchmark.csv`/`.log`. |
| `run_priority_ablation.sh` | Priority-on ablation (`--priority-mode contingency`, the recall lever) → `final_benchmark_priority.csv`. Paper Supp. §S1. |
| `run_capacity_drill_ablation.sh` | Capacity ablation (`--capacity-drill`, old sweep method) → `final_benchmark_drill.csv`. Paper Supp. §S2. |
| `aggregate_final.py [csv]` | Pools a results CSV into per-family / per-network FMS + precision/recall tables. Defaults to `final_benchmark.csv`. |
| `paper_numbers.py` | Prints the exact values (with bootstrap CIs) that fill the paper's `\dtba` placeholders, from `final_benchmark.csv`. |
| `margin_sweep.py` | Held-out capacity-margin sensitivity sweep — the harness behind the supplement's §S5 negative result. |
| `priority_steering.py` | Both priority arms of Supp. §S2: the **per-scenario oracle** (expressive range — what the lever can reach) and the **single per-network vector** (the negative control — whether that range generalizes; it does not, ≈+0.07). |
| `orientation_ablation.py` | The one true ablation (Supp. §S5): shipped orientation vs every pipe split both ways, all 8 networks. Orientation buys recall (0.944 vs 0.898) and costs precision (0.729 vs 0.862); it is decisive on Aqueduct C and explains C-Town's over-warning (precision 0.130 -> 0.774 without it). -> `orientation_ablation.csv`. |
| `anonymize_results.py` | Rewrites the `network` column to Aqueduct A/B/C and writes `results/` — the publishable per-situation CSVs the paper's Data and Code Availability statement promises. Refuses to write if a real export name survives. Re-run after any benchmark. |
| `cost_benchmark.py` | Per-situation engine vs WNTR timings + one-time import cost — the table in Supp. §S4. Samples evenly across the four families, because engine cost tracks scarcity, not network size. |

### Diagnostics
The one-off diagnostic scripts from the 2026-07-28 exploration (orientation
proxies, tank-supply surge, capacity sweeps, …) were removed after their
conclusions were folded into `ATTEMPTS.md` §12–§15 — that log is the record.

**Every number the paper reports for the SHIPPED configuration has a script and a
CSV here**, and `results/` holds the anonymized per-situation CSVs the Data and
Code Availability statement promises — every table in the paper and the
Supplementary Material recomputes from them. That was not true before
2026-08-17: the priority-controllability range and the cost table rested on
`ATTEMPTS.md` prose alone, with their scripts deleted.

The exception is Supp. Mat. S7 (negative results). Those arms measured a
**superseded** importer on the worst-10 situations, so no script here
reproduces them; their figures are recorded in `ATTEMPTS.md` §2–§5 with the run
each came from, and the raw variant reports stay local under `archive/`. If you
delete a diagnostic, check first whether the paper cites its number.

### Data
`results/` holds the **anonymized, tracked** copies (`anonymize_results.py`); the raw
files below carry the real export path in their `network` column and are gitignored,
as are all `.log` files from these runs.

| File | What it is |
|---|---|
| **`final_benchmark.csv`** / `.log` | **CANONICAL** 8-network result (uniform design velocity, no priority, post pump-fed-tank fix). The paper's numbers. |
| `final_benchmark_priority.csv` / `.log` | Priority-on ablation (contingency, the recall lever). Paper Supp. §S1. |
| `final_benchmark_drill.csv` / `.log` | Capacity ablation: old sweep-drill method (`--capacity-drill`), worse. Paper Supp. §S2. |
| `final_benchmark_drill_priority.csv` | drill + contingency (the 4th cell of the capacity×priority 2×2; kept for reference). |

### Docs
| File | What it is |
|---|---|
| `benchmark-protocol.md` | Full spec: networks, families, every importer/validation assumption and knob, explicit rationale for each. Read this first for *what the setup is*. |
| `ATTEMPTS.md` | Running log of every experiment, dead end, and decision. Ground truth for *why* the setup is what it is. |

---

## Results CSV schema (one row per situation)

`network, seed, priority_mode, contingency_bias, required_pressure,
minimum_pressure, n_levels, kind, situation,` then:

- `fms` — demand-weighted level agreement, module vs WNTR (0–1).
- `n_compared` — junctions scored in this situation.
- `tp, fp, fn, tn` — module critical-detection confusion (critical = level 1).
- `fms_null`, `fms_reach` — FMS of the two baselines (all-operational; reachability).
- `reach_tp/fp/fn/tn` — reachability-baseline confusion.
- `gt_pipes, gt_pipes_over_vmax, gt_max_velocity, gt_frac_flow_over_vmax` —
  ground-truth velocity-exceedance flags (data-quality, not scoring).

`kind` ∈ {cluster, targeted, source, tank} — the four failure families.

---

## archive/

Superseded material, kept only for provenance — nothing here feeds the current
benchmark (see `archive/README.md`). `pumpfed-fix-2026-07-23/` holds the
pre-fix `final_benchmark.csv`, the raw 3-network re-run, and the merge script
that combined them into today's `final_benchmark.csv`.
