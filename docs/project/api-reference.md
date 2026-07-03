# API Reference

Base URL: `http://localhost:8000` (configure via `NEXT_PUBLIC_API_URL` on the frontend, `HOST`/`PORT` on the backend).

Interactive documentation is always available at **`/api/docs`** (Swagger UI) and **`/api/redoc`** — generated from the same Pydantic models described here. This file is the narrative companion: what each endpoint is for, who may call it, and what to watch out for.

## Authentication model

Two modes, selected by configuration (see `CASCADE-backend/config.py`):

- **Local-only mode** (default): no OIDC env vars set. Every request is treated as a synthetic admin user — no token required. This is for single-user desktop use only. The server **refuses to start** with `ENV=production` in this mode.
- **OIDC mode**: `OIDC_DISCOVERY_URL` + `OIDC_CLIENT_ID` set. Endpoints require an `Authorization: Bearer <JWT>` header. The token proves *identity* only; the user's **role is read from the app database** (ADR-0010), where a new user is upserted as `viewer` on first authenticated request. Access-token validation checks signature, `aud`, and `iss`. Email verification is enforced once, at login: the `/callback` exchange validates the returned **id token** (which, unlike the access token, carries `email_verified`) and rejects an account whose email is unverified. JWKS keys are cached with a 1-hour TTL and refetched on an unknown `kid` (IdP key rotation).

Permissions per role are defined **in code** — `CASCADE-backend/auth/rbac.py` is the single source of truth (the former `role_permissions` table was dropped in migration 004):

| Role | Permissions |
| --- | --- |
| `viewer` | `can_view_analysis` |
| `analyst` | `can_propagate`, `can_view_analysis`, `can_sync` |
| `manager` | analyst + `can_manage_users` |
| `admin` | `can_admin` (wildcard — implies all) |

Each role also carries an **Entitlement** (ADR-0008): `max_nodes` and `evals_per_minute`, stored on the `roles` table and enforced before the engine runs.

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

Every successful run appends one row to the **Analysis Log** (`analysis_logs` table, ADR-0007): input shape + run metadata only — node/edge/canvas counts, category names, scale N, event/rule counts, graph types, scope, engine version, compute time, caller's user id and role. Never the network itself. Best-effort: a log failure never fails the run.

Errors:

| Status | Cause |
| --- | --- |
| `413` | Network exceeds the role's `max_nodes` Entitlement. |
| `429` | Per-user engine-evaluation budget exhausted (token bucket, `Retry-After: 5`). |
| `422` | Invalid scope/canvas (`ValueError` from scope filtering). |
| `503` | All engine workers occupied (e.g. by threads still wedged on timed-out runs); the run is rejected without queueing (`Retry-After: 5`). |
| `504` | Engine exceeded the 30 s wall-clock cap (`ENGINE_TIMEOUT_SECONDS`). |
| `500` | Engine failure (details only in server logs, never in the response). |

### `GET /api/engine/algorithms` — any authenticated user

Read-only metadata about the engine's graph types and heuristics (`EngineAlgorithms`). Used by the Config modal to render the algorithm pipeline editor. Static snapshot — does not inspect the running engine.

---

## Auth

### `GET /api/auth/config`

**Unauthenticated.** Returns `{ auth_enabled }` so a fresh/guest browser can discover whether sign-in exists before having a token.

### `GET /api/auth/me`

Returns the current user (`sub`, `email`, `display_name`, `roles`) plus `auth_enabled`, so the frontend can tell local-only mode from a real session.

### `DELETE /api/auth/me`

Self-service GDPR erasure. Deletes the identity in Zitadel **first** (via `ZITADEL_MGMT_URL`/`ZITADEL_MGMT_TOKEN`; aborts with `502` if that fails so erasure stays all-or-nothing), then removes the app record and appends an `account_delete` audit entry. `204` on success.

### `GET /api/auth/login?state=…`

Redirects to the OIDC provider's authorization page, forwarding the client-generated `state` (anti-CSRF: the frontend stores it in `sessionStorage` and the callback page rejects a mismatch). `501` in local-only mode.

### `GET /api/auth/callback?code=…`

Exchanges the authorization code for tokens and returns `{ access_token, refresh_token, expires_in, token_type }` (`refresh_token`/`expires_in` may be `null` if the IdP omits them). `501` in local-only mode; `403` if the id token's email is unverified. (The `state` round-trip is validated client-side on the callback page, which fails **closed** — a missing stored state is rejected, not accepted; the IdP echoes it in the redirect.)

### `POST /api/auth/refresh`

Body `{ refresh_token }`. Returns a fresh token set, or `401` when the refresh token is invalid/expired (client must re-login).

---

## Admin — require `can_manage_users`

Fully implemented against the `users` table (ADR-0010).

| Endpoint | Behaviour |
| --- | --- |
| `GET /api/admin/users` | List users (id, email, display name, role). |
| `PATCH /api/admin/users/{id}/role` | Assign a role. Validates the role name. Granting **or removing** `admin` requires `can_admin` (escalation guard). Audited (`role_change`). |
| `DELETE /api/admin/users/{id}` | Account erasure: Zitadel first, then app record (same all-or-nothing rule as self-deletion). Deleting an `admin` requires `can_admin`. Audited (`account_delete`). `204`. |
| `GET /api/admin/roles` | Lists the built-in roles and their permissions (live from `rbac.py`). |

---

## Audit — requires `can_sync`

### `POST /api/audit/activity`

Accepts a batch (max 1 000 entries) of client-side activity-log entries — action metadata only (type, timestamps, counts), never raw graph data. Stored in `activity_log_uploads` keyed by the caller's user id and session. Each entry's `id`/`session_id` must be a valid UUID and `app_version` at most 50 chars — malformed input is rejected as `422` at the boundary (never reaches the DB). Returns `202` with `{ ok, accepted }`; `501` in local-only mode (no database).

---

## Not implemented (by design, yet)

Batch propagation (`POST /api/propagate/batch`) and server-side project sync (`/api/projects`) appear in older planning documents but have **no endpoints and no schemas** — the speculative schema definitions were removed. Re-derive them from Pydantic when the feature is actually built (requirements §16).
