# Flow-Module Validation Benchmark — Full Protocol, Assumptions, and Open Issues

Status: working reference (2026-07-22). Purpose: state **exactly** how the
flow-module-vs-WNTR benchmark runs, make **every assumption explicit**, and
collect **every known issue** so nothing is silently load-bearing. Read this
before the final run.

Everything below was re-derived from the code this session
(`scripts/validate_faithfulness.py`, `core/importers/inp/*`, `engine/*`), not
from memory. Where a value is a default that matters, it is named.

---

## 0. What the benchmark actually claims (scope)

- It validates **one module** — the capacity-aware fair-share **flow** module —
  against an **independent hydraulic oracle** (WNTR pressure-driven demand).
- It does **NOT** validate: the logical/Requisite mechanism (no independent
  oracle exists), composability across categories, or expert authoring.
- The **operative claim** is *detection*: "quantity-awareness identifies
  junctions that lose service short of disconnection, which topological methods
  miss." WNTR defines truth; the **competitive comparison is vs topological
  baselines**, not vs WNTR (we can only approximate WNTR at best — framing the
  benchmark as "module vs WNTR fidelity" invites *"why not just use WNTR?"*).

> ISSUE-SCOPE: the benchmark measures the *least differentiating* part of the
> project (single-module hydraulic fidelity) and skips the differentiators
> (composition, authoring-from-partial-data). Decide consciously whether to
> add an authoring/abstraction experiment (see §11).

---

## 1. Networks (data)

| network               | role     | pipes | junctions | sources                 | keep?                  |
| --------------------- | -------- | ----- | --------- | ----------------------- | ---------------------- |
| Net1                  | textbook | 12    | 9         | 1 res + tanks           | DROP (trivial)         |
| Net2                  | textbook | 40    | 35        | tanks                   | DROP (trivial)         |
| Net3                  | textbook | 117   | 92        | 2 res, 3 tanks, 2 pumps | keep                   |
| Cassacco (Aqueduct A) | real     | 437   | 417       | 2 res                   | keep                   |
| Tarcento (Aqueduct B) | real     | 499   | ~424      | 2 res, 1 pump           | keep                   |
| Zampis (Aqueduct C)   | real     | 674   | ~?        | res                     | keep (but see ISSUE-C) |

**LOCKED (§11):** keep **all 8** networks (Net1, Net2, Net3, Cassacco, Tarcento,
Zampis, Modena, CTown). Net1/Net2 are small (everything ~perfect, FMS near-ceiling)
but retained per owner decision; Modena/CTown carry import-quality caveats. The
"DROP" column above is the earlier prune proposal — superseded, kept for rationale.

**Excluded networks and why (important — these are the failure boundary):**

- `Balerma` (irrigation, 443 j): **degenerate oracle** — its own null model
  scores 0.48, i.e. the WNTR PDD solve self-starves at nominal demand (most
  junctions read critical for the do-nothing baseline). No valid ground truth.
- `ky10`, `ky4`, `Net6` (thousands of nodes): do not converge / self-starve at
  peak demand under steady-state PDD without per-network calibration; `ky10`
  could not even finish import in 5 min. The entire Kentucky WDSRD dataset is
  this class — not usable here as-is.
- `Modena` (268 j), `CTown` (388 j): converge and are valid **held-out** medium
  networks, used for generalization checks (§11), NOT in the primary set.

> ASSUMPTION-NET: the primary 4 are representative of "complex enough" water
> networks. Textbook Net3 is the only non-aqueduct; the claim leans on the 3
> real aqueducts.

---

## 2. EPANET / WNTR ground-truth handling

The ground truth is a **single steady-state pressure-driven-demand (PDD)** solve
per situation, via `wntr.sim.EpanetSimulator` (the EPANET2 binary).

Configuration (from `_solve_served_ratios`):

- `demand_model = "PDD"`, `required_pressure = 20.0 m` (default), `minimum_pressure = 0.0 m`.
  - PDD delivers full demand at/above 20 m head, zero at/below 0 m, interpolated between.
- `time.duration = 0` → one steady-state snapshot, no EPS/time-stepping.
- `hydraulic.pattern = None` and every junction's demand fixed to the chosen
  `demand_mode` value (default **peak** = max pattern multiplier) before solving,
  so multiplier 1.0 IS the modeled scenario.
- **All pumps forced `initial_status = "Open"`** before solving. Rationale: the
  importer's baseline treats every pump an operator *can* run as operational, so
  the oracle must too, else we'd compare CASCADE's "fully capable" state against
  WNTR's mid-schedule snapshot.
- Broken links (per situation) set `initial_status = "Closed"`.

Three EPANET correctness traps, each handled explicitly:

1. **Non-convergence is silent.** `EpanetSimulator` does NOT raise on "System
   unbalanced"; it returns the last non-converged iterate (observed: pressures
   ~ −470,000 m). `_check_converged` parses the report and **discards** such
   situations. Same fix guards the importer sweeps.
2. **Singular-PDD false "served".** When broken links sever a whole component
   from every source, the PDD system for that component is singular; EPANET
   converges (no warning) to an arbitrary internal circulation whose per-junction
   delivered demands read as ~fully served but sum to ~0. Correction: any demand
   junction with **no undirected path to a source through in-service links**
   (`_severed_junctions`) is forced to ratio 0 before quantization.
3. **Velocity exceedance is flag-only.** EPANET imposes no velocity cap, so it
   "delivers" through pipes at unphysical speed. We record (never act on) where
   the solve relies on velocity > `V_MAX_DESIGN_MS` — the seed of a future
   overload oracle.

> ASSUMPTION-GT1: WNTR PDD at `required_pressure = 20 m` is "truth." This is
> itself a modeling choice; aggregate FMS depends on it (the flag exists to
> sweep it). A different service-pressure assumption shifts the ground truth.
> ASSUMPTION-GT2: steady-state only. No transients, no tank drawdown dynamics,
> no recovery/repair sequencing.
> ASSUMPTION-GT3: EPANET natively represents **only binary link closures** as
> damage. Reservoirs are infinite-head boundary conditions. → partial damage,
> intermediate functionality, and source degradation have **no native EPANET
> ground truth** (see §7, ISSUE-SRC).

---

## 3. Importer (parameterizing the flow model from the .inp)

One-shot pipeline: parse → hydraulic sweep → orient → map → (optional skeletonize).
Skeletonization is **bypassed** in validation (full networks imported).

### 3.1 Structural mapping

- Reservoirs, tanks → **Source** nodes, `supply_capacity["water"]`.
- Demanding junctions → **served** nodes (`category_dependency_profiles["water"].demand`).
- Pumps, valves → inline **Requisite**-typed nodes (gate downstream flow via the logical mechanism).
- Pipes → capacitated directed **edges**.

### 3.2 Pipe capacity (the load-bearing quantity)

**Default (since 2026-07-27): uniform Design Velocity.**
`capacity = (π/4)·d² × capacity_velocity`, `capacity_velocity` default **2.5 m/s**
(`ImportOptions.capacity_velocity`, a textbook water-main design speed). No
hydraulic solve, no margin, no cap. This is the shipped method — the
capacity ablation (`ATTEMPTS.md` §12, `run_capacity_drill_ablation.sh` →
`final_benchmark_drill.csv`, paper Supp. §S2) found the per-pipe sweep drill
buys nothing over it (pooled F1 0.770 vs 0.778, FMS 0.926 vs 0.921).

The demand sweep + contingency solves **still run** — they are what orients
edges (§3.3) — but their per-pipe *velocities* no longer set pipe capacity by
default. Valve capacity still uses the sweep drill formula.

**Retained sweep drill (`--capacity-drill` / `capacity_velocity=None`).** The
old method: `v_eff = min(v_peak · margin, max_velocity)`, `margin` default 2.0,
`max_velocity` default 3.0 m/s, where `v_peak` = the **max |velocity|** a pipe
reaches across TWO families of solves:
  1. **Demand sweep**: escalate every junction's demand 1×→`max_multiplier=8`
     in `steps=8`, at nominal topology.
  2. **Contingency solves**: close each breakable link once **at nominal demand**
     (`contingency_multiplier = 1.0`), re-solve — sizes *backup* pipes the demand
     sweep never stresses. Max-over-all-solves: a contingency only *raises* capacity.

> VERIFIED (2026-07-23/24, §12): capacity magnitude is NOT the precision
> bottleneck. On Modena & Net3 every pipe uses <50% of imported capacity even
> under failure; 0% are undersized vs observed WNTR flow; infinite capacity
> cures 0% of false positives; design velocity 2.5/3.0/3.5 are byte-identical.
> That insensitivity is exactly why the uniform constant replaced the drill.
> Precision is topology/priority-bound; see ISSUE-PREC.

### 3.3 Orientation

- Direction from the **sign** of simulated flow at peak.
- A pipe with meaningful flow **both** ways across solves → **two independently
  capacitated edges** (full-duplex), so rerouting can use either direction.
  Gates: `NEGLIGIBLE_VELOCITY_MS = 1e-4` (any real flow), `DECISIVE_VELOCITY_MS = 0.3` (below this a single-sided reading is hedged into a split).

> VERIFIED THIS SESSION: orientation is NOT the precision bottleneck either.
>
> Forcing all pipes bidirectional changed nothing (false positives 569→578).
> On Modena ~258/317 pipes are already bidirectional.

### 3.4 Contingency-link selection (which links get closed for capacity discovery)

"Trunk" = **top decile of pipes by diameter ∪ every pump** (44–67 links on the
aqueducts, 2–14 on textbook). Then close:

- **(i)** every trunk link once (exhaustive-trunk mode) — no sampling luck,
- **(ii)** **30** random trunk *pairs* (double-failure backup paths),
- **(iii)** **20** single links sampled uniformly from the non-trunk remainder.
  ≈ 90–120 extra steady-state solves on the aqueducts. Counts (30/20) are fixed
  import parameters across all networks.

> DETERMINISM FIX (verified): sampling now sorts the link set before
> `random.sample`. Python set iteration is `PYTHONHASHSEED`-dependent, which
> previously defeated the `seed` param — same seed could pick different links
> and derive different capacities across runs.

### 3.5 Source (reservoir/tank) supply capacity — **RESOLVED** (originally a known defect)

Original rule: `supply_capacity = sum of the source's outgoing pipe capacities`,
applied to every reservoir and tank alike.

> ISSUE-SRC (verified on a controllable 1-reservoir→3-junction chain, pre-2026-07-22):
> this **overstated** source yield ~**6.4×** actual demand (it's a sum of
> margined, peak-sweep-sized pipe capacities, not the source's deliverable
> yield). Effects: sources never bottlenecked in any family, and source
> degradation was unrepresentable via the normal functionality mechanism (at
> N=3, "source at 50%" = 50% of 6.4× = 3.2× demand → no effect; supply had to
> be cut below ~13% before anything happened).

**Fixed in two steps, now the live model** — see §"Supply model" above for the
current rule (reservoirs unbounded; gravity tanks = nominal delivered outflow;
pump-fed pass-through tanks = incident-pipe capacity). The original tension
this section flagged (source-degradation wants `supply_capacity ≈ nominal
yield`; demand-surge wants headroom above nominal) is resolved by the type
split: reservoirs (which any demand-surge family would stress) stay unbounded,
while tanks (where degradation semantics matter) are nominal-capped or
pipe-limited per their feed type — no single static value has to serve both
roles anymore.

### 3.6 FLOW_UNIT_SCALE

All flow quantities (`demand`, `supply_capacity`, edge `capacity`) are rescaled
by `FLOW_UNIT_SCALE = 1_000_000` (m³/s → mL/s) so the integer solver has
resolution. **The scale cancels in `served_ratio = delivered/demand`** — it is
NOT a bug (a diagnostic that compared scaled capacity to raw WNTR flow gave a
false "10⁷× too large" reading this session; the real comparison is unit-consistent).

### 3.7 Priorities (junction shedding order) — **RESOLVED (2026-07-28)**

The CANONICAL config uses `--priority-mode none` (no ordering; pure max-min fair
share). Three derivations exist:

- `none`: no ordering — the shipped canonical (best precision 0.68).
- `scarcity` (sweep): multiplier at which each junction first drops below a
  service threshold. Ablated as null on both axes.
- `contingency`: cycle-aware demand-weighted severity from single/pair/triplet
  closures — the optional **recall lever**.

> RESOLVED (ATTEMPTS.md §13): priority's effect is **capacity-method-dependent**.
> The earlier "contingency lifts precision" finding held only under the SWEEP-DRILL
> capacity. Under the shipped UNIFORM design-velocity capacity, contingency
> priority is a **recall lever, not a precision fix**: pooled it lifts recall
> 0.95→0.98 at a precision cost (0.68→0.63, +28% FP). So the canonical leaves it
> OFF (best precision/F1), and the priority-on arm (`run_priority_ablation.sh` →
> `final_benchmark_priority.csv`) is an ablation. Free physics proxies for priority
> all backfired earlier — vulnerability is genuinely hydraulic, not topological.
> CAVEAT (code=paper): the importer still auto-derives `scarcity` priorities by
> default (`derive_priorities=True`) — inconsistent with this canonical; see
> ATTEMPTS.md §13 open item.

---

## 4. Engine / algorithm (the flow proposal — do NOT reimplement, engine is inviolable)

Per `SourceToDemands` category, on the induced subgraph:

- Split every member node in→out, internal edge capped by per-category
  throughput (× functionality).
- Super-source → each source's `in` at effective supply (`supply_capacity × func_ratio`).
- Each demanding node's `in` → super-sink at its `demand`.
- Original edges capped by edge capacity × functionality.

`func_ratio(f, N) = (f − 0.5)/N` for intermediate levels (N=3 → 0, 0.5, 1.0;
so 1=critical passes 0%, N=full passes 100%).

**Allocation (default = `tiered_fair_share`):** strict priority preemption
between tiers, **max-min fairness within a tier** — water-filling by repeated
`nx.maximum_flow` with a residual-reachability bottleneck test to make
per-consumer amounts well-defined under degenerate ties. Alt = `priority_greedy`
(single `max_flow_min_cost`, winner-take-all).

`served_ratio = delivered/demand → level = max(1, min(N, ceil(ratio · N)))`.
So **critical (level 1) ⟺ ratio ≤ 1/3** at N=3.

Logical mechanism (Requisite categories, e.g. pumps): `worst_of(parent, edge)`
deliverable → `best_of` intra-category (redundancy) → `worst_of` inter-category
(conjunction). Guards (dependency level, backup) then a **monotone commit**
`s_new = worst_of(s_old, s_guarded)` → convergence in finite rounds.

> ISSUE-PREC (root cause of low precision, verified): hard-capacity max-flow +
> max-min fair-share **spreads** a rerouting shortage thinly across many
> junctions (tripping many below the 1/3 line), whereas real PDD **concentrates**
> loss on the pressure-disadvantaged junctions. The module has **no pressure /
> head-loss physics** — only volume feasibility. This is a *model* property in
> the inviolable engine; the only in-bounds lever is priority (§3.7). One traced
> targeted situation: WNTR 53 criticals, module 237 (184 false).

> ASSUMPTION-N: N = 3 (critical / degraded / operational). Exposed parameter,
> not a constant. Coarse — level 1 needs ratio ≤ 1/3.

---

## 5. Failure families (test-scenario distribution)

Generated per network by `_random_situation` (uniform over `_KINDS`), plus
exhaustive tank situations.

| family   | definition                                                      | keep?                                                 |
| -------- | --------------------------------------------------------------- | ----------------------------------------------------- |
| break    | 1–3 random links (pipes+pumps) closed                          | text-only (see below)                                 |
| hot      | demand surge on 15–40% of junctions ×1.2–1.8                 | **DROP** (2 criticals of 22,909; uninformative) |
| both     | a random break + a demand surge together                        | keep                                                  |
| cluster  | ≤6 breaks within 2 topological hops of an epicentre            | keep                                                  |
| targeted | 3 of the top-decile-diameter pipes + pumps closed               | keep (**the win**)                              |
| tank     | every link on a tank closed (isolate it), exhaustive over tanks | keep                                                  |

**Decisions this session:**

- **Drop `hot`** everywhere (already applied to the paper).
- **Drop `break` from the results table**, keep a one-line mention: under
  uncorrelated loss, disconnection and starvation coincide, so module ≡
  reachability (recall 0.81 = 0.81) — the honest boundary case.
- **LOCKED (§11): drop hot, break, AND both.** Scored families = **cluster,
  targeted, source-failure, tank**, ~60 situations each (targeted/tank/source =
  10 singles + 20 pairs + 30 triplets; targeted on top-20% diameter; cluster = 60
  random). Source-failure = fail source combinations to critical (§6 reachability
  removes critical sources, making it a fair concentrated comparison).

> METHODOLOGICAL GUARDRAIL: reweighting toward "critical scenarios" is legitimate
> ONLY if justified by the use case (hazard/attack analysis) and the full/uncorrelated
> results are still disclosed. Choosing the distribution to beat the baseline is
> rigging the test set. Do not drop families to win; drop `hot`/table-`break`
> only because they are uninformative (equivalence or ~0 criticals), and say so.

> DROPPED IDEA — source degradation as a competitive family (verified): under
> system-wide source degradation the loss is **diffuse/proportional**, so a
> trivial "flag everything" baseline (reachability with degraded sources removed)
> gets recall 1.0 / precision 0.23 and **beats** the module (0.82 / 0.21). No
> method has signal in a diffuse regime. Keep source degradation, if at all, only
> as an *illustration of topological blindness* (labeled as such), or restricted
> to single-source failure in a meshed net (concentrated loss — untested).

---

## 6. Baselines

Both scored on the **identical** junction set (demand-bearing, present both sides).

- **Null model**: predict every junction fully operational (level N). Its FMS is
  what a model earns for free — the ceiling-effect control. Under source
  degradation it EQUALS reachability-keep.
- **Reachability**: junction critical ⟺ **no undirected path to a source through
  in-service links** (`_severed_junctions`). Undirected (generous). Shares its
  severed test with the singular-PDD correction, so on fully-disconnected
  junctions it is correct by construction — its informative regime is everything
  *short* of disconnection.
  - **LOCKED (§11): a source is removed from the source-set iff CRITICAL
    (functionality = 1).** A degraded-but-alive source (level > 1) stays a source.
    This resolves ISSUE-REACH below: under the **source-failure** family (sources
    driven to critical) reachability flags junctions with no path to a surviving
    source (real signal), and the module additionally catches the reachable-but-
    under-supplied junctions — a fair, informative comparison, not the degenerate
    all-op/all-crit of *partial* degradation.

> ISSUE-REACH (verified this session): reachability's treatment of a **degraded**
> (not severed) source is **ambiguous and degenerate**:
>
> - keep the degraded source as a source → predicts all-operational (recall 0),
> - remove it → predicts all-critical in system-wide degradation (recall 1,
>   precision = base rate).
>   Neither is a real predictor. → reachability is a **fair, meaningful baseline
>   only for link-disconnection families** (targeted/cluster/both/tank), where it
>   has genuine signal (recall 0.51–0.94) and the module beats it non-trivially.
>   Do NOT use it as a competitive baseline for source degradation.

---

## 7. Metrics

- **FMS** (per situation, over demand-bearing junctions J):
  `FMS = 1 − (Σ_j w_j·|ℓ_WNTR − ℓ_CASCADE|)/(N−1)`, `w_j = d_j/Σd`. In [0,1].
  A regression-style level-agreement metric.
- **Binary detection**: threshold both sides at critical (level 1) vs operational;
  report precision / recall / confusion, **unweighted** (one junction = one sample).
- **Bootstrap**: paired percentile 95% CIs over per-situation differences,
  10⁴ resamples (module − null, module − reach).

> ISSUE-METRIC (verified): FMS **rewards the conservative predictor** — reachability
> wins/ties it on every family (its errors are small misses; the module's false
> alarms are large). On the pruned 4-net set the module−null FMS gap is even
> **non-significant** (Δ +0.007, CI [−0.013, +0.026]) because break (where the
> module beat null) is dropped. → **FMS is the wrong headline.** Recommendation:
> lead with **detection** (precision–recall curve: module is a tunable *curve*,
> reachability a single fixed point at recall ~0.5); optionally a **ranking**
> metric (Spearman / precision@k vs WNTR) for the prioritization use case; keep
> FMS as a disclosed secondary. GUARDRAIL: justify the metric by the use case
> (screening/prioritization tool → detection/ranking), never by "the metric we win,"
> and keep FMS visible so it isn't metric-shopping.

---

## 8. Protocol (the run itself)

Final configuration (`experiments/run_final_benchmark.sh`) — one invocation per
network; the four families and cluster's 3 seeds are generated internally:

```
for net in {Net1,Net2,Net3, Cassacco,Tarcento,Zampis, Modena,CTown}:   # 8 networks
    validate_faithfulness.py --networks <net>
       --contingency-exhaustive-trunk --priority-mode contingency
       --demand-mode peak_hour --csv experiments/final_benchmark.csv
```
(The pre-rebuild `run_headline_fairshare.sh` and its multi-seed 6-network loop
are in `experiments/archive/pre-rebuild-variants/`.)

- 30 random situations + all tank situations, per (net, seed).
- Results **pooled** over networks and seeds per family. Pooled detection is
  |crit|-weighted, and `targeted` holds ~80% of all true criticals → **pooled
  recall ≈ the targeted result** (state this; do not imply an even spread).
- Per-situation CSV rows enable re-aggregation (drop hot, prune nets, recompute
  CIs) WITHOUT re-running — the current paper numbers were re-derived this way.

---

## 9. Explicit assumptions (consolidated)

1. WNTR PDD @ 20 m required pressure = ground truth (a modeling choice).
2. Steady-state snapshots only; no dynamics, recovery, or tank drawdown.
3. Peak demand mode (max pattern multiplier), fixed on both sides.
4. All pumps operable (forced open) in both the oracle and the CASCADE baseline.
5. Damage = binary link closure (EPANET's only native damage); intermediate
   functionality and source degradation are conventions with no native oracle.
6. Uniform ×2 capacity margin; ceiling justified by design velocity.
7. N = 3 functionality levels; critical ⟺ served ratio ≤ 1/3.
8. FLOW_UNIT_SCALE cancels in the served ratio.
9. Reachability is undirected connectivity to a source through in-service links.
10. Priorities = none in the headline (under active reconsideration).
11. Source `supply_capacity` = sum of outlet pipe capacities (overstated; sources
    never bind — see ISSUE-SRC).
12. Skeletonization bypassed (full networks).

---

## 10. Known issues / risk register (read before running)

| id                  | issue                                                                   | severity       | status                                              |
| ------------------- | ----------------------------------------------------------------------- | -------------- | --------------------------------------------------- |
| ISSUE-SCOPE         | benchmark tests the least-differentiating claim                         | high (framing) | decide §11                                         |
| ISSUE-METRIC        | FMS rewards conservatism; reachability wins it                          | high           | switch lead metric to detection                     |
| ISSUE-PREC          | low precision = fair-share spreads shortage (no pressure physics)       | high           | priority is the only in-bounds lever                |
| ISSUE-SRC           | source capacity overstated ~6.4×; sources never bind                   | medium         | do not globally rewrite; per-situation for a family |
| ISSUE-REACH         | reachability degenerate under source degradation                        | medium         | use it only for link families                       |
| ISSUE-C             | Zampis/Aqueduct C localized data defect (below null under both/cluster) | medium         | disclosed as data defect                            |
| ISSUE-CONV-Tarcento | Tarcento fails PDD convergence at demand multiplier ≥ 2.5              | low            | contingency multiplier stays 1.0                    |
| ISSUE-FCV           | FCV source-cap oracle fragile on pump/tank nets (Net3 4/5 failed)       | low            | only if source family pursued                       |
| ISSUE-COST          | flow module cost vs WNTR unclosed at the largest net                    | low            | disclosed                                           |
| FIXED               | pattern-name crash (`get_pattern` None)                               | —             | fixed this session                                  |
| FIXED               | contingency sampling non-determinism (hash seed)                        | —             | fixed (sort before sample)                          |
| FIXED               | silent non-convergence; singular-PDD false-served                       | —             | `_check_converged` + severed test                 |

---

## 11. Decisions — LOCKED (2026-07-22, owner)

1. **Networks**: keep all **8** — Net1, Net2, Net3, Cassacco, Tarcento, Zampis,
   Modena, CTown (no prune). Modena/CTown carry import-quality caveats (ISSUE-PREC).
2. **Demand mode**: **`peak_hour`** — coincident system-peak (the single hour of
   max total consumption), NOT per-junction peaks. Implemented (§2). Tanks are
   zero-demand sources by construction.
3. **Capacity**: `max_velocity` cap **ON by default = 3.0 m/s** (implemented).
   Demand sweep = **adaptive single target**: solve at ×8, step down to the
   highest converging multiplier if it fails (§3.2) — NOT fixed multi-step, NOT
   fixed ×8 (which breaks Tarcento).
4. **Source supply by type**: reservoirs unbounded; GRAVITY tanks = NOMINAL (not
   sum of margined pipe caps); PUMP-FED (pass-through) tanks = incident-pipe
   capacity (2026-07-23 refinement — nominal falsely starves CTown's pumped
   districts). Consistent now that surge families (hot/both) are dropped (§3.5).
5. **Contingency + priority unified, cycle-aware** (§3.4, §3.7): one deterministic
   pass over cycle (2-edge-connected) trunk links → capacities (peak velocity)
   AND priorities (accumulated demand-weighted deficit `Σ max(0,1−ratio)`).
   Import-derived; hand-authored networks get expert-labelled priorities.
6. **Families**: **drop hot, break, both.** Keep **cluster, targeted,
   source-failure, tank**, ~60 situations each (§5):
   - targeted: 10 singles + 20 pairs + 30 triplets on **top-20%** diameter,
   - cluster: 60 (random, uses seeds),
   - tank: 10 singles + 20 pairs + 30 triplets,
   - source-failure: 10 singles + 20 pairs + 30 triplets (sources → critical).
7. **Seeds**: **3**. Random family (cluster) multiplies over seeds; the
   combinatorial families (targeted/tank/source) are deterministic top-K.
8. **Reachability**: a source is removed from the source-set **iff critical
   (functionality = 1)**; degraded-but-alive sources stay (§6). Makes the
   source-failure family a fair, informative comparison.
9. **Metric**: **FMS** kept as primary (owner decision), detection reported alongside.
10. **Supplementary**: non-convergence discards, singular-PDD correction, and
    velocity-exceedance stats all reported in Supp. Mat.

---

## 12. Build status (what's coded vs pending)

DONE (this session, tested + lint clean):
- `peak_hour` demand mode (`map.py`, schema, Zod synced).
- `max_velocity` default = 3.0.
- **Supply model** (tank refinement 2026-07-23): RESERVOIRS = unbounded (match
  WNTR fixed-head; keeps multi-source failure valid). TANKS split by feed:
  a GRAVITY tank (a reservoir reaches it through pipes/valves) = nominal delivered
  outflow (geometry-limited terminal store); a PUMP-FED tank (a reservoir reaches
  it ONLY across a pump — every CTown district tank) = incident-pipe capacity,
  because the pump keeps it full so it is a PASS-THROUGH, and capping it at
  nominal falsely starves everything downstream. `_supply_for` branches by type;
  `nominal_source_outflow` + `pump_fed_tanks` (gravity-graph reachability) in
  `sim.py`; `ImportOptions.nominal_supply` (default True). Verified: CTown
  baseline criticals 336→15 and FMS 0.029→0.902 after the split; gravity nets
  (Net3 tanks 0.03–0.06) and Tarcento (0.967, unchanged) unaffected.
- **Adaptive ×8 sweep**: one solve at the highest converging multiplier
  (Net3 → ×8 in 1 solve; Tarcento → ×4, was zero-capacity under fixed ×8).
- **Reachability critical-source removal**: NO code change — source-failure =
  outlet-link closure, so the existing `_severed_junctions` already removes the
  failed source (isolated) and severs only junctions with no surviving-source path.
- pattern-crash guard; determinism (sort-before-sample) already in.

- **#4 Families rewrite** (`validate_faithfulness.py`): DONE — drop hot/break/both;
  `_targeted_situations` (top-20%, 10/20/30), `_cluster_situations` (60 random,
  3 seeds), `_tank_situations` (10/20/30 combos), `_source_situations` (10/20/30
  reservoir-outlet-closure combos); generic `_combo_situations`. Verified on Net3
  (cluster 60, targeted 60, tank 7=C(3,·), source 3=C(2,·)); `--demand-mode`
  default now `peak_hour`.
- **#3 Cycle-aware contingency severity priority** (`sim.py`): DONE + VERIFIED —
  `_cycle_links` (Tarjan bridge filter), `contingency_priorities` rewritten:
  deterministic cycle-trunk singles+pairs+triplets, demand-weighted severity
  deficit `Σ demand·max(0,1−ratio)`, no sampling/threshold. Now the CLI default
  (`--priority-mode contingency`). Full capacity+priority UNIFICATION (reuse the
  same solves) left as a noted future optimisation.

### Precision journey (Modena targeted, verified)
| stage | precision | recall | notes |
|---|---:|---:|---|
| old setup, `none` | 0.18 | — | pre-rebuild baseline |
| new setup, `none` | **0.34** | 1.00 | max_velocity + peak_hour + nominal supply + top-20% families **doubled precision on their own** |
| new setup, cycle-aware priority | **~0.37** (0.25→0.37 on a 15-sit subset) | 0.96 | priority cuts FP a further ~44%, small recall cost |

**Cost:** priorities make `tiered_fair_share` run per-tier (≤10 tiers vs 1), so
scoring is ~2–3× slower. The precision gain justifies it → contingency is the
default; `none` remains the fast fallback (already 0.34).

RESOLVED residual: source-failure over-prediction (was Modena 269: 206 vs 67) is
the hard-capacity-vs-pressure mismatch (ISSUE-PREC); the priority is the lever,
and the supply model (reservoirs unbounded) is settled. Source-failure remains a
recall story (reachability blind by construction) with disclosed precision.

### The final run
`experiments/run_final_benchmark.sh` — 8 networks (Net1/2/3 + Cassacco/Tarcento/
Zampis + Modena/CTown), one invocation each (families internal, cluster 3-seeded),
`--priority-mode contingency --demand-mode peak_hour --contingency-exhaustive-trunk`,
→ `experiments/final_benchmark.csv`. Slow (hours) due to the priority tiering.
Per-situation CSV → tables re-derived downstream.

PENDING (after the run): update the PAPER (complenet.tex) — methods prose AND
headline numbers — to this setup. Deliberately NOT done yet: the numbers come
from `final_benchmark.csv`, so paper narrative + tables get rewritten together
once the run lands, to avoid a half-updated (new methods / old numbers) paper.
