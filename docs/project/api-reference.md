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

### `GET /metrics`

Prometheus exposition (request counts, latency). Deliberately **not** under
`/api`, so Caddy never proxies it to the internet — scrape it from inside the
Docker network. Absent from the OpenAPI schema.

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

### `POST /api/propagate/batch` — requires `can_propagate`

One Project, many Scenarios, one round trip. Exists because the model-based
Analysis Metrics evaluate hundreds of coalitions over an **unchanged** Project;
sending it once per coalition dominated a run's cost (a 39-node network at the
default settings: 1,297 requests re-sending the same ~49 KB payload, measured
down to 26).

Request body (`BatchPropagationRequest`) is `PropagationRequest` plus:

| Field | Type | Notes |
| --- | --- | --- |
| `coalitions` | `string[][]` | 1–50 lists of Element ids (nodes or edges) to drive to Functionality 1 before propagating. `[]` is the untouched baseline. Ids absent from the Project are ignored. |

Response (`BatchPropagationResult`): `{ results: PropagationResult[] }`, **positionally aligned** with `coalitions` — `results[i]` is the Propagation of `coalitions[i]`. Callers index by position, so results are never reordered or deduplicated.

Three properties the implementation guarantees, each with a test:

- **Not a second propagation path.** Every coalition goes through the same `propagate()` a single run uses, EPANET branch and timeout included, so a batched result is identical to the same Scenario sent alone.
- **Each coalition starts from the untouched Project.** Damage never accumulates across the batch.
- **Charged one engine evaluation per coalition** (ADR-0008). Charging a batch as one request would turn the budget into a request limit over unbounded compute — the exact failure that ADR exists to prevent.

Sequential server-side, deliberately: the engine already owns a bounded worker pool, and letting one request occupy all of it would starve other users for the length of an Analysis run. This endpoint removes transport cost, not the engine's concurrency limits.

Errors are the single endpoint's, plus `422` when `coalitions` is empty or longer than 50 (the caller chunks — that cap is what keeps progress reporting and cancellation responsive).

Unlike `POST /api/propagate`, this route writes **no** Analysis Log row: one user-initiated Analysis run needs hundreds of Scenarios, and logging each would bury every real entry. Its cost remains visible in the entitlement budget.

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

**Unauthenticated.** Returns `{ auth_enabled, google_login }` so a fresh/guest browser can discover whether sign-in exists before having a token, and which shortcuts to offer. `google_login` is a **boolean** — the Zitadel IdP id behind it (`OIDC_GOOGLE_IDP_ID`) stays server-side, so a client can request the Google shortcut but cannot point a login at an arbitrary provider.

### `GET /api/auth/me`

Returns the current user (`sub`, `email`, `display_name`, `roles`, `permissions`) plus `auth_enabled`, so the frontend can tell local-only mode from a real session. `permissions` is the effective (wildcard-expanded) set computed by `auth/rbac.py` — the client gates UI by membership in this list and never maps roles to permissions itself.

### `GET /api/auth/me/export`

Self-service GDPR **access and portability** (Art. 15 & 20): every server-side record tied to the caller — account row, synced project versions, audit entries, analysis-run metadata, activity uploads — as one JSON document, served with `Content-Disposition: attachment`. Takes no user id, so it can only ever return the caller's own data. `501` in local-only mode; `404` if the account row is missing.

The gathering lives in `db/export.py`. **Any new table carrying a `user_id` must be added there** in the same session it is created, or the export silently under-reports (see [privacy-and-data-protection.md](privacy-and-data-protection.md)).

### `DELETE /api/auth/me`

Self-service GDPR erasure. Deletes the identity in Zitadel **first** (via `ZITADEL_MGMT_URL`/`ZITADEL_MGMT_TOKEN`; aborts with `502` if that fails so erasure stays all-or-nothing), then removes the app record and appends an `account_delete` audit entry. `204` on success.

### `GET /api/auth/login?state=…&code_challenge=…&code_challenge_method=S256[&prompt=…][&ui_locales=…][&idp=…]`

Redirects to the OIDC provider's authorization page, forwarding the client-generated `state` (anti-CSRF: the frontend stores it in `sessionStorage` and the callback page rejects a mismatch) and the PKCE (RFC 7636) `code_challenge`. `501` in local-only mode.

Two optional pass-throughs shape the hosted login experience:

- `prompt` — forwarded only when it is one of `create`, `login`, `select_account`, `none` (anything else is dropped, not relayed). The frontend's **"Create account"** button sends `prompt=create` so Zitadel opens its self-service registration form directly instead of the sign-in form.
- `ui_locales` — a space-separated BCP-47 tag list (e.g. `it en-US`), validated against `^[A-Za-z0-9-]+( [A-Za-z0-9-]+)*$` before forwarding. The frontend sends `navigator.language`, so Zitadel renders its hosted pages in the same language the user sees in CASCADE.
- `idp` — a symbolic provider name; only `google` is wired, and only when `OIDC_GOOGLE_IDP_ID` is set. It maps **server-side** to Zitadel's `urn:zitadel:iam:org:idp:id:<id>` scope, which skips Zitadel's own form and goes straight to Google. An unknown or unconfigured value falls through to the normal login form rather than erroring — a missing shortcut must never block sign-in.

This app is a **public OIDC client** (no `client_secret`): PKCE proves the browser session that requests the token exchange is the one that started this authorize request, replacing a shared static secret. The frontend generates a random `code_verifier`, derives `code_challenge = BASE64URL(SHA256(code_verifier))`, stashes the verifier in `sessionStorage`, and sends only the challenge here.

### `GET /api/auth/callback?code=…&code_verifier=…`

Exchanges the authorization code (sending the PKCE `code_verifier` instead of a `client_secret`), then **sets the session as httpOnly cookies** — `cascade_access` (path `/api`) and `cascade_refresh` (path `/api/auth/refresh`) — and returns `{ "ok": true }`. Tokens never appear in a response body, so page JavaScript (and any XSS running as it) cannot read them; `SameSite=Lax` keeps cross-site non-GET requests from carrying them (CSRF). Also persists the id token's `email`/`name` claims to the user row (the access token carries no profile claims). `501` in local-only mode; `403` on a failed id-token check, with a **structured** detail so the client branches on a stable code rather than on prose:

- `{"detail": {"code": "email_not_verified", "message": …}}` — the one failure the user can act on ("check your inbox"). An *absent* `email_verified` claim is allowed; the IdP's own login policy is the primary gate (see `auth/oauth2.py::verify_id_token` and its dedicated `EmailNotVerifiedError`).
- `{"detail": {"code": "verification_failed", "message": …}}` — everything else (bad signature, expired, misconfigured audience/issuer), deliberately opaque. Configuration errors name server internals, so they are logged and never returned to an unauthenticated caller. (The `state` round-trip is validated client-side on the callback page, which fails **closed** — a missing stored state or verifier is rejected, not accepted.)

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

**Null-free bundle contract.** This response is serialised with
`response_model_exclude_none=True` (`api/sync_routes.py`), so unset optional
fields are **absent** rather than `null`. That makes the payload byte-shape-identical
to a local file save (the frontend's `JSON.stringify` drops `undefined` keys),
which the Zod schema requires: its `.optional()` fields accept an absent key but
**reject `null`**. Without the flag Pydantic emits every unset `Optional` as
explicit `null` and Load fails client-side validation with
`expected string, received null`. Do not remove it. The same contract governs
`POST /api/import/inp` (requirements §13.5).

### `DELETE /api/projects/{id}`

Deletes one version. `404` if it doesn't belong to the caller.

---

## Network import — any authenticated user (requirements.md §13.5, ADR-0012)

### `POST /api/import/inp`

Converts an EPANET `.inp` water network into a CASCADE `ProjectBundle`. Pure transformation — nothing persisted, engine never invoked. CPU-bound work (WNTR parse, pressure-driven priority sweep, skeletonization) runs in a worker thread; expect a few seconds on real aqueducts.

Body `{ filename, content, target_nodes?, source_crs?, demand_mode?, n_levels?, capacity_velocity?, capacity_margin?, max_velocity? }` — `content` is the raw `.inp` text; `target_nodes` defaults to the caller's Entitlement `max_nodes` (300 for unbounded roles); `source_crs` defaults to `EPSG:3004`; `n_levels` defaults to 3 (functionality scale size — pass the current project's own `functionality_scale.length` when merging the result into an existing project, so imported values land on that scale); `capacity_velocity` defaults to **2.5** m/s (the uniform design velocity every pipe capacity is sized at, `π/4·d²·v` — the shipped method; set null to fall back to the per-pipe sweep "drill"); `capacity_margin` defaults to 2.0 and `max_velocity` to 3.0 m/s — these govern **valve** capacity and, under the sweep drill only, pipe capacity (`min(v_peak × margin, max_velocity)`); the default uniform-velocity method ignores them for pipes. The importer derives **no shedding priority** (the per-node `priority` field is expert-set only — no auto-derivation improved the result). Source `supply_capacity` is always the sum of a Reservoir/Tank's outgoing pipe capacities — not a request parameter.

Returns `{ bundle: { project, config }, warnings, original_nodes, imported_nodes, skeleton_threshold_m? }`, serialised null-free (§13.4 contract). `422` with a human-readable detail on unparseable files, unknown CRS, or an unreachable node budget.

---

## Not implemented (by design, yet)

Nothing outstanding here. Batch propagation, listed here until 2026-09-10, now exists — see `POST /api/propagate/batch` above. It is **stateless**: no job table, no stored results. The speculative `batch_propagation_jobs` table dropped in migration 006 stays dropped, because its `results` JSONB would have persisted Propagation outputs, which ADR-0007 forbids.
