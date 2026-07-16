# Architecture Overview

## Design Philosophy

CASCADE follows a **local-first** architecture. All project data — graphs, rules, configurations, canvas state — lives on the client as JSON files. The user owns their data, can work offline, and decides when (and whether) to interact with the server.

The server has two core responsibilities:

1. **Execute the propagation engine** on submitted payloads (public now, proprietary later — ADR-0009).
2. **Enforce identity and access control** via OAuth2/OIDC and role-based policies.

By default, no project data is stored server-side. Optionally, users can enable **server-side sync** to persist and share project files across devices — stored in PostgreSQL per-user. The propagation engine operates identically in both modes.

---

## High-Level Diagram

```
┌─────────────────────────────────────────────────────┐
│                    CLIENT (Browser)                  │
│                                                      │
│  ┌──────────────┐  ┌──────────┐  ┌────────────────┐  │
│  │ Zustand       │  │ MapLibre │  │ File I/O       │  │
│  │ Stores        │  │ GL JS    │  │ upload/download│  │
│  │ canvas        │  │          │  │ + versioned    │  │
│  │ network       │  └──────────┘  │   auto-save    │  │
│  │ config        │                └────────────────┘  │
│  │ clipboard     │  ┌──────────────────────────────┐  │
│  │ auth / ui     │  │ Next.js App Router            │  │
│  └──────────────┘  │ Canvas Editor · Editors       │  │
│                     │ Rules · Events · Scorecard    │  │
│                     └────────────┬─────────────────┘  │
└──────────────────────────────────┼────────────────────┘
                                   │ HTTPS (JSON payloads)
                                   ▼
┌──────────────────────────────────────────────────────┐
│                   SERVER (FastAPI)                    │
│                                                      │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ API Routes │  │ Auth / RBAC  │  │ Propagation  │  │
│  │ /propagate │  │ OAuth2/OIDC  │  │ Service      │  │
│  │ /engine    │  │ Role guards  │  │              │  │
│  │ /sync      │  └──────┬───────┘  └──────┬───────┘  │
│  │ /admin     │         │                 │           │
│  └────────────┘         ▼                 ▼           │
│                  ┌────────────┐   ┌──────────────┐    │
│                  │ PostgreSQL │   │ ENGINE       │    │
│                  │ users      │   │ (private)    │    │
│                  │ roles      │   │ propagation  │    │
│                  │ opt: files │   │ algorithm    │    │
│                  └────────────┘   └──────────────┘    │
└──────────────────────────────────────────────────────┘
```

---

## Multi-Canvas Model

The core modelling primitive is a **multi-canvas**: multiple Canvases, each representing an independent Entity (water network, electricity grid, ICT infrastructure, …), connected by inter-canvas edges stored in the global element registry.

- Each Canvas can be independently **georeferenced** (MapLibre) or abstract (flow layout).
- Each Canvas carries a **`graph_type`** (`canvas.graph.graph_type`) — a name referencing a `ModelConfiguration.graph_types` entry. The Model Configuration defines what a graph type is (name + heuristic pipeline); the Canvas holds the assignment. Assignments can be made from both the Inspector's Canvas Meta panel and the Graph Types tab of the Config modal.
- The **Global view** (all Canvases together) also has an explicit `graph_type`, stored as `Project.global_graph_type`. Settable from the Graph Types tab alongside per-Canvas assignments.
- **Inter-canvas edges** are regular edges in the global registry whose target node belongs to a different Canvas. Identified at render time — no special type or field in the data model (ADR-0001).
- A node may appear in multiple Canvases. Because element IDs are globally unique, it is stored exactly once in the registry regardless of how many Canvases reference it.
- **Propagation scope** governs the engine payload only. Local: client sends active Canvas nodes + intra-canvas edges only. Global: client sends full Project. Event application always writes to the full registry, independent of scope.
- **Global display mode** (deferred, Slice 2): renders all Canvases in one React Flow instance. Because IDs are unique, each node appears exactly once — no deduplication step needed. Inter-canvas edges render as dashed connectors. Pure render-time operation; no data model change.

---

## Client Architecture

### State Management — Zustand

All application state is managed through nine Zustand stores:

- **`canvas-store`** — global element registry (`nodes`, `edges`), Canvas list, active Canvas, serialisation to/from `Project`. Hosts `undo()`/`redo()` (they must write the registry) but the history data itself lives in `history-store`.
- **`history-store`** — the Any Graph Update ring buffer (`update_history`, cap 20) plus the session-only redo stack. Pure append/pop/restore data structure; zero dependency on other stores.
- **`network-store`** — UI-only selection and hover state for the active Canvas. Intentionally thin — no graph data. High-frequency updates (every pointer event) stay isolated from the registry.
- **`config-store`** — `ModelConfiguration`: functionality scale, category definitions, Event definitions, graph-type algorithm pipelines. Owns a draft/commit lifecycle for the Config modal.
- **`scorecard-store`** — the Scorecard entry list, serialised into `Project.scorecard` via canvas-store.
- **`analysis-store`** — ephemeral Analysis-page state (selected metric, results, heatmap colours). Never persisted.
- **`clipboard-store`** — transient copy/paste state. Never persisted.
- **`auth-store`** — user profile, current role, session lifecycle. Holds no tokens — the session lives in httpOnly cookies set by the backend; JavaScript never sees a token. UI permission gating uses the `permissions` list served by `GET /api/auth/me` (computed in `auth/rbac.py`) — there is no client-side role→permission map to drift.
- **`ui-store`** — panel visibility, active tool, propagation scope, category filter, toast queue.

The stores are the single source of truth. Components subscribe to slices they need.

### Data Model — Global Element Registry (ADR-0001)

Nodes and edges have globally unique IDs and live in a single registry at the Project level (`Project.nodes`, `Project.edges`). Each Canvas holds only `node_ids` and `edge_ids` — references, not copies. A node that participates in multiple Canvases is stored once; both Canvases reference the same ID. Propagation updates the registry once; all Canvases reflect the change automatically.

The project file structure:

```json
{
  "version": "2.0",
  "nodes": { "<id>": { … } },
  "edges": { "<id>": { … } },
  "canvases": [
    { "id": "…", "graph": { "graph_type": "…", "node_ids": […], "edge_ids": […] } }
  ],
  "update_history": [],
  "scorecard": []
}
```

There is no top-level `inter_canvas_edges` array. Inter-canvas edges are plain edges in the registry; their inter-canvas nature is computed at render time.

### Any Graph Update History — Undo Stack

Every user action that changes graph state pushes an `AnyUpdateEntry` to `update_history` (capped at 20). Each entry carries a `before` and `after` `GraphSnapshot`. Ctrl+Z restores `before`; the entry is popped. Entry types:

| `update_type` | Trigger |
|---|---|
| `graph_update` | Add/remove/edit nodes or edges |
| `event_applied` | Applying an Event (Hazard or Disservice) |
| `event_cleared` | Clearing a previously applied Event |
| `propagation` | Receiving a PropagationResult from the server |
| `manual_functionality_update` | User manually editing Functionality or Functionality Time |

### Data Persistence — File I/O and Version History

- **Auto-save** — continuous background save to `localStorage` (safety net). Discarded when an explicit save is made.
- **Explicit save** — downloads `project.json` + `config.json` (or a bundle). Up to 10 previous explicit saves retained in browser storage.
- **Load** — Zod validation at the boundary before hydrating stores.

### Server Sync (opt-in)

When enabled, explicit saves are also pushed to `POST /api/projects` (each save is a new version, never an overwrite). The version list is accessible across devices via `GET /api/projects`; load/delete one version via `GET`/`DELETE /api/projects/{id}`. Requires the `can_sync` RBAC permission. See api-reference.md.

### Schema Layer

All shared data shapes are defined as Zod schemas (frontend) and Pydantic models (backend). Zod is the runtime validation boundary on the frontend; TypeScript types are inferred from Zod via `z.infer<>`.

The Pydantic models are the **Python source of truth**. A bridge script exports them to JSON Schema, which serves as the reference for keeping the Zod schemas in sync:

```
CASCADE-backend/schemas/*.py
        │
        │  python CASCADE-backend/scripts/export_json_schema.py
        ▼
CASCADE-app/shared/schemas/*.schema.json   ← drift is CI-enforced (backend job)
        │
        │  manual update
        ▼
CASCADE-app/lib/schemas/*.ts               ← TypeScript source of truth
```

Run the bridge script whenever a Pydantic model changes (see CLAUDE.md §6).

| File | Contents |
|---|---|
| `CASCADE-app/lib/schemas/network.ts` | `Node`, `Edge`, `Canvas`, `Graph`, `Project`, `GraphSnapshot`, `AnyUpdateEntry`, `ScorecardEntry` |
| `CASCADE-app/lib/schemas/config.ts` | `ModelConfiguration`, `FunctionalityScaleLevel`, `CategoryDefinition`, `EventDefinition`, `GraphTypeConfig`, `HeuristicConfig` |
| `CASCADE-app/lib/schemas/api.ts` | `PropagationRequest`, `PropagationResult`, `ElementUpdate`, sync types |
| `CASCADE-app/lib/schemas/primitives.ts` | Shared primitive schemas |
| `CASCADE-app/lib/schemas/audit.ts` | Audit log types |
| `CASCADE-app/shared/schemas/` | Generated JSON Schema bridge files (do not edit manually) |
| `CASCADE-backend/schemas/network.py` | Pydantic equivalents: `Node`, `Edge`, `Canvas`, `Project`, `ScorecardEntry` |
| `CASCADE-backend/schemas/config.py` | Pydantic equivalent of `ModelConfiguration` |
| `CASCADE-backend/schemas/results.py` | `PropagationRequest`, `PropagationResult`, `ElementUpdate`, sync models |
| `CASCADE-backend/schemas/engine.py` | `EngineAlgorithms`, `HeuristicMeta`, `GraphTypeMeta` — returned by `GET /api/engine/algorithms` |
| `CASCADE-backend/schemas/auth.py` | `AuthUser`, `TokenPair` |

### Geo Visualization — MapLibre GL JS

A georeferenced Canvas renders a MapLibre map as a **non-interactive background behind React Flow**, locked to the React Flow viewport. The nodes stay React Flow nodes; the map sits underneath and tracks every pan/zoom.

- **`components/geo/geo-map-background.tsx`** — owns the MapLibre lifecycle (init, tile-style swap, interaction toggle, resize) and the setup/synced UI (style picker, "Set anchor", crosshair, debug overlay). In *setup* mode the map is fully interactive so the user can navigate and drop a **GeoAnchor**; in *synced* mode interaction is disabled and the map follows the viewport.
- **`hooks/useMapViewportSync.ts`** — the viewport-sync seam. Mirrors React Flow's transform onto the map container every frame (GPU compositor, zero lag) and reloads sharp tiles via `map.jumpTo()` only when a gesture ends. Returns `invalidate()` for style swaps.
- **`lib/geo-utils.ts`** — the **GeoAnchor projection**: exact Web Mercator (`anchorFlowToGeo`, `anchorGeoToFlow`, `computeMapTarget`). One seam converts flow ↔ geo, so `node.geo`-on-drag and the map camera can never use disagreeing projections. See CONTEXT.md → *GeoAnchor*.

A node carries both `position` (flow) and `geo` (lng/lat); see CONTEXT.md → *Node Position vs Geo Coordinates*. The GeoAnchor is the single per-Canvas correspondence tying the two.

### Offline Capability

Editing, Event application, rule authoring, topological analysis, manual Functionality edits, and Scorecard entry authoring work fully offline. The server is only needed for Propagation and optional sync.

---

## Server Architecture

### Stateless Compute Model

The server accepts a JSON payload (project + config + scope), runs the propagation engine, and returns results. It holds no session state, and the network is never persisted (ADR-0007) unless the user has enabled server sync.

**One exception to statelessness:** the per-user Entitlement meter (the engine-evaluation token bucket, ADR-0008) is mutable state. In v1 it lives in-process, which assumes a **single backend instance** — the default for the single-VM deployment. Horizontal scaling (multiple backend instances) would require externalising the meter to PostgreSQL; until then, the "run multiple instances" note under *Scaling* is deferred.

### Global Unhandled-Exception Middleware

`main.py` registers a `BaseHTTPMiddleware` that catches any exception a route doesn't handle itself and returns a plain `500 {"detail": "Internal server error."}`. This is **not** done via `@app.exception_handler(Exception)` — Starlette special-cases a handler keyed on `Exception`/`500` to run inside `ServerErrorMiddleware`, which is the outermost layer, added above every user middleware including CORS; its response bypasses `CORSMiddleware` entirely, so the client gets a 500 with no `Access-Control-Allow-Origin` header. A browser's `fetch()` then rejects with a network-level *"Failed to fetch"*, hiding the real status and body — this is exactly what happened for `.inp` imports before the fix (see ADR-0012's `FLOW_UNIT_SCALE` note for the underlying import bug; this middleware would have kept the error diagnosable for the client regardless).

The fix: register the middleware via `app.add_middleware()` **before** `CORSMiddleware`. Since `add_middleware` prepends to the middleware list, adding it first places it *inside* (closer to the router than) `CORSMiddleware` once both are registered — so the 500 response it builds still passes through `CORSMiddleware`'s `send` wrapper on the way out and gets CORS headers like any other response. Order matters here; do not reorder these two `add_middleware` calls. Regression test: `test/test_error_handling.py`.

### Engine Capabilities Endpoint

`GET /api/engine/algorithms` returns an `EngineAlgorithms` snapshot listing available graph types and heuristics with their parameter schemas. The frontend uses this to populate the graph-type selector and the algorithm pipeline editor in the Config modal. Requires at minimum `viewer` role. Returns `HeuristicMeta.param_schema` fragments so the frontend can render typed parameter forms instead of raw JSON textareas (Slice 1 uses raw JSON as a fallback when this endpoint is unreachable).

### Engine Isolation

The propagation algorithm lives in `CASCADE-backend/engine/`, a dedicated Python package. It is **published openly for now** (it ships with the paper) and becomes **proprietary later**, after refinement through company collaboration (ADR-0009). The isolation below is therefore not about secrecy today — it keeps the engine a single extractable package so future privatization is a one-step operation:

- **Exposed** to clients only through `PropagationResult` — never as source in the client bundle.
- **Imported only** by `CASCADE-backend/services/propagation_service.py` (the single seam for a future private submodule/service split — ADR-0008).

The `CASCADE-backend/core/` package contains open, auditable graph logic (rules, analysis, utilities); `CASCADE-backend/engine/` is the algorithm proper.

A Canvas with `graph_type = "epanet"` (ADR-0013) is a deliberate second, non-engine solve path — `services/epanet_solve_service.py` runs a live WNTR/EPANET solve instead of `engine.propagation.run` for that canvas, is engine-import-free by construction, and `propagation_service.py` still does the one engine-touching step (ratio→level quantization, reusing `engine.flow._ratio_to_level`) — so the single-seam property above holds unchanged.

### Authentication & Authorization

Identity is handled via OAuth2/OIDC, using the self-hosted open-source **Zitadel** provider (provider-agnostic in principle — any OIDC IdP works). Signup is self-service; a new user is provisioned in PostgreSQL on first authenticated request with the default `analyst` role (ADR-0010 amendment — `viewer` is the guest/demotion role). The server validates JWT access tokens on every request. RBAC role assignments and per-role **Entitlements** (quotas — see ADR-0008) are stored in PostgreSQL; the role→permission mapping is code-owned (`auth/rbac.py`). Both are enforced through FastAPI dependency injection.

Relevant permissions:

| Permission | Grants |
|---|---|
| `can_propagate` | Call the propagation engine (`POST /api/propagate`) |
| `can_sync` | Store and retrieve project files server-side |
| `can_manage_users` | List users, assign/change roles via admin API |
| `can_admin` | Wildcard — implies all others; guards admin-role escalation/deletion |

### Database — PostgreSQL

The database stores identity and access data (users, roles + entitlements, audit logs) and the per-run Analysis Log (ADR-0007) always. When server sync is enabled for a user, their project versions are stored here too. No project data is stored for users who have not opted in to sync.

---

## Data Flow — Propagation

All Canvases are operationally interdependent — inter-canvas edges exist in the global registry regardless of scope. Scope controls what the client **sends**, not how the engine filters.

1. User builds/edits networks and config locally in the browser.
2. User applies an Event (Hazard or Disservice) client-side: functionality drops, `direct_damage`, `attribute_mutations` are applied to the registry; an `event_applied` entry is pushed to `update_history`.
3. User clicks **Propagate**.
4. The frontend builds a trimmed `PropagationRequest` payload:
   - **Local scope**: includes only the active Canvas's `node_ids` and the edges whose both endpoints are within that Canvas. Inter-canvas edges are physically absent from the payload.
   - **Global scope**: includes the full `Project` — all nodes, all edges, all Canvases.
   - Both scopes strip engine-irrelevant bookkeeping (`update_history`, `scorecard`, and `source_inp_content` on non-EPANET canvases) — history snapshots and Scorecard PNGs would otherwise blow past the edge's 10MB body cap.
5. `api-client` sends `POST /api/propagate` with the payload and the user's JWT.
6. The server validates the token and checks `can_propagate`.
7. `propagation_service` passes the validated payload to `engine.propagation`.
8. The engine computes `PropagationResult` — an `ElementUpdate` list with updated `functionality`, `functionality_time`, `direct_damage`, `responsibility_share` — and returns it.
9. The server responds with the `PropagationResult` JSON body.
10. The frontend merges the updates into the **global registry** (by element ID) and pushes a `propagation` entry to `update_history`.

No project data is persisted on the server during this flow unless the user has enabled sync.

---

## Repository Layout

```
CASCADE-v2/
├── CASCADE-app/                # Next.js frontend
│   ├── app/                    # App Router pages (layout, page)
│   ├── components/             # React components by domain
│   │   ├── analysis/           # Centrality, timeline, model-based tools
│   │   ├── auth/               # User button, anonymous banner
│   │   ├── canvas/             # Topbar, Action Bar, Flow Canvas, Status Bar
│   │   │   └── inspector/      # Inspector panel — split by selection mode
│   │   │       ├── index.tsx           # Thin dispatch root (routes to sub-panels)
│   │   │       ├── node-inspector.tsx  # Single-node panel
│   │   │       ├── edge-inspector.tsx  # Single-edge panel
│   │   │       ├── canvas-meta.tsx     # Canvas/All-Canvases meta (nothing selected)
│   │   │       ├── multi-select-panel.tsx # Batch editing panel
│   │   │       ├── canvas-membership.tsx  # Shared canvas copy/move section
│   │   │       ├── cause-banner.tsx    # Compromised-element cause banner
│   │   │       ├── editors.tsx         # RulesEditor, PropertiesEditor
│   │   │       └── primitives.tsx      # Section, Field, TextInput, NumberInput, Toggle…
│   │   ├── controls/           # Category panel, config override, file I/O
│   │   │   └── config-modal/   # ModelConfiguration modal — split by tab
│   │   │       ├── index.tsx              # Thin shell (draft lifecycle, tab bar, footer)
│   │   │       ├── primitives.tsx         # TextInput, NumberInput, ColBtn, CollapsibleSection
│   │   │       ├── icon-picker.tsx        # IconPickerButton + module-level icon cache
│   │   │       ├── event-editors.tsx      # DirectDamageEditor, VulnerabilityLevelsEditor, AttributeMutationsEditor
│   │   │       ├── tab-functionality-scale.tsx
│   │   │       ├── tab-categories.tsx     # TabCategories + CategoryRow
│   │   │       ├── tab-events.tsx
│   │   │       ├── tab-graph-types.tsx
│   │   │       └── tab-node-defaults.tsx
│   │   ├── geo/                # MapLibre background behind React Flow (geo-map-background)
│   │   ├── onboarding/         # New Project Wizard
│   │   ├── rules/              # Rule editor, autocomplete, active rules panel
│   │   └── scorecard/          # Scorecard panels
│   ├── hooks/                  # Custom React hooks
│   │   ├── useHistoryAction.ts # Snapshot-wrap-push hook for undoable mutations
│   ├── lib/
│   │   ├── schemas/            # Zod schemas (network, config, api, primitives, audit)
│   │   └── …                   # Utilities, API client, rule parser, file I/O
│   ├── shared/
│   │   ├── schemas/            # Generated JSON Schema bridge files (do not edit manually)
│   │   └── rule-grammar.json   # Rule DSL grammar spec — shared seam (functions, operators, attributes, disabled prefix)
│   └── store/                  # Zustand stores (canvas, network, config, clipboard, auth, ui)
├── CASCADE-backend/            # FastAPI backend
│   ├── api/                    # Route handlers
│   ├── auth/                   # OAuth2/OIDC + RBAC
│   ├── core/                   # Open graph/rule logic
│   │   └── rule_grammar.py     # Python adapter: loads rule-grammar.json, exports typed constants
│   ├── engine/                 # PRIVATE propagation algorithm
│   ├── schemas/                # Pydantic models (network, config, results, engine, auth)
│   ├── services/               # Business logic orchestration
│   └── db/                     # PostgreSQL schema (users/roles + opt. project files)
├── docs/                       # Workspace-level docs and ADRs
├── CONTEXT.md                  # Domain glossary and resolved ambiguities
└── CLAUDE.md                   # AI-assisted development guidelines
```

---

## Technology Stack

| Layer | Technology | Version | Purpose |
|---|---|---|---|
| UI Framework | Next.js | 16 | App Router, server/static rendering |
| Canvas | React Flow (`@xyflow/react`) | 12 | Interactive graph editor |
| State | Zustand + Immer | 5 / 11 | Lightweight, immutable stores |
| Styling | Tailwind CSS | 4 | Utility-first design system |
| Validation | Zod | 4 | Runtime schema validation, type inference |
| Maps | MapLibre GL JS | 5 | Open-source map background for georeferenced Canvases |
| API Server | FastAPI | — | High-performance async Python API |
| Backend validation | Pydantic v2 | — | Request/response schema enforcement |
| Auth | OAuth2/OIDC (provider-agnostic) | — | Identity, JWT validation |
| Database | PostgreSQL | — | Users, roles, permissions; opt. project sync |
| Engine | Python (isolated package) | — | Propagation algorithm (public now, proprietary later — ADR-0009) |
