# API Reference

Base URL: `http://localhost:8000` (configure via `NEXT_PUBLIC_API_URL` on the frontend, `HOST`/`PORT` on the backend).

Interactive documentation is always available at **`/api/docs`** (Swagger UI) and **`/api/redoc`** — generated from the same Pydantic models described here. This file is the narrative companion: what each endpoint is for, who may call it, and what to watch out for.

## Authentication model

Two modes, selected by configuration (see `CASCADE-backend/config.py`):

- **Local-only mode** (default): no OIDC env vars set. Every request is treated as a synthetic admin user — no token required. This is for single-user desktop use only. The server **refuses to start** with `ENV=production` in this mode.
- **OIDC mode**: `OIDC_DISCOVERY_URL` + `OIDC_CLIENT_ID` set. Endpoints require an `Authorization: Bearer <JWT>` header; roles are read from the token's `roles` (or `groups`) claim.

Permissions per role are defined in `CASCADE-backend/auth/rbac.py` (mirrored in `db/seed.sql`):

| Role | Permissions |
| --- | --- |
| `viewer` | `can_view_analysis` |
| `analyst` | `can_propagate`, `can_view_analysis`, `can_sync` |
| `manager` | analyst + `can_manage_users` |
| `admin` | `can_admin` (wildcard — implies all) |

---

## Health

### `GET /api/health`

No auth. Returns `{ "status": "healthy", "version": "1.0.0" }`. The frontend pings this (5 s timeout) to decide whether to enable the Propagate button.

---

## Propagation

### `POST /api/propagate` — requires `can_propagate`

Runs the propagation engine. Request body (`PropagationRequest`):

| Field | Type | Notes |
| --- | --- | --- |
| `project` | `Project` | Full project state. Event effects are applied **client-side before** this call — the engine receives the perturbed graph. |
| `config` | `ModelConfiguration` | Functionality scale, categories, heuristic pipelines. |
| `scope` | `"local" \| "global"` | Local = active canvas only; the client already trims the payload, the server filters again (defence in depth). |
| `active_canvas_id` | `string?` | Required when `scope = "local"`. |

Response (`PropagationResult`): `scope`, `updates: ElementUpdate[]` (deltas only — elements that changed), `computed_at`, `iterations`, `warnings: string[]` (e.g. `"convergence not reached"`).

`ElementUpdate.responsibility_share` values are in `(0, 1]` and sum to 1; zero shares are never emitted.

Errors: `422` for invalid scope/canvas (`ValueError` from scope filtering), `500` for engine failures (details only in server logs, never in the response).

### `GET /api/engine/algorithms` — any authenticated user

Read-only metadata about the engine's graph types and heuristics (`EngineAlgorithms`). Used by the Config modal to render the algorithm pipeline editor. Static snapshot — does not inspect the running engine.

---

## Auth

### `GET /api/auth/me`

Returns the current user (`sub`, `email`, `display_name`, `roles`) plus `auth_enabled`, so the frontend can tell local-only mode from a real session.

### `GET /api/auth/login`

Redirects to the OIDC provider's authorization page. `501` in local-only mode.

### `GET /api/auth/callback?code=…`

Exchanges the authorization code for tokens and returns `{ access_token, refresh_token, expires_in, token_type }`. `501` in local-only mode.

> ⚠️ **Hardening before production**: this flow does not yet implement the `state` parameter or PKCE, and the JWT validation does not yet check the `iss` claim or refresh cached JWKS keys. Tracked as a pre-deployment requirement — do not expose the OIDC flow publicly until addressed.

---

## Admin — require `can_manage_users`

Stubs until a database is connected: they validate input and permissions but return empty lists or `501`.

| Endpoint | Behaviour |
| --- | --- |
| `GET /api/admin/users` | List users. Currently returns `[]`. |
| `PATCH /api/admin/users/{id}/role` | Assign a role. Validates the role name, then `501`. |
| `GET /api/admin/roles` | Lists the built-in roles and their permissions (live from `rbac.py`). |

---

## Audit — requires `can_sync`

### `POST /api/audit/activity`

Accepts a batch (max 1 000 entries) of client-side activity-log entries — action metadata only (type, timestamps, counts), never raw graph data. Returns `202` with `{ ok, accepted }`. Server-side storage is a TODO until the database is connected.

---

## Not implemented (by design, yet)

Batch propagation (`POST /api/propagate/batch`) and server-side project sync (`/api/projects`) appear in older planning documents but have **no endpoints and no schemas** — the speculative schema definitions were removed. Re-derive them from Pydantic when the feature is actually built (requirements §16).
