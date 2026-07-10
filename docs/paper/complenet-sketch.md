# Paper sketch — Complex Networks & Their Applications

**Target venue:** International Conference on Complex Networks and their Applications (complexnetworks.org).
**Format:** full paper, 8–10 pages recommended, hard cap 12 pages including bibliography (Springer *Studies in Computational Intelligence* style).
**Status:** sketch — section-by-section content plan with figures, tables, page budget, and the experiments still to run.

---

## Title (working)

> **Knowledge-Driven Cascading-Failure Propagation That Emulates Hydraulic Simulation: the SourceToDemands Heuristic Validated Against EPANET**

Alternatives:
- *A Low-Data Flow Heuristic for Cascading Failures in Interdependent Infrastructure, with Hydraulic Ground-Truth Validation*
- *From Pipes to Priorities: Emulating Pressure-Driven Hydraulics with Discrete Network Propagation*

## One-paragraph thesis

Cascading-failure analysis of critical infrastructure usually forces a choice: **data-driven physical simulators** (EPANET/WNTR for water) that are faithful but demand full physical parameterization and a solver per domain, or **abstract topological models** (percolation, Motter–Lai) that generalize but lose engineering fidelity. We present a middle layer: a **discrete, knowledge-driven propagation model** operating on integer functionality levels `1..N` with two heuristic families — **SourceToDemands** (priority-aware min-cost max-flow with served-ratio quantization) for commodity flows, and **Requisite** (logical aggregation over deliverables) for threshold dependencies — composed by a monotone **propose → guard → commit** pipeline. The model needs only topology, capacities, demands, priorities and categorical dependency declarations — no PDEs, no solver per domain. We show it can **reliably emulate a real hydraulic simulator**: an automated EPANET `.inp` importer parameterizes the model from short hydraulic sweeps, and across six networks (three textbook, three real Italian aqueducts, up to 3,300 junctions) the engine's post-failure functionality levels match pressure-driven WNTR ground truth with a demand-weighted **Functionality Match Score of 0.97–0.99**, holding up under both random failure and, more weakly (0.85-0.92), spatially-clustered and capacity-targeted attack. Because the Requisite layer is domain-agnostic, the same validated model extends beyond hydraulics with a single edge: power blackouts hitting pumps, operator/personnel dependencies, SCADA/digital layers — interdependencies no hydraulic solver can express.

**Provisional flag on the 0.97-0.99 headline number**: it was measured before a determinism bug fix in the validation harness (§5.1) and before the failure-family mix was broadened beyond random breaks/demand spikes (§5.6); the first post-fix, full-mix re-run landed at 0.960 (Net1+Net3, 3 seeds) and 0.920 (three real aqueducts, 1 seed) — still strong, but this range needs to be re-confirmed with ≥3 seeds on every network (item 1 in "Experiments still to run") before it goes in the abstract. Don't quote 0.97-0.99 without re-running.

---

## Section plan

### 1. Introduction (~1 page)

- Problem: cascading failures in critical infrastructure are **cross-domain** (water depends on power, operators, ICT), but high-fidelity simulators are single-domain and data-hungry; operators of small/medium utilities rarely have calibrated models for every layer.
- Gap: between physical simulation (faithful, closed-domain) and topological abstraction (general, unfaithful). Interdependency studies (Buldyrev et al.) use percolation-style models whose predictions are hard to trust for engineering decisions.
- Contribution list:
  1. A discrete monotone propagation model (propose→guard→commit) combining flow allocation (SourceToDemands) and logical aggregation (Requisite) with per-node guard parameters (dependency level, backup with time-deferred failure).
  2. An automated parameterization pipeline from EPANET `.inp` files: hydraulic sweeps derive per-pipe capacity, flow direction, and demand-shedding priorities; skeletonization respects a node budget while conserving demand.
  3. A validation methodology and metric (**FMS**) comparing the heuristic engine's per-consumer functionality levels against pressure-driven WNTR ground truth over randomized break/surge scenarios; aggregate 0.97–0.99 on six networks including three real utility exports.
  4. A demonstration that the same model couples external layers (power, personnel, digital) with zero solver changes — the interdependency case hydraulic simulators cannot express.
- Explicitly frame the `.inp` study as a **stress test of emulation capability**, not the end goal: if the low-data model reproduces the one domain where ground truth exists, its cross-domain extensions inherit credibility.

### 2. Related work (~0.75 page)

- Interdependent-network cascades: Buldyrev et al. 2010 (Nature), Rinaldi et al. 2001 (interdependency taxonomy), Ouyang 2014 (review of interdependent CI modeling — puts our model in the "network flow-based" family).
- Flow/capacity cascade models: Motter & Lai 2002 (load redistribution), Crucitti et al. 2004; note their loads are betweenness proxies, not commodity flows against demands.
- Water-network tooling: EPANET (Rossman), WNTR (Klise et al. 2017) incl. resilience metrics and PDD semantics; skeletonization literature.
- Functional-state / HAZUS-style discrete damage scales — precedent for integer functionality levels.
- Positioning sentence: to our knowledge no prior work *quantifies* how well a solver-free network-flow heuristic reproduces PDD hydraulic outcomes per-consumer; validation is usually topological (connectivity) or aggregate (total served demand).

### 3. The propagation model (~2.25 pages)

Presented as a formal model, self-contained (reader needs no CASCADE knowledge):

- **3.1 Elements and functionality.** Directed multigraph, nodes/edges carry functionality `f ∈ {1..N}` (1 = failed, N = nominal). Categories with two types. Deliverable of an edge: `L(u→v) = min(f_u, f_uv)`.
- **3.2 SourceToDemands (flow) proposal.** Per category: super-source → sources (capacity = supply × midpoint functionality scaling `(f−0.5)/N`, top = 1, bottom = 0) → capacitated edges/inline nodes → demand sinks with priority-scaled rewards; min-cost max-flow; `served_ratio = delivered/demand`; quantization `P_flow = max(1, ceil(served_ratio · N))`. State the integer-capacity implementation detail only as "fixed-point scaling" (one sentence — it matters for reproducibility).
- **3.3 Requisite (logical) proposal.** Universal pass: group incoming edges by source category, `best_of` (max) within group — redundancy semantics — `worst_of` (min) across groups — conjunctive semantics; runs for every node so every edge-implied dependency is visible without declarations. Other operators (majority, average, median) exist; defaults suffice for the paper.
- **3.4 Guards.** `dependency_level d ∈ 1..N`: attenuation `P' = min(f_current, P + (N − d))`. `backup`: defers the drop into a countdown `functionality_time = backup_duration` (tank reserves, generator fuel — same mechanism). Guard defaults are worst-case (full dependency) when undeclared → low-data-friendly.
- **3.5 Commit and convergence.** `f ← min(f, P)` per round until fixed point; monotone on a bounded lattice ⇒ termination guaranteed. One short proposition + 3-line proof.
- **3.6 What the model does *not* need.** Explicit table contrasting inputs: EPANET (diameters, roughness, elevations, curves, patterns, solver) vs. our model (topology, capacities, demands, priorities, categorical tags). This table carries the "low-data / knowledge-driven" claim.
- *(Cut if page-tight: responsibility share — mention in one sentence as attribution output, cite the tool.)*

### 4. Parameterizing from data: the EPANET importer (~1.75 pages)

Frame: the model's parameters are few but must be *right*; when a hydraulic model exists, derive them from it automatically. Pipeline figure: **parse → hydraulic sweeps → skeletonize → orient → map**.

- **4.1 Structural mapping.** Condensed version of the ADR-0012 table (reservoir/tank → source, demanding junction → sink, pump/valve → inline Requisite node, pipe → edge). Tanks: volume ÷ downstream demand → `backup_duration`.
- **4.2 Capacity and orientation from stressed hydraulics.** Demand-multiplier PDD sweep (1×→8×); per-pipe capacity `π/4·d²·v_peak` from **peak-of-sweep** velocity (idle-flow velocity understates capacity — quantify with the Cassacco 22/67→8/67 regression); direction from the **sign of simulated flow** (34% of Net3 pipes flow opposite their file orientation); bidirectional pipes → two directed edges splitting one physical capacity; low-confidence single-sided readings hedged with a minimum reverse share ("when uncertain, split — a wrong single direction orphans whole branches, an over-generous split costs almost nothing"). Contingency samples (20 single-link closures) to size backup mains the demand sweep never stresses.
- **4.3 Priorities from failure order.** PDD sweep on the original network: the multiplier step where a junction first drops below 90% served → its shedding priority; transferred onto the skeleton by demand-weighted averaging.
- **4.4 Skeletonization.** WNTR skeletonize, binary search over the diameter-threshold ladder to a node budget; demand mass conserved.
- Keep §4 tight — it is methodology serving the validation, not the contribution headline. The war stories (velocity-sign bug, global default pattern bug) compress to one sentence each where they justify a design rule.

### 5. Validation: emulating WNTR (~1.75 pages)

- **5.1 Protocol.** Randomized situations from five families (`_KINDS` in `scripts/validate_faithfulness.py`), not just breaks and demand spikes: **break** (1-3 uniformly random pipe/pump closures), **hot** (a network-wide moderate demand increase — a broad random 15-40% of junctions at ×1.2-1.8, framed as an ordinary hot/dry spell, not a firefighting-scale event no standard backed), **both**, **cluster** (several breaks concentrated within 2 topological hops of a random epicenter — a localized-hazard stand-in: trench collapse, small earthquake), and **targeted** (breaks concentrated on the top-10%-by-diameter trunk mains and pumps — the standard random-vs-targeted contrast in the network-robustness literature, Albert-Jeong-Barabási/Motter-Lai). Each applied identically to (a) the real WNTR model → PDD steady state → per-junction served ratio → quantized to a level **using the engine's own quantization rule** (methodological point: identical rounding on both sides, or the metric measures rounding drift); (b) the imported CASCADE project → engine propagation → per-junction level. **A determinism bug was found and fixed during this pass**: the importer's contingency-sample link selection built its candidate pool via `list(set(...) | set(...))` before a seeded sample — Python's per-process hash-seed randomization of `set` iteration order silently defeated the seed, so identical `--seed` runs previously produced different imports and different FMS (observed: 0.907/0.947/0.980 on three successive identical-command runs). Fixed (sort before sampling); post-fix repeat runs agree to the 3rd decimal. **Numbers measured before this fix (below, and in ADR-0012) should be treated as one draw from a small noise band, not exact — the qualitative conclusions replicate, the exact figures don't need to.**
- **5.2 Metric.** `FMS = 1 − weighted_mean(|level_true − level_model|)/(N−1)`, demand-weighted, ∈ [0,1]. Compared only on demand-bearing junctions (the only elements with unambiguous continuous ground truth). **Secondary binary metric**: threshold both sides to critical (level 1, no service) vs operational (level > 1) and report a confusion matrix / precision / recall / F1 — unweighted, one junction = one sample. Post-fix, full 5-family mix: on Net1+Net3 (3 seeds × 30 situations) recall ranges 0.964-1.000 by seed, not the flat 1.000 the break/hot-only mix gave; pooled across the three real aqueducts (seed 5, 15 situations each) recall drops to **0.611** — materially lower than the break/hot-only mix suggested. **The "never misses a truly critical junction" claim does not survive the fuller scenario mix as a blanket statement — it still holds for break/hot/both, it does not hold once cluster/targeted are included.** Precision stays the weaker number throughout (driven by class imbalance and the coarse level-1 cutoff, as before) and needs the same caveat as previously noted — **flag both before using in the abstract**; FMS stays the paper's primary claim.
- **5.3 Networks.** Net1, Net3, Net6 (3,300 junctions, 61 pumps, 124 controls) + real aqueducts Zampis (607 j, 2 sources), Tarcento (439 j, pump + 3 tanks), Cassacco (417 j, 2 reservoirs). **Check with owner before naming the utilities/locations — may need "three aqueducts in northern Italy".**
- **5.4 Results table.** Post-determinism-fix, full 5-family mix: synthetic (Net1+Net3, 3 seeds × 30 situations) aggregate FMS 0.960 (seed range 0.942-0.973, sd≈0.013); Net6 alone (1 seed, 15 situations) 0.992; real aqueducts pooled (Cassacco+Zampis+Tarcento, seed 5, 15 situations each) 0.920 (Cassacco 0.910, Zampis 0.925, Tarcento 0.926 individually). **Re-run with more seeds for camera-ready, but the fuller scenario mix + fixed determinism make these numbers trustworthy as a starting point, unlike the pre-fix ones.**
- **5.5 Ablation (the strongest table).** FMS as importer components toggle: naive import (file orientation + flat 1 m/s velocity) → +signed-flow orientation → +peak-of-sweep capacity → +contingency samples → +hedged splitting. Existing measurements: 0.753 → 0.958 → 0.980 → 0.988. Message: *the heuristic engine is not intrinsically approximate — parameter quality is nearly everything.* This directly supports the "knowledge-driven" thesis: knowledge in, fidelity out. **These numbers predate the determinism fix (5.1) — re-run before camera-ready.**
- **5.6 Robustness by failure family (new — a genuine, reportable finding, not just a caveat).** Fidelity is not uniform across `_KINDS`. Synthetic (3-seed pooled means): hot 1.000, break 0.978, cluster 0.965, both 0.946, **targeted 0.918** — consistently the weakest family across all 3 seeds (0.838/0.970/0.946). Real aqueducts (seed 5, pooled): cluster 0.946, hot 0.938, both 0.944, break 0.927, **targeted 0.854** — again weakest, by a wider margin. Frame honestly: *targeted attack on trunk mains/pumps is where the heuristic's fidelity is thinnest, though still ≥0.85 in the worst case observed* — this is the right result to report to a complex-networks audience that will otherwise assume "random failure only" validation is the whole story. **Open item, not yet root-caused:** pooled across the full mix, Tarcento's binary recall (0.086) is a striking outlier vs. Cassacco (0.872) and Zampis (0.818) on the same run; 79% of its pipes get the bidirectional-split treatment (vs. Zampis 87%, Cassacco 51%) so that alone doesn't explain it — leading hypothesis is its single-pump/three-tank topology, unverified. **Do not report Tarcento-specific recall in the paper until this is resolved**; Cassacco/Zampis individually and the network-pooled aggregate are unaffected.
- **5.7 Threshold sensitivity (new — strengthens the fidelity claim).** Two hardcoded ground-truth assumptions (`required_pressure`, `minimum_pressure` for the PDD solve) and the quantization granularity (`n_levels`) were suspected load-bearing for the headline FMS without ever being varied — now they have been (`--required-pressure`/`--minimum-pressure` flags added to the harness). On Net1+Net3 (seed 7, 20 situations, post-fix): required_pressure ∈ {15,20,25} m → FMS ∈ {0.942, 0.944, 0.942}; minimum_pressure 0→5 m → 0.942 (no change); n_levels 3→5 → 0.944→0.948. All within the noise band of re-running the identical config — **the aggregate FMS is not an artifact of one arbitrary service-pressure convention or the specific (coarse) quantization chosen**, which pre-empts an obvious reviewer question.
- **5.8 Cost.** Wall-clock: one engine propagation vs. one WNTR PDD solve; import one-time cost (~4 s / 420 nodes; sweeps ~0.4 s / 20 contingency solves on Net3). **Measurement still to run** — the speed argument needs a number, especially for many-scenario workloads (Monte Carlo resilience, N−k screening, Shapley-style attribution) where the solver is called thousands of times.

### 6. Beyond hydraulics: coupling external layers (~1 page + 1 figure)

The payoff section — why emulation fidelity matters:

- The Requisite pass is domain-agnostic: any node/edge tagged with a category participates. Adding an interdependency = adding an edge, no new solver.
- **Worked scenario (run for the paper, qualitative + one number):** Net3 or Tarcento with a **power layer** (one grid node feeding all pumps — the importer's "Blackout" hazard is exactly this with the grid node implicit) and an **operator layer** (a personnel node feeding valves/treatment). Kill the grid node → pumps drop → flow pass propagates the shortage → tank backups defer downstream failure by `backup_duration` → a temporal jump realizes it. Report the served-demand trajectory.
- Enumerate further layers with one clause each: SCADA/digital (telemetry loss degrades valve control), materials/chemicals supply (treatment plant Requisite input), finance (deferred maintenance as slow functionality decay), communications. Cite Rinaldi's taxonomy: these are its physical/cyber/logical interdependency classes, expressible in one formalism.
- Honesty paragraph: cross-layer results are **not validated against ground truth** (none exists — that is precisely the point); the hydraulic study bounds the intra-layer error, cross-layer coupling is exact by construction (logical), so composite error is dominated by the flow layers.

### 7. Limitations & future work (~0.5 page)

- Steady-state snapshots, monotone within a run; recovery is a separate timeline mechanism, not modeled here.
- Quantization to N levels loses sub-level information (FMS measures exactly this residual).
- Flow attribution (responsibility) uses a provisional uniform-blame rule.
- Time-of-day flow reversal (tank fill/drain cycles) deliberately out of scope of the orientation sweep.
- Validation covers water; power/gas importers would repeat the methodology (a template, `core/importers/<format>/`).

### 8. Conclusion (~0.25 page)

Restate: knowledge-driven propagation + automated parameterization ≈ simulation fidelity (FMS ≥ 0.97) at network-flow cost, with interdependency expressiveness no single-domain simulator has.

---

## Figures (5) & tables (3)

| # | Type | Content | Source |
|---|---|---|---|
| F1 | diagram | propose→guard→commit pipeline; flow + logical passes merging into P | draw (TikZ/SVG) |
| F2 | diagram | importer pipeline parse→sweep→skeletonize→orient→map, with what each sweep derives | draw |
| F3 | chart | ablation FMS bar/step chart (0.753→0.988) | existing numbers + re-run |
| F4 | map/canvas | one real aqueduct rendered in CASCADE, pre/post cascade coloring | app screenshot or matplotlib from JSON |
| F5 | diagram | multi-layer coupling sketch (water + power + operator), the §6 scenario | draw |
| T1 | table | model inputs vs EPANET inputs (the low-data claim) | write |
| T2 | table | EPANET→model mapping rules (condensed ADR-0012) | condense |
| T3 | table | per-network FMS results, mean ± sd over seeds; network stats columns | re-run harness |

## Page budget (10 pp target)

intro 1.0 · related 0.75 · model 2.25 · importer 1.75 · validation 1.75 · extension 1.0 · limitations+conclusion 0.75 · bibliography ~0.75 = **10.0**. Slack to 12 if reviewers of a draft want more.

## Experiments still to run (blocking camera-ready numbers)

1. ~~Fresh FMS runs, ≥3 seeds × ≥30 situations per network~~ — **done for Net1+Net3 (§5.4)**; still need Net6 + real aqueducts at ≥3 seeds each (currently 1 seed) before camera-ready.
2. **Runtime benchmark**: engine propagation vs WNTR PDD solve per network size; import one-time cost. (Small script; `benchmark_engine.py` is a starting point.)
3. **§6 multi-layer scenario**: build the water+power+operator project (Tarcento import + a handful of manual nodes/edges), run blackout + temporal jump, export trajectory.
4. Optional if space: sensitivity of FMS to parameter noise (perturb capacities ±20%) — strengthens the "knowledge-driven, robust" claim.
5. ~~Robustness beyond independent random failure (clustered/targeted attack)~~ — **done (§5.6)**: targeted attack on trunk mains/pumps is the weakest scenario family (0.85-0.92 vs. 0.96-0.99 aggregate) but doesn't collapse. Worth its own paragraph/table in the paper, not just a footnote — a complex-networks audience will ask for exactly this.
6. ~~Ground-truth threshold sensitivity (required/minimum pressure, n_levels)~~ — **done (§5.7)**: FMS is insensitive to all three within the range tested.
7. **New, blocking**: isolate why Tarcento's binary recall (0.086 pooled) is an outlier vs. Cassacco (0.872)/Zampis (0.818) on the same run — see ADR-0012 addendum. Needed before any per-network binary-metric table can safely include Tarcento.
8. **New, non-blocking but recommended**: re-run the §5.5 ablation table under the fixed (deterministic) harness — the existing 0.753→0.988 progression was measured before the determinism fix and should be reproduced to confirm the exact figures, even though the qualitative story is expected to hold.

## Open items for the owner

- Authors, affiliations, funding acknowledgements.
- Can the Friuli utilities be named? (Persistence-boundary instinct suggests anonymizing to "three aqueducts in NE Italy" unless permission exists.)
- Engine openness statement: ADR-0009 says the engine ships open with the paper — confirm the artifact/repository link to include.
- Which conference year/deadline — check the current CFP before formatting (Springer SCI template).

## Bibliography candidates (~15 refs)

Buldyrev 2010; Rinaldi 2001; Ouyang 2014; Motter & Lai 2002; Crucitti 2004; Rossman EPANET 2.2 manual; Klise 2017 (WNTR); a PDD reference (Wagner 1988 or Gupta & Bhave); skeletonization ref; HAZUS or functionality-scale ref; interdependent CI resilience review; min-cost-flow (Ahuja–Magnanti–Orlin, book); percolation on interdependent lattices follow-up; a water-distribution criticality/N−k study; complex-networks resilience survey.
