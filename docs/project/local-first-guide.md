# Local-First Guide

## What "Local-First" Means

In CASCADE, your project data lives on your machine as plain JSON. Editing, visualization, rule authoring, Event application, and topological analysis all happen entirely in the browser with no server involvement.

The server has two purposes:

1. **Run the server-hosted propagation engine** when you click Propagate.
2. **Enforce identity and access control** (OAuth2/OIDC + RBAC).

Optionally, users can enable **server-side sync** to persist and share project files across devices. When sync is disabled (the default), the server never sees or stores project data.

---

## Data Model

All project data is organized into two JSON files: a **project file** and a **config file**.

> **Canonical schemas** — The machine-readable definitions are the source of truth. Do not infer field rules from the JSON examples alone.
>
> | Layer | Location |
> |---|---|
> | TypeScript types (frontend) | `CASCADE-app/lib/schemas/network.ts`, `CASCADE-app/lib/schemas/config.ts`, `CASCADE-app/lib/schemas/api.ts`, `CASCADE-app/lib/schemas/primitives.ts` |
> | Pydantic models (backend) | `CASCADE-backend/schemas/network.py`, `CASCADE-backend/schemas/config.py`, `CASCADE-backend/schemas/results.py`, `CASCADE-backend/schemas/auth.py` |
>
> The JSON examples below are illustrative only.

### Project File

A project file contains a **global element registry** (all nodes and edges, keyed by their ID) and a list of **Canvases** that reference elements by ID. The same element may appear in multiple Canvases without duplication (ADR-0001).

Inter-canvas edges are **not** a special type — they are stored as regular edges in the global registry. An edge is "inter-canvas" only at render time, when its target node is absent from the current Canvas's `node_ids`.

```json
{
  "version": "2.0",
  "meta": {
    "name": "Palmanova Infrastructure",
    "description": "Water and electricity interdependency model",
    "created_at": "2026-05-11T08:00:00Z",
    "updated_at": "2026-05-11T10:00:00Z"
  },
  "nodes": {
    "node-reservoir": {
      "id": "node-reservoir",
      "label": "Main Reservoir",
      "node_type": "Source",
      "node_categories": ["water"],
      "functionality": 3,
      "functionality_time": 0,
      "direct_damage": false,
      "expected_repair_time": 0,
      "importance": 0.9,
      "cost_of_disservice_per_day": 50000,
      "position": { "x": 200, "y": 100 },
      "geo": { "lng": 13.312, "lat": 45.905 },
      "supply_capacity": { "water": 1000 },
      "vulnerability_levels": {
        "earthquake-m6": 3,
        "flood-100y": 2
      },
      "properties": {}
    },
    "node-hospital": {
      "id": "node-hospital",
      "label": "City Hospital",
      "node_type": "Service",
      "node_categories": ["water", "electricity"],
      "functionality": 3,
      "functionality_time": 0,
      "direct_damage": false,
      "expected_repair_time": 0,
      "importance": 1.0,
      "cost_of_disservice_per_day": 200000,
      "position": { "x": 500, "y": 300 },
      "geo": { "lng": 13.318, "lat": 45.901 },
      "category_dependency_profiles": {
        "water": {
          "dependency_level": 3,
          "backup": true,
          "backup_duration": 48,
          "demand": 80,
          "priority": 9
        },
        "electricity": {
          "dependency_level": 3,
          "backup": true,
          "backup_duration": 72,
          "demand": 500,
          "priority": 10
        }
      },
      "vulnerability_levels": {
        "earthquake-m6": 1,
        "flood-100y": 1
      },
      "properties": {}
    },
    "node-substation-a": {
      "id": "node-substation-a",
      "label": "Substation A",
      "node_type": "Infrastructure",
      "node_categories": ["electricity"],
      "functionality": 3,
      "supply_capacity": { "electricity": 2000 },
      "position": { "x": 300, "y": 400 },
      "geo": { "lng": 13.310, "lat": 45.899 }
    }
  },
  "edges": {
    "edge-pipe-1": {
      "id": "edge-pipe-1",
      "source": "node-reservoir",
      "target": "node-hospital",
      "sourceHandle": "right",
      "targetHandle": "left",
      "functionality": 3,
      "functionality_time": 0,
      "direct_damage": false,
      "expected_repair_time": 0,
      "capacity": 600,
      "vulnerability_levels": {
        "earthquake-m6": 2,
        "flood-100y": 3
      },
      "properties": {}
    },
    "edge-power-to-hospital": {
      "id": "edge-power-to-hospital",
      "source": "node-substation-a",
      "target": "node-hospital",
      "functionality": 3,
      "capacity": 1000,
      "vulnerability_levels": {
        "earthquake-m6": 2
      }
    }
  },
  "canvases": [
    {
      "id": "canvas-water",
      "label": "Water Network",
      "color": "#3b82f6",
      "georeferenced": true,
      "map_style": "liberty",
      "map_center": { "lng": 13.312, "lat": 45.905 },
      "map_zoom": 13.5,
      "geo_anchor": {
        "flow": { "x": 600, "y": 400 },
        "geo": { "lng": 13.312, "lat": 45.905 },
        "rf_zoom": 1,
        "ml_zoom": 13.5
      },
      "graph": {
        "graph_type": "water",
        "node_ids": ["node-reservoir", "node-hospital"],
        "edge_ids": ["edge-pipe-1"]
      }
    },
    {
      "id": "canvas-power",
      "label": "Electricity Network",
      "color": "#eab308",
      "georeferenced": true,
      "graph": {
        "graph_type": "power",
        "node_ids": ["node-substation-a", "node-hospital"],
        "edge_ids": ["edge-power-to-hospital"]
      }
    }
  ],
  "scorecard": [],
  "update_history": []
}
```

Note: `node-hospital` appears in both canvases — it is stored once in the registry and referenced by both. `edge-power-to-hospital` connects `node-substation-a` (in `canvas-power`) to `node-hospital` (also in `canvas-power`). If rendered from `canvas-water`, it would appear as an inter-canvas edge because `node-substation-a` is not in `canvas-water`'s `node_ids`.

#### Canvas geo fields

Present only on georeferenced Canvases (all optional / nullable):

| Field | Type | Description |
| --- | --- | --- |
| `georeferenced` | `bool` | When true, the Canvas renders a MapLibre background and node `geo` is authoritative for placement. |
| `map_style` | `string` | Last tile style id: `liberty` \| `bright` \| `positron`. |
| `map_center` | `{lng, lat}` | Last map viewport centre, restored when the Canvas reopens. |
| `map_zoom` | `number` | Last MapLibre zoom level, restored on reopen. |
| `geo_anchor` | `GeoAnchor` | The one flow↔geo correspondence (`flow`, `geo`, `rf_zoom`, `ml_zoom`). Defines the exact Web Mercator **GeoAnchor projection** that converts node `position` ↔ `geo`. Absent until the user sets the anchor in the geo editor. See CONTEXT.md → *GeoAnchor*. |

#### EPANET-mode fields

Present only on a Canvas imported from a `.inp` file where the user chose to
enable EPANET-mode comparison (both optional):

| Field | Type | Description |
| --- | --- | --- |
| `source_inp_content` | `string` | Full text of the original `.inp` file this canvas was imported from, embedded automatically at import time (the browser already holds the picked file's content — a filesystem path can't be auto-captured, and a server-side copy would break the importer's nothing-persisted property). Required for `graph_type: "epanet"` to solve; travels inside the project JSON, so the feature is fully local-first and works on hosted deployments. |
| `source_inp_demand_mode` | `"peak"` \| `"base"` \| `"avg"` | `demand_mode` this canvas was imported with, reused so the live EPANET solve's demand baseline matches the original import rather than the `.inp` file's raw time-varying pattern. |

Setting a Canvas's `graph.graph_type` to the reserved value `"epanet"` makes
Propagation on that canvas run a live WNTR/EPANET solve against
`source_inp_content` instead of the normal CASCADE engine — see
`docs/adr/0013-epanet-mode-canvas.md` and `api-reference.md`.

#### Node fields reference

| Field | Type | Description |
| --- | --- | --- |
| `node_type` | `"Source"` \| `"Infrastructure"` \| `"Service"` \| `"Personnel"` | Display classification. Engine treats all types identically. |
| `node_categories` | `string[]` | One or more category names from the config. |
| `functionality` | `integer 1–N` | Current level: 1 = worst, N = fully operational. |
| `functionality_time` | `integer` (hours) | Countdown to Functionality 1. 0 = no pending degradation. Set by engine or manually by the user. |
| `direct_damage` | `boolean` | Physical breakage set by a Hazard; requires active repair. |
| `expected_repair_time` | `integer` (hours) | Estimated repair duration when `direct_damage = true`. |
| `importance` | `number` | Weight for Scorecard aggregation. |
| `cost_of_disservice_per_day` | `number` | Economic impact when below full functionality. |
| `supply_capacity` | `{ [category]: number }` | Source nodes only. Effective supply = `supply_capacity[cat] × (functionality / N)`. |
| `category_dependency_profiles` | `{ [category]: profile }` | Per-category dependency attributes (see below). Absent on Source nodes for categories they supply. |
| `vulnerability_levels` | `{ [event_id]: 0–(N−1) }` | Sensitivity to each defined Event. Higher = more vulnerable; 0 = immune (same as absent). |
| `responsibility_share` | `{ [element_id \| event_id]: float }` | Set by engine after Propagation. Values in (0,1] summing to 1. |
| `rules` | `string[]` | Rule strings — parsed client-side, evaluated by the engine. |
| `properties` | `object` | Free-form attributes; Event `attribute_mutations` may write here. |

#### Per-category dependency profile fields

| Field | Required for | Description |
| --- | --- | --- |
| `dependency_level` | All categories | 1–N. N = fully dependent (strict thresholds). 1 = barely dependent (high tolerance). |
| `capacity` | Optional, all categories | Max throughput for this category on this node. Degrades proportionally with Functionality. |
| `backup` | All categories | Whether a backup mechanism exists. |
| `backup_duration` | All (if `backup: true`) | Hours (integer) the backup can sustain the element. |
| `demand` | `SourceToDemands` only | Resource amount requested. |
| `priority` | `SourceToDemands` only | Flow allocation priority 1–10 (10 = served first in scarcity). |

#### Vulnerability level formula

When Event `e` is applied, the imposed `functionality` level is:

```
imposed = N − vulnerability_levels[e.id]   (clamped to 1)
```

Applied only if it worsens the current `functionality`.

#### Edge fields reference

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | Globally unique edge ID (global registry key). |
| `source` / `target` | `string` | Node IDs in the global registry. |
| `sourceHandle` / `targetHandle` | `string` (optional) | React Flow connection-dot ids the edge was drawn between. UI-only; ignored by the engine. |
| `functionality` | `integer 1–N` | Effective level is `worst_of(intrinsic, source node)` — recomputed by the engine each run. |
| `functionality_time` | `integer` (hours) | Same semantics as on nodes. |
| `direct_damage` | `boolean` | Physical breakage set by a Hazard. |
| `expected_repair_time` | `integer` (hours) | Estimated repair duration when `direct_damage = true`. |
| `capacity` | `number` | Maximum throughput; degrades proportionally with Functionality. Edges carry no category — the engine infers it from the endpoints. |
| `vulnerability_levels` | `{ [event_id]: 0–(N−1) }` | Same semantics as on nodes. |
| `responsibility_share` | `{ [element_id \| event_id]: float }` | Set by engine after Propagation. Values in (0,1] summing to 1. |
| `rules` | `string[]` | Rule strings — parsed client-side, evaluated by the engine. |
| `properties` | `object` | Free-form attributes. |

---

### Config File

The config file defines the functionality scale, categories, Events (Hazards and Disservices), and Engine Configuration. It is the single source of truth for label↔integer mapping used in rule parsing.

```json
{
  "version": "1.0",
  "meta": {
    "name": "Default Config"
  },
  "functionality_scale": [
    { "level": 1, "label": "critical",            "color": "#ef4444" },
    { "level": 2, "label": "operational_warning", "color": "#f97316" },
    { "level": 3, "label": "operational",         "color": "#22c55e" }
  ],
  "categories": [
    { "name": "water",       "category_type": "SourceToDemands", "color": "#3b82f6" },
    { "name": "electricity", "category_type": "SourceToDemands", "color": "#eab308" },
    { "name": "ICT",         "category_type": "Requisite",       "color": "#a855f7" }
  ],
  "events": [
    {
      "id": "earthquake-m6",
      "label": "Earthquake M6.0 — NW epicentre",
      "type": "hazard",
      "frequency_per_10y": 0.3,
      "direct_damage_effects": {
        "node-reservoir": { "expected_repair_time": 720 },
        "edge-pipe-1":    { "expected_repair_time": 480 }
      },
      "attribute_mutations": {}
    },
    {
      "id": "power-blackout",
      "label": "Regional power blackout",
      "type": "disservice",
      "frequency_per_10y": 1.0,
      "direct_damage_effects": {},
      "attribute_mutations": {}
    }
  ],
  "graph_types": [
    {
      "name": "water",
      "heuristics": [
        { "id": "source-to-demands-flow", "enabled": true, "params": {} },
        { "id": "requisite-pessimistic",  "enabled": true, "params": {} }
      ]
    },
    {
      "name": "power",
      "heuristics": [
        { "id": "source-to-demands-flow", "enabled": true, "params": {} }
      ]
    },
    {
      "name": "global",
      "local_graph_types": ["water", "power"]
    }
  ]
}
```

The `global` graph type (referenced by `global_graph_type`) lists its constituent
local graph types in `local_graph_types` instead of declaring `heuristics`
directly. During a global Propagation the engine merges the named locals'
heuristic pipelines; because heuristic `params` are keyed by category, the water
and power flow params coexist without conflict. A local graph type omits
`local_graph_types` and its `heuristics` array is its literal pipeline.

#### Category types

`category_type` is a **closed enum** — exactly these two values are valid
(enforced by both the Pydantic and Zod schemas; the UI offers them as a
select). The engine dispatches on exact string equality, so any other string
would silently bind the category to no heuristic.

| `category_type` | Algorithm | Description |
| --- | --- | --- |
| `SourceToDemands` | Capacitated flow allocation | Physical resource flows (water, electricity). Delivery ratio → functionality via `dependency_level`. How scarcity is shared is a per-graph-type choice — see "Flow allocation strategies" below. |
| `Requisite` | Pessimistic aggregation | Non-flow logical necessities. Node degrades if any required upstream falls below threshold. |

#### Flow allocation strategies (ADR-0014)

How a `SourceToDemands` category shares **scarce** supply is selected per
graph type via the `"source-to-demands-flow"` heuristic's `allocation` param:

```json
"graph_types": [
  { "name": "water_network",
    "heuristics": [
      { "id": "source-to-demands-flow", "enabled": true,
        "params": { "allocation": "priority_greedy" } }
    ] }
]
```

| `allocation` | Behaviour under scarcity |
| --- | --- |
| `tiered_fair_share` *(default — used when the param or the whole heuristic entry is absent)* | Higher-priority tiers are served fully first; consumers of **equal** priority spread the shortage as evenly as the network physically allows (max-min water-filling). |
| `priority_greedy` | One min-cost max-flow with priority rewards: strict triage, winner-take-all among equals, cheapest to compute. |

Under both, `priority` (1–10, on a consumer's category profile) means "who is
served first" — with fair-share it additionally guarantees equals share the
pain instead of one being silently zeroed. The engine resolves the strategy
once per Propagation run from the first canvas whose graph type declares it.

#### Rule syntax

Rules are stored as strings on nodes and edges. Two forms are accepted — the parser resolves labels to integers using `functionality_scale` at parse time:

```
# Specific rule (attribute-based condition → assignment)
if node-hospital.functionality is <2 then node-reservoir is critical

# Shorthand using labels defined in functionality_scale
if node-hospital is operational_warning then node-reservoir is critical

# Intracategorical propagation rule
worst_of(node-reservoir, node-substation-a) propagates to node-hospital

# Intercategorical propagation rule
worst_of(water, electricity) propagates to node-hospital
```

A rule referencing a label not defined in `functionality_scale` is ignored and a warning is returned in `PropagationResult.warnings`.

---

## File I/O Workflow

### Saving

1. Open the **File** panel (or `Ctrl+S`).
2. Choose **Download Project** or **Download Config** (or both bundled).
3. A browser download saves the `.json` file locally.

Explicit saves are version-tracked: up to **10 previous explicit saves** are retained in browser storage. Auto-saves run continuously as a safety net and are discarded when you make an explicit save.

### Loading

1. Open the **File** panel.
2. Click **Upload Project** or **Upload Config**.
3. Select the `.json` file. The app validates the schema and hydrates the stores.

### Server Sync (opt-in) — signed-in analyst role and above

The **File** panel shows a **Server sync** section when you're signed in with `can_sync` permission (analyst, manager, admin). **Save current project to server** pushes the current bundle as a new version — sync never overwrites, so every save is kept, up to 10 versions per project name (older ones are pruned automatically, same cap as local history). The version list shows every synced save with load/delete actions; you can load your project from any device this way, no manual file transfer. Deleting your account (self-service or by an admin) deletes all your synced versions too.

API: `POST/GET /api/projects`, `GET/DELETE /api/projects/{id}` — see api-reference.md.

---

## Propagation Scope

When running the propagation engine, choose:

- **Local** — operates only on nodes and edges within the active Canvas; inter-canvas edges are ignored.
- **Global** — operates across all Canvases; inter-canvas edges participate in propagation.

---

## Offline Capabilities

The following work without any network connection:

- Building and editing Canvases, nodes, and edges.
- Authoring rules and configuring categories.
- Applying Events (Hazards and Disservices) — pre-propagation only.
- Running topological analysis (centrality, etc.) locally.
- Manual Functionality and Functionality Time edits.
- Viewing and authoring Scorecard entries from existing snapshots.
- Downloading JSON files.

The **only** actions requiring the server are:

- **Propagate** — sends the payload to the propagation engine.
- **Server sync** — upload/download via account storage.

If the server is unreachable, the Propagate button is disabled and the app shows: *"Server unreachable. Your data is safe locally."*

---

## Data Ownership

- No telemetry unless explicitly opted in.
- In local-only mode, no project data ever reaches the server.
- JSON files are portable: version-control with Git, share via any file method, process with Python or QGIS.
- The schema is documented and open; no vendor lock-in.

---

## Integration with External Tools

### QGIS

Nodes with `geo` coordinates can be exported as GeoJSON FeatureCollections. A helper script is planned at `samples/scripts/export_to_geojson.py`.

### Python / Jupyter

```python
import requests, json

with open("project.json") as f:
    project = json.load(f)
with open("config.json") as f:
    config = json.load(f)

resp = requests.post(
    "https://your-server/api/propagate",
    json={"project": project, "config": config, "scope": "global"},
    headers={"Authorization": f"Bearer {token}"}
)
result = resp.json()
```

### Version Control

Because files are plain JSON, Git works naturally:

```bash
git add project.json config.json
git commit -m "Add hospital backup duration after field survey"
```
