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
| **Result data** | **`final_benchmark.csv`** — the 8-network numbers in the paper |
| **Ablation data** | `final_benchmark_none.csv` — uniform-priority arm (for the priority comparison) |
| **Read the numbers** | `python3 aggregate_final.py` |
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

Separately, for the paper's "priority restores precision" claim:

```
rerun_none_priority.sh   →  final_benchmark_none.csv    (same 8 networks, --priority-mode none)
```

---

## Files

### Scripts — run these
| File | What it does |
|---|---|
| `run_final_benchmark.sh` | Main runner: 8 networks, four failure families, cycle-aware contingency priorities. Writes `final_benchmark.csv`/`.log`. |
| `rerun_none_priority.sh` | Uniform-priority ablation (`--priority-mode none`) → `final_benchmark_none.csv`. |
| `aggregate_final.py [csv]` | Pools a results CSV into per-family / per-network FMS + precision/recall tables. Defaults to `final_benchmark.csv`. |
| `paper_numbers.py` | Prints the exact values (with bootstrap CIs) that fill the paper's `\dtba` placeholders, from `final_benchmark.csv`. |

### Diagnostics — one-off investigations (not part of the main pipeline)
| File | What it answers |
|---|---|
| `margin_sweep.py` | Held-out selection of the importer's capacity margin (Supp. Mat. S5). |
| `diag_precision.py` | Why is flow-module precision low (over-prediction of criticality)? |
| `diag_orientation.py` | Is the low precision caused by fixed pipe orientation rather than capacity? |

### Data
| File | What it is |
|---|---|
| **`final_benchmark.csv`** / `.log` | **CANONICAL** 8-network result (post pump-fed-tank fix). The paper's numbers. |
| `final_benchmark_none.csv` / `.log` | Uniform-priority ablation. |

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
