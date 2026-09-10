# ADR-0012 — EPANET .inp importer: skeletonization, hydraulic parameterization, mapping rules

**Status:** accepted (2026-07-07; consolidated to current state 2026-07-16 — the
full experiment/regression history behind each rule lives in
`experiments/aqueducts/ATTEMPTS.md`)

## Context

Real infrastructure models exist in domain formats. The first supported source
is EPANET `.inp` (water distribution): raw aqueduct exports (419–935 nodes)
exceed both role Entitlements and readable canvas size. Import must reduce,
not just translate — and produce a *meaningful* CASCADE model whose engine
behaviour tracks real hydraulics.

## Decision

One-shot backend pipeline (`POST /api/import/inp`, pure transformation — no
engine, no persistence): **parse → hydraulic sweep → skeletonize → orient →
map → place**. Modules in `CASCADE-backend/core/importers/inp/` (`parse.py`,
`sim.py`, `skeleton.py`, `map.py`, `geo.py`) — the template for future
formats (`core/importers/<format>/`, same `ProjectBundle` out). WNTR (BSD-3)
parses/skeletonizes/solves; pyproj (MIT) does CRS.

### Mapping rules

| EPANET | CASCADE |
|---|---|
| Reservoir | `Source`, `supply_capacity["water"]` = unbounded (fixed-head, like WNTR — the outlet pipe limits delivery, not the source) |
| Tank | `Source` + water profile `{backup, backup_duration = volume ÷ downstream demand}` + shared "Running on Reserve" Disservice. `supply_capacity["water"]`: GRAVITY tank (reservoir reaches it via pipes) = nominal delivered outflow; PUMP-FED pass-through tank (reservoir reaches it only across a pump) = incident-pipe capacity — see "Source supply" below |
| Junction, demand > 0 | `Service`, water profile `{demand, priority}` |
| Junction, demand = 0 | `Infrastructure` |
| Junction, demand < 0 | `Source` (`kind: "injection_well"`), supply = the injection rate — the EPANET well idiom; mapping it as Infrastructure deletes the network's supply (Net2's only source is such a junction) |
| Pump link | inline `Infrastructure` node (`["water","pumping"]`) + two half-edges capped by pump-curve max flow; always imported operational (see below) |
| Valve link | inline `Infrastructure` node (`["water","valve"]`); `.inp` `Closed` → Functionality 1 |
| Pipe | edge, `capacity = π/4·d² × capacity_velocity` (uniform 2.5 m/s design velocity, default); orientation from the simulated flow sign. `capacity_velocity=None` reverts to the sweep drill `π/4·d²·min(v_peak × margin, max_velocity)` (see Capacity) |

**Pumps import as operational regardless of `.inp` status.** A pump's t=0
status is a duty-cycle artifact (off overnight, waiting on a tank control),
not equipment failure; CASCADE's baseline is a working-condition snapshot.
Real pump failure is a Hazard. (Net6 has 18 of 61 pumps `Closed` at t=0 —
importing that literally removed ~30% of pumping capacity.) Pipes/valves keep
their `.inp` status — theirs is usually a genuine topological state.

**Units**: all hydraulics in SI internally; `demand`/`supply_capacity`/edge
`capacity` are rescaled by `FLOW_UNIT_SCALE = 1e6` before hitting the model.
Required: the engine's integer solver rounds via `×1000`, and realistic SI
demands (~1e-5 m³/s) all round to zero without it — every consumer would be
permanently critical. The engine is ratio-based, so a uniform rescale changes
nothing else. (`test_demand_survives_engine_fixed_point_rounding`.)

**Functionality scale**: `n_levels` (default 3) sizes the emitted scale;
`generate_scale(3)` reproduces the app default exactly. Merge mode requests
the target project's own scale length, so imported values land on the right
range without importer awareness of the target.

**Source supply** is type-aware (2026-07-22 nominal model, 2026-07-23 pump-fed
refinement), never a user knob:
- **Reservoirs** → unbounded (`UNBOUNDED_SUPPLY_FALLBACK = 1e7`): EPANET models
  them fixed-head, so the outlet pipe limits delivery, not the source. This also
  keeps multi-source failure valid against WNTR (a surviving reservoir must cover
  the slack, as it does in the oracle).
- **Gravity tanks** (a reservoir reaches them through pipes/valves) → NOMINAL
  delivered outflow from one PDD solve (`nominal_source_outflow`). Pipes are
  over-sized ~6×, so summing their capacity leaves the tank unable to bottleneck
  and tank-isolation events meaningless.
- **Pump-fed tanks** (a reservoir reaches them ONLY across a pump —
  `pump_fed_tanks`, gravity-graph reachability) → incident-pipe capacity. Such a
  tank is a PASS-THROUGH the pump keeps full; capping it at nominal bottlenecks
  every downstream district and falsely starves the network (CTown: baseline
  criticals 336→15, FMS 0.029→0.902 once split out).

A source with no capacitated pipe falls back to `UNBOUNDED_SUPPLY_FALLBACK` with
a warning. Specific real values are edited in the Inspector afterwards.

### Capacity — Uniform Design Velocity (default) (CONTEXT.md terms)

`.inp` gives diameter, not flow, so a velocity converts one to the other.
**Current default rule: `π/4·d² × capacity_velocity`**, a UNIFORM design
velocity (`DEFAULT_DESIGN_VELOCITY_MS = 2.5 m/s`, the water-main design speed;
exposed as `ImportOptions.capacity_velocity`). No hydraulic solve, no margin,
no cap — a textbook, reproducible constant applied to every pipe. Valve
capacity keeps the sweep formula below; the sweep still runs regardless because
it is what **orients** edges (see next section).

**Addendum (2026-07-27) — uniform velocity replaced the sweep drill as the
default.** The importer previously sized each pipe from its own *simulated peak*
velocity (`π/4·d²·min(v_peak × capacity_margin, max_velocity)`, margin 2,
ceiling 3 m/s). A full ablation across all 8 benchmark networks
(`experiments/aqueducts/ATTEMPTS.md` §12, paper Supp. §S5) showed that elaborate per-pipe
capacity discovery is **not merely unnecessary but worse** than the flat 2.5 m/s
constant — pooled critical-class F1 0.794 (uniform) vs 0.737 (drill), precision
0.682 vs 0.599, at equal recall. The simpler, standard, and more
defensible rule therefore became the default; this **reverses** the earlier
"constant design velocity — rejected" note (that rejection rested on a partial
comparison predating the full ablation). The module's fidelity comes from
topology, orientation, and priorities — not from tuned capacities.

**Retained sweep drill (`ImportOptions.capacity_velocity=None`).** Sizes each
pipe from its highest simulated velocity `v_peak` across:

1. the **demand-multiplier Sweep** (1×→8×, independent PDD steady states,
   every junction fixed to the chosen `demand_mode` demand — this anchoring
   also keeps the priority sweep and the emitted demands consistent), and
2. **Contingency solves** — single links (and optional N-2 trunk pairs)
   closed at nominal demand: backup pipes only reveal their capacity when a
   topology change reroutes flow through them. Modes: uniform sample,
   trunk-biased, exhaustive trunk. Accumulation is `max`.

Under the drill, `capacity_margin` (default 2, `DEFAULT_CAPACITY_MARGIN`) and
the optional `max_velocity` ceiling (default 3 m/s) apply as
`min(v_peak × margin, max_velocity)`; pipes with no signal fall back to
`FALLBACK_VELOCITY_MS = 1 m/s`. These two knobs **also** govern valve capacity
under both methods. Full variant study: `experiments/aqueducts/ATTEMPTS.md` §2, §12.

### Orientation — simulated sign + Full-Duplex Splits

Direction is read off the SIGN of the simulated flow (WNTR's `flowrate`;
its `velocity` column is unsigned), not guessed from topology:

- **Confidently one-way** (one side above `NEGLIGIBLE_VELOCITY_MS = 1e-4`,
  other side silent, velocity above `DECISIVE_VELOCITY_MS = 0.3 m/s`): single
  edge in the simulated direction.
- **Bidirectional** (both sides above the noise floor) or **low-confidence
  one-way** (single side below 0.3 m/s — solver noise near equilibrium can
  pick an arbitrary winner): TWO directed edges (`__fwd`/`__rev`), EACH at
  the pipe's full physical capacity (**Full-Duplex Split**). Proportional
  shares were shipped first and starved exactly the reversal direction that
  failure-rerouting needs; a max-flow never gains from a cancelling two-way
  cycle, so full duplex over-grants nothing.
- **No signal**: multi-source BFS fallback (shallow→deep over the full
  topology, never overriding simulated directions).

Threshold tuning history (a stricter noise gate made real networks much
worse — wrong single directions silently disconnect branches): ATTEMPTS.md
§2-3. Time-of-day reversal (tank recharge vs discharge) is deliberately out
of scope — the Sweep has no clock; the tank's depletion is the reserve event.

### Hydraulic priorities — optional derivation, expert knob

`priority` (1–10) orders the engine's scarcity shedding (ADR-0014: strict
tiers under the default fair-share allocation). **The importer derives no
priority** (2026-07-28): every measured auto-derivation either does nothing for
FMS/level-agreement fidelity (the demand-multiplier scarcity sweep — null on
both axes) or, worse, *downgrades* the critical-class result at import time —
the cycle-aware contingency ranking trades precision for recall (0.68→0.63 for
0.95→0.98; ATTEMPTS.md §13, paper Supp. §S5). Since no automatic derivation
improves the shipped config, none is offered; `priority` is left an
**expert-set per-node primitive** (``serve the hospital first''), and imports
ship with no ordering (pure max-min fair share — the best-precision config).

### Generated scenario Events

- **Tank reserve** (`evt-tank-reserve`, Disservice): sets
  `functionality_time = backup_duration` on every tank with a valid backup
  profile — a repeatable "system lost its upstream feed" scenario. No
  persistent stock depletion (would break stateless Propagation; a general
  CASCADE concept if ever needed, not a water one-off).
- **Blackout** (`evt-blackout-pump-failure`, Hazard): full
  `vulnerability_levels` on every pump + `default_repair_time = 6 h`. One
  shared event — real blackouts aren't per-pump.
- **Demand surge** (`evt-demand-surge-top10`, Disservice): doubles demand for
  the top 10% of consumers via `attribute_mutations`. The mutation carries
  the COMPLETE profile object — the applier supports only flat
  `"<elementId>.<field>"` keys, no deep paths.

### Skeletonization

`wntr.morph.skeletonize` (branch trim + series/parallel merge, demand mass
conserved); its knob is a pipe diameter, so we binary-search the distinct
diameters for the smallest threshold fitting `target_nodes` (default: the
caller's Entitlement). Sources, pumps, valves always survive; absorbed ids
land in `properties.merged_elements`.

### Merge mode

Two frontend modes: **Replace project**, and **Add as extra canvas** —
`mergeImportedProject` remaps colliding node/edge/canvas ids (separate
namespaces), `remapConfigEventIds` rewrites mutation keys through the id map
first, and `mergeConfig` adds categories/graph_types by name (existing wins)
while events sharing an id get their `attribute_mutations` **unioned** — so
the three shared scenario Events grow to cover every merged network. The
target's `functionality_scale` is never touched.

### Placement

Coordinate-magnitude heuristic picks georeferenced (pyproj `source_crs` →
WGS84 + GeoAnchor, default `EPSG:3004`) vs abstract placement (scaled,
y-flipped).

### Import-time warnings

Unreachable demand junctions (a real import defect — permanently critical
regardless of hazards), count of fallback-capacity pipes, count of
full-duplex splits, negative-demand junctions imported as wells.

### Faithfulness benchmark (`scripts/validate_faithfulness.py`)

Dev-only harness reducing "does the engine match real hydraulics?" to one
number: per generated situation, (1) the identical intervention is applied to
the real WNTR model and PDD-solved (ground truth), (2) ratios quantize
through the engine's own `_ratio_to_level`, (3) the imported Project runs
through the real `engine.propagation.run`, (4) demand-weighted **FMS**
`= 1 − weighted_mean(|level_true − level_cascade|)/(N−1)`. **Four scored
failure families** — clustered, capacity-targeted, per-source outage, tank
isolation (the harness can also generate random break / demand surge / both,
dropped as uninformative — `experiments/aqueducts/benchmark-protocol.md` §5),
multi-seed, CSV output; `--priority-mode
sweep|contingency|none`, contingency-coverage flags mirror the importer's.
Two ground-truth corrections are built in: EPANET non-convergence is treated
as no-ground-truth (`_check_converged`), and demand junctions severed from
every source are forced to ratio 0 (`_severed_junctions`) — WNTR's PDD is
singular on severed components and silently reports arbitrary "fully served"
circulations. Import-linter carve-out: this script — along with
`benchmark_engine.py` — may import `engine.*` because it must measure the REAL
engine, not a reimplementation (CLAUDE.md §8a). (`paper_shapley_vs_centrality.py`
held the same carve-out until 2026-09-09, when its duplicate Shapley estimator
was removed in favour of the app's exported result.)

## Alternatives rejected

One line each; measurements in `experiments/aqueducts/ATTEMPTS.md`:

- Custom graph contraction — WNTR skeletonization already does it with demand awareness.
- Priorities from elevation/distance proxies — ignores loops and pumps.
- ~~Constant design velocity as capacity — worse than the Sweep peak.~~ **Reversed 2026-07-27**: a uniform 2.5 m/s design velocity is now the DEFAULT — the full 8-network ablation (§12) found it beats the sweep peak (F1 0.794 vs 0.737). Idle-flow velocity remains rejected.
- Stricter noise/dominance gates on orientation — regressed real two-source networks.
- Proportional bidirectional splits with hedge shares — superseded by Full-Duplex.
- Unbounded source supply by default / `supply_mode` / `supply_value` knobs — supply derives from file data, edited in the Inspector when known.
- Interactive import designer — deferred; the existing knobs cover current needs.
- Extended-period (clocked) simulation for time-of-day reversals — unnecessary complexity.

## Consequences

- `wntr` + `pyproj` become backend runtime deps (both open-source, §1-clean).
- `core/importers/<format>/` is the template for future importers (GIS, CIM).
- Import responses follow the §13.4 null-free serialisation contract.
- Two frontend import modes (Replace / Add as extra canvas), see Merge mode.
- `n_levels` is a real knob — required for merge mode to target an existing scale.
- Every capacity/orientation/priority rule above is benchmark-validated; changing one warrants a `validate_faithfulness.py` run before merging.
