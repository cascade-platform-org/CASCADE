# Experiments log — the fidelity journey, condensed

Institutional memory of the engine/importer fidelity work (2026-07). Benchmark
throughout: **FMS** (demand-weighted level agreement between CASCADE propagation
and a WNTR/EPANET PDD solve of the same situation), over generated situations on
8 networks — 3 textbook (Net1/2/3), Modena, C-Town, and 3 real Italian aqueducts
(**Aqueduct A/B/C**; anonymized, the `.inp` exports are proprietary utility data and
are never committed). "Worst-10" (early sections) = the 10 lowest-FMS situations.

Legend: ✅ shipped/recommended · ❌ tried, worse/no effect · ⚠️ open.

The exploratory diagnostics (`diag_*`, variant sweeps) were removed once their
conclusions landed here; `archive/` (gitignored) keeps historical CSVs/reports.
Tracked scripts now: `run_final_benchmark.sh` (+ `run_priority_ablation.sh`,
`run_capacity_drill_ablation.sh`), `aggregate_final.py`, `paper_numbers.py`;
full spec in `benchmark-protocol.md`. Sections 1–7 are early attribute-level
findings; 8–13 the benchmark's path to the canonical config; 14–15 the
2026-07-28 steering/residual analysis. **Current canonical (§13): uniform
design-velocity capacity + no priority.**

---

## 1. Priority derivation — a recall lever, not a fidelity fix
Three derivations tried (`scarcity_priorities` demand-order, `contingency_priorities`
structural fragility, none). Under the LP allocation all ≈ 0 FMS effect. Under
the shipped `tiered_fair_share` (strict-preemption tiers, ADR-0014) priority
matters but in *both* directions — wrong tiers actively hurt, since strict
preemption zeroes low tiers under scarcity. A pressure-margin derivation beat the
demand sweep on average (0.665 vs 0.620) but with high variance. **Bottom line
(refined in §13–15):** once capacities are right (§2), derived priority has ~zero
fidelity effect; it is an expert-knowledge knob, not a fidelity fix.

## 2. Pipe capacity discovery
- ✅ **Sweep peak velocity** (demand ×1..8 + trunk-biased contingency closures):
  what a pipe carries when *pushed*, not its idle flow — backup pipes reveal
  capacity only under a closure (Net3 pipe 317: 0.44→several× m/s). The baseline
  everything built on.
- ❌ Solve-free geometric capacity (constant velocity; Hazen-Williams `D,C`
  formula): correlates with the sweep but ~entirely via diameter — blind to
  topology+demand (a fat pipe past light demand needs no capacity). Worse on
  worst-10 — an UNDER-SIZED constant at 1–2 m/s scores **0.681–0.791** vs the
  sweep's 0.927. Read at the time as "the sweep's relative profile carries
  information"; §12–13's full 8-network ablation overturned that — a
  *correctly* sized constant (2.5 m/s) matches the drill. The earlier result
  was an artifact of the size, not evidence for the profile.
- ✅ **Capacity margin ×2** (sweep peak is a lower bound; head loss absorbs ~2×
  overshoot): worst-10 0.770→0.878, ×2 the knee. Swept over
  {1, 1.25, 1.5, 1.75, 2, 3} on six networks (`margin_sweep.py`): flat on Net1,
  Net2, Aqueducts A and B; Net3 0.946→0.998 with the knee at ×1.5; Aqueduct C
  0.136→0.891 by ×2. Pooled 0.828→0.963 from ×1 to ×2, +0.013 more by ×3;
  recall flat within every network, precision tracking FMS. Held-out selection
  on ky10/ky4/Net6 was attempted and abandoned — they do not converge or they
  self-starve at peak demand without per-network calibration.
- **Superseded (§12–13):** a flat uniform design velocity (`area × 2.5 m/s`)
  matches the whole sweep drill across 8 networks — now the shipped default.

## 3. Orientation — direction matters, exact direction does not
- ✅ **Orient by simulated flow sign + full-duplex split** (both directions of a
  two-way pipe get FULL capacity): +0.05 over margin ×2 → 0.927; fixes
  tank-feeder reversals.
- ❌ Reverse edge on every pipe (flow graph effectively undirected, as EPANET's
  links are): **0.772** on the worst-10 — essentially unchanged from the 0.770
  baseline, and occasionally worse via degenerate ties. The sweep's confident
  one-way calls are reliable; the real directional defect was only the
  *proportional* capacity split on pipes already known to be bidirectional.
  Exact orientation is not a lever, but *having* a direction is (§15: removing
  it wrecks directional nets).

## 4. Tanks / pumps / valves — not the worst-10 bottleneck
Uncapping pumps/valves and unbounding source supply had **zero effect** on the
worst-10 — none binding there; the early pessimism was pipe capacity. (Tank
*supply caps* do bind on specific later scenarios — §14.)

## 5. Allocation algorithm — ✅ shipped tiered fair-share
❌ Global proportional water-filling: disaster (0.373). Max-min fair-share beats
the LP on as-imported capacities (0.774 vs 0.724) but the gap vanishes once
capacities are right (0.918 vs 0.927) at ~100× cost — its wins compensated for
under-import. Shipped `tiered_fair_share`: equal-priority consumers degrade
together rather than one being arbitrarily zeroed.

## 6. Benchmark ground-truth corrections
- ✅ Net6 global default pattern silently scaled fixed demands ×0.1 — fixed in
  `_fixed_demand_model`.
- ✅ **Singular PDD on source-severed components**: WNTR converges to an arbitrary
  internal circulation reading "fully served" while summing to ≈0. Post-processed
  in `validate_faithfulness.py`: demand junctions with no undirected path to a
  source → level 1.
- Set-iteration nondeterminism (hash seed → edge order → degenerate tie flips):
  `engine/flow.py` sorts `members`.

## 7. ⚠️ Still open — Aqueduct C tail
Aqueduct C's worst situations (suspected sub-network import anomaly) are
immune to capacity ×5, full-duplex, reverse edges, unbounded supply, and every
allocation — a data defect, not a heuristic one. Disclosed in the paper's
limitations; per-network minima matter more than means for deployment.

## 8–9. Headline evolution (2026-07-16/21) — superseded numbers
First capacity-fixed headline: aggregate FMS 0.958 (6 nets, no priority).
Findings that survived: (a) the weakest family is "both" (surge stacked on
breaks), not targeted alone; (b) under harder families **precision** collapses
(0.92→0.35), not recall — the pessimism bias, opposite of what was predicted.
Nulls: scaling demand on the contingency solves too is orthogonal (no gain, and
breaks the oracle ≥×2.5); held-out Modena/CTown generalize on ordinary failure
but are capacity-import-quality-bound on targeted detection — kept as a
generalization note, not pooled into the headline.

## 10–11. Current benchmark setup + pump-fed tank fix (2026-07-22/23)
Rebuild driven by a precision diagnosis: low precision is NOT
capacity/orientation/supply — it is that hard-capacity max-flow + max-min
fair-share **spreads** a rerouting shortage across many junctions while PDD
**concentrates** it (bimodal in the margin, so no uniform scalar fixes it).
Setup: `peak_hour` demand; reservoirs unbounded, tanks nominal outflow;
`max_velocity`=3.0; adaptive ×8 sweep; families cluster/targeted/tank/source;
cycle-aware contingency priority; reachability source-removal = outlet closure.
- ✅ **Pump-fed tank fix** (`pump_fed_tanks`, `sim.py`): `nominal_source_outflow`
  wrongly capped pump-fed pass-through tanks (reservoir→pump→tank→district, e.g.
  C-Town) at their tiny nominal outflow → mass false starvation (CTown FMS
  0.029). A tank outside every reservoir's *gravity* component (pipes/valves, no
  pumps) is pump-fed → gets incident-pipe capacity. CTown 0.029→0.961.

## 12–13. Capacity method + capacity×priority interaction → the CANONICAL (2026-07-24/28)
A long drill-design exploration (unify capacity+priority ensembles, batched
closures, priority budgets, bidirectional probes) yielded **no clean improvement;
several leads collapsed once capacity was held fixed** — the fast one-knob probes
had silently changed capacity too. Design velocity is insensitive (2.5/3.0/3.5
identical). The decider was the full capacity×priority 2×2 (939 situations,
pooled):

| capacity | priority | P | R | F1 |
|---|---|---|---|---|
| **uniform** | **none** | **0.682** | 0.950 | **0.794** |
| uniform | contingency | 0.634 | 0.980 | 0.770 |
| drill | none | 0.599 | 0.957 | 0.737 |
| drill | contingency | 0.657 | 0.955 | 0.778 |

**Canonical = uniform capacity + no priority** — best precision and F1, no
priority machinery (`run_final_benchmark.sh` → `final_benchmark.csv`; pooled FMS
≈0.92). "Priority restores precision" held only under the drill; under uniform it
*trades* precision for recall (0.68→0.63 P, 0.95→0.98 R), so it is reframed as an
optional **recall lever** (`run_priority_ablation.sh` → `final_benchmark_priority.csv`,
Supp. S5; drill arm: `run_capacity_drill_ablation.sh` → `final_benchmark_drill.csv`).
**Priority auto-derivation was removed from the product** (best precision);
priority stays an expert-set per-node primitive.

## 14. What priority steering can and cannot fix (2026-07-28)
Per-scenario oracle priority (`round(1 + WNTR_ratio·9)`) steers powerfully on
**distributional** failures: Modena worst-10 FMS 0.466→0.831, CTown `cluster#36`
0.04→0.90 (one tier + max-min smears a partial shortage below the critical line;
a high tier concentrates it onto whom WNTR sheds). But a single shared
per-network vector recovers little (≈+0.067) — scenarios protect different
junctions. Ceiling ~0.83 (within-tier fair share splits equally; only 1..10
tiers). Orientation is not a lever here (+0.003–0.008).

**Deep residual = conservative gravity-tank supply caps** (Net3 `cluster#25`,
base = prio = 0.058, no lever moves it). A 4-way max-flow discriminator:
directed+real **48.5%**, directed+supply=∞ **84.9%**, bidir+real **49.9%**,
bidir+supply=∞ **100%** → the binding constraint is SOURCE SUPPLY, not conveyance
or directionality. The break isolates a district onto 3 local gravity tanks;
CASCADE caps each at its nominal outflow while WNTR's t=0 drains them as
fixed-head (measured **6.6×** the cap; tank 3 20×) → 48% vs 134%. A depletion-aware
model read against an instantaneous snapshot — a benchmark-semantics mismatch,
not a bug. **Net3-only:** CTown's stuck tank cases (0.51–0.77) are pump-fed (caps
not binding) — a different, still-unidentified orientation-sensitive mechanism.

## 15. Orientation cost, tank surge, priority as controllability (2026-07-28)
- **Orientation needs the sweep, not the EXHAUSTIVE sweep.** Ranking: correct
  orientation (sweep) ≫ no orientation (bidirectional) > wrong orientation
  (elevation). The elevation proxy fails (flow follows pressure, not gravity;
  precision 0.04–0.75); bidirectional-everywhere is catastrophic on directional
  nets (Aqueduct C F1 0.82→0.42, missed criticals via phantom reroutes). A
  **trunk-biased sample (~48 solves) matches the exhaustive ~68** (Aqueduct C holds
  0.819). The shipped importer already samples; exhaustive is benchmark-only.
- **Tank surge cap** (raise a gravity tank's cap to its measured surge) recovers
  Net3 (FMS 0.875→0.960, P 0.287→0.509, recall flat) but the demand-sweep surge
  measurement DIVERGES on the real aqueducts — a robust cap needs a graph
  max-flow from the tank. Future work; importer unchanged.
- **Priority is validated as CONTROLLABILITY, not fidelity.** It answers a
  normative "who *should* be shed" question WNTR has no concept of, so scoring it
  against the ground truth is a category error. Evidence is EXPRESSIVE RANGE — a
  per-scenario assignment steers the outcome to a specified target (§14:
  0.04→0.90, 0.47→0.83), using each situation's WNTR-served set as a well-defined
  target. Paper Supp. S5; the product ships none by default.
- ⚠️ An empirical **monotonicity** sweep was abandoned: under demand-scaled
  shortage `tiered_fair_share` can collapse TOTAL delivery when consumers split
  into few coarse tiers at extreme scarcity (×2 Modena: 0.71→0.01 once a district
  becomes a separate top tier), so raising priority could non-monotonically hurt
  the protected group. A degenerate edge case (the many-tier real-break oracle
  works fine), so monotonicity is NOT claimed in the paper. Follow-up: does
  `tiered_fair_share` under-deliver with few tiers at extreme scarcity? (Does not
  affect the shipped no-priority default.)
