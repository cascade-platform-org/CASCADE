# Local-First Guide

## What "Local-First" Means

In CASCADE, your project data lives on your machine as plain JSON. Editing, visualization, rule authoring, hazard application, and topological analysis all happen entirely in the browser with no server involvement.

The server has two purposes:

1. **Run the proprietary propagation engine** when you click Propagate.
2. **Enforce identity and access control** (OAuth2/OIDC + RBAC).

Optionally, users can enable **server-side sync** to persist and share project files across devices. When sync is disabled (the default), the server never sees or stores project data.

---

## Data Model

All project data is organized into two JSON files: a **project file** and a **config file**.

> **Canonical schemas** — The machine-readable definitions are the source of truth. Do not infer field rules from the JSON examples alone.
>
> | Layer | Location |
> |---|---|
> | TypeScript types (frontend) | `app/lib/types/graph.ts`, `app/lib/types/config.ts`, `app/lib/types/api.ts`, `app/lib/types/primitives.ts` |
> | Pydantic models (backend) | `backend/schemas/network.py`, `backend/schemas/config.py`, `backend/schemas/results.py`, `backend/schemas/auth.py` |
>
> The JSON examples below are illustrative only.

### Project File

A project file contains all canvases (graph layers), their nodes and edges, and inter-canvas connections.

```json
{
  "version": "2.0",
  "meta": {
    "name": "Palmanova Infrastructure",
    "description": "Water and electricity interdependency model",
    "created_at": "2026-05-11T08:00:00Z",
    "updated_at": "2026-05-11T10:00:00Z"
  },
  "canvases": [
    {
      "id": "canvas-water",
      "label": "Water Network",
      "georeferenced": true,
      "nodes": [
        {
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
          "category_blocks": {
            "water": {
              "dependency_level": 3,
              "backup": false,
              "backup_duration": 0
            }
          },
          "vulnerability_levels": {
            "earthquake-m6": 3,
            "flood-100y": 2
          },
          "properties": {}
        },
        {
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
          "category_blocks": {
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
        }
      ],
      "edges": [
        {
          "id": "edge-pipe-1",
          "source": "node-reservoir",
          "target": "node-hospital",
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
        }
      ]
    },
    {
      "id": "canvas-power",
      "label": "Electricity Network",
      "georeferenced": true,
      "nodes": [],
      "edges": []
    }
  ],
  "inter_canvas_edges": [
    {
      "id": "ice-power-to-hospital",
      "source_canvas": "canvas-power",
      "source": "node-substation-a",
      "target_canvas": "canvas-water",
      "target": "node-hospital",
      "functionality": 3,
      "functionality_time": 0,
      "direct_damage": false,
      "expected_repair_time": 0,
      "capacity": 1000,
      "vulnerability_levels": {
        "earthquake-m6": 2
      }
    }
  ]
}
```

#### Node fields reference

| Field                          | Type                                                                     | Description                                                        |
| ------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `node_type`                  | `"Source"` \| `"Infrastructure"` \| `"Service"` \| `"Personnel"` | Role in the network                                                |
| `node_categories`            | `string[]`                                                             | One or more categories from the config                             |
| `functionality`              | `integer 1–N`                                                         | Current status: 1 = worst (critical), N = best (operational)       |
| `functionality_time`         | `integer` (hours)                                                      | Remaining time when in `time_warning` state                      |
| `direct_damage`              | `boolean`                                                              | Set by a hazard; signals physical breakage requiring active repair |
| `expected_repair_time`       | `integer` (hours)                                                      | Estimated repair duration when `direct_damage = true`            |
| `importance`                 | `number`                                                               | Weight for scorecard aggregation                                   |
| `cost_of_disservice_per_day` | `number`                                                               | Economic impact when below full functionality                      |
| `supply_capacity`            | `{ [category]: number }`                                               | Source nodes only — maximum resource supply per category          |
| `capacity`                   | `number`                                                               | Infrastructure nodes only — maximum throughput                    |
| `category_blocks`            | `{ [category]: block }`                                                | Per-category dependency attributes (see below)                     |
| `vulnerability_levels`       | `{ [hazard_id]: 1–N }`                                                | Sensitivity to each defined hazard/disservice                      |
| `properties`                 | `object`                                                               | Free-form extra attributes; hazards may mutate these               |

#### Per-category block fields

| Field                | Required for                   | Description                                                                           |
| -------------------- | ------------------------------ | ------------------------------------------------------------------------------------- |
| `dependency_level` | All categories                 | 1–N. N = fully dependent (strict thresholds). 1 = barely dependent (high tolerance). |
| `backup`           | All categories                 | Whether a backup mechanism exists                                                     |
| `backup_duration`  | All (if `backup: true`)      | Hours the backup can sustain the element                                              |
| `demand`           | `SourceToDemands` categories | Resource amount requested                                                             |
| `priority`         | `SourceToDemands` categories | Flow allocation priority 1–10 (higher = served first in scarcity)                    |

#### Vulnerability level formula

When hazard `h` is applied, the imposed `functionality` level is:

```
imposed = N − vulnerability_levels[h.id]   (clamped to 1)
```

Applied only if it worsens the current `functionality`.

---

### Config File

The config file defines the functionality scale, categories, rules, hazards, and scorecard parameters.

```json
{
  "version": "3.0",
  "meta": {
    "name": "Default Config"
  },
  "functionality_scale": [
    { "level": 1, "label": "critical",              "color": "#ef4444" },
    { "level": 2, "label": "operational_warning",   "color": "#f97316" },
    { "level": 3, "label": "operational",           "color": "#22c55e" }
  ],
  "categories": [
    { "name": "water",       "category_type": "SourceToDemands", "color": "#3b82f6" },
    { "name": "electricity", "category_type": "SourceToDemands", "color": "#eab308" },
    { "name": "ICT",         "category_type": "Requisite",       "color": "#a855f7" }
  ],
  "hazards": [
    {
      "id": "earthquake-m6",
      "label": "Earthquake M6.0 — NW epicentre",
      "type": "hazard",
      "affected": ["node-reservoir", "edge-pipe-1"],
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
      "affected": ["node-hospital"],
      "frequency_per_10y": 1.0,
      "expected_recovery_time": 8,
      "attribute_mutations": {}
    }
  ],
  "rules": [
    {
      "id": "rule-1",
      "type": "intercategorical",
      "expression": "IF ALL(parents[category=ICT]) == critical THEN target = critical",
      "enabled": true
    }
  ]
}
```

#### Category types

| `category_type`   | Algorithm           | Description                                                                                             |
| ------------------- | ------------------- | ------------------------------------------------------------------------------------------------------- |
| `SourceToDemands` | Max-flow with costs | Physical resource flows (water, electricity). Delivery ratio → functionality via `dependency_level`. |
| `Requisite`       | Pessimistic logic   | Non-flow logical necessities. Intra-category: best-of. Inter-category: worst-of.                        |

---

## File I/O Workflow

### Saving

1. Open the **File** panel (or `Ctrl+S`).
2. Choose **Download Project** or **Download Config** (or both bundled).
3. A browser download saves the `.json` file locally.

Explicit saves are version-tracked: up to **10 previous explicit saves** are retained. Auto-saves run continuously in the background as safety net and are discarded when you make an explicit save.

### Loading

1. Open the **File** panel.
2. Click **Upload Project** or **Upload Config**.
3. Select the `.json` file. The app validates the schema and hydrates the Zustand stores.

### Server Sync (opt-in)

When sync is enabled in Settings, explicit saves are also pushed to your account on the server. You can then load your project from any device without manual file transfer. Sync requires authentication.

---

## Simulation Scope

When applying a hazard or running the propagation engine, choose:

- **Local** — affects only the currently selected canvas; inter-canvas edges are ignored.
- **Global** — affects all canvases; inter-canvas edges participate in propagation.

---

## Offline Capabilities

The following work without any network connection:

- Building and editing canvases, nodes, and edges.
- Authoring rules and configuring categories.
- Applying hazards and disservices (pre-propagation only).
- Running topological analysis (centrality, etc.) locally.
- Temporal simulation (event-driven clock).
- Viewing scorecard of current state.
- Downloading JSON files.

The **only** actions requiring the server are:

- **Propagate** — sends the payload to the propagation engine.
- **Server sync** — upload/download via account storage.

If the server is unreachable, the app shows: *"Server unreachable. Your data is safe locally."*

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

The project JSON accepted by the UI is the same format accepted by `POST /api/simulate`:

```python
import requests, json

with open("project.json") as f:
    project = json.load(f)
with open("config.json") as f:
    config = json.load(f)

resp = requests.post(
    "https://your-server/api/propagate",
    json={"project": project, "config": config},
    headers={"Authorization": f"Bearer {token}"}
)
results = resp.json()
```

### Version Control

Because files are plain JSON, Git works naturally:

```bash
git add project.json config.json
git commit -m "Add hospital backup duration after field survey"
```

---

## Migration from v1

If you have projects from the previous tool (Flask + Vis.js):

1. Export from the old UI as JSON.
2. Run the migration script: `samples/scripts/migrate_v1_to_v3.py` (planned).
3. Upload the converted file in the new UI.

Key changes in the v3 schema:

- `operativity` (float 0–1) → `functionality` (integer 1–N)
- Single `category` → `node_categories` (list)
- Per-node `category_blocks` replaces flat dependency fields
- `canvases` wrapper for multi-layer support
