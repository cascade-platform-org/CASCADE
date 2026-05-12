# Architecture Overview

## Design Philosophy

CASCADE follows a **local-first** architecture. All project data — graphs, rules, configurations, canvas state — lives on the client as JSON files. The user owns their data, can work offline, and decides when (and whether) to interact with the server.

The server has two core responsibilities:

1. **Execute the proprietary propagation engine** on submitted payloads.
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
│  │ network       │  │          │  │ + versioned    │  │
│  │ canvas        │  └──────────┘  │   auto-save    │  │
│  │ config        │                └────────────────┘  │
│  │ auth / ui     │  ┌──────────────────────────────┐  │
│  └──────────────┘  │ Next.js App Router            │  │
│                     │ Canvas Manager · Editors      │  │
│                     │ Rules · Hazards · Scorecard   │  │
│                     └────────────┬─────────────────┘  │
└──────────────────────────────────┼────────────────────┘
                                   │ HTTPS (JSON payloads)
                                   ▼
┌──────────────────────────────────────────────────────┐
│                   SERVER (FastAPI)                    │
│                                                      │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ API Routes │  │ Auth / RBAC  │  │ Simulation   │  │
│  │ /simulate  │  │ OAuth2/OIDC  │  │ Service      │  │
│  │ /timeline  │  │ Role guards  │  │              │  │
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

The core modelling primitive is a **network of networks**: multiple graph canvases, each representing an independent infrastructure layer (water, electricity, ICT, …), connected by inter-canvas edges.

- Each canvas can be independently **georeferenced** (MapLibre) or abstract (force-layout).
- **Inter-canvas edges** model cross-layer dependencies (e.g. a water pumping station depending on a power substation on the electricity canvas).
- Simulation scope is selectable: **Local** (single canvas, inter-canvas edges ignored) or **Global** (all canvases merged for propagation).
- An **auto-merge** utility collapses all canvases into a single unified graph. Same-ID nodes and edges are merged; attribute conflicts are flagged for manual resolution.

---

## Client Architecture

### State Management — Zustand

All application state is managed through five Zustand stores, each serializable to/from JSON:

- **`network-store`** — nodes and edges for each canvas, selection state, visual properties.
- **`canvas-store`** — canvas list, active canvas, inter-canvas edges, merge state.
- **`config-store`** — functionality scale, category definitions, rules, hazard definitions.
- **`auth-store`** — OAuth2 tokens, user profile, current role.
- **`ui-store`** — panel visibility, theme, simulation scope, layout preferences.

The stores are the single source of truth. Components subscribe to slices they need.

### Data Persistence — File I/O and Version History

Persistence is explicit and versioned:

- **Auto-save** — continuous background save to `localStorage` (safety net). Discarded when an explicit save is made.
- **Explicit save** — serializes all stores to a `.json` file (browser download or server sync upload). Up to 10 previous explicit saves are retained in version history; older ones are discarded.
- **Load** — accepts a `.json` file, validates the schema, hydrates the stores.

Multi-canvas projects are serialized under a `canvases` array with a top-level `inter_canvas_edges` array.

### Server Sync (opt-in)

When enabled, explicit saves are also pushed to `POST /api/sync/save`. The version list is accessible across devices via `GET /api/sync/versions`. Requires the `can_sync` RBAC permission.

### Type System

All shared data shapes are defined once and used by both the frontend and backend. The TypeScript types in `app/lib/types/` are the human-facing contract; the Pydantic models in `backend/schemas/` are the machine-enforced equivalent.

| File | Contents |
|---|---|
| `app/lib/types/primitives.ts` | Branded aliases: `ElementId`, `Hours`, `ISOTimestamp`, `FunctionalityLevel`, `NodeType`, etc. |
| `app/lib/types/config.ts` | `ProjectConfig`, `HazardDefinition`, `RuleDefinition`, `AttributeMutations` |
| `app/lib/types/graph.ts` | `Node`, `Edge`, `InterCanvasEdge`, `Canvas`, `Project`, `DirectCause`, `GeoCoords` |
| `app/lib/types/api.ts` | `PropagationRequest/Result`, `ElementUpdate`, `AuthUser`, `TokenPair`, sync types, `ApiResponse<T>` |
| `app/lib/types/simulation.ts` | Timeline and intervention types — deferred for deeper design |
| `backend/schemas/network.py` | Pydantic equivalents of `Node`, `Edge`, `InterCanvasEdge`, `Canvas`, `Project` |
| `backend/schemas/config.py` | Pydantic equivalent of `ProjectConfig` and its nested types |
| `backend/schemas/results.py` | `PropagationRequest`, `PropagationResult`, `ElementUpdate`, sync models |
| `backend/schemas/auth.py` | `AuthUser`, `TokenPair` |

`app/lib/types/index.ts` re-exports everything so callers import from a single entry point.

### Geo Visualization — MapLibre GL JS

Network nodes with geographic coordinates render on an interactive map. The `components/geo/` folder contains the map view, layer controls, and coordinate utilities. MapLibre is free and open-source.

### Offline Capability

Editing, analysis, hazard application, temporal simulation, and scorecard computation work fully offline. The server is only needed for propagation simulation and optional sync.

---

## Server Architecture

### Stateless Compute Model

The server accepts a JSON payload (project + config), runs the propagation engine, and returns results. It holds no session state. Project data is stored only when the user has enabled server sync.

### Engine Isolation

The proprietary propagation algorithm lives in `backend/engine/`, a dedicated Python package that is:

- **Not published** to any package registry.
- **Not exposed** through any API schema or client bundle.
- **Imported only** by `backend/services/simulation_service.py`.

The `core/` package contains open, auditable graph logic (rules, analysis, utilities). The `engine/` package contains the protected IP.

### Authentication & Authorization

Identity is handled via OAuth2/OIDC (provider-agnostic: Keycloak or any compliant IdP). The server validates JWT access tokens on every request. RBAC policies are stored in PostgreSQL and enforced through FastAPI dependency injection.

Relevant permissions:

| Permission | Grants |
|---|---|
| `can_simulate` | Call the propagation engine |
| `can_sync` | Store and retrieve project files server-side |
| `can_admin` | Manage users and roles |

### Database — PostgreSQL

The database stores identity and access data (users, roles, permissions, audit logs) always. When server sync is enabled for a user, their project versions are stored here too. No project data is stored for users who have not opted in to sync.

---

## Data Flow — Simulation Request

1. User builds/edits networks and config locally in the browser.
2. User clicks "Run Simulation."
3. The frontend applies hazard effects locally (functionality drops, `direct_damage`, `attribute_mutations`) and serializes the modified graph state into a `PropagationRequest` JSON payload (project + config + scope).
4. The `api-client` sends `POST /api/simulate` with the payload and the user's JWT.
5. The server validates the token and checks `can_simulate`.
6. `simulation_service` passes the validated payload to `engine.propagation`.
7. The engine computes propagation results (`ElementUpdate` list with updated `functionality` and `direct_causes`) and returns them.
8. The server responds with a `PropagationResult` JSON body.
9. The frontend merges the `updates` into the stores and updates the visualization.

No project data is persisted on the server during this flow unless the user has enabled sync.

---

## Repository Layout

```
propagation-platform/
├── app/                        # Next.js frontend
│   ├── app/                    # App Router pages & API routes
│   ├── components/             # React components by domain
│   │   ├── analysis/           # Centrality, timeline, model-based tools
│   │   ├── auth/               # Login, user button, anonymous banner
│   │   ├── canvas/             # Canvas manager, tab switcher
│   │   ├── controls/           # Category panel, config override, file I/O
│   │   ├── editors/            # Node editor, edge editor
│   │   ├── geo/                # MapLibre map view, layer controls
│   │   ├── hazards/            # Hazard & disservice panel
│   │   ├── network/            # Graph visualization, tooltips, add-edge dialog
│   │   ├── rules/              # Rule editor, autocomplete
│   │   └── scorecard/          # Scorecard panels
│   ├── hooks/                  # Custom React hooks
│   ├── lib/                    # Types, utilities, API client, rule parser
│   └── store/                  # Zustand stores (network, canvas, config, auth, ui)
├── backend/                    # FastAPI backend
│   ├── api/                    # Route handlers
│   ├── auth/                   # OAuth2/OIDC + RBAC
│   ├── core/                   # Open graph/rule logic
│   ├── engine/                 # PRIVATE propagation algorithm
│   ├── schemas/                # Pydantic models
│   ├── services/               # Business logic orchestration
│   └── db/                     # PostgreSQL schema (users/roles + opt. project files)
├── samples/                    # Example networks & configs
├── docs/                       # Documentation
└── docker-compose.yml
```

---

## Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| UI Framework | Next.js 14 (App Router) | Server/static rendering, routing |
| State | Zustand | Lightweight, serializable stores |
| Styling | Tailwind CSS + shadcn/ui | Utility-first design system |
| Maps | MapLibre GL JS | Open-source geo visualization |
| API Server | FastAPI | High-performance async Python API |
| Validation | Pydantic v2 | Request/response schema enforcement |
| Auth | OAuth2/OIDC (provider-agnostic) | Identity, JWT validation |
| Database | PostgreSQL | Users, roles, permissions; opt. project sync |
| Engine | Python (private module) | Proprietary propagation algorithm |
