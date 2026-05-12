# CASCADE — Product Requirements

> **Status:** Living document. Voice session 2026-05-11 takes precedence over legacy README where they conflict. Features from the existing tool not explicitly mentioned here remain in scope unless contradicted.
>
> **Phase 1 — Types & Schemas: complete (2026-05-11)**
> TypeScript types: `app/lib/types/` (primitives, config, graph, api, simulation).
> Pydantic schemas: `backend/schemas/` (network, config, results, auth).

---

## 1. Guiding Principles

- **Local-first by default.** All project data (graphs, rules, configuration, canvas state) lives as JSON on the user's machine. Editing, visualization, CRUD operations, hazard application, and topological analysis happen entirely in the browser with zero server round-trips.
- **Optional server-side sync.** Users can opt in to storing and syncing project data on the server. When disabled, behaviour is identical to local-only mode.
- **Private engine.** The propagation algorithm is proprietary IP hosted on a dedicated server. The client sends a payload and receives results. No project data is persisted server-side unless sync is explicitly enabled.
- **100 % open-source stack.** Every dependency — frontend, backend framework, GIS renderer, auth provider — must be free and open-source.

---

## 2. System Architecture

```
CLIENT (Browser)                           SERVER (Private)
─────────────────────────────────          ──────────────────────────────
  Next.js app shell                          FastAPI
  Zustand stores (local working copy)        Auth / RBAC (OAuth2/OIDC)
  MapLibre GL JS (geo rendering)             PostgreSQL (users, roles, opt. project data)
  File I/O + versioned auto-save             Propagation engine (private Python)
  All CRUD, hazards, local analysis          Returns PropagationResult JSON
```

### 2.1 Data Storage Modes

| Mode | Project data location |
|---|---|
| **Local-only** (default) | Browser / user's file system (upload/download JSON) |
| **Server sync** (opt-in) | PostgreSQL per-user + local cache |

The propagation engine operates identically in both modes.

---

## 3. Multi-Canvas Model (Network of Networks)

### 3.1 Canvases (Layers)

- Users can add, rename, and remove canvases; each canvas is an independent graph layer.
- Inter-canvas **edges** connect nodes across layers (cross-layer dependencies).
- Each canvas is independently toggled between **georeferenced** (MapLibre GL JS with lat/lon) and **non-georeferenced** (abstract layout) mode.

### 3.2 Simulation Scope

When applying a hazard, disservice, or simulation run, the user selects:

| Scope | Behaviour |
|---|---|
| **Local** | Applies only to the current canvas; inter-canvas edges are ignored |
| **Global** | Applies across all canvases; inter-canvas edges participate in propagation |

### 3.3 Auto-merge

A utility merges multiple canvases into a single unified graph. Merge rules:

- **Same ID** → same node/edge; merge by union of all edges and attributes. Conflicting attribute values on the same ID must be resolved manually by the user.
- **Different IDs** → distinct elements; no collision.

---

## 4. Configuration File

A user-editable JSON/YAML config is the single source of truth for system-wide parameters.

### 4.1 Functionality Scale

- Ordered list of N levels, each with a label and a hex colour.
- Levels are numbered 1 (worst) to N (best).
- **Default (N = 3):** level 1 = `critical` (red), level 2 = `operational_warning` (orange), level 3 = `operational` (green).
- Applies uniformly to both nodes and edges.
- `time_warning` is a special orthogonal status (see §9); it does not occupy a slot in the main scale.

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
| `functionality_time` | integer (hours) | Remaining time when in `time_warning`; 0 otherwise |
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
| `supply_capacity` | Source nodes (per category) | Maximum resource supply |
| `capacity` | Infrastructure nodes, edges | Maximum throughput / flow capacity |

### 5.4 Per-Category Dependency Block

For each category a node or edge is involved with, it carries:

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

Each node and edge carries a `vulnerability_level` ∈ {1, …, N} for each defined hazard or disservice ID. These are independent of category dependency levels.

When a hazard or disservice is applied, the imposed functionality level for each affected element is:

```
imposed_level = N − vulnerability_level   [clamped to 1..N]
```

- **vulnerability_level = 1**: imposed level = N − 1 (mild degradation).
- **vulnerability_level = N**: imposed level = 0 → clamped to 1 (worst, critical).

As with categories, this is applied only if it worsens current `functionality`.

> A node or edge not listed in the hazard's affected set is unaffected regardless of its vulnerability levels.

### 5.6 Edge Functionality

Edge functionality is treated as `worst_of(own_functionality, incoming_node_functionality)` by the propagation engine, and edge capacity is scaled accordingly. This is consistent with existing v1 behaviour.

### 5.7 Free-form Attributes

Additional key-value attributes may be attached to any node or edge. Hazards and disservices may modify these as part of their effect definition.

---

## 6. Hazards and Disservices

Applied via named UI buttons. Distinguished by whether they cause physical breakage.

### 6.1 Distinction

| Type | Direct damage | Recovery |
|---|---|---|
| **Hazard** | Yes — sets `direct_damage = true` | Tracked by the timeline module (§9) |
| **Disservice** | No | Resolves when upstream cause resolves |

### 6.2 Effect on Functionality

Each hazard/disservice has an explicit **affected set** (list of node/edge IDs). For each element in the set, the imposed functionality level is computed from the element's `vulnerability_level` for that hazard/disservice ID per the formula in §5.5. The change is applied before the propagation engine runs.

### 6.3 Effect on Other Attributes

A hazard/disservice definition can specify mutations to **arbitrary other attributes** of affected nodes and edges beyond functionality.

### 6.4 Event Properties

| Property | Type | Description |
|---|---|---|
| `id` | string | Unique identifier |
| `label` | string | Human-readable name |
| `type` | enum | `hazard` \| `disservice` |
| `affected` | list\<id\> | Node/edge IDs in scope |
| `frequency_per_10y` | numeric ≥ 0 | Expected occurrences in a 10-year period |
| `direct_damage_effects` | map\<id, {expected_repair_time}\> | Per-element repair times; hazards only. Absence of an element means functionality drop only (no physical breakage). |
| `expected_recovery_time` | integer (hours) | Hours until the disservice self-resolves; disservices only |
| `attribute_mutations` | map | Optional other attribute changes |

Multiple **scenario variants** of the same event type can be defined with different parameters (e.g. earthquakes at different epicentres or magnitudes).

> Georeferenced hazard footprints are a future enhancement.

---

## 7. Propagation Engine

Runs server-side as private IP.

### 7.1 Client Payload

- Category list with types (from config)
- All logical rules (specific, intracategorical, intercategorical)
- Per-node/edge: `supply_capacity`, `capacity`, `demand`, `dependency_level`, `backup`, `backup_duration`, `priority`
- Current `functionality` states after hazard/disservice pre-application

No display or layout data is sent.

### 7.2 Category Algorithms

#### `SourceToDemands` — Flow-based

- Max-flow with costs guided by node `priority` (1–10).
- Sources combined jointly; `capacity` on infrastructure and edges constrains throughput.
- Service node functionality set from delivered/demand ratio adjusted by `dependency_level` per §5.4.

#### `Requisite` — Logic-based

- **Intra-category:** redundancy within same category → best-of.
- **Inter-category:** multiple incoming categories → worst-of.
- Rules layer on top.

#### Extensibility

The engine interface accommodates new category types without structural changes.

### 7.3 Rule System (carried over from v1)

- **Specific rules** — explicit conditions targeting a specific node.
- **Intracategorical rules** — conditions within one category.
- **Intercategorical rules** — conditions across categories.
- Authored with human-readable labels; internally mapped to node IDs.

### 7.4 Iterative Convergence

Alternates capacity step and rule step until no node's `functionality` worsens further.

### 7.5 Causality Tracking

The engine records for each degraded node/edge which upstream element caused it. This powers:

- UI visualisation of causal chains.
- Distinction between directly damaged and indirectly affected elements.
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

### 8.3 Georeferenced Mode

- Canvas renders over a **MapLibre GL JS** base map (open-source tiles).
- Nodes carry lat/lon; edges rendered as geographic paths.
- QGIS for data preparation and GeoJSON / Vector Tile export.

---

## 9. Temporal Simulation Module

### 9.1 `time_warning` Status

Orthogonal to the main 1–N scale. Meaning: *"currently functioning but will fail in X hours."*

- `functionality_time` holds remaining hours.
- `backup` and `backup_duration` (per-category block) extend the effective time before the node expires.
- On expiry, the node transitions to `functionality = 1` (worst level, critical).

### 9.2 `expected_repair_time` and Recovery

When a hazard sets `direct_damage = true`, an `expected_repair_time` tag is associated with the node/edge. The timeline module tracks this tag: when it is activated (manually or automatically), the repair countdown begins. Detailed recovery mechanics are deferred; the data model reserves `expected_repair_time` and `direct_damage` for this purpose.

### 9.3 Event-Driven Simulation

The simulation clock does not tick at a fixed interval. Instead it is **event-driven**:

1. Find the **minimum `functionality_time`** across all `time_warning` nodes/edges — the next event.
2. Advance the clock to that point; transition all expired elements to `functionality = 1`.
3. Run a propagation pass to propagate cascading effects.
4. Repeat from step 1 until no `time_warning` elements remain.

A **slider** controls display time resolution, but event processing always jumps to the next natural breakpoint. Both step-by-step and play modes are available.

---

## 10. Intervention Prioritisation

Given:
- Causality data from the engine (§7.5)
- `direct_damage` and `expected_repair_time` per node/edge

Compute a **ranked intervention list** maximising recovery weighted by downstream `importance` and `cost_of_disservice_per_day`. Runs client-side (not proprietary).

---

## 11. Topological Analysis Module

- **Centrality metrics**: degree, betweenness, closeness.
- Visualisation overlays (node size / colour).

---

## 12. Scorecard

Auto-generated after each propagation or hazard application. Available in both **local** (current canvas) and **global** (all canvases) variants.

| Metric | Description |
|---|---|
| Operativity index | Weighted average `functionality` across nodes |
| Cost of disservice | Sum of `cost_of_disservice_per_day` for nodes below `functionality = N` |
| Status breakdown | Count per functionality level |
| Most impacted nodes | Ranked by `importance × (N − functionality)` |
| Causal summary | Top root causes from causality tracking |

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

### 13.4 Server Sync (opt-in)

When enabled, explicit saves are also pushed to PostgreSQL per-user. Version list is accessible across devices.

---

## 14. Authentication and Access Control

- **OAuth2/OIDC** (provider-agnostic: Keycloak or any compliant IdP).
- **RBAC** server-side; stored in PostgreSQL.
- Roles: `viewer`, `analyst`, `manager`, `admin`.
- Permissions: `can_propagate`, `can_view_analysis`, `can_sync`, `can_manage_users`, `can_define_roles`.
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
| Server sync conflict resolution strategy | To be defined |
| Detailed recovery mechanics for `direct_damage` nodes | Deferred to timeline module design |
