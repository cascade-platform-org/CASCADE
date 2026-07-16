# API Reference

Base URL: `http://localhost:8000` (configure via `NEXT_PUBLIC_API_URL` on the frontend, `HOST`/`PORT` on the backend).

Interactive documentation is always available at **`/api/docs`** (Swagger UI) and **`/api/redoc`** — generated from the same Pydantic models described here. This file is the narrative companion: what each endpoint is for, who may call it, and what to watch out for.

## Authentication model

Two modes, selected by configuration (see `CASCADE-backend/config.py`):

- **Local-only mode** (default): no OIDC env vars set. Every request is treated as a synthetic admin user — no token required. This is for single-user desktop use only. The server **refuses to start** with `ENV=production` in this mode.
- **OIDC mode**: `OIDC_DISCOVERY_URL` + `OIDC_CLIENT_ID` set. Endpoints require an `Authorization: Bearer <JWT>` header. The token proves *identity* only; the user's **role is read from the app database** (ADR-0010), where a new user is upserted as `analyst` on first authenticated request (ADR-0010 amendment; `viewer` is the guest/demotion role). Access-token validation checks signature, `aud`, and `iss`. Email verification is enforced once, at login: the `/callback` exchange validates the returned **id token** (which, unlike the access token, carries `email_verified`) and rejects an account whose email is unverified. JWKS keys are cached with a 1-hour TTL and refetched on an unknown `kid` (IdP key rotation).

Permissions per role are defined **in code** — `CASCADE-backend/auth/rbac.py` is the single source of truth (the former `role_permissions` table was dropped in migration 004):

| Role | Permissions |
| --- | --- |
| `viewer` | none — guest-preview/demotion role; plain-authenticated endpoints only |
| `analyst` | `can_propagate`, `can_sync` |
| `manager` | analyst + `can_manage_users` |
| `admin` | `can_admin` (wildcard — implies all) |

Every permission is enforced by at least one endpoint; a permission with no endpoint to guard is not declared (client-side analysis needs none).

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

#### EPANET-mode canvas (`graph.graph_type == "epanet"`, ADR-0013)

When the active (local-scope) canvas's `graph_type` is the reserved value
`"epanet"`, this same endpoint runs a live WNTR/EPANET solve against
`Canvas.source_inp_content` (the original `.inp` file's text, embedded on the
canvas at import time and shipped inside the request's own project payload)
instead of the engine, returning the identical `PropagationResult` shape.
`ElementUpdate.responsibility_share` is always absent for these updates (no
causal chain — the engine's pipeline is bypassed entirely). `warnings` may
additionally list elements that could not be represented in the EPANET solve
(any element without a `properties.inp_id` round-trip to the original `.inp`
file, prefixed `"Not reflected in this EPANET solve: ..."`).

Additional error case for this path: `422` if `source_inp_content` is unset
(a canvas imported before this feature existed) or fails to parse — see
ADR-0013. Global-scope propagation ignores this graph_type and always uses
the normal engine (no live-EPANET equivalent for composing multiple graph
types).

### `GET /api/engine/algorithms` — any authenticated user

Read-only metadata about the engine's graph types and heuristics (`EngineAlgorithms`). Used by the Config modal to render the algorithm pipeline editor. Static snapshot — does not inspect the running engine.

The `source-to-demands-flow` heuristic advertises the one engine-consumed
param so far: `allocation` (enum `tiered_fair_share` — the default — or
`priority_greedy`), the flow pass's scarcity-sharing strategy per graph type
(ADR-0014). Set it on the matching `GraphTypeConfig.heuristics` entry in the
model configuration; Propagation resolves it from the request's canvases.

---

## Auth

### `GET /api/auth/config`

**Unauthenticated.** Returns `{ auth_enabled }` so a fresh/guest browser can discover whether sign-in exists before having a token.

### `GET /api/auth/me`

Returns the current user (`sub`, `email`, `display_name`, `roles`, `permissions`) plus `auth_enabled`, so the frontend can tell local-only mode from a real session. `permissions` is the effective (wildcard-expanded) set computed by `auth/rbac.py` — the client gates UI by membership in this list and never maps roles to permissions itself.

### `DELETE /api/auth/me`

Self-service GDPR erasure. Deletes the identity in Zitadel **first** (via `ZITADEL_MGMT_URL`/`ZITADEL_MGMT_TOKEN`; aborts with `502` if that fails so erasure stays all-or-nothing), then removes the app record and appends an `account_delete` audit entry. `204` on success.

### `GET /api/auth/login?state=…&code_challenge=…&code_challenge_method=S256`

Redirects to the OIDC provider's authorization page, forwarding the client-generated `state` (anti-CSRF: the frontend stores it in `sessionStorage` and the callback page rejects a mismatch) and the PKCE (RFC 7636) `code_challenge`. `501` in local-only mode.

This app is a **public OIDC client** (no `client_secret`): PKCE proves the browser session that requests the token exchange is the one that started this authorize request, replacing a shared static secret. The frontend generates a random `code_verifier`, derives `code_challenge = BASE64URL(SHA256(code_verifier))`, stashes the verifier in `sessionStorage`, and sends only the challenge here.

### `GET /api/auth/callback?code=…&code_verifier=…`

Exchanges the authorization code (sending the PKCE `code_verifier` instead of a `client_secret`), then **sets the session as httpOnly cookies** — `cascade_access` (path `/api`) and `cascade_refresh` (path `/api/auth/refresh`) — and returns `{ "ok": true }`. Tokens never appear in a response body, so page JavaScript (and any XSS running as it) cannot read them; `SameSite=Lax` keeps cross-site non-GET requests from carrying them (CSRF). Also persists the id token's `email`/`name` claims to the user row (the access token carries no profile claims). `501` in local-only mode; `403` if the id token's email is not explicitly verified (an absent `email_verified` claim is rejected too — fail closed). (The `state` round-trip is validated client-side on the callback page, which fails **closed** — a missing stored state or verifier is rejected, not accepted.)

`OIDC_CLIENT_SECRET` is optional: if set (a confidential-client IdP registration), it's sent alongside `client_id` on every token-endpoint call; if unset (the default, PKCE), only `client_id` + `code_verifier`/`refresh_token` are sent.

### `POST /api/auth/logout`

Clears the session cookies and returns `{ "logout_url": <IdP end_session URL or null> }`. The frontend must navigate to `logout_url` (RP-initiated logout): clearing cookies alone leaves the Zitadel SSO session alive, and the next sign-in would silently re-authenticate the same account.

### `POST /api/auth/refresh`

No body — the refresh token rides in the `cascade_refresh` httpOnly cookie. Rotates both session cookies and returns `{ "ok": true }`, or `401` when the refresh session is missing/expired (client must re-login).

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

## Server Sync — requires `can_sync` (requirements.md §13.4)

Owner-scoped: every route below only ever sees the caller's own saved versions, never another user's — not even an admin's. `501` in local-only mode (no database). Each save is a **new version**, never an overwrite; up to 10 versions are kept per project `name`, older ones pruned automatically on the next save for that name (mirrors the local save-history cap in `lib/file-io.ts`).

### `POST /api/projects`

Body `{ name, description?, data: { project, config } }` — `data` is validated against the same `Project`/`ModelConfiguration` Pydantic models the rest of the app uses, so a save can never write something Load would later choke on. Returns the new version's summary `{ id, name, description, created_at, updated_at }` (no bundle data in the response).

### `GET /api/projects`

Lists the caller's saved versions, newest first, as summaries (no bundle data — a version list, not a bulk download).

### `GET /api/projects/{id}`

Full bundle for one version, for Load. `404` (not `403`) if the id doesn't belong to the caller — existence of another user's version is never leaked.

### `DELETE /api/projects/{id}`

Deletes one version. `404` if it doesn't belong to the caller.

---

## Network import — any authenticated user (requirements.md §13.5, ADR-0012)

### `POST /api/import/inp`

Converts an EPANET `.inp` water network into a CASCADE `ProjectBundle`. Pure transformation — nothing persisted, engine never invoked. CPU-bound work (WNTR parse, pressure-driven priority sweep, skeletonization) runs in a worker thread; expect a few seconds on real aqueducts.

Body `{ filename, content, target_nodes?, source_crs?, demand_mode?, derive_priorities?, n_levels? }` — `content` is the raw `.inp` text; `target_nodes` defaults to the caller's Entitlement `max_nodes` (300 for unbounded roles); `source_crs` defaults to `EPSG:3004`; `n_levels` defaults to 3 (functionality scale size — pass the current project's own `functionality_scale.length` when merging the result into an existing project, so imported values land on that scale). Source `supply_capacity` is always the sum of a Reservoir/Tank's outgoing pipe capacities — not a request parameter.

Returns `{ bundle: { project, config }, warnings, original_nodes, imported_nodes, skeleton_threshold_m? }`, serialised null-free (§13.4 contract). `422` with a human-readable detail on unparseable files, unknown CRS, or an unreachable node budget.

---

## Not implemented (by design, yet)

Batch propagation (`POST /api/propagate/batch`) appears in older planning documents but has **no endpoint and no schema** — the speculative schema definition was removed. Re-derive it from Pydantic when the feature is actually built (requirements §16).
