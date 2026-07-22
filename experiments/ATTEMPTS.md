# Experiments log — every attempt, its idea, and what happened

The institutional memory of the engine/importer fidelity work (2026-07).
Benchmark throughout: **FMS** (demand-weighted level agreement between
CASCADE's propagation and a live WNTR/EPANET PDD solve of the same
situation), swept over generated situations on Net1/Net3/Net6 + three real
aqueduct exports (Cassacco, Tarcento, Zampis — anonymized, never committed).
"Worst-10" = the 10 lowest-FMS situations across networks
(`collect_worst_situations.py` → `worst-situations/`, gitignored).

Legend: ✅ adopted / recommended · ❌ tried, worse or no effect · ⚠️ open.

---

## 1. Priority derivation (which junctions the engine sheds first)

| attempt | idea | result |
|---|---|---|
| ❌ Demand-multiplier failure-order sweep (`scarcity_priorities`, shipped) | Junctions WNTR abandons first as demand scales → low engine priority | Works, but its FMS contribution measured ≈ **0.000** (E3′ ablation) |
| ❌ Single-link-closure failure frequency (`contingency_priorities`) | Priority from *structural* fragility (who fails under closures), the question shedding actually answers | Also ≈ 0 FMS delta (`archive/complenet-sweeps/prio_contingency.csv`) |
| ❌ No priorities at all | Ablated arm | Indistinguishable (`prio_none.csv`; re-confirmed on worst-10, ≤0.01 everywhere) |

**Conclusion (superseded 2026-07-16, see below)**: priority is irrelevant to
*hydraulic-fidelity emulation* under the priority-greedy LP. Kept in
schema/UI regardless — it's the right lever for hand-built networks with no
.inp ground truth.

### 1a. Priority derivation UNDER TIERED FAIR-SHARE (2026-07-16)

The null result above was measured under the LP (where priority is only a
tie-break reward) and under a harness fair-share that ignored priority. The
shipped `tiered_fair_share` (ADR-0014) uses priority as **strict preemption
tiers**, and there the derivation matters a lot — in both directions
(`priority_modes_fairshare.py`, real engine, worst-10 kits, as-imported
capacities, raw FMS):

| priority mode | mean FMS | notes |
|---|---|---|
| pressure-margin (NEW: deciles of baseline PDD pressure surplus) | **0.665** | Zampis kits transformed (0.27→0.78, 0.40→0.62); one bad loss (Net3 kit 01: 0.62→0.34) |
| sweep (shipped importer derivation) | 0.620 | |
| none (single tier = pure max-min) | 0.514 | catastrophic on kits 04/10 (0.14, 0.02) — uniform pain is NOT what PDD does |
| (reference: priority-greedy LP + sweep) | 0.724 | |

Takeaways: (1) under fair-share, wrong tiers actively hurt — strict
preemption zeroes low tiers under scarcity, so 10 fine-grained tiers amplify
derivation errors; (2) **pressure-margin beats the demand sweep on average**
and is the physically-grounded derivation (PDD sheds where pressure margin
is thinnest), but with high variance — not a safe default switch yet;
(3) all of this is second-order next to the capacity fix (§2): these kits'
scarcity is largely an artifact of under-imported capacities, and with
margin ×2 + full-duplex the allocation/priority axis collapses to ≈0.92
regardless. (4) For *emulation* use, the LP still beats fair-share on
as-imported networks — worth considering having the .inp importer emit an
explicit `allocation: priority_greedy` on its graph type while fair-share
stays the hand-modelling default.

**Verification for the paper's simple story (2026-07-16, capfix +
fair-share, sweep vs none priorities, raw FMS)**: with margin ×2 +
full-duplex capacities, priorities have **zero effect on 9 of 10 kits**
(identical FMS to 3 decimals); the single exception is Zampis kit 06
(0.616 sweep vs 0.270 none — the network with the known `PFRC_*` import
anomaly). Means 0.858 vs 0.824. This supports presenting fair-share with
priority as a pure expert-knowledge knob: once capacities are parameterized
correctly, derived priorities are not needed for fidelity.

## 2. Pipe capacity discovery (importer)

| attempt | idea | result |
|---|---|---|
| ❌ Constant design velocity (1–2 m/s), no simulation | capacity = π/4·d²·v_design | Much worse than the sweep (worst-10 mean 0.681–0.791 vs 0.770 control) — the sweep's *relative* profile is real signal |
| ❌ Hazen-Williams design flow from pipe physics alone, no simulation (`physical_capacity_variants.py`) | capacity = 0.278·C·D^2.63·S^0.54 from imported diameter+roughness only — zero WNTR sweep needed | Correlates with shipped capacity (log-log Pearson r=0.84 across 3271 pooled pipes) but the correlation is ~entirely diameter (r=0.844 for diameter alone; roughness spans only 91–199 vs diameter's 2+ orders of magnitude, contributes almost nothing) — best-fit-scaled variant on worst-10: mean 0.821→0.724, worse on 7/10, tied 3/10, never better. A per-pipe geometric formula can't see what the sweep sees: topology + demand distribution (a fat pipe past a light-demand branch needs no capacity; D,C alone can't tell) |
| ✅ Demand-multiplier sweep peak velocity (shipped) | "What can this pipe do when pushed" ≠ its idle flow | The baseline everything else builds on |
| ✅ + contingency closures, trunk-biased → exhaustive trunk + N-2 pairs (shipped) | Backup pipes only reveal capacity when something else closes (Net3 pipe 317: 0.44→several× m/s) | Headline import config (E3″/E3‴; `cap_*.csv`, `pairsweep_*.csv` in archive) |
| ❌ Strict noise floor + dominance ratio for orientation | Be "smarter" about near-zero readings | Reverted — confidently wrong direction can disconnect a whole mesh branch (ADR-0012 "Pipe capacity / orientation") |
| ✅ **Capacity margin ×2** (`importer_variants.py`, recommended, not yet shipped) | Sweep peak is a *lower bound*; EPANET has no hard cap, head loss absorbs ~2× overshoot | Worst-10 mean 0.770→0.878 alone; ×2 is the knee — ×3/×5 buy little and grow over-optimism (231→313 Σopt), regress Zampis kit 06 |
| ❌ Velocity floor 0.5–2 m/s | Floor only the weakly-observed pipes | Helps (0.840 @ 2 m/s) but strictly dominated by the plain margin |

## 3. Orientation / direction (importer)

| attempt | idea | result |
|---|---|---|
| ✅ Sign-of-simulated-flow orientation + proportional bidirectional split (shipped) | Orient by physics, not BFS guess | Shipped; but the *proportional share* is the flaw below |
| ✅ **Full-duplex split (`split_full`, recommended)** | Both directions of a two-way pipe get the FULL physical capacity (a pipe carries all of it either way, just not both at once) | +0.05 mean on top of margin ×2 → combined **0.927**, 8/2/0 vs control; fixes tank-feeder reversals (recharge-dominated share starved the discharge direction) |
| ❌ Synthetic reverse edge on every one-way pipe (`bidir`) | EPANET links are undirected; maybe CASCADE needs both directions everywhere | No help, slight harm from degenerate ties — the sweep's one-way calls are trustworthy; only the split *shares* were wrong |
| ❌ Half-capacity floors (`split_floor_0.5`) | Hedge between proportional and full | Worse than full duplex |

## 4. Tanks / pumps / valves / supply (importer)

| attempt | idea | result |
|---|---|---|
| ❌ Uncap pumps (curve max) and valves | Curve-derived caps might undersize | **Zero effect** on all 10 worst kits — not binding |
| ❌ Unbounded source supply | "supply = Σ incident pipe capacity" might throttle | **Zero effect** — not binding |

No tank/pump/valve capacity issue exists in the worst situations; the
pessimism was pipes (capacity level + split shares) all along.

## 5. Allocation algorithm (engine-side, tested via monkeypatch harness only)

| attempt | idea | result |
|---|---|---|
| ❌ Global proportional water-filling | One θ scaling every consumer | Disaster (worst-10 mean 0.373) — punishes consumers unrelated to the bottleneck |
| ❌→ moot: Max-min fair-share (ascending-demand sequential max-flow) | Spread scarcity like real pressure does, vs the LP's winner-take-all | Won 7/10 on *as-imported* capacities (0.774 vs 0.724) — but with the capacity fix applied it's **slightly worse** (0.918 vs 0.927) and ~100× slower. Its wins were compensating for under-imported capacity. **Keep the shipped LP.** |
| ❌ Bisection-based fair-share | Shared-θ freeze/continue | Buggy by construction — max-flow's arbitrary decomposition makes per-consumer attainment unreadable (FMS≈0 on kit 01) |

## 6. Benchmark (ground truth) corrections

| finding | consequence |
|---|---|
| ✅ Net6 global default pattern silently scaled "fixed" demands ×0.1 | Fixed in `_fixed_demand_model` (shipped) |
| ⚠️ **Singular PDD on source-severed components**: WNTR converges to an arbitrary internal circulation that *reads* "fully served" | Kits 05/07 (Cassacco): CASCADE's all-critical answer was **correct**, the "ground truth" wrong. Corrected in `importer_variants.py` (undirected source-reachability → level 1); **`scripts/validate_faithfulness.py` still has this artifact** — fixing it will raise reported FMS everywhere |
| Set-iteration nondeterminism (hash seed → edge insertion order → degenerate LP tie flips) | Root cause of the original engine bug AND a harness bug here; `engine/flow.py` retains the latent property (`members` set) — worth `sorted()` when next touched |

## 7. Still open

- ⚠️ **Zampis kit 09** (targeted#26, 198 pessimistic mismatches): immune to
  capacity ×5, full duplex, reverse edges, unbounded supply, and every
  allocation algorithm — strongest evidence for the suspected `PFRC_*`
  sub-network import anomaly (likely a mis-modelled connection). Needs its
  own investigation before trusting Zampis numbers.
- ⚠️ Apply the winning combo (margin ×2 + full-duplex split) for real in
  `core/importers/inp/map.py`, and the severed-component correction in
  `validate_faithfulness.py`.

## Files

This file is the **single tracked narrative** for all experiment attempts —
every other doc (ADRs, CONTEXT.md, project docs) links here instead of
retelling the journey. Tracked alongside it: the harness scripts only.

- `importer_variants.py` — importer-attribute A/B (22 variants × worst-10)
- `algorithm_variants.py` — allocation-algorithm A/B (monkeypatch harness)
- `priority_modes_fairshare.py` — priority-derivation ablation under tiered fair-share
- `collect_worst_situations.py` — builds the worst-10 kits; `render_variant_bundles.py` — bakes variant results into loadable bundles for screenshots
- `run_headline_fairshare.sh` — the paper's headline benchmark configuration
- `archive/` (gitignored, local-only) — full detail: per-experiment reports, result CSVs, logs, CompleNet sweep outputs
- `worst-situations/` (gitignored, **never commit** — real aqueduct data): per-kit `scenario.bundle.json`, engine/EPANET results, `combined5.png` visual comparisons

## 8. Headline benchmark (2026-07-16, +Net2 2026-07-16) — the paper's numbers

Full re-run after shipping the capacity fix: 6 networks (Net1, Net2, Net3,
Cassacco, Tarcento, Zampis) × 3 seeds × 30 situations + exhaustive tanks,
exhaustive-trunk + 30 N-2 pairs + 20 uniform contingencies, **engine default
tiered fair-share, NO derived priorities (`--priority-mode none`)**,
corrected ground truth (severed-component + convergence checks). Net2 added
after the original 5-network run to restore parity with the paper's
originally-drafted "six networks, three textbook" framing; its known
negative-demand well junction is handled correctly by the shipped
injection-well fix (§4), no separate treatment needed. Raw data:
`archive/results/headline_fairshare_none.csv` (537 rows; the original
444-row 5-network file plus 93 Net2 rows, `net2_addon.csv`, merged in).

| | mean FMS | min | n |
|---|---:|---:|---:|
| **AGGREGATE** | **0.958** | | 537 |
| Net1 | 0.988 | 0.818 | 93 |
| Net2 | 0.937 | 0.232 | 93 |
| Net3 | 0.990 | 0.857 | 99 |
| Cassacco | 0.992 | 0.823 | 90 |
| Tarcento | 0.990 | 0.370 | 70 |
| Zampis | 0.857 | 0.002 | 92 |

By family: break 0.983, tank 0.976, cluster 0.968, hot 0.962, targeted
0.939, both 0.934 — **"both" (demand-surge stacked on breaks) is the
actual weakest family, not targeted alone**; the paper's Discussion
originally claimed targeted attack was "consistently the weakest," which
was already imprecise before Net2 was added (both was 0.939 in the
5-network run too) — corrected in the paper text. Zampis remains the
outlier (known `PFRC_*` import anomaly, ATTEMPTS §7) with a heavy tail —
disclosed in the paper's limitations. Every other network sits ≈0.94–0.99
with **zero fitted parameters** (no priorities, no per-network tuning).

Binary-confusion recheck (Appendix~app:extended in the paper): the
original plan expected recall on the critical class to degrade under
harder families. It doesn't (0.81 under break → 0.97 under both,
pooled n=537) — **precision** collapses instead (0.92 → 0.35). The
module gets more false-positive-critical, not more false-negative-critical,
as families get harder — consistent with the disclosed pessimism bias, but
the opposite of what was originally predicted.

## 9. Contingency demand multiplier + held-out medium networks (2026-07-21)

Two reviewer-driven probes. Harnesses: `contingency_multiplier_sweep.sh` +
`aggregate_cmult.py` (multiplier); `margin_sweep.py` on downloaded nets
(generalization). Raw: `cmult_*.csv`.

### 9a. Should the demand multiplier scale the CONTINGENCY solves too? — NO (null)

Idea: today the demand-escalation sweep runs 1x..8x but the single-link
contingency solves run at NOMINAL demand (topology change only). Reviewer
intuition: stack demand onto the contingency closures too, sizing backup
pipes from "a break AND a surge at once". Added `contingency_multiplier`
(sim.py `link_flow_profiles`, default 1.0 = shipped) + `--contingency-multiplier`
(validate). Re-ran the full headline protocol (6 nets x 3 seeds x 30 sit,
exhaustive-trunk + 20 uniform + 30 pairs, priority none) per multiplier.

| mult | pooled FMS | break | targeted FMS | mod prec | targeted recall |
|---:|---:|---:|---:|---:|---:|
| 1.0 (shipped) | 0.958 | 0.983 | 0.939 | 0.62 | 0.94 |
| 1.25 | 0.958 | 0.983 | 0.939 | 0.62 | 0.94 |
| 1.5  | 0.957 | 0.974 | 0.939 | 0.60 | 0.94 |
| 1.75 | 0.958 | 0.981 | 0.937 | 0.62 | 0.94 |
| 2.0  | 0.955 | 0.970 | 0.939 | 0.60 | 0.94 |

Flat everywhere; break-FMS if anything DECAYS at the top. The 2.5/3.0 arms
HUNG on Tarcento (its ground truth stops converging >=2.5, see sim.py
`_run_sweep_step` note) — so pushing the multiplier up doesn't just fail to
help, it breaks the oracle. WHY null: capacity is the MAX over all solves,
and the 1x..8x demand sweep already reaches far higher demand than a 1.25-2x
contingency; the contingency's value is the TOPOLOGY change, not the demand
level. Kept `contingency_multiplier=1.0` (orthogonal stressors). No main-text
change — this validates the §4 framing; candidate for a one-line Supp. S2 null.

### 9b. Extending the network sample with held-out MEDIUM networks

Reviewer: 6 nets is thin, reachability looks strong on FMS. Downloaded from
WaterBenchmarkHub (`raw-networks/benchmark/`): Modena (268 j), CTown (388 j,
11 pumps/7 tanks), Balerma (443 j), Pescara, MarchiRural. `>50 j` medium band
— big enough to matter, small enough to converge where the KY nets (ky10/ky4,
thousands of nodes) self-starve.

- **Pescara** — WNTR parse error (KeyError '79'). Dropped.
- **Balerma** — DISCARD. Its own NULL model scores 0.48 (break), i.e. the
  ground-truth PDD solve self-starves (most junctions critical for the
  do-nothing baseline). Same degenerate class as the abandoned KY nets — not
  a valid oracle.
- **Modena, CTown** — VALID. Ordinary-failure FMS GENERALIZES out-of-sample
  (break 0.998 Modena / 0.968 CTown; these nets set no parameter). But
  capacity-targeted DETECTION is poor: precision ~0.14-0.15 (heavy cry-wolf),
  worse than the original six (0.35-0.72).

Is the low precision fixable by the capacity margin? NO — margin sweep on
Modena (10 sit): x2 -> prec 0.17 recall 0.91; x4 -> prec 0.00 recall 0.00;
x8 -> 0.00/0.00. Raising the margin trades all false alarms for MISSED
detections (recall collapses to 0) with FMS barely moving — there is no
margin giving good precision AND recall. Signature of a MIS-SHAPED imported
capacity profile (some pipes badly undersized), which a UNIFORM scalar can't
repair. Coherent with the Zampis/Aqueduct-C story (§7): on real/held-out
exports the residual is dominated by localized capacity-IMPORT defects, not
by the allocation model or a global knob.

Decision: do NOT pool Modena/CTown into the headline (import-quality-bound,
would drag the clean 6-net numbers for the wrong reason). Fold in as a
1-2 sentence held-out GENERALIZATION note in the Discussion instead:
ordinary-failure fidelity holds on truly held-out networks, while
capacity-stress fidelity is bounded by per-network capacity-import quality.
Turns the "depressing" result into evidence for the limitation already claimed.

## 10. Full benchmark rebuild (2026-07-22) — the current setup

Driven by a precision diagnosis (§ below) + owner decisions. Spec:
`docs/paper/benchmark-protocol.md`. Runner: `run_final_benchmark.sh` →
`final_benchmark.csv`.

### Why: precision was the problem, and it was NOT the importer's capacity
Diagnosed the low flow-module precision (cry-wolf over-prediction of criticality).
Ruled out, by direct measurement (diag_precision.py, diag_orientation.py):
- capacity NOT undersized (every pipe <50% utilised even under failure);
- orientation NOT the cause (forcing all-bidirectional changed nothing);
- supply NOT short; subgraph fully connected; baseline 0 criticals.
ROOT CAUSE: hard-capacity max-flow + max-min fair-share SPREADS a rerouting
shortage across many junctions, while PDD CONCENTRATES loss on the pressure-
disadvantaged ones. Bimodal in the margin (Modena targeted: x2 -> 237 crit,
x4 -> 0), so no uniform margin fixes it. The lever is PRIORITY (who gets shed).

### Changes made
1. **Demand `peak_hour`** — coincident system-peak (max total-consumption hour),
   not per-junction peaks (which over-count non-coincident loads). Tanks are
   zero-demand sources already.
2. **Supply model** — RESERVOIRS unbounded (EPANET fixed-head; the old
   sum-of-outlet-pipe-caps overstated yield ~6.4x AND, when made nominal, broke
   multi-source failure vs WNTR's infinite reservoirs — Modena 269: module 242
   vs WNTR 67). TANKS nominal delivered outflow (geometry-limited, meaningful to
   degrade). `nominal_source_outflow` (sim.py), `_supply_for` branches by type.
3. **`max_velocity` = 3.0 m/s default** (was uncapped) — no unphysical capacities.
4. **Adaptive x8 sweep** — one solve at the highest converging multiplier instead
   of an 8-step ramp; Tarcento (fails x8) lands x4 instead of zero-capacity.
5. **Families** — dropped hot/break/both (uninformative). Kept cluster (60 random,
   3 seeds), targeted (top-20%, 10 singles+20 pairs+30 triplets), tank (10/20/30
   isolation combos), **source-failure** (10/20/30 reservoir-outlet-closure combos).
   Deterministic combos (targeted/tank/source), so seeds only vary cluster.
6. **Priority `contingency` rewritten** (now default) — DETERMINISTIC + CYCLE-AWARE
   + SEVERITY. Close only CYCLE trunk links (Tarjan bridge filter — a bridge
   closure only disconnects, which reachability already sees; on the real
   aqueducts 45-62% of links ARE bridges, so this is very selective, though
   near-transparent on the atypically-meshed Modena, 1% bridges). Score by
   demand-weighted deficit `Σ demand·max(0,1-ratio)` over singles+pairs+triplets,
   not a binary 0.9-threshold count. Fixes the old method's sample-dependence,
   threshold cliff, and single-break-only blindness.
7. **Reachability** — a source is removed iff CRITICAL; since source-failure =
   outlet closure, the existing `_severed_junctions` already does this (no change).

### Precision result (Modena targeted, verified)
- old setup, none: **0.18**
- new setup, none: **0.34** (items 1-5 doubled precision on their own, recall 1.00)
- new setup, cycle-aware priority: **~0.37** (0.25->0.37 on a 15-sit subset;
  FP -44%, recall 1.00->0.96). Priority earns its ~2-3x scoring slowdown
  (tiered_fair_share runs per-tier).

### Rejected along the way (negative results, kept honest)
- Nominal RESERVOIR supply — broke source-failure vs infinite-reservoir WNTR.
- Free physics priors (hydraulic-distance, effective-resistance, topological-
  contingency-Reff) — ALL backfired (prec 0.15-0.16 < none's 0.18); vulnerability
  is hydraulic, not static-topological. Only WNTR-contingency-based priority works
  (needs solves → import-only; hand-authored networks get expert-labelled priority).
- System-wide partial source degradation as a family — diffuse regime where a
  trivial flag-all baseline beats the module; replaced by concentrated source
  FAILURE (outlet closure).

Bug fixed: `_demand_value` crashed on a junction referencing a missing demand
pattern (`get_pattern` returns None, not KeyError) — now guarded.
