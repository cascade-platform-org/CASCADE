# CASCADE — Product Requirements

> **Status:** Living document. Voice session 2026-05-11 takes precedence over legacy README where they conflict. Features from the existing tool not explicitly mentioned here remain in scope unless contradicted.
>
> **Phase 1 — Types & Schemas: complete (2026-05-11)**
> Zod schemas: `CASCADE-app/lib/schemas/` (network, config, api, primitives, audit).
> Pydantic schemas: `CASCADE-backend/schemas/` (network, config, results, engine, auth).

---

## 1. Guiding Principles

- **Local-first by default.** All project data (graphs, rules, configuration, canvas state) lives as JSON on the user's machine. Editing, visualization, CRUD operations, hazard application, and topological analysis happen entirely in the browser with zero server round-trips.
- **Optional server-side sync.** Users can opt in to storing and syncing project data on the server. When disabled, behaviour is identical to local-only mode.
- **Server-hosted engine.** The propagation algorithm runs on a dedicated server; the client sends a payload and receives results. No project **network** is ever persisted server-side unless sync is explicitly enabled — only aggregate run metadata (ADR-0007). Licensing posture: ADR-0009.
- **100 % open-source stack.** Every dependency — frontend, backend framework, GIS renderer, auth provider — must be free and open-source.

---

## 2. System Architecture

```
CLIENT (Browser)                           SERVER (Private)
─────────────────────────────────          ──────────────────────────────
  Next.js app shell                          FastAPI
  Zustand stores (local working copy)        Auth / RBAC (OAuth2/OIDC)
  MapLibre GL JS (geo rendering)             PostgreSQL (users, roles, opt. project data)
  File I/O + versioned auto-save             Propagation engine (Python, server-hosted)
  All CRUD, hazards, local analysis          Returns PropagationResult JSON
```

### 2.1 Data Storage Modes

| Mode | Project data location |
|---|---|
| **Local-only** (default) | Browser / user's file system (upload/download JSON) |
| **Server sync** (opt-in) | PostgreSQL per-user + local cache |

The propagation engine operates identically in both modes.

---

## 3. Multi-Canvas Model

### 3.1 Canvases (Layers)

- Users can add, rename, and remove canvases; each canvas is an independent graph layer.
- Inter-canvas **edges** connect nodes across layers (cross-layer dependencies).
- Each canvas is independently toggled between **georeferenced** (MapLibre GL JS with lat/lon) and **non-georeferenced** (abstract layout) mode.
- Each canvas carries a **`graph_type`** — a name referencing a `ModelConfiguration.graph_types` entry. The Model Configuration is the single source of truth for what a graph type is (its name and heuristic pipeline); the Canvas holds only the name assignment. Assignments can be made from two places: the Inspector's Canvas Meta panel (per-canvas, inline) and the Graph Types tab of the Config modal (all canvases at once).
- The **Global view** (all Canvases together) also has an explicit `graph_type` stored as `Project.global_graph_type`, settable from the Graph Types tab of the Config modal.

### 3.2 Propagation Scope

When running Propagation the user selects:

| Scope | Client payload | Behaviour |
|---|---|---|
| **Local** | Active Canvas nodes + intra-canvas edges only. Inter-canvas edges physically absent. | Engine sees one isolated subgraph. |
| **Global** | Full Project — all nodes, all edges, all Canvases. | Engine sees the complete multi-canvas network. |

In both scopes the payload excludes engine-irrelevant bookkeeping: `update_history` (each entry carries two full GraphSnapshots), `scorecard` (entries embed base64 PNGs), and `source_inp_content` on non-EPANET canvases — without this trimming a modest project exceeds the edge's 10MB request-body cap (Caddy 413). See `lib/propagation-payload.ts`.

Event application (client-side) is always applied to the full registry regardless of scope; scope only governs what is sent to the engine.

### 3.3 Global Display Mode *(implemented)*

`components/canvas/global-view-canvas.tsx` renders all Canvases together in a single React Flow instance, each Canvas laid out as its own group region with nodes at their stored positions. Because element IDs are globally unique (ADR-0001) and each element lives once in the registry, a node that appears in multiple Canvases is shown exactly once — no deduplication step needed. Inter-canvas edges render as dashed connectors. The view is **read-only** (no editing, no tool interactions); it is also what the Scorecard captures as its snapshot PNGs (§12.4). Pure render-time operation, no data model change.

---

## 4. Configuration File

A user-editable JSON/YAML config is the single source of truth for system-wide parameters.

### 4.1 Functionality Scale

- Ordered list of N levels, each with a label and a hex colour.
- Levels are numbered 1 (worst) to N (best).
- **Default (N = 3):** level 1 = `critical` (red), level 2 = `operational_warning` (orange), level 3 = `operational` (green).
- Applies uniformly to both nodes and edges.
- **Functionality Time** (`functionality_time > 0`) is an orthogonal timed-degradation state (see §9); it does not occupy a slot in the 1..N scale.

### 4.2 Category Definitions

Each category entry carries:

| Field | Description |
|---|---|
| `name` | Label (e.g. `electricity`, `water`, `ICT`) |
| `category_type` | `SourceToDemands` \| `Requisite` \| … (extensible) |
| `color` | Default display colour |

`category_type` is a **config-level** property. Nodes reference a category by name; the engine looks up its type from the config.

### 4.3 Other Parameters

- Default attribute templates per node type.
- Scorecard metric weights.
- Time unit: **hours** (applies to all duration attributes throughout the system).

---

## 5. Node and Edge Model

### 5.1 Node Types

| Type | Description |
|---|---|
| **Source** | Supplies one or more category resources |
| **Infrastructure** | Transports or transforms flows |
| **Service** | Consumes resources; end-point of dependency chains |
| **Personnel** | Organisational / human actors — future agentic behaviour (§12) |

A single node may participate in multiple categories simultaneously (e.g. a pumping station is both an Infrastructure node for water and a Service node for electricity). If the functional degradation of the node should affect its different category roles **differently**, it must be modelled as separate nodes.

### 5.2 Core Attributes (nodes and edges share these)

| Attribute | Type | Notes |
|---|---|---|
| `functionality` | integer 1–N | Current functional status (single value per node/edge) |
| `functionality_time` | integer (hours) | Remaining hours of Functionality Time. 0 = no pending timed degradation. |
| `direct_damage` | boolean | Set by a hazard; signals physical breakage |
| `expected_repair_time` | integer (hours) | Estimated repair time when `direct_damage = true` |

Additional **node-only** attributes:

| Attribute | Type | Notes |
|---|---|---|
| `node_type` | enum | One of the four types above |
| `node_categories` | list\<string\> | References to categories defined in config |
| `importance` | numeric | Weight for scorecard |
| `cost_of_disservice_per_day` | numeric | Economic impact metric |

### 5.3 Capacity Attributes

| Attribute | Applies to | Description |
|---|---|---|
| `supply_capacity` | Source nodes | `{ [category]: number }` — maximum resource supply per category the node provides. |
| `category_dependency_profiles[cat].capacity` | All nodes (per category) | Maximum throughput for that specific category dependency. Degrades proportionally with Functionality. |
| `capacity` | Edges | Single number — caps the flow of the one category carried by the edge. An edge carries exactly one category-flow, determined by its source node's supply category. To model different capacity limits for different categories on the same connection, use separate edges (one per category).|

### 5.4 Per-Category Dependency Block

Nodes only — edges carry no Category Dependency Profile. A profile entry is **guard customisation only** — its absence never prevents propagation. When the Universal Requisite pass (§7.2) discovers a source category `C` for which the target node has no profile entry, the guard defaults to `dependency_level = N` (full dependency). The frontend auto-adds a default entry (`dependency_level = N`, no backup, no demand) whenever an edge is created from a node whose declared categories are not yet covered in the target's profiles, so the entry is visible and editable in the Inspector without the modeller needing to remember this rule. On edge deletion the profile entry is retained and flagged as orphaned in the Inspector; the modeller decides whether to remove it.

For each category a node participates in (or receives via an incoming edge), it carries:

| Attribute | Type | Scope | Description |
|---|---|---|---|
| `dependency_level` | integer 1–N | All categories | How dependent this element is on the category. Governs how the delivered/demand ratio maps to functionality degradation (see formula below). |
| `backup` | boolean | All categories | Whether a backup mechanism exists for this dependency |
| `backup_duration` | integer (hours) | If `backup = true` | How long the backup sustains the element before expiry |
| `demand` | numeric | `SourceToDemands` only | Resource amount requested from this category |
| `priority` | integer 1–10 | `SourceToDemands` only | Flow allocation priority — higher means served first in case of scarcity |

#### Dependency level and the ratio-to-status formula

The delivered/demand ratio r ∈ [0, 1] is first divided into N equal segments, yielding a base functionality index b ∈ {1, …, N} (1 = worst, N = best):

```
b = ceil(r × N)   [clamped to 1..N]
```

The `dependency_level` d ∈ {1, …, N} then shifts the result:

```
proposed_level = b + (N − d)   [clamped to 1..N]
```

Effect:
- **d = N** (fully dependent, no tolerance): shift = 0; raw ratio result is used.
- **d = 1** (barely dependent, maximum tolerance): shift = N − 1; result pushed toward best level.

The proposed level is applied only if it **worsens** the current `functionality` (propagation is monotone downward).

### 5.5 Vulnerability Levels (per hazard/disservice type)

Each node and edge carries a `vulnerability_level` ∈ {0, …, N−1} for each defined hazard or disservice ID. These are independent of category dependency levels. A missing entry is treated as 0 (immune).

When a hazard or disservice is applied, the imposed functionality level for each affected element is:

```
imposed_level = N − vulnerability_level   [clamped to 1..N]
```

| vulnerability_level | imposed_level | Effect |
|---|---|---|
| 0 (absent or explicit) | N | Immune — no degradation |
| 1 | N − 1 | Mild degradation |
| k | N − k | Moderate degradation |
| N − 1 | 1 | Maximum degradation (worst) |

As with categories, this is applied only if it worsens current `functionality`.

> An absent `vulnerability_levels[event.id]` entry is equivalent to `vulnerability_level = 0` (immune).

### 5.6 Edge Functionality

`edge.functionality` is the edge's **intrinsic** level — set by the user or by a previous Propagation result. During Propagation the engine applies `worst_of(edge.functionality, source_node.functionality)` and writes the result back via `ElementUpdate`. The frontend always displays `edge.functionality` as stored — it never recomputes worst-of client-side. The worst-of rule is exclusively the engine's responsibility. Edge capacity is scaled proportionally to the post-worst-of functionality.

### 5.7 Free-form Attributes

Additional key-value attributes may be attached to any node or edge. Hazards and disservices may modify these as part of their effect definition.

---

## 6. Hazards and Disservices

Applied via named UI buttons. Distinguished by whether they cause physical breakage.

### 6.1 Distinction

| Type | Direct damage | Recovery |
|---|---|---|
| **Hazard** | Yes — sets `direct_damage = true` on every Element whose `vulnerability_levels[event.id] > 0` | Tracked by the timeline module (§9) |
| **Disservice** | No | Resolves when upstream cause resolves |

### 6.2 Effect on Functionality

There is no explicit affected set on the event definition. Any Element carrying `vulnerability_levels[event.id]` is affected. For each such element, the imposed functionality level is computed per §5.5 and applied client-side before the Propagation engine runs.

### 6.3 Effect on Other Attributes

A hazard/disservice definition can specify mutations to **arbitrary other attributes** of affected nodes and edges beyond functionality.

### 6.4 Event Properties

| Property | Type | Description |
|---|---|---|
| `id` | string | Unique identifier |
| `label` | string | Human-readable name |
| `type` | enum | `hazard` \| `disservice` |
| `frequency_per_10y` | numeric ≥ 0 | Expected occurrences in a 10-year period |
| `direct_damage_effects` | map\<id, {expected_repair_time}\> | Per-element `expected_repair_time` overrides; hazards only. Does **not** control which elements a *hazard* flags as `direct_damage` — for a hazard that is determined by `vulnerability_levels[event.id] > 0`. (A specific rule may independently set `direct_damage` on any element — ADR-0015.) |
| `default_repair_time` | integer (hours)? | Fallback `expected_repair_time` for affected Elements with no `direct_damage_effects` entry; hazards only. |
| `expected_recovery_time` | integer (hours) | Hours until the disservice self-resolves; disservices only. |
| `attribute_mutations` | map\<string, unknown\> | Optional field overwrites applied to Elements on trigger. Keys are `"<elementId>.<fieldName>"`. |

There is no explicit `affected` set on the event definition. The affected set is **implicit**: any Element with `vulnerability_levels[event.id] > 0` is affected. The imposed Functionality level is `N − vulnerability_level` (clamped to 1), applied only if it worsens the current level.

For **hazards**, every affected Element also receives `direct_damage = true`. The `expected_repair_time` is taken from `direct_damage_effects[element.id].expected_repair_time` if present, otherwise from `default_repair_time` if set on the event, otherwise left unchanged. A missing or zero vulnerability entry means the Element is unaffected and does not receive `direct_damage`.

Multiple **scenario variants** of the same event type can be defined with different parameters (e.g. earthquakes at different epicentres or magnitudes).

> Georeferenced hazard footprints are a future enhancement.

---

## 7. Propagation Engine

Runs server-side (licensing posture: ADR-0009).

### 7.1 Client Payload

- Category list with types (from config)
- All logical rules (specific, intracategorical, intercategorical)
- Per-node/edge: `supply_capacity`, `capacity`, `demand`, `dependency_level`, `backup`, `backup_duration`, `priority`
- Current `functionality` states after hazard/disservice pre-application

No display or layout data is sent.

### 7.2 Category Algorithms

The proposal phase runs two sub-steps in sequence for each node each round. Their candidates are merged via `worst_of` before the guard phase (see ADR-0005).

#### Universal Requisite pass (every node, every round)

Every node receives a Requisite logical aggregation proposal over **all** its incoming edges, regardless of the source node's category type:

1. For each incoming edge `(u → v)`, compute the deliverable `L(u→v) = worst_of(u.functionality, edge.functionality)`.
2. Group deliverables by source category (all categories declared on `u`).
3. Within each group apply `best_of` (redundancy — one healthy supplier suffices).
4. Across groups apply `worst_of` (conjunctive — all required categories must hold).
5. The resulting candidate `P_req` is merged into the running proposal `P` via `worst_of`.

When the target node has no `category_dependency_profiles` entry for a source category, the guard uses `dependency_level = N` (full dependency — the drop passes unattenuated). Profiles are guard customisation only; their absence never prevents propagation.

#### `SourceToDemands` — additive flow pass

For nodes with `demand > 0` in at least one `SourceToDemands`-typed category, the flow heuristic also runs:

- Capacitated flow allocation guided by node `priority` (1–10). How **scarce**
  supply is shared is a per-graph-type strategy (ADR-0014, implemented):
  `tiered_fair_share` (default — higher tiers served first, equals share the
  shortage max-min-fairly) or `priority_greedy` (single min-cost max-flow,
  strict triage, winner-take-all among equals). Selected via the
  `source-to-demands-flow` heuristic's `allocation` param on the graph type.
- Sources combined jointly; `capacity` on infrastructure and edges constrains throughput.
- Service node functionality set from delivered/demand ratio via a configurable threshold table (`dependency_level` guard applies afterwards).
- The flow candidate `P_flow` is merged into `P` via `worst_of` alongside the Requisite candidate.

Nodes without demand are unaffected by this pass.

#### Guard applies once

After both sub-steps, the guard phase runs once on the merged `P`: `dependency_level` attenuation → `backup` deferral → specific-rule override (see ADR-0003 §Guard mechanics).

#### Extensibility

Future category types (multicommodity flow, transport, etc.) add as further additive passes alongside `SourceToDemands`. The Universal Requisite pass and the guard phase are unchanged.

### 7.3 Rule System (carried over from v1)

- **Specific rules** — explicit conditions targeting a specific element: `if <cond> then <target>[.<attr>] is <value>`. A `functionality` consequent (or the bare `then <target> is <level>`) overrides the target's proposal, clamped to worsening. **Any other attribute** — first-class `direct_damage` / `expected_repair_time`, or a custom `properties` key — is a generic **attribute-set** consequent (ADR-0015): the value is written onto the target and emitted, without changing `functionality`. Attribute-sets apply as a set-once latch (first firing per element+attribute wins) so the fixed point stays terminating.
- **Intracategorical rules** — conditions within one category.
- **Intercategorical rules** — conditions across categories.
- Authored with human-readable labels; internally mapped to node IDs. Labels may not contain `.` (the rule grammar's attribute-access operator); the label input strips it.

### 7.4 Iterative Convergence

Alternates capacity step and rule step until no node's `functionality` worsens further. The engine may time out before full convergence and return a `PropagationResult` with `warnings` containing `"convergence not reached"`. In that case:

- The frontend merges the partial `ElementUpdate` list into the registry exactly as a normal result.
- A persistent warning is shown (toast or status bar badge): "Propagation may be incomplete — convergence not reached."
- The user can inspect, undo, and save the result to Scorecard. Nothing is blocked.

### 7.5 Causality Tracking

The engine records for each degraded Element which upstream Elements or Events are directly responsible, and in what proportion. This is returned as `responsibility_share: { [ElementId | EventId]: float }` on each `ElementUpdate` — values in (0, 1] summing to 1; zero shares are never emitted (a blameless Element is simply absent from the dictionary). Populated only from the heuristic or Rule that produced the final (worst) Functionality for the Element. Attribution per mechanism (see ADR-0003): the **logical** heuristic splits evenly across failed upstreams; the **flow** heuristic uses a provisional v1 uniform-blame rule over degraded same-category elements in the transitive incoming closure (empty if none degraded); Events key the single EventId; Specific Rules split evenly across referenced Elements. This powers:

- UI visualisation of causal chains (colour edges/nodes by responsibility share).
- Distinction between directly damaged (`direct_damage = true`) and indirectly affected Elements.
- Input to intervention prioritisation (§10).

---

## 8. CRUD and Canvas Editing

### 8.1 Graph Operations

- Add / edit / remove nodes (with all attributes, per-category blocks, vulnerability levels).
- Add / edit / remove edges (direction, capacity, vulnerability levels).
- Undo/redo stack.

### 8.2 Selection

| Method | Description |
|---|---|
| **Point selection** | Click a single node or edge |
| **Rectangle selection** | Drag bounding box; all enclosed elements selected |
| **Multi-select** | Shift-click or equivalent |

Works in both georeferenced and non-georeferenced modes.

### 8.3 Georeferenced Mode *(implemented)*

- A georeferenced Canvas renders a **MapLibre GL JS** base map (open-source OpenFreeMap tiles: liberty / bright / positron) as a **non-interactive background behind React Flow**. Nodes remain React Flow nodes drawn on top; the map tracks the viewport.
- The user enters *setup* mode (interactive map) to navigate to the area and set a **GeoAnchor** — one flow↔geo correspondence point. From the anchor, the **GeoAnchor projection** (exact Web Mercator, `lib/geo-utils.ts`) converts any node `position` to/from `geo` (lng/lat). Each node stores both `position` and `geo`; see CONTEXT.md → *Node Position vs Geo Coordinates* and *GeoAnchor*.
- Dragging a node in a georeferenced Canvas writes its `geo` via the projection. The map background stays locked to the graph through `useMapViewportSync`.
- **Deviation from the original spec:** edges are *not* rendered as separate geographic paths, and QGIS/GeoJSON export tooling is not part of this implementation — edges render as normal React Flow edges between the on-map nodes. GeoJSON export of nodes remains a future enhancement (see `local-first-guide.md`).

### 8.4 In-app documentation *(implemented)*

Two right-edge slide-over drawers, both pure-JSX presentational components (no
markdown dependency) that are the canonical user-facing text for their topic:

| Drawer | Opened from | Covers |
|---|---|---|
| **User Manual** (`components/help/`) | Topbar **Help** (`HelpCircle`) | Setting up elements and what each attribute does, rules, running a scenario, testing an intervention, what needs the server |
| **Rules Manual** (`components/rules/rules-manual.tsx`) | Active Rules panel **Manual** (`BookOpen`), and the User Manual §2 | The rule DSL grammar and how the engine interprets it |

They share the same right-edge slot, so `ui-store` opens either one by closing
the other (`toggleUserManualPanel` / `toggleRulesManualPanel` / `openRulesManualPanel`).

`docs/project/user-manual.md` mirrors the User Manual for readers outside the
app; the Rules Manual has no `.md` twin. Change a component and its mirror
together. The rule grammar additionally tracks `CASCADE-backend/core/rule_parser.py`.

### 8.5 Guided tour *(implemented)*

A skippable eleven-step walkthrough of the core loop — read the network, inspect
an element's attributes, Reset, apply an Event, Propagate, read the cascade,
advance time — pointing at the real editor UI.

- **Action-gated.** A step that asks the user to do something advances by itself
  the moment they do it. A gate is armed *when its step appears*, so a step can
  never be satisfied by something that already happened. `Next` is never removed,
  so a step nobody can satisfy (a guest without `can_propagate`) stays skippable.
- **Nothing is dimmed and nothing is blocked.** The user must be able to read the
  network while a step talks about it, and to click real controls outside whatever
  the step highlights. The tour draws a ring and a card, and nothing else.
- **It runs on `samples/public/IJDRR_example.json`** — the paper's worked example.
  Starting the tour loads that bundle, replacing what is open, so every entry
  point says so first. The bundle ships in its post-Earthquake, post-Propagation
  state, so the tour has the user Reset and then cause the cascade themselves.
- **Entry points:** the New Project Wizard's first step, a one-time prompt over
  the canvas (both suppressed once offered), and "Take the guided tour" in the
  User Manual drawer, available forever after.
- Propagation still needs the server and `can_propagate`. The tour does not work
  around that — the step explains the button, and a guest skips past it.

Implementation — the step/target data model, why no tour library is used, and the
constraints that shape the ring — is documented in
[architecture.md → Guided tour](architecture.md).

---

## 9. Temporal Jump

The history model is uniform: **Event → Propagation → Event → Propagation → …**  
A **Temporal Jump** is the Event kind that advances simulated time.

### 9.1 Functionality Time

An attribute on an Element (integer, hours). Value > 0 means the Element will degrade when the clock reaches zero. Value 0 means no pending timed degradation.

- `functionality_time` holds remaining hours.
- `backup` and `backup_duration` (per-category block) extend the effective time before the Element's Functionality Time expires.
- On expiry (`functionality_time` drops to ≤ 0): `functionality_time` is clamped to 0 and `functionality` is set to 1 (critical).

### 9.2 Temporal Jump Event

A Temporal Jump is an Event with `type = "temporal_jump"`. It is always system-generated (not user-authored). It carries a single parameter:

| Field | Type | Description |
|---|---|---|
| `duration_hours` | integer ≥ 1 | How many hours to advance the clock |

**Application (client-side, same as any Event):**

For each Element with `functionality_time > 0`:
1. `functionality_time -= duration_hours`
2. If `functionality_time ≤ 0`: set `functionality_time = 0` and `functionality = 1`

A Propagation immediately follows to cascade the effects of any expired Elements.

**Stored in history** as an `event_applied` entry (`event_id` = the Temporal Jump's synthetic id, `type = "temporal_jump"`). Undoable with CTRL+Z. Clearable with CTRL+R (uses `mutation_reversal` like any Event).

### 9.2a Reverting a run of jumps

The first jump of a run saves a pre-jump `GraphSnapshot`; the **−Xh** button (in the action bar and the Temporal Jump panel) restores it, undoing every jump of that run at once.

The revert is stored as a **`temporal_jump_revert`** entry carrying `reverts_to_entry_id` — the newest history entry at the moment that snapshot was taken. That id is what makes the revert legible to everything derived from history: `deriveSituation()` (§12.3a) and the unsaved-run scan (§12.8) both skip from the revert straight back to it. Without it, the canvas would show the pre-jump state while the Situation window still reported the jumps and the Propagation that ran during them, and Save-to-Scorecard would offer a run the project had been rewound out of. If that entry has aged out of the capped history, the pre-jump Situation cannot be reconstructed and none is reported — reporting the reverted one would be worse.

### 9.3 Auto-Advance Mode

A UI mode that fires Temporal Jumps automatically:

1. Find `min_ft` = minimum `functionality_time` across all Elements with Functionality Time > 0.
2. Fire a Temporal Jump of `min_ft` hours.
3. Run a Propagation.
4. Repeat from step 1 until no Elements with Functionality Time > 0 remain.

Both **step-by-step** (one jump at a time) and **play** (run to completion) modes are available.

### 9.4 Manual Jump

The user may also trigger a Temporal Jump with a custom duration — useful for skipping to a specific time horizon without waiting for natural expiry points. If the custom duration causes some Elements to overshoot (their `functionality_time` was shorter), those Elements expire as normal.

### 9.5 `expected_repair_time` and Recovery

When a Hazard sets `direct_damage = true`, `expected_repair_time` records estimated repair duration. Detailed recovery mechanics are deferred; the data model reserves these fields.

---

## 10. Intervention Prioritisation

Given a post-Propagation Scenario (Elements carrying `responsibility_share`), compute a **ranked repair list** client-side (open logic — `CASCADE-app/lib/intervention-prioritisation.ts`, not proprietary).

**Candidates.** The ranked list contains exactly the Elements (nodes *and* edges) with `direct_damage = true` — the targets a physical repair crew can act on. Degraded Elements without physical damage are reported in a separate informational bucket: they recover via Event expiry or upstream repair, not by direct intervention.

**Recovery Value.** Each degraded Element `D` carries a loss
`L(D) = W(D) × (N − functionality_D) / (N − 1)`
where the weight `W` uses precedence `cost_of_disservice_per_day ?? importance ?? 1`. Edges carry intrinsic loss 0 (a broken pipe costs nothing by itself; the hospital it starves carries the cost) but participate fully as blame intermediaries and as repair targets.
Losses are distributed backwards along **transitive blame chains**: the fraction of `D`'s `responsibility_share` keyed to upstream ElementIds forwards `D`'s loss upstream multiplicatively; the fraction keyed to EventIds — or an absent share map — terminates at `D` itself. An Element's **Recovery Value** is the total loss that terminates on it: everything its repair would unblock, including its own weighted degradation.

*Design notes:* precedence (not multiplication) avoids double-counting when both weights are set; degradation depth matters (`(N − functionality)/(N − 1)`); losses distribute along *transitive* responsibility chains so causes outrank symptoms.

**Effort.** `expected_repair_time` is the repair effort. Two ranking modes: by Recovery Value, and by **value per repair hour** (`recovery_value / expected_repair_time`). Elements with no repair estimate sort last in the per-hour mode and are flagged.

**At-risk list.** Elements with `functionality_time > 0` (holding on backup) are listed with remaining hours as time-critical context. Attributing a deferred drop to its upstream root is not derivable client-side — the engine does not emit blame for deferred proposals (see §16).

**Auditability.** Blame cycles are cut by a depth cap; mass that cannot reach a terminal Element is reported as `unattributed`, so `Σ recovery values + Σ non-repairable losses + unattributed = Σ losses` holds exactly when every `responsibility_share` map sums to 1.0, and is approximate otherwise (floating-point rounding in the engine can shift the total by a small epsilon).

---

## 11. Analysis Module (implemented)

Two families of Analysis Metrics (see CONTEXT.md → *Analysis Metric*):

- **Topological** (client-side, graphology): degree/in/out/k-core, betweenness, closeness, eigenvector, reachability, community detection, articulation points, percolation.
- **Model-based** (engine-side): Vitality Centrality (Operativity drop from removing one Element and re-propagating) and Shapley Values (exact 2^N or approximate).

Scores render as an **Analysis Heatmap** overlay on the canvas (colours mean scores, not Functionality; cleared by Reset). Each metric shows a recommended graph-type badge on the Analysis page.

---

## 12. Scorecard

An atlas of named Scenario snapshots. **Explicitly saved by the user** — nothing is auto-generated. The user clicks "Save to Scorecard" at any point, gives the entry a label, and it is persisted in `Project.scorecard`.

### 12.1 Entry Structure

Each Scorecard entry stores up to three snapshots, all optional except `before_propagation`:

| Field | Type | Description |
|---|---|---|
| `event_ids` | string[] | EventDefinition.id for every Event applied since the last Propagation, newest-applied first. Empty for a Manual What-If entry. A user may stack several Events before running one Propagation (§12.3a) — all of them are recorded here, not just the latest. |
| `before_propagation` | GraphSnapshot | State just before the most recent Propagation (post-Event(s), pre-engine). Pulled automatically from `update_history` — the `before` of the most recent `propagation` entry. If no Propagation has been run, this is the current state (Manual What-If). |
| `after_propagation` | GraphSnapshot? | State after the Propagation. Absent if no Propagation has been run in the current session. |
| `after_temporal_jump` | GraphSnapshot? | State after one or more Temporal Jumps + Propagations. Populated in two ways: (a) **already computed** — the Save dialog detects a `temporal_jump` entry in history that follows the most recent `propagation` entry and loads it automatically; (b) **computed at save time** — the user enters a duration in the Save dialog and the system fires a Temporal Jump internally, runs Propagation, captures the result, then discards the side-effects (the graph state is not permanently changed). |
| `temporal_jump_hours` | integer? | The total hours elapsed across all Temporal Jumps that produced `after_temporal_jump`. |
| `propagation_result` | PropagationResult? | The raw engine delta from the Propagation that produced `after_propagation`. Used for `responsibility_share` and causal analysis. |

### 12.2 Entry Label

Auto-populated from context, editable before saving:

| Context | Default label |
|---|---|
| One Event applied since the last Propagation | Event label (e.g. "Earthquake M6.5") |
| Several Events stacked since the last Propagation | Their labels joined with " + ", oldest-applied first (e.g. "Earthquake M6.5 + Blackout") |
| Most recent Event is a Temporal Jump | "Temporal Jump — Nh" |
| No Event in history (manual edits only) | "Manual What-If Scenario" |

### 12.3 Deduplication

A Scorecard entry is a **duplicate** if its `before_propagation` snapshot is identical to an existing entry's `before_propagation`. Comparison is done by content hash (stable JSON serialisation → SHA-256). If a duplicate is detected at save time, the save is blocked and the user sees a toast: *"This scenario is already in the Scorecard."* No entry is overwritten.

### 12.3a Situation Window

After an Event is applied, a small floating **Situation window** appears over the top-right of the canvas. It is a live read-out of the current Situation, derived entirely from `update_history` via `deriveSituation()` (`CASCADE-app/lib/situation.ts`): **every** `event_applied` entry applied since the last Propagation (a user may apply several Events in a row before running one Propagation — nothing in the UI forces a Propagation between them), plus the `propagation` entry that ran *after* all of them (a Propagation older than the newest Event is ignored as stale). It shows the newest Event's icon, a combined label when more than one Event is stacked (§12.2), a "Propagation run / not run yet" status, and a **Save to Scorecard** button that opens the Save Dialog. The window can be **minimised** to an icon pill or **dismissed** (it reappears when a newer Event is applied). It is purely informational — dismissing it changes no graph state.

Because the Save Dialog resolves its snapshots from the same Situation (§12.4), the entry saved from the Situation window captures the real before→after of the current scenario (post-Event(s) `before_propagation`, propagated `after_propagation`) rather than storing the live canvas as an un-propagated "initial" state. `event_ids` on the saved entry lists every stacked Event, so Type 3 gap detection (§12.8) treats each of them as covered.

### 12.4 Save Dialog

When the user clicks "Save to Scorecard" the dialog opens and shows:

1. **Label** — editable text, pre-filled per §12.2.
2. **Snapshot previews** — one card per snapshot already available in history:
   - `before_propagation` — always shown. Resolved from the current Situation (§12.3a): the `before` of the Propagation that ran for the current session's Event(s) when one exists, otherwise the post-Event state (the newest `event_applied` entry's `after`, which already includes every earlier stacked Event). Falls back to the live canvas only when no Event is in history (a pure Manual What-If).
   - `after_propagation` — shown if a Propagation has been run; absent card otherwise.
   - `after_temporal_jump` — shown if a Temporal Jump event followed the most recent Propagation in history; absent card otherwise.
3. **Temporal Jump option** — shown only when `after_propagation` is present but `after_temporal_jump` is absent. Contains:
   - Hours input (default: `duration_hours` from the triggering Event if available, otherwise 48 h).
   - **"Compute"** button — fires an ephemeral Temporal Jump + Propagation: applies the jump client-side on a copy of `after_propagation`, calls `POST /api/propagate`, and displays the result as the third card. **The main graph state is not modified.** If the server is unreachable, the card shows an error and saving proceeds without `after_temporal_jump`.
4. **Save** button — captures the GlobalViewCanvas as a base64 PNG for each available snapshot (temporarily restores each snapshot to the store, renders, captures, then restores the original state), then commits all snapshots + images to `Project.scorecard`. Dialog closes.

### 12.5 Derived Metrics

Computed client-side from the stored snapshots, never persisted:

| Metric | Computed from |
|---|---|
| Operativity Score | Weighted average `functionality` across nodes — see §12.6 |
| Cost of disservice | Sum of `cost_of_disservice_per_day` for nodes below `functionality = N` |
| Status breakdown | Count per functionality level |
| Most impacted Elements | Ranked by `importance × (N − functionality)` |
| Causal summary | `responsibility_share` from `propagation_result` |

The Scorecard UI shows all three snapshots side by side, with derived metrics for each.

### 12.6 Operativity Score Formula

```
O = Σ(importance_i × functionality_i) / (Σ(importance_i) × N) × 100   [%]
```

Falls back to unweighted mean `Σ(functionality_i) / (nodeCount × N) × 100` when all `importance` values are 0.

**Level thresholds** — the N equal intervals that divide 0–100%:

```
Level k threshold (upper bound) = k / N × 100 %
```

For N = 3: level 1 = 0–33 %, level 2 = 33–66 %, level 3 = 66–100 %.  
The threshold boundaries and their associated label/colour come from `FunctionalityScaleLevel` in the Model Configuration.  
A given percentage P maps to level `k = ceil(P × N / 100)`, clamped to [1, N].

---

### 12.7 Export

The Scorecard is downloadable as a **zip archive** containing:

```
scorecard-<project-name>-<date>/
  scorecard.md               ← Markdown report
  images/
    <entry-id>-before.png
    <entry-id>-after.png
    <entry-id>-temporal.png  ← present only when after_temporal_jump exists
```

The Markdown file uses standard `![label](images/<file>.png)` image references. It renders correctly in VS Code, Obsidian, GitHub, and any Markdown viewer. One section per Scorecard entry, ordered by `created_at`.

### 12.8 Missing Computation Detection

The Scorecard panel surfaces three categories of gaps:

| Type | Description | Detection |
|---|---|---|
| **Type 1 — Unsaved runs** | An `event_applied` (one or more, stacked) + `propagation` session exists in `update_history` but has not been saved to the Scorecard. | Cross-reference `update_history` sessions against `scorecard[].event_ids`. |
| **Type 2 — Incomplete entries** | A saved entry is missing `after_propagation` or `after_temporal_jump`. | Check optional fields on each `ScorecardEntry`. |
| **Type 3 — Uncovered events** | An `EventDefinition` in the Model Configuration (`type ≠ temporal_jump`) has no Scorecard entry with a matching id in `event_ids`. | Cross-reference `config.events` against the flattened `scorecard[].event_ids`. |

**UI treatment:**
- Type 1: "Unrecorded runs" section at the top of the Scorecard panel — each unsaved pair shown with a "Save" button.
- Type 2: each incomplete saved entry shows a badge per missing snapshot with an inline "Compute" button (ephemeral engine call, stores result into the entry).
- Type 3: "Never covered" section listing config events with no Scorecard entry — each shown with a "Run" button (see §12.9).

### 12.9 "Run" Button for Uncovered Events (Type 3)

When the user clicks "Run" on an uncovered event, the system applies the event **ephemerally** to the **current graph state** (as a working copy, main graph unchanged), calls `POST /api/propagate`, then opens the Save dialog pre-filled with the result. The user can add a Temporal Jump in the dialog and confirm the save. If the server is unreachable, the button is disabled with a tooltip.

---

## 13. Persistence, File I/O, and Version History

### 13.1 Explicit Save

- Serialises all Zustand stores to a single `.json` file (browser download or server sync upload).
- Each explicit save creates a named version entry.
- Up to **10 previous explicit saves** are retained; older ones are discarded.

### 13.2 Auto-save

- Runs continuously in the background.
- Auto-saves are discarded when an explicit save is made (they are safety nets, not history).
- Stored in `localStorage` (or IndexedDB for larger graphs).

### 13.3 Load

- Upload a `.json` file; validate schema; hydrate stores.
- Multi-canvas projects serialised under a `canvases` array.

### 13.4 Server Sync (opt-in) — implemented

`can_sync`-permitted users (analyst and above) can push explicit saves to PostgreSQL via `POST/GET/DELETE /api/projects` and `GET /api/projects/{id}`. Each save is a **new version**, never an overwrite — the version list is accessible across devices. Up to 10 versions are kept per project name; older ones are pruned automatically on the next save (mirrors the existing local save-history cap, `lib/file-io.ts`'s `MAX_HISTORY`). Strictly owner-scoped: no cross-user access, including admins. Conflict resolution (§16) remains out of scope because there is no merge — versions are independent, additive rows; the user picks which to load.

**Null-free bundle contract (Load):** the Load response must serialise the bundle **without `null` keys**, so it is byte-shape-identical to a local file save. See [api-reference.md → Server Sync](api-reference.md) for the mechanism and the failure it prevents.

### 13.5 Network importers — EPANET .inp (implemented)

`POST /api/import/inp` converts an EPANET water-network `.inp` file into a
CASCADE `ProjectBundle` (same envelope as local save / Server Sync — §13.4
null-free contract applies). Pure transformation: nothing persisted, engine
never invoked; any authenticated caller may import. UI entry point: "Import
EPANET .inp" in the File I/O panel.

Pipeline (`CASCADE-backend/core/importers/inp/`; every rule, threshold and
its validation lives in ADR-0012): **parse** (WNTR, SI) → **hydraulic
sweeps** (demand-multiplier Sweep + Contingency solves derive per-pipe
capacity `π/4·d²·v_peak × 2` and simulated flow direction; optional priority
derivation) → **skeletonize** (WNTR, binary-searched diameter threshold to
`target_nodes`, demand mass conserved) → **orient** (simulated sign;
bidirectional pipes become two full-duplex edges at full capacity each; BFS
only as no-signal fallback) → **map** (reservoirs/tanks/negative-demand
injection wells → Sources; demanding junctions → Service; pumps/valves →
inline Requisite nodes, pumps always imported operational; supply = sum of
incident pipe capacities) → **place** (pyproj → WGS84 + GeoAnchor, or
abstract layout).

Knobs: `target_nodes`, `source_crs`, `demand_mode` (peak / base / avg pattern
multiplier), `capacity_velocity` (uniform design velocity, default 2.5 m/s),
`n_levels` (functionality scale size, default
3 — every node/edge value and the emitted scale itself are generated for this
size; `generate_scale(3)` reproduces the app's own hardcoded default exactly).
No shedding priority is auto-derived (the per-node `priority` field is expert-set only).
A specific node's `supply_capacity` can be edited in the Inspector after
import; there is no separate fixed-value import knob for that.

**Ready-made scenario Events** are emitted into `config.events` alongside the
network — no code/UI needed to reach for a common water-utility scenario:
- Every Tank with a valid backup profile contributes to ONE shared Disservice
  ("All Tanks — Running on Reserve") that sets `functionality_time =
  backup_duration` for each of them at once — starting every tank's reserve
  countdown together as a repeatable, appliable scenario instead of only ever
  emerging as a side effect of a full upstream-failure Propagation.
- A network with any pumps gets one shared Hazard ("Blackout — Pump
  Failures") carrying full `vulnerability_levels` on every pump node (a power
  outage takes them all out together, not one at a time) and a
  `default_repair_time` of 6 hours.
- A Disservice ("Demand Surge — Top 10% Consumers") doubles demand for the
  top 10% of demand-bearing junctions by their imported `demand_mode` value.

**Import modes** (`components/controls/import-inp-section.tsx`):
- **Replace project** — the returned bundle replaces the current project and
  config wholesale, exactly like loading a local file.
- **Add as extra canvas** — merges the imported canvas + nodes/edges into the
  current project (`canvasStore.mergeImportedProject`, remapping any node/edge
  id that collides with the current project's own) and merges new
  categories/graph_types/events into the current config
  (`configStore.mergeConfig`) rather than replacing it — an existing
  category/graph_type of the same name is kept as-is; an existing event of
  the same id has the incoming `attribute_mutations` unioned in, so importing
  several networks grows one shared Blackout/Tank-Reserve/Demand-Surge
  scenario covering all of them rather than duplicating events. `n_levels` is
  forced to the current project's own `functionality_scale.length` in this
  mode so imported values land on the right scale; the target's scale is
  never replaced.

### 13.6 EPANET-mode canvas — live hydraulic comparison (implemented, ADR-0013)

A Canvas's `graph.graph_type` can be set to the reserved value `"epanet"`.
Propagation on that canvas then runs a live WNTR/EPANET solve against the
canvas's `source_inp_content` (the original `.inp` file's full text, embedded
on the canvas automatically at import time and travelling inside the project
JSON — fully local-first, works on hosted deployments) instead of the CASCADE
engine, returning the same `PropagationResult` shape the UI already renders. Canvas edits are not
reflected in that solve except by full binarization: an imported
pipe/pump/valve below full functionality closes that link; an imported
junction/reservoir/tank below full functionality closes every link touching
it; anything with no round-trip to the original `.inp` file (a CASCADE-only
addition) is skipped and named in the response's `warnings` rather than
silently ignored. Switching `graph_type` away from `"epanet"` resumes normal
engine propagation immediately. Only meaningful for local (single-canvas)
scope — a global Propagation composing multiple graph types has no
live-EPANET equivalent, so an `"epanet"`-typed canvas mixed into a global run
falls through to the normal engine.

Motivation: lets a user directly compare "what CASCADE's engine says" against
"what real hydraulics says" for the same intervention, inside the app,
without a separate validation script — the same comparison
`scripts/validate_faithfulness.py` performs offline, made interactive.

---

## 14. Authentication and Access Control

- **OAuth2/OIDC** via self-hosted open-source **Zitadel** (any OIDC IdP works in principle; paid SaaS excluded by §1). **Self-service signup** — anyone may register.
- **Login experience** (implemented): the identity gate offers separate **Sign in** and **Create account** actions; "Create account" sends `prompt=create` so Zitadel opens its registration form directly. The authorize request forwards the browser language (`ui_locales`), so the hosted Zitadel pages match the app's language. The callback surfaces actionable messages — an unverified email says "check your inbox", a declined/expired login says "start again from CASCADE" — and returns the user to the page they started from. Zitadel-side polish (branding, email-as-username, verification-code template, passkeys) is a console checklist in [deployment.md](deployment.md).
- **Google sign-in** (implemented, optional per deployment): with `OIDC_GOOGLE_IDP_ID` set, the gate shows **Continue with Google** and jumps straight past Zitadel's own form. Zitadel brokers the federation — CASCADE never handles Google credentials, and with the variable unset the app makes no request to Google at all. Enabling it makes Google a recipient of personal data (see below).
- **Data protection** (implemented): personal data is limited to identity, authorization, opt-in sync, and time-boxed logs; Propagation results and Element identities are never persisted server-side (ADR-0007). Users can download everything held about them (`GET /api/auth/me/export`) and erase their account (`DELETE /api/auth/me`); retention windows are enforced by `scripts/purge_expired.py`. The processing record, lawful bases, and the operator's remaining obligations are in [privacy-and-data-protection.md](privacy-and-data-protection.md).
- **RBAC** server-side; stored in PostgreSQL.
- Roles: `viewer`, `analyst`, `manager`, `admin`. New self-service users default to `analyst`, provisioned on first authenticated request (ADR-0010 amendment; `viewer` is the guest-preview/demotion role); higher roles are granted by an admin.
- Permissions: `can_propagate`, `can_sync`, `can_manage_users`, `can_admin` (wildcard). Code-owned mapping in `auth/rbac.py`; every permission is enforced by at least one endpoint.
- **Entitlements** (per-role quotas, not just permissions — ADR-0008): `max_nodes` and an engine-evaluation budget per minute, enforced server-side before the engine runs. Current defaults (migrations 002/003): `viewer` = 45 nodes / 10k evals-min; `analyst`/`manager` = 300 nodes / 5k evals-min (recalibrated from benchmarks — model-based analysis, not single propagations, is the binding cost). This is how self-service signup coexists with a protected engine — anyone can explore the full toolset on small graphs, bounded by quota.
- Single-user local mode requires no auth.

---

## 15. Personnel Nodes and Agentic Behaviour (Future)

- Personnel nodes carry agentic rules in a simple user-writable DSL.
- Rules describe actor responses to disservices (e.g. "if electricity = 1, mobilise backup generator within 2 h").
- Rule engine for personnel is separate from the propagation engine.

**Out of scope for the current release** — data model must reserve the `Personnel` type.

---

## 16. Open Questions / Deferred Decisions

| Topic | Status |
|---|---|
| Personnel node DSL syntax | Deferred |
| Georeferenced hazard footprints | Future enhancement |
| Additional category types beyond `SourceToDemands` and `Requisite` | Extensibility confirmed; types TBD |
| Exact scorecard layout and visual design | To be defined during UI design |
| Server sync conflict resolution strategy | Resolved by design — sync never merges. Every save is an independent new version (§13.4); there is nothing to reconcile because nothing is ever overwritten. |
| Detailed recovery mechanics for `direct_damage` nodes | Deferred to timeline module design |
| Root attribution for deferred drops (backup countdowns) in intervention prioritisation | Deferred — engine does not emit blame for deferred proposals; at-risk Elements are listed without a responsible root (§10) |
