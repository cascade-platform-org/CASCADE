# CASCADE

A platform for modelling multi-canvas systems and analysing how failures cascade across their Elements.

## Language

**Entity**:
A real-world network being modelled — not limited to physical infrastructure (e.g. a water distribution system, an ICT network, a hospital organisation). Each Entity is represented in the tool as a Graph / Canvas.
_Avoid_: Infrastructure, system (when the domain meaning of "a modelled network" is intended)

**Graph**:
The mathematical structure representing one Entity: a typed set of nodes and edges, plus a `graph_type` reference. In domain and technical conversations, prefer "Graph."
_Avoid_: Layer, subnetwork (in domain conversation)

**Canvas**:
The named UI container for one Graph — carries display metadata (id, label, colour, CRS, georeferenced flag) and a `graph_type` that tells the engine which heuristic pipeline to apply. The `graph_type` value is a name referencing an entry in `ModelConfiguration.graph_types` (where the pipeline is defined); the Canvas holds only the name assignment. `graph_type` can be set from two places: the Inspector's Canvas Meta panel and the Graph Types tab of the Model Configuration modal. The backend reads `canvas.graph.graph_type` to dispatch heuristics.

The **Global view** (all Canvases rendered together) also carries a `graph_type`, stored as `Project.global_graph_type`. It follows the same assignment model: a name referencing a `ModelConfiguration.graph_types` entry, settable from the Graph Types tab alongside per-canvas assignments. The global graph type's `GraphTypeConfig` carries a `local_graph_types` list naming the constituent local (per-Canvas) graph types; during a global Propagation the engine composes their heuristic pipelines (merging the heuristics — params are category-keyed, so they coexist without conflict). A local graph type leaves `local_graph_types` absent and its `heuristics` list is its literal pipeline.
_Avoid_: Layer, network layer (use Graph or Canvas depending on context)

**Multi-canvas**:
The set of Canvases (and inter-canvas edges) currently in scope for a Propagation. When all Canvases are included, it is called the **full multi-canvas**.
_Avoid_: Network of Networks, full graph, multi-canvas project

**Element**:
A node or edge within a Graph — the atomic building blocks of an Entity.
_Avoid_: Entity (when referring to a node or edge), component, resource

**GraphSnapshot**:
A point-in-time serialisation of a multi-canvas (or a single Canvas) — the code-level representation of a Scenario. Used in `update_history` to capture before/after states.
_Avoid_: Scenario (in code); GraphSnapshot (in domain conversation — say Scenario instead)

**Event**:
Any applied perturbation that affects Elements — the parent concept for Hazard and Disservice. An Event carries: `vulnerability_levels` (per-EventId Functionality drop, keyed by EventId), `direct_damage_effects` (typed physical damage signal for Hazards), and `attribute_mutations` (unrestricted field overwrites on any Element, including first-class fields like `functionality` and `direct_damage`). `direct_damage_effects` is a typed shorthand kept alongside `attribute_mutations` for engine legibility; the two are not redundant — `direct_damage_effects` is an explicit engine-recognised physical damage signal.
_Avoid_: Incident, perturbation (in domain conversation)

**Hazard**:
An Event that causes physical damage (`direct_damage = true`) in addition to functional degradation. Recovery requires explicit repair tracked by the timeline. Hazard frequency is expressed as `frequency_per_10y` (occurrences per 10 years) — never as `probability`, which is a different quantity.
_Avoid_: Accident, failure (when the specific meaning of physical damage is intended)

**Disservice**:
An Event that degrades Functionality without physical damage. Resolves when its upstream cause resolves.
_Avoid_: Outage, disruption (when the specific no-physical-damage meaning is intended)

**Scenario**:
A Functionality state of a multi-canvas (or a single Canvas) that is fed to a Propagation. A Scenario can be created by applying an Event, by manually setting Functionality values as a what-if, or by restoring a past state from history.
_Avoid_: Simulation state, hazard scenario (Scenario is broader — it need not originate from a Hazard)

**Propagation**:
A single engine computation that takes a Scenario and a Model Configuration and returns a new Scenario (the post-cascade state). Scope is either **local** or **global**. All Canvases are operationally interdependent — Elements have globally unique IDs and a node may appear in multiple Canvases. Scope governs only what the client sends to the engine: **local** — the client trims the `PropagationRequest` to the active Canvas's nodes and intra-canvas edges (inter-canvas edges are physically absent from the payload); **global** — the full Project is sent unchanged. Event application always writes to the global registry regardless of scope; scope only affects the engine payload. Propagation is **monotone**: Functionality can only worsen during a run — never improve. The API endpoint is `POST /api/propagate` (owned by `CASCADE-backend/api/propagation_routes.py`).
_Avoid_: Simulation

**Functionality Time**:
An attribute on an Element (integer, hours) that signals the Element will degrade further at a future point. A value > 0 means the Element is in a time-warned state — it is currently functional at its current level but will drop to Functionality 1 when the countdown reaches zero. The countdown is advanced by the Temporal Propagation Sequence; it does not tick in real time. A value of 0 means no pending timed degradation. Functionality Time may be set by the engine (e.g. when backup duration is exhausted) or manually by the user as a what-if Scenario input. Manual edits are recorded as `manual_functionality_update` entries in `update_history`.
_Avoid_: Time warning, countdown, timer (use Functionality Time)

**Temporal Jump**:
A special Event kind that advances simulated time by a fixed number of hours. For every Element with Functionality Time > 0, it subtracts the jump duration from Functionality Time. If the result drops to ≤ 0, Functionality Time is clamped to 0 and Functionality is set to 1 (critical). A Propagation immediately follows to cascade the effects. Temporal Jumps are Events in the full sense: they are stored in `update_history` as `event_applied` entries (kind = `temporal_jump`), can be undone with CTRL+Z, and are the triggering Event for a Scorecard entry. The "auto-advance" mode fires Temporal Jumps in a loop, always jumping to the minimum remaining Functionality Time across all Elements, until no Elements with Functionality Time > 0 remain.
_Avoid_: Temporal Propagation Sequence (retired — replaced by Temporal Jump + Propagation), time step, clock tick

**Temporal Propagation Sequence** *(retired term)*:
Previously described as a separate mechanism. Now modelled as a chain of Temporal Jump events each followed by a Propagation. The history pattern is always: Event → Propagation → Event → Propagation. Use **Temporal Jump** in all new documentation and code.
_Avoid_: Use "Temporal Jump" instead

**Node Type**:
A display classification for a node — one of `Source`, `Infrastructure`, `Service`, or `Personnel`. `Personnel` represents a role or service provided by a human agent. Node Type is a Client Configuration concern: it controls how the node is rendered on the Canvas (icon, shape, colour). The engine does not branch on Node Type; heuristic behaviour is determined solely by Category and Category Type. All Node Types including `Personnel` are treated identically by the engine in v2. Personnel-specific DSL (shifts, availability, fatigue) is explicitly out of scope.
_Avoid_: Node class, node role (use Node Type)

**Model Configuration**:
The complete set of user-editable project settings. Divided into Client Configuration and Engine Configuration. Never abbreviated — `ModelConfiguration` in both code and conversation.
_Avoid_: Config, ModelConfig, ProjectConfig, project config, settings

**Client Configuration**:
The subset of Model Configuration used only by the frontend — display colours, Event definitions (pre-applied client-side), Scorecard weights, Canvas metadata. Never sent to the backend.
_Avoid_: Display configuration, UI config

**Engine Configuration**:
The subset of Model Configuration the backend needs to instantiate the propagation engine correctly — category definitions, rules, graph type heuristic pipelines, and the Functionality scale N value. The full Model Configuration is sent with every Propagation request; the backend reads only the Engine Configuration fields from it.
_Avoid_: Propagation configuration, backend config

**Runtime Configuration**:
Infrastructure and deployment settings — environment variables, database URLs, OAuth credentials. Not part of the project model.
_Avoid_: Codebase configuration, .env settings (in domain conversation)

**Category**:
A named resource type (e.g. "water", "electricity", "personnel") defined in the Engine Configuration. Each Category has exactly one **Category Type** (`SourceToDemands` or `Requisite`, extensible in the future). A node carries a list of Category names (`node_categories`) — the engine looks up each name in the configuration to find its type and applies the corresponding heuristic logic. The Category and its type are global to the project; two nodes in the same Category always share the same Category Type.
_Avoid_: Resource type, dependency type (use Category and Category Type)

**Rule**:
A logical condition attached to an Element (node or edge) that determines when its Functionality degrades based on the state of other Elements. Each Element carries a list of Rules. Three kinds exist: **Specific** (references a named Element), **Intracategorical** (references Elements within the same Category), and **Intercategorical** (references Elements across different Categories). Rules are parsed and validated client-side; evaluation (determining which Elements change Functionality) is the engine's exclusive responsibility. Functionality values in rules may be expressed as integers (`node1.functionality is <2`) or as labels defined in `FunctionalityScaleLevel` (`node1 is critical`); label resolution to integer happens at parse time using the Model Configuration. A rule referencing an undefined label is ignored and produces a warning.
_Avoid_: Dependency rule, condition, constraint (use Rule)

**Category Dependency Profile**:
The set of guard parameters a node carries for one specific Category — how deeply it depends on that Category, whether it has backup, how long the backup lasts, how much resource it demands, and its allocation priority. `dependency_level` ∈ 1..N is a **guard**: it attenuates a proposed Functionality drop by the linear shift `P' = min(current, P + (N − dependency_level))`, where N is the Functionality scale size. Level N = full dependency (drop passes unattenuated); level 1 = no dependency (any drop is neutralised entirely). Stored on the node as a record keyed by Category name (`category_dependency_profiles` in code). **A missing entry for a category discovered via incoming edges defaults to `dependency_level = N`** (full dependency, no protection) — the modeller adds an explicit profile only to attenuate the drop or add backup. The frontend auto-adds a default profile entry (`dependency_level = N`) when an edge is created whose source declares a category not yet in the target's profiles; if the edge is later deleted, the profile is retained and flagged as orphaned in the Inspector. Fields irrelevant to a given Category Type are left absent (`demand` and `priority` are SourceToDemands-only; `backup` and `backup_duration` apply regardless of Category Type; `dependency_level` applies to all types). Edges have no Category Dependency Profile. See ADR-0005.
_Avoid_: Category block, dependency block, category attributes

**Edge Capacity**:
`edge.capacity` is a single number expressing the maximum throughput of the flow carried by that edge. An edge carries exactly one category-flow, determined by its source (tail) node's supply category. `capacity` therefore needs no per-category qualifier — it caps the flow of whatever the source supplies. If a source node supplies multiple categories and different capacity limits are needed per category, they are modelled as separate edges (one per category). When `capacity` is **unspecified**, the engine defaults it (and unspecified infrastructure throughput) to the **maximum supply of any source in the category**, scaled by Functionality — so a degraded edge/node throttles flow and propagates the shortage (see ADR-0003 → Flow proposal). A category with no source leaves these capacities unbounded. One edge = one category flow.
_Avoid_: treating edge capacity as category-agnostic or multi-category

**Category Type**:
The engine heuristic class associated with a Category. Defined in Engine Configuration alongside the Category name. Currently two types exist:
- `SourceToDemands` — a flow category: Source nodes have supply capacity, demand nodes request an amount, the engine allocates flow (respecting priority) and degrades Functionality when demand is unmet.
- `Requisite` — a threshold dependency: a node requires its upstream to be above a Functionality threshold; no quantity allocation, just a pass/fail check.
New Category Types may be added in future without changing the Category data model.
_Avoid_: Category class, dependency model

**Functionality**:
An attribute on an Element — a discrete integer on the 1..N scale defined in the Model Configuration (1 = worst, N = fully operational) — expressing how well that Element is performing.
_Avoid_: Status, health, service level, operativity (when referring to a single Element's Functionality attribute)

**Operativity Score**:
An aggregate metric computed from any Scenario — the weighted average Functionality across a Canvas or the full multi-canvas. Appears in the Scorecard. Not limited to post-Propagation states; can be computed from any manually crafted Scenario.
_Avoid_: Operativity index, health score, operativity (without "Score")

**Scorecard**:
An atlas of named entries explicitly saved by the user. A Scorecard entry is a **discriminated union** on `type`:
- `type: "propagation"` — stores `scenario_before`, optional `scenario_after`, optional `after_temporal_jump`, and optional `propagation_result`. The user saves one by clicking "Save to Scorecard" after a Propagation. See requirements §12.
- `type: "analysis"` — stores the Analysis Metric name, scope (active Canvas or global), per-Element scores `{ [elementId]: number }`, a GraphSnapshot at time of computation, and an optional PNG capture of the canvas with the Analysis Heatmap applied. Saved from the Analysis page. See ADR-0006.

Nothing is saved automatically. Derived metrics (Operativity Score, cost of disservice, etc.) are computed client-side from snapshots and never persisted. The Scorecard is persisted as a top-level field on the Project (`Project.scorecard`), separate from `update_history`.
_Avoid_: Report, dashboard, results panel; do not use "Scorecard" to refer to a single entry; do not treat Scorecard as auto-generated; do not assume all entries are Propagation entries

**Model Graph Update**:
Any modification to a Graph that does NOT change Element Functionality — adding or removing nodes/edges, editing non-Functionality attributes, changing topology. Does not affect the Scenario.
_Avoid_: Graph Update, structural update, topology change (in domain conversation)

**Any Graph Update**:
Any modification to the graph — a superset covering both Model Graph Updates and Functionality-changing operations (Event applied/cleared, Propagation result, manual Functionality edit). The undo (CTRL+Z) history operates on Any Graph Updates.
_Avoid_: Any Update, change, modification (when the specific undo-history meaning is intended)

**Responsibility Share**:
A dictionary `{ element_id: float }` returned by every heuristic or Rule that causes a node's Functionality to worsen. Values are in (0, 1] and sum to 1. Zero shares are never emitted — a blameless Element is simply absent from the dictionary (enforced by both the Pydantic and Zod schemas). Identifies which upstream Elements are the direct triggers of the degradation and in what proportion. For `Requisite` categories (logical heuristic), failed upstreams split evenly. For `SourceToDemands` (flow heuristic), a provisional v1 "uniform-blame" rule applies: the degraded elements (nodes and edges, same category, Functionality `< N`) in the transitive incoming closure of the target split responsibility uniformly; if none are degraded the dictionary is empty. For Event-caused degradation, the single key is the EventId. For Specific Rules, all Elements referenced in the condition split evenly. Responsibility Share is populated only from the heuristic or Rule that produced the final (worst) Functionality for the node.
_Avoid_: Blame, causal weight, attribution

**Recovery Value**:
The total weighted loss that terminates on an Element when degradation losses are distributed backwards along transitive Responsibility Share chains — i.e. everything that repairing this Element would unblock, including its own weighted degradation. Each degraded Element's loss is `W × (N − functionality)/(N − 1)` with weight precedence `cost_of_disservice_per_day ?? importance ?? 1` (edges carry intrinsic loss 0). Computed client-side by Intervention Prioritisation (requirements §10); the ranked repair list contains exactly the Elements with `direct_damage = true`, ordered by Recovery Value or by value per repair hour (`recovery_value / expected_repair_time`).
_Avoid_: priority score, criticality (use Recovery Value); ranking non-damaged Elements as repair targets

**Heuristic Pipeline**:
The mechanisms executed by the engine during a Propagation, run per node per round in a **fixed canonical order**: **propose → guard → commit**. Each node holds a single running proposed Functionality `P` (initialised to its current value). The proposal phase has two sub-steps, both merged into `P` via `worst_of`:
1. **Universal Requisite pass** — runs for *every* node over *every* incoming edge, regardless of category type. Incoming edges are grouped by the source node's declared categories; `best_of` is applied over deliverables `L(u→v) = worst_of(node_func, edge_func)` within each group; then `worst_of` across groups yields `P_req`. This is the default propagation and makes every edge-implied dependency visible to the engine without requiring explicit profile declarations.
2. **SourceToDemands flow pass** — runs only for nodes with `demand > 0` in a `SourceToDemands`-typed category. Executes priority min-cost max-flow and maps the served-ratio to a candidate `P_flow`. Acts as an additive layer on top of the universal Requisite pass.
**Guard** mechanisms (`dependency_level`, `backup`) then modulate the merged `P`. When a source category is not declared in the target's `category_dependency_profiles`, the guard defaults to `dependency_level = N` (full dependency). **Commit** sets `functionality = worst_of(current, P)` — the sole guarantor of monotonicity. Mechanism roles are typed: logical/flow are proposal-only, `dependency_level`/`backup` are guard-only, and Rules (specific/intra/inter) can act as either. See ADR-0005.
_Avoid_: Propagation pipeline, rule pipeline (the Heuristic Pipeline is distinct from Rule evaluation)

**Node Position vs Geo Coordinates**:
A node carries two independent position fields. `position: {x, y}` is the React Flow layout position in abstract canvas space — used when the Canvas is not georeferenced. `geo: {lng, lat}` is the real-world geographic coordinate — used when the Canvas is georeferenced (MapLibre renders the node at that location). The two fields are independent and both preserved at all times. When a Canvas is georeferenced, `position` is ignored for rendering but retained so that switching back to non-georeferenced mode restores the last known layout. When switching from geo to non-geo and `position` is absent, the Canvas auto-layouts nodes on first render.
_Avoid_: treating `position` as the ground truth in geo mode; treating `geo` as a display hint only

**GeoAnchor**:
The single correspondence that ties a georeferenced Canvas's abstract flow space to real-world geography. It records one flow point and the geographic coordinate it maps to, plus the React Flow and MapLibre zoom levels captured at anchor time (`flow`, `geo`, `rf_zoom`, `ml_zoom`). From this one anchor the **GeoAnchor projection** converts any flow position to a `geo` coordinate and back. The projection is exact Web Mercator: flow space ↔ Mercator world coordinates is a constant affine map, and Mercator world ↔ lng/lat is the standard closed form — the same projection MapLibre uses to draw tiles, so node placement and the map background never disagree. There is exactly one GeoAnchor per georeferenced Canvas, set by the user in the map background's setup mode.
_Avoid_: flat-earth / linear approximation (the projection is exact Mercator, not a cosine-latitude shortcut); calling it a "calibration" or "registration point"

**Analysis Metric**:
A named computation run on a Graph (or multi-canvas) that produces a scalar score per Element. Two families exist:
- **Topological** — computed client-side via graphology on the graph structure alone: degree, betweenness (node and edge), closeness, eigenvector, reachability (upstream/downstream cone), community (Louvain), articulation points, percolation robustness.
- **Model-based** — computed engine-side via repeated Propagation calls: Vitality Centrality and Shapley Values.

Each metric has a recommended graph type (`SourceToDemands`, `Requisite`, or global) where it is most diagnostic, indicated by a badge in the Analysis page.
_Avoid_: "analysis type", "metric type" (use Analysis Metric)

**Analysis Heatmap**:
A colour overlay applied to Elements on the canvas that encodes an Analysis Metric's scores as a light-to-dark gradient. While the Analysis Heatmap is active the canvas is in **Analysis Mode** — Element colours reflect metric scores, not Functionality levels. Cleared by the Reset button, which restores normal Functionality-based colouring. The Analysis Heatmap is toggled from the Analysis page after a metric is computed; the page can be minimised to inspect the heatmap on the live canvas.
_Avoid_: "heatmap mode", "centrality overlay" (use Analysis Heatmap)

**Vitality Centrality**:
A model-based Analysis Metric: the drop in Operativity Score that results from removing a single Element from the graph and re-running Propagation. Computed server-side — requires one engine call per Element. The ranked list contains both nodes and edges. Higher Vitality = removing this Element causes a greater loss of Operativity Score.
_Avoid_: "vitality score" (use Vitality Centrality or Recovery Value depending on context — Vitality is a structural metric from analysis; Recovery Value is the intervention prioritisation metric)

**Shapley Value**:
A model-based Analysis Metric derived from cooperative game theory: the marginal contribution of each Element averaged over all possible orderings of Element removal. Requires many engine calls (exact: 2^N; Monte Carlo approximation: `permutations × N` calls, configurable). Answers "which Elements contribute most to the total Operativity Score of the network." Only meaningful for networks up to ~30 Elements without approximation; the UI warns and degrades to Monte Carlo above that threshold.
_Avoid_: "Shapley centrality" (say Shapley Value)

**Coupling Strength**:
A Network-of-Networks structural metric: the ratio of inter-canvas edges to total edges for a given Canvas pair. High coupling strength means the two Canvases are tightly interdependent and a failure in one is very likely to cascade into the other.
_Avoid_: "interdependency ratio" (that term is reserved for per-Canvas node-level measurement)

**Interdependency Ratio**:
A Network-of-Networks structural metric per Canvas: the fraction of that Canvas's nodes that carry at least one inter-canvas dependency (i.e. have at least one inter-canvas incoming or outgoing edge). A Canvas with an Interdependency Ratio near 1.0 is almost entirely reliant on other systems.
_Avoid_: "coupling ratio"

**Inter-Canvas Edge Creation**:
Inter-canvas edges are created via a dedicated dialog (not drag-and-drop). The user selects a source Canvas and source node, then a target Canvas and target node. The resulting edge is stored in the global Project registry as a uniform Edge with no special type or fields. The dialog is the only supported creation path — there is no cross-canvas drag-and-drop mode.

**Analysis Log**:
An append-only, operator-only record of Propagation runs — one row per engine call — storing only input-shape and run metadata (node/edge/canvas counts, category names, functionality-scale N, event-definition and rule counts, graph_type, scope, engine version, compute time) plus the caller's user ID (which clusters all runs by the same user) and role. It never stores the network itself, any Element/Entity name or location, the GeoAnchor, or run outcomes. Governed by the persistence boundary in ADR-0007.
_Avoid_: "audit log" (that is the who-did-what accountability trail, a distinct concern); "usage log", "telemetry"

**Entitlement**:
The bundle of quotas a Role grants, scaling up with trust: `max_nodes` (largest network the user may propagate or run model-based analysis on) and an engine-evaluation budget per minute. Defaults: `viewer` = 45 nodes / ~10,000 evals-min; `analyst` = 300 nodes / ~100,000 evals-min. Enforced server-side before the engine runs. Distinct from a Role's boolean **permissions** (`can_propagate`, `can_sync`, …) — permissions say *whether*, the Entitlement says *how much*. Governed by ADR-0008.
_Avoid_: "plan", "tier", "quota" (use Entitlement; "quota" for an individual knob is fine)

**Engine Evaluation**:
The unit of engine work and the unit the Entitlement meters. A single Propagation costs 1 Engine Evaluation; a model-based analysis costs `permutations × N`. The token-bucket budget is spent in these units, not in API requests — so a model-based run cannot bypass the limit by being "one call." See ADR-0008.
_Avoid_: "engine run", "propagation call" (ambiguous between one API request and one evaluation)

**Persistence Boundary**:
The rule separating what the server may store from what it may not: **config-level vocabulary may be persisted; anything naming or locating a real-world Element or Entity may not.** The network transits the engine in memory but is never written to disk unless the user opts into Sync. See ADR-0007.
_Avoid_: "privacy policy" (that is a legal document; this is the engineering rule)

## Flagged ambiguities

- "Canvas" and "Graph" were used interchangeably — resolved: same concept, different register. **Graph** in domain/technical conversation; **Canvas** in UI/data-model context.
- "Network of Networks" was used for the full multi-canvas scope — retired. Use **multi-canvas** (scoped) or **full multi-canvas** (all Canvases included).
- "Simulation" was used to mean both a single engine run and a temporal sequence — resolved: use **Propagation** for a single run, **Temporal Propagation Sequence** for the time-stepped series.
- "ProjectConfig" / "ModelConfig" — retired. The type is `ModelConfiguration`, never abbreviated.
- "auto-merge" — retired. There is no merge operation. Global display mode renders all Canvases in one view; because IDs are unique, each node appears exactly once without deduplication logic.
- Node `position` vs `geo` — two independent fields. `position` drives React Flow layout (non-geo mode); `geo` drives MapLibre placement (geo mode). Both are preserved regardless of the Canvas's current mode.
- Convergence not reached — partial `PropagationResult` is merged into the registry as normal; a persistent warning is shown. Nothing is blocked or rolled back.
- Edge `functionality` worst-of rule — `edge.functionality` is the intrinsic level set by the user. The engine applies `worst_of(edge.functionality, source_node.functionality)` and writes the result back via `ElementUpdate`. The frontend never recomputes worst-of client-side (ADR-0004).
- Edge `capacity` interpretation — one edge carries one category-flow (determined by the source node's supply category). `edge.capacity` caps that single flow; no per-category qualifier needed. Multi-category capacity limits on the same connection require separate edges.
- "Affected set" on Event — retired. There is no `affected: list<id>` on the Event definition. The affected set is implicit: any Element carrying `vulnerability_levels[event.id]` is affected when the Event is applied. The Event definition carries only `direct_damage_effects`, `attribute_mutations`, and metadata.
- "Entity" was initially used for nodes/edges — resolved: **Entity** is a modelled real-world network (maps to a Graph/Canvas); **Element** is a node or edge within it.
- "hazard_applied" / "hazard_cleared" — retired. Events cover both Hazards and Disservices; use `event_applied` / `event_cleared`.
- "simulation_history" / "events_and_propagation_history" — retired. The history field is `update_history`; its entries are `AnyUpdateEntry`.
- "Graph Update" — retired. Use **Model Graph Update** (structural changes) and **Any Graph Update** (the full superset including Functionality changes).
- "Any Update" — retired. Use **Any Graph Update**.
- Specific rules improving Functionality — retired. In v1 a specific rule could *raise* a node's Functionality; in v2 Propagation is strictly monotone, so the final `worst_of(current, P)` commit clamps every mechanism (rules included) to worsening-only. A rule that would improve a node is a no-op; improvement is recovery/repair, handled by the timeline, not by propagation.
- Four-state status domain (`operational` / `operational_warning` / `time_warning` / `critical`) — retired inside the engine. The engine operates purely on integer Functionality `1..N` (1 = worst, N = best) with `functionality_time` as an orthogonal field. The old `time_warning` *status* is gone: a node may be at any Functionality level while `functionality_time > 0`. The label names survive only as display strings in `ModelConfiguration.functionality_scale`. `worst_of = min`, `best_of = max` on the integer scale.
