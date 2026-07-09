# ADR-0012 — EPANET .inp importer: skeletonization, hydraulic priorities, mapping rules

**Status:** accepted (2026-07-07)

## Context

Real infrastructure models exist in domain formats. The first supported source
is EPANET `.inp` (water distribution networks): the raw aqueduct files
(Cassacco 419 nodes, Zampis 610, Tarcento 444, ky10 935) far exceed both the
role Entitlement `max_nodes` and what a canvas can readably display. Import
must therefore reduce, not just translate — and the translation has to produce
a *meaningful* CASCADE model, not a lossy caricature.

## Decision

One-shot backend pipeline (`POST /api/import/inp`, pure transformation — no
engine, no persistence): **parse → hydraulic sweep → skeletonize → orient →
map → place**. All modules live in `CASCADE-backend/core/importers/inp/`
(`parse.py`, `sim.py`, `skeleton.py`, `map.py`, `geo.py`) — a subpackage of
`core/importers/`, the general home for network-format importers (this is
the first; future formats each get their own `core/importers/<format>/`
sibling producing the same `ProjectBundle`, per Consequences below). WNTR
(BSD-3) does parsing, skeletonization and hydraulics; pyproj (MIT) does CRS.

### Mapping rules

| EPANET | CASCADE |
|---|---|
| Reservoir | `Source` node, `supply_capacity["water"]` = sum of outgoing pipe capacity (see below) |
| Tank | `Source` node + water profile `{backup, backup_duration = volume ÷ downstream demand}`, + a ready-made "Running on Reserve" Disservice event (see below) |
| Junction, demand > 0 | `Service` node, water profile `{demand, priority}` |
| Junction, demand = 0 | `Infrastructure` node |
| Pump link | inline `Infrastructure` node, categories `["water", "pumping"]`, + two half-edges; pump-curve max flow caps them; always Functionality N regardless of .inp status (see below) |
| Valve link | inline `Infrastructure` node, categories `["water", "valve"]`; `Closed` → Functionality 1 |
| Pipe | edge, `capacity = π/4·d²·v`, `v` = peak-of-sweep simulated velocity (see below) |

**Pumps import as operational regardless of `.inp` `initial_status`.** A
pump's status in the source file reflects one arbitrary moment of a
scheduled duty cycle (off overnight, waiting on a tank-level control) — not
equipment failure. CASCADE's baseline is a **working-condition** snapshot:
every pump a water operator CAN run is imported as fully functional, exactly
like every pipe/valve at baseline. A pump that is genuinely out of service is
represented the same way any other hazard is — by applying the Blackout
Hazard (or a bespoke one) — not by whatever the source file's schedule
happened to be at the instant it was exported. `_collect_links` sets
`open_=True` unconditionally for pumps (`core/importers/inp/map.py`); pipes
and valves are unaffected — their `.inp` status is more often a genuine
topological state (an isolation valve, a normally-closed loop pipe) than a
duty-cycle artifact. Discovered via `scripts/validate_faithfulness.py`
(below): Net6 (a 3300-junction network with 61 pumps under 124 time/level
controls) has 18 pumps `Closed` at the file's t=0 — importing that literally
made ~30% of the system's pumping capacity permanently absent from a network
that, operated normally, uses all of it.

Every water-path node declares `water` — the engine's flow pass only routes
through category members. `pumping` and `valve` are `Requisite` categories:
inline placement makes the universal Requisite pass gate downstream flow on the
device's Functionality with no explicit rules. All hydraulic quantities are
computed in SI (WNTR normalises GPM/LPS on parse) — but `demand`,
`supply_capacity`, and edge `capacity` are rescaled by `FLOW_UNIT_SCALE = 1e6`
(`core/importers/inp/map.py`) before being written into the model. This is
required, not cosmetic: the engine's SourceToDemands flow heuristic
(`engine/flow.py`, protected/proprietary per §7) feeds networkx's
min-cost-flow solver, which needs integer capacities, via
`round(value × 1000)`. Real water demand in SI units is tiny (a typical
residential connection is ~1e-5 m³/s) — on Cassacco_totale.inp, **all 410**
demand-bearing junctions rounded to exactly zero under that conversion,
meaning every consumer's demand-sink edge had zero capacity and Propagation
showed the entire network permanently critical regardless of actual supply or
topology. The engine is unit-agnostic by design (only demand/supply/capacity
*ratios* affect its output), so a uniform rescale entirely within the importer
— never touching engine/ — fixes this without assuming anything beyond the
documented `×1000` constant. See `core/importers/inp/map.py::FLOW_UNIT_SCALE`
and `test/test_inp_import.py::test_demand_survives_engine_fixed_point_rounding`.

### Functionality scale — settable, not hardcoded

`n_levels` (`ImportOptions`/`ImportInpRequest`, default 3) sizes the emitted
`functionality_scale`: `generate_scale(n_levels)` reproduces the app's own
hardcoded 3-level default exactly at `n_levels == 3` (same labels, same
colors — every hand-authored project already uses this scale), and for any
other size generates generic labels (`"critical"` / `"degraded (i/n)"` /
`"operational"`) with a color interpolated along the same red→orange→green
gradient. Every node/edge functionality value and every profile's
`dependency_level` in `build_bundle` is expressed on this same `n` — there is
no separate hardcoded constant anywhere in the mapping. This is what makes
the "add as extra canvas" merge mode (below) correct: the frontend requests
`n_levels` = the target project's own scale length, so the imported values
land on the right 1..N range without the importer needing any awareness of
what it's being merged into.

### Source supply — always the sum of outgoing pipe capacity

`supply_capacity["water"]` is always the sum of a Reservoir/Tank's outgoing
edge capacities — not a user choice, and never asked for. An earlier version
of this ADR defaulted to an unbounded constant instead, reasoning that a
Reservoir/Tank is, by EPANET's own hydraulic-modelling convention, a
fixed-head external boundary (a lake, aquifer, or the cut point of a larger
system) whose own capacity shouldn't double-count what the connected pipes
already model; that reasoning is sound in general, but the outgoing-pipe
derivation was chosen as the sole, unconditional behaviour instead — the
pipes immediately downstream of a source are real data already present in
the file, and deriving from them keeps the imported network's stated supply
tied to *something in the source data*, rather than an arbitrary constant. A
source with no capacitated outgoing edge at all (degenerate/malformed data)
falls back to `UNBOUNDED_SUPPLY_FALLBACK = 1e7` (`core/importers/inp/map.py`) — chosen
comfortably above any realistic network's total demand (validated:
Cassacco/Zampis ~2e3, ky10 ~9.5e4 in `FLOW_UNIT_SCALE` units) while staying
well under the engine's `INF_CAP` sentinel after its own `×1000` scaling — with
a warning, since this is a genuine "nothing sensible to derive from" case, not
the normal path. A specific known real value is set by editing the node's
`supply_capacity` in the Inspector after import; there is no dedicated "fixed
value" import knob for that — the app already supports it.

### Pipe/valve capacity — peak-of-sweep velocity, not a preset constant

Capacity is `π/4·d²·v`. `.inp` files give diameter, not a flow rate, so a
velocity assumption is unavoidably needed to convert one into the other. The
first implementation used a single global constant (`design_velocity`, a user
knob, default 1 m/s) — replaced because a fixed guess is worse than the
network's own hydraulics: a **first** iteration tried deriving `v` from a
baseline hydraulic solve at normal (unstressed) demand, but that measures the
wrong thing — a lightly-loaded branch pipe carrying a trickle at rest is not
*limited* to that trickle, it could carry far more if actually needed.
Verified on Cassacco: switching only the velocity source (same skeleton, same
supply mode) from "flat 1 m/s" to "baseline/rest velocity" dropped fully
served consumers from 22/67 to 8/67 — an artifact of measuring idle flow, not
a real finding about the network.

The fix: `core/importers/inp/sim.py::link_flow_profiles` runs the same kind
of demand-multiplier sweep already built for priorities (1× → 8×, on the
post-skeleton network this time — skeleton merges change pipe
diameter/length, so it can't reuse the original-network priority sweep's own
per-link results) and takes each pipe/valve's **highest** velocity across all
steps — a real, simulation-grounded answer to "what can this pipe deliver
when pushed," unlike either a constant or idle-flow velocity. Re-verified on
Cassacco: 21/67 fully served (vs. 22/67 for the flat constant) — comparable,
not systematically worse, while every pipe now carries genuinely
differentiated, simulation-derived capacity (83 distinct velocities observed,
0.01–2.4 m/s) instead of one assumed number. Elements the sweep never reports
meaningful flow through fall back to `FALLBACK_VELOCITY_MS = 1.0`.

The same sweep also tracks the **sign** of each pipe's flow (not just its
magnitude) — `LinkFlowProfile.velocity_fwd`/`velocity_rev` — which is what
the Orientation section below uses instead of a topology guess. **Regression
(caught by `scripts/validate_faithfulness.py`, see below):** the first cut of
this read the sign off WNTR's own `results.link["velocity"]` column — which
is an UNSIGNED magnitude, never negative. Direction has to come from
`results.link["flowrate"]` instead (signed: positive = `start_node_name` →
`end_node_name`); reading velocity's sign silently classified every single
pipe as flowing its .inp `start`→`end` direction regardless of reality,
making the whole "simulation-based orientation" feature a no-op that just
re-derived the file's own arbitrary direction. Verified on Net3: 34% of links
(41/119) actually flow opposite to their .inp direction under nominal demand;
before the fix, baseline (zero events) Propagation showed 16 of 59
demand-bearing junctions critical for a network that in reality serves 100%
of them — after the fix, 0. This was the actual cause of the "some nodes go
critical even at Reset" problem that motivated orientation-by-simulation in
the first place — the earlier BFS-vs-simulation redesign was the right
direction, the sign bug just silently defeated it.

A second, smaller gap the same tool surfaced: capacity sized ONLY from the
demand-escalation sweep above systematically undersizes a backup/redundant
pipe — one whose entire purpose is to reroute traffic if something ELSE
fails — because escalating demand uniformly never discovers alternate paths;
only an actual topology change does. `link_flow_profiles` now also runs a
bounded sample (`contingency_samples`, default 20) of single-link contingency
solves — a random pipe/pump/valve closed one at a time at nominal demand —
folding their velocities into the same `LinkFlowProfile` accumulation
(`max()`, so it only ever raises a link's known capacity, never lowers one
the main sweep already established). Verified on Net3: a 203 mm backup main
(pipe 317) peaks at 0.44 m/s under the demand sweep alone (~14 300 capacity)
but is later observed carrying much more once a contingency solve happens to
reroute through it (~17 600 at 20 samples) — closing two specific pipes
elsewhere, which the real network reroutes around at full service, previously
left one downstream junction critical in CASCADE purely from this
undersizing; the contingency sample fixes it. Cost: ~20 extra single-step
EPANET solves per import (~0.4 s on Net3), the same order of magnitude as the
existing priority sweep's 15 steps.

**A refinement that was tried and reverted, on real data.** Validating against
three real Friuli aqueducts (`raw-networks/aqueducts/Zampis.inp`,
`Tarcento_totale.inp`, `Cassacco_totale.inp` — not test fixtures, actual
utility exports) surfaced a genuinely noisy case: a 60mm leaf service pipe in
Zampis carries a near-stagnant flow (~1e-4 m³/s) whose *sign* flips between
sweep steps from ordinary solver noise near a near-zero equilibrium — not a
real reversal — yet clears `NEGLIGIBLE_VELOCITY_MS` on both sides (a small
pipe's cross-section turns even noise into a deceptively large velocity), so
it gets bidirectionally split on pure vibes rather than physics.

The obvious fix — an absolute raw-flow floor (not velocity) to gate
bidirectional classification, later refined with a dominance-ratio test so a
clearly one-sided pipe trusts the simulated direction instead of splitting —
was implemented, and made the SAME file's overall faithfulness score
materially *worse* (aggregate FMS dropped from ~0.94 to as low as ~0.42 in
one variant, with over 400 of 601 junctions wrongly reachable-critical).
Tracing why: Zampis is fed by **two** sources from opposite ends of a long
serial branch; where their fronts meet, flow is genuinely small but REAL on
both sides (not noise — verified by tracing per-multiplier-step flow: a
smooth, consistent split, not an erratic sign-flip). Any threshold —
absolute floor, dominance ratio — that's tuned to exclude the noisy leaf pipe
also, somewhere else in the same file, ends up forcing a single confident
direction onto one of these genuine near-balance points. When that guess is
wrong, it silently orphans everything downstream of it on the serial branch —
a single bad edge can disconnect dozens of nodes. Splitting a pipe that
didn't really need it costs almost nothing (it just carries a little spare
capacity in a direction it rarely uses); guessing a single wrong direction
can be catastrophic. So the plain `NEGLIGIBLE_VELOCITY_MS`-only rule —
already biased toward the safe failure mode — was kept, and the fix was
reverted rather than layered on top with more tuning. The takeaway generalizes
beyond this one file: for pipe orientation specifically, "when genuinely
uncertain, degrade gracefully (split)" beats "be clever about which single
answer is more likely right," because the wrong single answer is so much more
expensive than the imprecise split. Numbers: `NEGLIGIBLE_VELOCITY_MS`-only —
Zampis 0.94 aggregate FMS; the reverted flow-floor variant — 0.86-0.90; the
reverted flow-floor+ratio variant — 0.42.

**The follow-up refinement that DID help, by applying that same lesson one
step further.** The reverted attempts all tried to be smarter about *which
pipes* get split. The part of "when uncertain, split" that was still missing:
the plain rule only ever splits when BOTH directions independently clear
`NEGLIGIBLE_VELOCITY_MS` — a pipe where only ONE side ever registers any
signal at all still gets a single, outright-trusted direction, with no hedge,
regardless of how low that one reading is. `DECISIVE_VELOCITY_MS` (0.3 m/s —
a common minimum "self-cleansing" design velocity; real one-way trunk flow on
the real aqueduct data sits at 0.9-4+ m/s, comfortably above) extends the
hedge to exactly that gap: a single-sided reading below it is treated the
same as a "genuinely uncertain" pipe and split rather than trusted outright.
A pure proportional split would be pointless here, though — the unobserved
side measured exactly 0, so proportional-to-observed hands it exactly 0%
capacity, hedging nothing. `MIN_HEDGE_SHARE` (0.1) reserves a real, usable
minimum share for it instead, at the confident side's expense. Verified: this
is a genuine improvement, not another regression — Zampis rose from 0.938 to
0.962, and the three-aqueduct aggregate from 0.965 to 0.974, with Net1/Net3/
Net6 unaffected (both directions clearing `NEGLIGIBLE_VELOCITY_MS`, the
already-correct case, is checked first and unconditionally splits regardless
of magnitude — this refinement only ever adds a hedge in the strictly
narrower one-sided-and-low-velocity case, it never removes the existing one).

Both this sweep and the priority sweep are anchored to the **same** demand:
every junction's demand pattern is overridden to the exact value
`compute_junction_demands` computed for the chosen `demand_mode` before the
multiplier scales it up (`core.inp_sim._fixed_demand_model`). Without this,
WNTR's own pattern evaluation at "time 0" reflects an arbitrary hour that
needn't match the chosen `demand_mode`, and different junctions' patterns
peak at different hours — capacity could then be sized against a materially
different demand scenario than the one CASCADE actually models, an
apples-to-oranges comparison this anchoring removes.

### Tank reserve — a Disservice event, not persistent stock

A Tank's finite water quantity (m³) is a different physical dimension than
the rate-typed `supply_capacity`/`demand`/`capacity` fields (m³/s) — it is
already represented correctly, but *only* as `backup_duration` (hours), the
one temporal dimension the engine's backup guard actually reads
(`engine/propagation.py` Guard 2: defers any drop into `functionality_time`
for `backup_duration` hours once the tank's own feed is cut). There is no
"current volume remaining" as persistent engine state — Propagation is a
stateless, single-snapshot computation (`architecture.md`) — so nothing about
the tank's material quantity is lost that a Reset shouldn't clear.

What Reset *did* make awkward: starting that countdown was only ever an
emergent side effect of a full upstream-failure chain actually running during
Propagation — there was no direct, repeatable way to set a tank into "running
on reserve" as a deliberate scenario. Since `EventDefinition.attribute_mutations`
already supports overwriting any field on any Element (`schemas/config.py`,
no engine change needed), every Tank with a valid backup profile contributes
to ONE shared **Disservice** (no physical damage — the tanks themselves are
intact, just cut off), `id: TANK_RESERVE_EVENT_ID = "evt-tank-reserve"`, icon
`BatteryWarning`, that sets `functionality_time = backup_duration` for every
such tank at once — not a separate event per tank. A real "the whole system
lost its upstream feed" scenario hits every tank's reserve together, same
reasoning as the Blackout event below; per-tank buttons would misrepresent
the scenario and clutter the Action Bar on networks with several tanks.
Applying it puts every covered tank straight into the documented
"time-warned" state (CONTEXT.md **Functionality Time**) — fully functional
now, critical when its own countdown reaches zero — fully undoable (CTRL+Z /
clearEvent) and Scorecard-trackable like any other Event. A network with no
tank producing a valid backup profile gets no reserve event at all.

Considered and deliberately out of scope for now: true persistent stock
depletion (a running total decremented by actual flow across a session,
rather than a static volume ÷ current-demand estimate computed once at
import). That would need new stateful Node data and very likely a new engine
guard mechanic — a real architecture change (breaks the stateless
Propagation model), and would generalise beyond water (a generator's fuel,
a warehouse's stock face the identical question) — worth building as a
general CASCADE concept if ever justified, not a water-specific one-off.

### Blackout — one shared Hazard, not one per pump

Every pump is electrically driven, so a power outage takes all of them out
together — this is modelled as ONE `EventDefinition` (`id:
"evt-blackout-pump-failure"`, `type: "hazard"`) shared across every pump the
import finds, rather than a separate button per pump (which would clutter the
Action Bar for a network with many pumps and misrepresents the failure mode —
real blackouts are not independent per-pump events).

Uses the idiomatic Hazard mechanism, not `attribute_mutations`: each pump node
gets `vulnerability_levels[BLACKOUT_EVENT_ID] = n_levels − 1` (`n_levels`
here being this import's own scale size — full vulnerability, since the
frontend's `imposed = max(1, N − level)` then always resolves to 1, i.e.
critical) at import time, and the event itself carries
`default_repair_time = 6` hours (a blanket estimate — no `.inp` data
distinguishes real per-pump repair times; the user can tune it in Config).
The `EventDefinition.attribute_mutations` field's own docstring says not to
express physical damage solely through it — `direct_damage`/
`expected_repair_time` are meant to be derived automatically from
`vulnerability_levels` + `direct_damage_effects`/`default_repair_time`
(`canvas-store.ts::applyEvent` step 2), which this follows exactly. A network
with no pumps gets no blackout event.

### Demand surge — top 10% of consumers, doubled

A Disservice (`id: "evt-demand-surge-top10"`) representing a coincident spike
among the network's heaviest consumers (firefighting draw, a heatwave, industrial
peak) — the ten reasonable candidates from a wider brainstorm; the user picked
"blackout" and this one to build first. Ranks demand-bearing junctions by
their already-computed `demand_mode` value descending, takes the top 10%
(rounded up, minimum one), and doubles each one's demand via
`attribute_mutations`. Because a mutation value REPLACES the whole field (the
frontend applies `"<elementId>.<field>"` as one flat key, not a nested path —
there is no way to patch just `category_dependency_profiles.water.demand` in
isolation), the mutation carries the complete updated profile — dependency
level, doubled demand, and the junction's own priority when one was derived —
not just the changed number.

### Merging into an existing project

Import has two frontend modes (`components/controls/import-inp-section.tsx`):
**Replace project** (the original behaviour — `loadProject`/`loadConfig`
wholesale) and **Add as extra canvas**, which merges the imported network
into the *current* project instead of replacing it:

- `canvasStore.mergeImportedProject` adds the imported canvas + its nodes/edges
  into the current registry. Node ids and edge ids are separate collision
  namespaces (matching the store's own separate `nodes`/`edges` dicts): any
  id that collides with the current project's own gets a fresh
  `imp-<random>-<originalId>` id (independently-authored `.inp` files
  commonly reuse short generic ids like `"J1"` or `"R1"`, so this is a real
  case, not a defensive-only one); the canvas id is remapped the same way,
  though `build_bundle` already mints a fresh one per call
  (`f"canvas-inp-{secrets.token_hex(4)}"`, not a fixed literal — a prior
  version hardcoded `"canvas-inp-import"`, which would silently collide two
  imports onto the same canvas). Pushes one `graph_update` history entry
  (undoable), matching `copyNodesToCanvas`'s existing pattern.
- `configStore.mergeConfig` adds the imported config's categories/graph_types
  by name and events by id **into** the current config, rather than replacing
  it. A category/graph_type name that already exists is skipped (existing
  wins, surfaced in the returned summary so the UI can warn) — reconciling a
  genuine type mismatch (e.g. two conflicting definitions of `"water"`) is
  left to the user, out of scope here. An event id that already exists has
  its `attribute_mutations` **unioned** into the existing event instead of
  being skipped or duplicated — this is what makes the Blackout, Tank
  Reserve, and Demand Surge events (all using fixed, non-per-import ids)
  correctly grow to cover every merged network's own elements: importing two
  networks yields ONE "Blackout" hazard whose vulnerability spans both
  networks' pumps, not two separate hazards. `functionality_scale` is never
  touched by a merge — the target project's own scale stays authoritative
  (see the settable-scale section above: the frontend requests the import be
  built with `n_levels` = the target's own scale length specifically so this
  is safe).
- `lib/merge-import.ts::remapConfigEventIds` rewrites the elementId part of
  every event's `attribute_mutations` keys (`"<elementId>.<field>"`) through
  the id map `mergeImportedProject` returns, run **before** `mergeConfig` —
  otherwise a remapped tank/junction's scenario event would target a
  since-renamed (or now nonexistent) id. Vulnerability-based Hazards (the
  Blackout event) need no such rewrite: `vulnerability_levels` lives on the
  node object itself and travels with it through the id remap unchanged.

### Skeletonization (node budget)

`wntr.morph.skeletonize` (branch trim + series/parallel merge, demand
redistributed onto retained neighbours — demand mass conserved). Its knob is a
pipe diameter, not a size, so we binary-search the ascending distinct-diameter
list for the smallest threshold whose skeleton fits `target_nodes` (default:
the caller's Entitlement `max_nodes`). Sources, pumps and valves always
survive. Absorbed element ids land in `properties.merged_elements`.

### Hydraulic priorities (WNTR emulation)

`priority` (1–10) drives the engine's scarcity shedding; to make that order
emulate real hydraulics, a pressure-driven (PDD) steady-state sweep runs at
increasing demand multipliers (1→8, 15 steps) on the **original** network
(skeleton geometry distorts hydraulics): the first step where a junction's
delivered/expected ratio drops below 0.9 is its failure step. Early failure →
low priority. Transfer to the skeleton by demand-weighted mean over absorbed
originals (using the original network's `demand_mode`-consistent demand, not
the model's own pattern values — see the demand-anchoring note above). Sim
failure never blocks an import — it degrades to uniform priorities with a
warning.

### Orientation & placement

Pipe direction: read off the SIGN of the same demand-multiplier sweep that
sizes capacity (`core.importers.inp.sim.link_flow_profiles`), not guessed
from graph distance. A pipe whose sweep shows meaningful flow (above
`NEGLIGIBLE_VELOCITY_MS`) in only one direction is oriented by that sign,
overriding whatever direction the .inp file itself wrote it in. Multi-source
BFS from the Source set (shallow → deep) is now a **fallback only**, used
solely for links the sweep reports no signal for at all (isolated/idle
branch, or the solve failed) — it still runs across the FULL topology
(including pipes whose direction is already known) so its depth numbers stay
correct for the genuinely ambiguous remainder, it just never overrides an
already-simulated direction. Pump/valve inline edges are unaffected — they
still go through this BFS fallback exactly as before, since pump direction is
already fixed by the .inp file's own definition and isn't in scope here.

**Bidirectional pipes**: a pipe carrying meaningful flow in BOTH directions
across the sweep (the common case being a loop pipe that reverses as demand
is pushed toward stress) is modelled as **two** independently-capacitated
edges (`e_<id>__fwd`, `e_<id>__rev`) instead of being forced onto a single,
possibly wrong, direction — `schemas.network.Edge` has no undirected concept
(just `source`/`target`), so two directed edges is the only representation
available, and the max-flow-min-cost solver (`engine/flow.py`) handles two
opposing capacitated arcs between the same node pair with no special-casing
(`core.topology.incoming_closure`'s cycle guard already handles it too).
The pipe's ONE physical capacity (`π/4·d²·v_peak`) is **split** between the
two edges in proportion to how much each direction is actually used
(`velocity_fwd : velocity_rev`), not duplicated — a single cross-section
can't carry its full rated capacity in both directions at once. Explicitly
NOT modelled: time-of-day reversal (e.g. a tank filling at night, draining by
day) — this sweep is a sequence of independent steady states at increasing
demand *magnitude*, never a real clock, so a pipe that only reverses between
night and day looks single-direction here (whichever direction the chosen
`demand_mode` snapshot resolves to) and needs no special handling: a Tank is
still just a full, discharging `Source` node at baseline (see above), and its
eventual depletion is the existing `evt-tank-reserve` event, not a second
demand phase. A genuine extended-period (time-varying) simulation was
considered and rejected as unnecessary complexity for that case.

**Import-time faithfulness warnings**, added alongside this change:
- *N junctions unreachable from any Source after orientation* — a
  demand-bearing junction with no path from any Source is a real import
  defect (would show as permanently critical regardless of any
  hazard/disservice), not a network property, so it's surfaced rather than
  silently imported.
- *N of M pipes had no simulated flow signal* — how much of the network's
  capacity is a generic `FALLBACK_VELOCITY_MS` guess rather than
  simulation-grounded, and that those pipes' orientation is a topology guess
  too.
- *N pipes carry meaningful flow in both directions* — which pipes got the
  two-edge treatment above.

Coordinates: magnitude heuristic (> 10 000 → projected metres) picks between
georeferenced (pyproj `source_crs` → WGS84, default `EPSG:3004` Gauss-Boaga
Est for the Friuli files, plus a GeoAnchor whose zoom pair encodes the exact
flow↔Mercator affine used to derive `position`) and abstract placement
(scaled, y-flipped).

### Faithfulness benchmark (`scripts/validate_faithfulness.py`)

A dev-only harness answering "how closely does CASCADE's engine output match
real WNTR hydraulics for a given situation" as ONE number, so importer
changes can be judged by measurement instead of spot-checking a canvas.

For each randomly generated situation (a pipe/pump break, a demand spike, or
both — the two scenario families that matter for the importer's own
ready-made Events), it: (1) applies the identical intervention to the real
WNTR model and solves a real PDD steady state — the ground truth per-junction
served ratio; (2) converts that ratio to a functionality level using the
engine's OWN `_ratio_to_level` (not a reimplementation of it, so the
comparison isn't confounded by two different rounding rules); (3) applies the
same intervention to the imported Project and runs the real
`engine.propagation.run`; (4) reduces the per-junction comparison to one
demand-weighted **Functionality Match Score** (FMS) —
`1 − weighted_mean(|level_true − level_cascade|) / (N−1)`, in `[0, 1]`. The
mean FMS across every situation/network is the aggregate number. Only
Service (demand-bearing) junctions are compared — the only elements WNTR
gives an unambiguous continuous ground truth for. Out of scope on purpose:
Tank Reserve (a time-warning, not a hydraulic state change at the moment it's
applied — nothing for a t=0 solve to disagree with).

Shares the `benchmark_engine.py` import-linter carve-out (`pyproject.toml`)
to call `engine.propagation.run`/`engine.flow._ratio_to_level` directly — the
one seam where reusing the engine's exact logic matters more than the
boundary discipline, since a second, slightly different quantization rule
would make the harness measure its own drift instead of the engine's.

Measured aggregate FMS across Net1 + Net3 (30 random situations, seed 7):
0.753 before the velocity-sign fix above → 0.958 after it alone → 0.980 with
the contingency-sample capacity fix also applied (confirmed on a second seed:
0.984). The sign fix accounts for nearly all of the gain; the contingency
sample closes most of what's left. With Net6 added (seed 42, 20 situations
per network, all fixes applied including the global-default-pattern one
below): Net1 0.968, Net3 0.998, Net6 0.996, aggregate **0.988**.

Net6 (3300 junctions, 61 pumps, 124 controls) first scored far worse
(~0.21-0.25) even after the pump fix above — the ground-truth solve itself
delivered only ~10% of demand **regardless of demand_mode** (base/avg/peak
all landed within noise of the same ratio), a flat ratio that doesn't scale
with demand magnitude and so isn't a real capacity shortfall.

**Root cause, found by checking per-junction pressure (fine — 50-70m, nowhere
near the PDD threshold) against per-junction delivered ratio (uniformly
exactly 0.1, for every junction, regardless of its own demand):** a WNTR
Demand entry's `pattern_name=None` does NOT mean "constant, no pattern" — it
silently falls back to the model's GLOBAL default pattern
(`wn.options.hydraulic.pattern`, the .inp file's top-level `Pattern` option)
if one is set. Net6 declares one whose first multiplier is exactly 0.1. Both
`core/importers/inp/sim.py::_fixed_demand_model` (used by every sweep the
importer runs: priorities, capacity/orientation, and the contingency sample)
and `scripts/validate_faithfulness.py`'s ground-truth solve write a "fixed"
demand with `pattern_name=None`, expecting it to mean constant — so on any
`.inp` file with a global default pattern, EVERY sweep and EVERY validation
solve was silently derated by that pattern's value, uniformly, looking
exactly like a capacity/pressure problem. Net1/Net3 declare no global default
pattern, so it never surfaced there. Fixed by explicitly clearing
`model.options.hydraulic.pattern` on the private, fixed-demand copy both
places make — restores Net6 to 0.996-0.998, in line with Net1/Net3.

This is a real, generalizable bug independent of network size: any `.inp`
export using the `[OPTIONS] Pattern` convention (common for utility-scale
files, not just huge ones) would have had every sweep-derived capacity and
priority silently deflated by that pattern's value at solve time — not just
the validation harness, the actual importer output every user gets.

**Validated against real utility data, not just textbook examples.** The
three real Friuli aqueducts (`raw-networks/aqueducts/Zampis.inp` — 607
junctions, 2 sources; `Tarcento_totale.inp` — 439 junctions, 1 pump, 3 tanks;
`Cassacco_totale.inp` — 417 junctions, 2 reservoirs, no pumps/valves), run
through the same harness (seed 5, 15 situations each): Zampis 0.938, Tarcento
0.975, Cassacco 0.984 — aggregate 0.965 with `NEGLIGIBLE_VELOCITY_MS` alone;
0.962 / 0.982 / 0.980 — aggregate 0.974 — with the `DECISIVE_VELOCITY_MS` /
`MIN_HEDGE_SHARE` low-confidence-single-direction hedge described above also
applied (Net1 0.968, Net3 0.998, Net6 0.997, seed 42, unaffected by the hedge
as expected). Consistent with the synthetic networks; the noise-vs-near-
balance-point investigation above (found and resolved on Zampis specifically)
is the only place real data diverged meaningfully from Net1/Net3/Net6's
behaviour.

## Alternatives rejected

- **Custom graph contraction** — re-derives what WNTR's skeletonization
  already does with demand redistribution and hydraulic awareness.
- **Priorities from elevation/distance proxies** — ignores loops and pump
  topology; the PDD sweep is cheap (~4 s / 420 nodes) and faithful.
- **Interactive import designer** — deferred; the knobs (node budget, CRS,
  demand mode, priorities toggle) cover current needs at a fraction of the
  UI cost.
- **A user-set `design_velocity` constant** — tried first; a single guessed
  number for every pipe in the network, no better-informed than a default.
- **Velocity from a baseline (unstressed) hydraulic solve** — tried second;
  measures idle flow, not capacity, and materially understates it for
  lightly-loaded branch pipes (see above). Superseded by peak-of-sweep
  velocity.
- **Source supply defaulting to an unbounded constant** — tried first
  (reasoning: a Reservoir/Tank is an EPANET external boundary, not itself
  capacity-limited); superseded by outgoing-pipe capacity as the sole,
  unconditional behaviour — tying supply to real data already in the file
  beats an arbitrary constant, even one chosen not to bind in practice.
- **A `supply_mode` knob letting the user pick between the two** — removed;
  the user asked for outgoing-pipe capacity unconditionally, never a choice.
- **A `supply_value` fixed-override import knob** — removed earlier; the app
  already supports editing any node's `supply_capacity` in the Inspector
  after import, so a redundant import-time knob added a second,
  easily-inconsistent path to the same result.

## Consequences

- `wntr` + `pyproj` become backend runtime deps (both open-source, §1-clean).
- The importer lives under `core/importers/` (not a flat `core/inp_*.py` set
  of modules): a template for future formats (GIS, CIM) to plug in as new
  `core/importers/<format>/` siblings producing the same `ProjectBundle`.
- Import responses follow the §13.4 null-free serialisation contract.
- Two frontend import modes exist (Replace project / Add as extra canvas) —
  the latter merges rather than replaces, both the graph (canvas-store) and
  the config (config-store); see "Merging into an existing project" above.
- Functionality scale size (`n_levels`) is a real knob, not a hardcoded `N=3`
  — needed for merge mode to target an existing project's own scale.
