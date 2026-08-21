# CASCADE

A platform for modelling multi-canvas systems and analysing how failures cascade across their Elements.

Glossary entries are deliberately short: what the term IS, the distinctions that matter, and where the mechanics live (usually an ADR). One term, one meaning.

## Language

**Entity**:
A real-world network being modelled — physical or organisational (a water system, an ICT network, a hospital). Each Entity is represented as one Graph / Canvas.
_Avoid_: Infrastructure, system (when "a modelled network" is intended)

**Graph**:
The mathematical structure representing one Entity: typed nodes and edges plus a `graph_type` reference. Prefer "Graph" in domain and technical conversation.
_Avoid_: Layer, subnetwork (in domain conversation)

**Canvas**:
The named UI container for one Graph — display metadata plus a `graph_type` naming an entry in `ModelConfiguration.graph_types`, which tells the engine which heuristic pipeline to apply. The Global view carries its own `graph_type` (`Project.global_graph_type`) whose config lists constituent local graph types; a global Propagation composes their pipelines. Set from the Inspector's Canvas Meta panel or the Config modal's Graph Types tab.
_Avoid_: Layer, network layer (use Graph or Canvas by context)

**Multi-canvas**:
The set of Canvases (and inter-canvas edges) in scope for a Propagation; with every Canvas included it is the **full multi-canvas**.
_Avoid_: Network of Networks, full graph, multi-canvas project

**Element**:
A node or edge within a Graph — the atomic building block of an Entity.
_Avoid_: Entity (for a node/edge), component, resource

**GraphSnapshot**:
A point-in-time serialisation of a multi-canvas (or one Canvas) — the code-level form of a Scenario, used in `update_history`.
_Avoid_: Scenario (in code); GraphSnapshot (in domain conversation — say Scenario)

**Event**:
Any applied perturbation affecting Elements — parent concept of Hazard and Disservice. The affected set is implicit: every Element whose own `vulnerability_levels[event.id] > 0` (the levels live on Elements, keyed by EventId — not on the Event). The Event definition carries `direct_damage_effects` (per-Element `expected_repair_time` overrides, Hazards only) and `attribute_mutations` (unrestricted field overwrites, `"<elementId>.<field>"` keys). The typed repair signal and the free-form mutations are complementary, not redundant.
_Avoid_: Incident, perturbation (in domain conversation)

**Hazard**:
An Event causing physical damage (`direct_damage = true`) plus functional degradation; recovery requires explicit repair. Frequency is `frequency_per_10y`, never `probability` (a different quantity).
_Avoid_: Accident, failure (when physical damage is meant)

**Disservice**:
An Event degrading Functionality without physical damage; resolves when its upstream cause resolves.
_Avoid_: Outage, disruption (when the no-damage meaning is intended)

**Scenario**:
A Functionality state of a multi-canvas fed to a Propagation — created by applying an Event, manual what-if edits, or restoring history.
_Avoid_: Simulation state, hazard scenario (a Scenario need not come from a Hazard)

**Propagation**:
One engine computation: Scenario + Model Configuration → post-cascade Scenario. Monotone: Functionality only worsens within a run. Scope is **local** (client trims the request to the active Canvas) or **global** (full Project sent); scope affects only the engine payload, never the global registry. Endpoint: `POST /api/propagate`.
_Avoid_: Simulation

**Functionality Time**:
Integer hours on an Element signalling pending timed degradation: > 0 means functional now, drops to 1 when the countdown (advanced only by Temporal Jumps, not wall-clock) reaches zero. Set by the engine (backup exhaustion) or manually as a what-if.
_Avoid_: Time warning, countdown, timer

**Temporal Jump**:
An Event kind advancing simulated time by N hours: subtracts N from every positive Functionality Time, clamps expiries to 0 with Functionality 1, then a Propagation follows. Full Event semantics (history entry, undo, Scorecard trigger). Auto-advance fires jumps to the minimum remaining Functionality Time until none remain.
_Avoid_: Temporal Propagation Sequence (retired), time step, clock tick

**Node Type**:
Display classification (`Source` / `Infrastructure` / `Service` / `Personnel`) controlling rendering only — the engine branches solely on Category and Category Type. Personnel-specific DSL is out of scope.
_Avoid_: Node class, node role

**Model Configuration**:
The complete user-editable project settings, split into Client Configuration and Engine Configuration. Never abbreviated.
_Avoid_: Config, ModelConfig, ProjectConfig, settings

**Client Configuration**:
The frontend-only subset — display colours, Event definitions (applied client-side), Scorecard weights, Canvas metadata. Never sent to the backend.
_Avoid_: Display configuration, UI config

**Engine Configuration**:
The subset the backend reads to instantiate the engine — categories, rules, graph-type heuristic pipelines, Functionality scale. The full Model Configuration travels with every Propagation request; the engine reads only these fields.
_Avoid_: Propagation configuration, backend config

**Runtime Configuration**:
Deployment settings (env vars, DB URLs, OAuth credentials) — not part of the project model.
_Avoid_: Codebase configuration, .env settings (in domain conversation)

**Category**:
A named resource type (e.g. "water") defined in Engine Configuration, with exactly one Category Type. Nodes carry Category names (`node_categories`); the engine looks up the type and applies the matching heuristic. Global to the project.
_Avoid_: Resource type, dependency type

**Category Type**:
The engine heuristic class of a Category — a **closed enum**: `SourceToDemands` (capacitated flow from sources to demands) or `Requisite` (threshold dependency, no quantity). Closed at every validation boundary (Pydantic Literal, Zod enum, UI select) because the engine dispatches on exact string equality. **Category Type chooses the algorithm; Graph Type tunes it** — physics here, policy there.
_Avoid_: Category class, dependency model; confusing with Graph Type (which never changes WHICH mechanism runs)

**Graph Type**:
A named, per-Canvas configuration profile (`GraphTypeConfig`) that **tunes** the mechanisms Category Types select — heuristic params such as the Flow Allocation strategy — and carries dispatch escapes (the reserved `"epanet"` value bypasses the engine for a live WNTR solve, ADR-0013). Same categories under two Graph Types = same physics, different policy. User-named, free text.
_Avoid_: using it to mean the mechanism itself (that is Category Type)

**Flow Allocation**:
How a `SourceToDemands` category shares **scarce** supply — the first Graph Type policy knob (`source-to-demands-flow` heuristic's `allocation` param, ADR-0014): `tiered_fair_share` (default — priority tiers preempt strictly, equals share max-min-fairly) or `priority_greedy` (single min-cost max-flow, strict triage, winner-take-all among equals, cheapest). Fidelity to real hydraulics is insensitive to the choice once capacities are parameterized correctly (`experiments/aqueducts/ATTEMPTS.md`).
_Avoid_: "algorithm" bare (say allocation or allocation strategy)

**Rule**:
A logical condition on an Element determining when its Functionality degrades from other Elements' state. Kinds: **Specific** (named Element), **Intracategorical**, **Intercategorical**. Parsed/validated client-side; evaluated exclusively by the engine. Levels may be integers or scale labels (resolved at parse time; undefined labels ignored with a warning).
_Avoid_: Dependency rule, condition, constraint

**Category Dependency Profile**:
A node's per-Category guard parameters: `dependency_level` (1..N; attenuates a proposed drop by `P + (N − dependency_level)`; missing profile = N, full dependency), `backup`/`backup_duration`, optional per-Category `capacity` (max throughput, degrades with Functionality), and for SourceToDemands `demand` and `priority`. Keyed by Category name; edges carry none. See ADR-0005.
_Avoid_: Category block, dependency block, category attributes

**Edge Capacity**:
`edge.capacity` — one number, max throughput of the single category-flow the edge carries (determined by its source node's supply). Multiple category limits = multiple edges. Unspecified capacity defaults to the category's max source supply, scaled by Functionality (ADR-0003).
_Avoid_: treating edge capacity as category-agnostic or multi-category

**Functionality**:
A discrete integer 1..N on an Element (1 = worst, N = fully operational), on the scale defined in Model Configuration.
_Avoid_: Status, health, service level, operativity (for a single Element)

**Operativity Score**:
Weighted average Functionality across a Canvas or the full multi-canvas, computed from any Scenario. Appears in the Scorecard.
_Avoid_: Operativity index, health score, operativity (without "Score")

**Scorecard**:
An atlas of entries the user explicitly saves — never automatic. Discriminated union on `type`: `"propagation"` (stacked `event_ids`, before/after snapshots, optional result) or `"analysis"` (metric name, scope, per-Element scores, snapshot, optional PNG). Persisted as `Project.scorecard`, separate from `update_history`. See ADR-0006, requirements §12.
_Avoid_: Report, dashboard; "Scorecard" for a single entry; assuming auto-generation

**Model Graph Update**:
A Graph modification that does NOT change Functionality (topology, attributes). Does not affect the Scenario.
_Avoid_: Graph Update, structural update (in domain conversation)

**Any Graph Update**:
Superset: Model Graph Updates plus Functionality-changing operations. The undo (CTRL+Z) history operates on these.
_Avoid_: Any Update, change (when the undo-history meaning is intended)

**Responsibility Share**:
`{element_id: float}` in (0,1] summing to 1, returned by whichever mechanism produced a node's final (worst) Functionality — who triggered the degradation, in what proportion. Requisite: failed upstreams split evenly. SourceToDemands: provisional uniform blame over degraded same-category upstream elements (empty if none). Events: the EventId alone; Specific Rules: referenced Elements evenly. Zero shares are never emitted.
_Avoid_: Blame, causal weight, attribution

**Recovery Value**:
The total weighted loss terminating on an Element when losses are distributed backwards along Responsibility Share chains — what repairing it would unblock, including its own loss (`W × (N − functionality)/(N − 1)`, weight `cost_of_disservice_per_day ?? importance ?? 1`). Drives Intervention Prioritisation (requirements §10); only `direct_damage` Elements are ranked as repair targets.
_Avoid_: priority score, criticality; ranking non-damaged Elements

**Heuristic Pipeline**:
The engine's per-node, per-round order: **propose → guard → commit**. Propose = universal Requisite pass (logical aggregation over all incoming edges, every category) merged via `worst_of` with the SourceToDemands flow pass (demand-bearing nodes only). Guards (`dependency_level`, `backup`) modulate the proposal; commit = `worst_of(current, P)`, the sole guarantor of monotonicity. See ADR-0003/0005.
_Avoid_: Propagation pipeline, rule pipeline

**Node Position vs Geo Coordinates**:
Two independent, always-preserved fields: `position` (React Flow layout, non-geo mode) and `geo` (lng/lat, georeferenced mode). Geo mode ignores `position` for rendering but retains it for switching back.
_Avoid_: treating `position` as ground truth in geo mode; treating `geo` as a display hint

**GeoAnchor**:
The single flow-point ↔ geographic-coordinate correspondence (plus zoom levels) from which the exact Web Mercator projection converts any flow position to `geo` and back — the same projection MapLibre draws with, so nodes and map never disagree. One per georeferenced Canvas.
_Avoid_: flat-earth/linear approximation; "calibration"/"registration point"

**Analysis Metric**:
A named per-Element scoring of a Graph. Two families: **topological** (client-side graphology: degree, betweenness, closeness, eigenvector, reachability, community, articulation, percolation) and **model-based** (engine-side: Vitality Centrality, Shapley Values). Each has a recommended graph type badge in the Analysis page.
_Avoid_: "analysis type", "metric type"

**Analysis Heatmap**:
The colour overlay encoding an Analysis Metric's scores on the canvas (**Analysis Mode** — colours mean scores, not Functionality). Cleared by Reset.
_Avoid_: "heatmap mode", "centrality overlay"

**Vitality Centrality**:
Model-based metric: Operativity Score drop from removing one Element and re-propagating. One engine call per Element; ranks nodes and edges.
_Avoid_: "vitality score" (Recovery Value is the intervention metric; Vitality is analysis)

**Shapley Value**:
Model-based metric: each Element's marginal contribution averaged over removal orderings (exact 2^N; approximate with parameters).
_Avoid_: "Shapley centrality"

**Coupling Strength**:
Per Canvas pair: inter-canvas edges ÷ total edges. High = failures likely cascade between the two.
_Avoid_: "interdependency ratio" (reserved for the per-Canvas measure)

**Interdependency Ratio**:
Per Canvas: fraction of its nodes with at least one inter-canvas edge.
_Avoid_: "coupling ratio"

**Inter-Canvas Edge Creation**:
Only via the dedicated dialog (source Canvas/node → target Canvas/node); the result is a uniform Edge in the global registry. No cross-canvas drag-and-drop.

**Analysis Log**:
Append-only, operator-only record of engine runs — input-shape and run metadata plus caller ID/role only. Never the network, Element/Entity names, locations, GeoAnchor, or outcomes. Governed by ADR-0007.
_Avoid_: "audit log" (distinct accountability trail), "usage log", "telemetry"

**Entitlement**:
The quota bundle a Role grants: `max_nodes` and an engine-evaluation budget per minute, enforced server-side before the engine runs. Distinct from a Role's boolean permissions — permissions say *whether*, the Entitlement says *how much*. See ADR-0008.
_Avoid_: "plan", "tier" ("quota" for one knob is fine)

**Engine Evaluation**:
The metered unit of engine work: one Propagation = 1; a model-based analysis = `permutations × N`. Budgets are spent in these units, not API requests. See ADR-0008.
_Avoid_: "engine run", "propagation call" (ambiguous)

**Network Importer**:
A pure transformation of an external network format into a CASCADE ProjectBundle — parse, reduce, map; never persist, never propagate. One subpackage per format under `CASCADE-backend/core/importers/`; the first is the EPANET `.inp` water importer (`POST /api/import/inp`). All mapping rules — sources (reservoirs, tanks, injection wells), Service/Infrastructure junctions, inline pump/valve nodes, uniform Design Velocity pipe capacities (with the Sweep providing orientation and the retained Capacity Margin drill), Full-Duplex Splits, skeletonization, generated scenario Events, Replace/Add-as-extra-canvas modes — live in ADR-0012.
_Avoid_: "converter", "uploader"; treating import as sync (nothing is stored server-side)

**Design Velocity**:
The default pipe-capacity rule: `capacity = π/4·d² × capacity_velocity`, a single uniform design speed (`DEFAULT_DESIGN_VELOCITY_MS = 2.5 m/s`, exposed as `ImportOptions.capacity_velocity`) applied to every pipe — no hydraulic solve. Adopted 2026-07-27 after a full 8-network ablation showed the per-pipe Sweep capacities (the "drill") buy nothing over it (F1 0.770 vs 0.778). Set `capacity_velocity=None` to fall back to the drill. Fidelity comes from topology/orientation/priorities, not tuned capacities. Default: `map.py::DEFAULT_DESIGN_VELOCITY_MS`.
_Avoid_: "assumed velocity" (it is a validated default, not a guess); do not conflate with the Sweep's per-pipe velocities

**Sweep (demand-multiplier sweep)**:
The importer's parameterization instrument: independent steady-state PDD solves with all demands scaled 1×→8× (no clock — deliberately not extended-period). Its primary product is **orientation** (per-pipe flow direction from the flow sign); it also yields per-pipe peak |velocity|, used for pipe capacity only under the retained drill (`capacity_velocity=None`) and always for valve capacity.
_Avoid_: "simulation" (too generic), "time series" (no clock)

**Contingency (contingency solve)**:
One import-time PDD solve with one link (or a trunk pair, N-2) closed at nominal demand — discovers backup-pipe capacity the Sweep can't (only a topology change reroutes flow). Folds into the same capacity accumulation (max — only ever raises).
_Avoid_: "failure scenario" (that is a runtime Scenario/Event; this is an import-time probe)

**Capacity Margin**:
Multiplier on Sweep/Contingency peak velocity (`ImportOptions.capacity_margin`, default 2.0), with an optional `max_velocity` cap (default 3.0 m/s) clamping `v_peak × margin`. Since 2026-07-27 this governs **valve** capacity always, and **pipe** capacity only under the retained Sweep drill (`capacity_velocity=None`) — the default Design Velocity method ignores it for pipes. The observed peak is a lower bound; the margin removes that systematic underestimate (not a safety conservatism). Default: `map.py::DEFAULT_CAPACITY_MARGIN`.
_Avoid_: "safety factor" (it removes a systematic underestimate, not adds conservatism); do not describe it as the default pipe-capacity rule (Design Velocity is)

**Full-Duplex Split**:
A bidirectional pipe (Sweep signal both ways) imports as two directional edges **each at full physical capacity** — not proportional shares, which starve exactly the reversal direction failure-rerouting needs. Shipped: `map.py::_emit_split`.
_Avoid_: "bidirectional edge" alone (Full-Duplex names the full-capacity-per-direction rule)

**Persistence Boundary**:
Config-level vocabulary may be persisted; anything naming or locating a real-world Element or Entity may not. Networks transit the engine in memory; disk only on explicit Sync opt-in. See ADR-0007.
_Avoid_: "privacy policy" (legal doc; this is the engineering rule)

## Flagged ambiguities

- "Canvas" vs "Graph" — same concept, different register: **Graph** in domain/technical talk, **Canvas** in UI/data-model context.
- "Network of Networks" — retired; use **multi-canvas** / **full multi-canvas**.
- "Simulation" — use **Propagation** (one run) or **Temporal Jump** sequence (time-stepped).
- "ProjectConfig" / "ModelConfig" — retired; the type is `ModelConfiguration`.
- "auto-merge" — retired; global display renders all Canvases, unique IDs need no dedup.
- Node `position` vs `geo` — independent fields, both always preserved.
- Convergence not reached — partial result merges normally + persistent warning; nothing rolls back.
- Edge `functionality` — the user-set intrinsic level; the engine commits `worst_of(intrinsic, source_node)` (ADR-0004); the frontend never recomputes it.
- "Temporal Propagation Sequence" — retired; a chain of Temporal Jumps each followed by a Propagation.
