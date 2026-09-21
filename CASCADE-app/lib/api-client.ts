/**
 * api-client.ts — Thin HTTP client for the CASCADE backend.
 *
 * The ONLY place that talks to the backend: every endpoint call lives here so
 * the base URL, error handling, and response validation (Zod at the boundary)
 * are defined once.
 *
 * Every endpoint goes through `request()`, which owns the whole round trip —
 * timeout, 401-rotate-and-retry, failure-detail extraction, Zod parse — and
 * returns an `ApiResult`. Endpoints then pick ONE of three named wrappers to
 * decide what their caller sees. Before, each of the 23 endpoints made that
 * decision for itself, and four incompatible conventions grew up side by side:
 * `Promise<string | null>` meant "the logout URL" in one function and "the
 * error message" in another, and `null` meant failure, success, and
 * legitimately-absent in three more. The conventions are still three, because
 * callers genuinely want different things, but they are now named and chosen
 * rather than reinvented per endpoint.
 */
import { z } from "zod";
import {
  BatchPropagationResultSchema,
  PropagationResultSchema,
  type PropagationResult,
} from "@/lib/schemas/propagation";
import {
  EngineAlgorithmsSchema,
  ImportInpResponseSchema,
  ProjectVersionSummarySchema,
  ProjectVersionDetailSchema,
  WorkingCopyDetailSchema,
  type EngineAlgorithms,
  type ImportInpResponse,
  type BatchPropagationRequest,
  type PropagationRequest,
  type ProjectVersionSummary,
  type ProjectVersionDetail,
  type WorkingCopyDetail,
} from "@/lib/schemas/api";
import type { ProjectBundle } from "@/lib/file-io";
import {
  MeResponseSchema,
  AuthConfigSchema,
  type AuthConfig,
  type MeResponse,
} from "@/lib/schemas/auth";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ---------------------------------------------------------------------------
// Session transport: httpOnly cookies. The backend sets cascade_access /
// cascade_refresh at /callback; the browser attaches them automatically on
// same-origin requests. JavaScript never sees a token — an XSS can ride the
// session while the page is open but cannot exfiltrate credentials, which was
// the main risk of the previous localStorage scheme.
// ---------------------------------------------------------------------------

// A refresh callback registered by the auth store: on a 401 it rotates the
// session cookies via POST /refresh (true = retry is worthwhile). Kept as a
// module-level seam so this file never imports the store (no cycle).
let _refresher: (() => Promise<boolean>) | null = null;

export function setTokenRefresher(fn: (() => Promise<boolean>) | null): void {
  _refresher = fn;
}

// Single-flight the refresh: when several requests 401 at once they must share
// ONE refresh call. Otherwise each would present the same refresh cookie, and an
// IdP that rotates refresh tokens (Zitadel does by default) invalidates it after
// the first — the rest fail and sign the user out spuriously.
let _refreshInFlight: Promise<boolean> | null = null;

function refreshOnce(): Promise<boolean> {
  if (!_refresher) return Promise.resolve(false);
  if (!_refreshInFlight) {
    _refreshInFlight = _refresher().finally(() => {
      _refreshInFlight = null;
    });
  }
  return _refreshInFlight;
}

// ---------------------------------------------------------------------------
// One result shape
// ---------------------------------------------------------------------------

/** Why a call did not produce data. Reached through `ApiResult`, never named alone. */
interface ApiFailure {
  ok: false;
  /** HTTP status, or 0 when the request never got an answer (network, timeout). */
  status: number;
  /** The server's own detail where it sent one, else a short reason. */
  detail: string;
  /**
   * A stable machine-readable code from a structured FastAPI detail, else "".
   * Callers branch on this rather than on `detail` prose, which is free to
   * change and is sometimes the IdP's words rather than ours.
   */
  code: string;
}

export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

/** Timeouts. Short for the auth pings, long for the calls that do real work. */
const AUTH_TIMEOUT_MS = 5_000;
const TOKEN_TIMEOUT_MS = 15_000;

// Comfortably above the backend's own ENGINE_TIMEOUT_SECONDS (30 s, see
// services/propagation_service.py), so a slow Propagation surfaces the server's
// error rather than a client-side abort that says nothing about what went wrong.
const DEFAULT_TIMEOUT_MS = 45_000;

// The EPANET importer runs a skeletonization plus a hydraulic sweep; on a large
// network that legitimately outlives DEFAULT_TIMEOUT_MS.
const IMPORT_TIMEOUT_MS = 180_000;

/**
 * Read a failed response's body ONCE and pull out the best detail available.
 *
 * Once, because a `Response` body is a single-use stream: the previous code
 * tried `res.json()` and fell back to `res.text()` in the catch, but by then the
 * stream was consumed and the fallback could only ever yield `statusText`. So a
 * non-JSON error body — the one case the fallback existed for — was the one case
 * it could not report.
 *
 * FastAPI wraps `HTTPException(detail=…)` as `{ detail: … }`, where ours is
 * sometimes an object carrying `code`. A plain string, or a non-JSON body,
 * simply yields no code.
 */
async function readFailure(res: Response): Promise<{ detail: string; code: string }> {
  const raw = await res.text().catch(() => "");
  if (!raw) return { detail: res.statusText || `HTTP ${res.status}`, code: "" };
  try {
    const body = JSON.parse(raw) as { detail?: unknown };
    const d = body.detail;
    if (typeof d === "string") return { detail: d, code: "" };
    if (d && typeof d === "object") {
      const o = d as { code?: unknown; message?: unknown };
      return {
        detail: typeof o.message === "string" ? o.message : raw,
        code: typeof o.code === "string" ? o.code : "",
      };
    }
  } catch {
    /* not JSON — the raw text is the best detail we have */
  }
  return { detail: raw, code: "" };
}

interface RequestOptions<T> {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Serialised as JSON with the matching Content-Type. */
  body?: unknown;
  /** Validates the success body at the boundary. Omit for an empty response. */
  schema?: z.ZodType<T>;
  timeoutMs?: number;
  /**
   * Statuses to treat as success with `data` left null — a 404 that means
   * "there is none", not "something went wrong".
   */
  absentOn?: number[];
  /** Skip the 401-rotate-and-retry, for the calls that establish the session. */
  noRetry?: boolean;
}

/**
 * One round trip: timeout, 401-rotate-and-retry, failure extraction, Zod parse.
 *
 * Every attempt gets its own timeout budget — an AbortController cannot be
 * reused once it has fired, and the post-refresh retry deserves a full timeout
 * rather than the remainder of the first one. The timeout applies to ALL calls:
 * it used to apply only to the unauthenticated auth pings, which left every
 * Propagation, batch Propagation, import and sync — the long ones — able to
 * hang forever.
 */
async function request<T>(
  path: string,
  opts: RequestOptions<T> = {},
): Promise<ApiResult<T>> {
  const {
    method = "GET",
    body,
    schema,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    absentOn = [],
    noRetry = false,
  } = opts;

  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }

  async function send(): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(`${API_BASE}${path}`, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  let res: Response;
  try {
    res = await send();
    if (res.status === 401 && !noRetry && _refresher) {
      const refreshed = await refreshOnce();
      if (refreshed) res = await send(); // the rotated cookie rides automatically
    }
  } catch {
    // Abort (timeout) and genuine network failures are indistinguishable here
    // and equally actionable: nothing was learned about the server's state.
    return { ok: false, status: 0, detail: "Network error or timeout.", code: "network_error" };
  }

  if (absentOn.includes(res.status)) return { ok: true, data: null as T };

  if (!res.ok) {
    const { detail, code } = await readFailure(res);
    return { ok: false, status: res.status, detail, code };
  }

  if (!schema) return { ok: true, data: null as T };

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return {
      ok: false,
      status: res.status,
      detail: "The server's reply was not valid JSON.",
      code: "invalid_response",
    };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      status: res.status,
      detail: "The server's reply did not match the expected shape.",
      code: "invalid_response",
    };
  }
  return { ok: true, data: parsed.data };
}

// ---------------------------------------------------------------------------
// The three things a caller can want. Named, so an endpoint picks one instead
// of inventing a convention.
// ---------------------------------------------------------------------------

/** Failure is exceptional and the caller shows the message: throw. */
function unwrap<T>(result: ApiResult<T>, prefix: string): T {
  if (result.ok) return result.data;
  const where = result.status ? ` (${result.status})` : "";
  throw new Error(`${prefix}${where}: ${result.detail}`);
}

/** Failure is ordinary and the reason does not matter: null. */
function orNull<T>(result: ApiResult<T>): T | null {
  return result.ok ? result.data : null;
}

/** The caller renders the reason inline: the message, or null on success. */
function errorOrNull(result: ApiResult<unknown>, prefix: string): string | null {
  if (result.ok) return null;
  const where = result.status ? ` (${result.status})` : "";
  return `${prefix}${where}: ${result.detail}`;
}

// ---------------------------------------------------------------------------
// Auth endpoints
// ---------------------------------------------------------------------------

/**
 * GET /api/auth/config — UNauthenticated: whether the backend enforces auth and
 * which sign-in shortcuts it offers. Returns null on network error/timeout.
 * Read this before a user has a token (the token-gated /me can't reveal
 * auth_enabled to a guest).
 */
export async function fetchAuthConfig(): Promise<AuthConfig | null> {
  return orNull(
    await request("/api/auth/config", {
      schema: AuthConfigSchema,
      timeoutMs: AUTH_TIMEOUT_MS,
      noRetry: true,
    }),
  );
}

/** GET /api/auth/me — current identity (session cookie carries the auth). */
export async function fetchMe(): Promise<MeResponse | null> {
  return orNull(
    await request("/api/auth/me", {
      schema: MeResponseSchema,
      timeoutMs: AUTH_TIMEOUT_MS,
      noRetry: true,
    }),
  );
}

/** The URL that starts the OIDC (Zitadel) login redirect. `state` is the
 *  anti-CSRF value the callback page validates when the IdP returns it.
 *  `codeChallenge` is the PKCE (RFC 7636) S256 challenge — the backend is a
 *  public client, so this replaces a client_secret at token exchange.
 *
 *  `intent` "create" asks the backend to forward `prompt=create` so Zitadel
 *  opens its registration form instead of the sign-in form. `uiLocales` (a
 *  BCP-47 tag such as "it" or "en-US", normally `navigator.language`) picks the
 *  language Zitadel renders its hosted pages in. `idp` "google" asks the
 *  backend to add the Zitadel scope that jumps straight to Google — the
 *  provider's id lives in backend config, never here. */
export function oidcLoginUrl(
  state: string,
  codeChallenge: string,
  opts: { intent?: "login" | "create"; uiLocales?: string; idp?: "google" } = {},
): string {
  const params = new URLSearchParams({
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  if (opts.intent === "create") params.set("prompt", "create");
  if (opts.uiLocales) params.set("ui_locales", opts.uiLocales);
  if (opts.idp) params.set("idp", opts.idp);
  return `${API_BASE}/api/auth/login?${params.toString()}`;
}

/** Exchange an OIDC authorization code via the backend, which sets the
 *  httpOnly session cookies on success (no tokens in the body — JS never sees
 *  them). `codeVerifier` is the PKCE verifier generated before the redirect.
 *
 *  The failure branch carries `code`, a STABLE identifier the callback page
 *  branches on rather than pattern-matching the message prose — it is
 *  `"email_not_verified"` for the one failure a user can fix. */
export async function exchangeOidcCode(
  code: string,
  codeVerifier: string,
): Promise<ApiResult<null>> {
  const params = new URLSearchParams({ code, code_verifier: codeVerifier });
  return request<null>(`/api/auth/callback?${params.toString()}`, {
    timeoutMs: TOKEN_TIMEOUT_MS,
    noRetry: true,
  });
}

/** Rotate the session cookies via the refresh cookie. false => must re-login. */
export async function refreshSession(): Promise<boolean> {
  // noRetry: this IS the retry path — a 401 here means the refresh cookie is
  // spent, and recursing would deadlock on the single-flight promise.
  const res = await request("/api/auth/refresh", {
    method: "POST",
    timeoutMs: TOKEN_TIMEOUT_MS,
    noRetry: true,
  });
  return res.ok;
}

const LogoutSchema = z.object({ logout_url: z.string().nullish() });

/** POST /api/auth/logout — clears the session cookies; returns the IdP's
 *  end_session URL the browser must visit to kill the SSO session too (null
 *  when auth is off, the IdP exposes none, or the call failed). */
export async function logoutSession(): Promise<string | null> {
  const res = await request("/api/auth/logout", {
    method: "POST",
    schema: LogoutSchema,
    timeoutMs: AUTH_TIMEOUT_MS,
    noRetry: true,
  });
  return res.ok ? (res.data.logout_url ?? null) : null;
}

/** GET /api/auth/me/export — download the caller's own data export (GDPR
 *  Art. 15/20). Returns an error message, or null once the save is triggered.
 *
 *  This one does not go through `request()`: it wants the raw bytes, not a
 *  parsed body. It still goes through the session transport for the reason
 *  below — navigating away replaces the running app, so an expired access
 *  cookie (they last about an hour) would land the user on a raw JSON 401 page
 *  and discard whatever local-first work was open. Going through the retry
 *  means a 401 silently rotates the session, and a failure leaves the page
 *  untouched. */
export async function downloadMyData(): Promise<string | null> {
  // Each attempt gets its own controller and budget, as in `request()`: a fired
  // AbortController cannot be reused, so sharing one would make the retry abort
  // immediately.
  async function send(): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      return await fetch(`${API_BASE}/api/auth/me/export`, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  let res: Response;
  try {
    res = await send();
    if (res.status === 401 && _refresher && (await refreshOnce())) res = await send();
  } catch {
    return "Export failed: network error.";
  }
  if (!res.ok) {
    const { detail } = await readFailure(res);
    return `Export failed (${res.status}): ${detail}`;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = "cascade-my-data.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Release the blob once the browser has taken the download.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  return null;
}

/** DELETE /api/auth/me — self-service GDPR account erasure (app DB + IdP).
 *  Returns an error message, or null on success. */
export async function deleteMyAccount(): Promise<string | null> {
  return errorOrNull(await request("/api/auth/me", { method: "DELETE" }), "Deletion failed");
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

/**
 * Pings GET /api/health. Returns true if the server responds with 2xx within
 * the timeout, false on any network error or non-2xx status.
 */
export async function checkServerHealth(): Promise<boolean> {
  const res = await request("/api/health", { timeoutMs: AUTH_TIMEOUT_MS, noRetry: true });
  return res.ok;
}

// ---------------------------------------------------------------------------
// Propagation
// ---------------------------------------------------------------------------

/**
 * POST /api/propagate — send a PropagationRequest, return the validated result.
 * Throws an Error carrying the server detail on any failure, including a
 * response that does not match PropagationResultSchema.
 */
export async function postPropagate(payload: PropagationRequest): Promise<PropagationResult> {
  return unwrap(
    await request("/api/propagate", {
      method: "POST",
      body: payload,
      schema: PropagationResultSchema,
    }),
    "Propagation failed",
  );
}

/**
 * POST /api/propagate/batch — one Project, many coalitions, one round trip.
 *
 * Results come back positionally aligned with `payload.coalitions`. Batching is
 * a transport optimisation only: the server runs each coalition through the same
 * path a single Propagation takes, so a batched result is identical to the same
 * Scenario sent on its own.
 */
export async function postPropagateBatch(
  payload: BatchPropagationRequest,
): Promise<PropagationResult[]> {
  const parsed = unwrap(
    await request("/api/propagate/batch", {
      method: "POST",
      body: payload,
      schema: BatchPropagationResultSchema,
    }),
    "Batch propagation failed",
  );
  return parsed.results;
}

// ---------------------------------------------------------------------------
// Engine metadata
// ---------------------------------------------------------------------------

/** GET /api/engine/algorithms — graph types and heuristics the engine supports. */
export async function getEngineAlgorithms(): Promise<EngineAlgorithms> {
  return unwrap(
    await request("/api/engine/algorithms", { schema: EngineAlgorithmsSchema }),
    "Could not load engine algorithms",
  );
}

// ---------------------------------------------------------------------------
// Admin (requires can_manage_users; the backend enforces, this just calls)
// ---------------------------------------------------------------------------

const AdminUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  display_name: z.string(),
  role: z.string(),
});
export type AdminUser = z.infer<typeof AdminUserSchema>;

const AdminRoleSchema = z.object({
  name: z.string(),
  permissions: z.array(z.string()),
});
export type AdminRole = z.infer<typeof AdminRoleSchema>;

/** GET /api/admin/users — all accounts. */
export async function adminListUsers(): Promise<AdminUser[]> {
  return unwrap(
    await request("/api/admin/users", { schema: z.array(AdminUserSchema) }),
    "Could not load users",
  );
}

/** GET /api/admin/roles — role names + permissions. */
export async function adminListRoles(): Promise<AdminRole[]> {
  return unwrap(
    await request("/api/admin/roles", { schema: z.array(AdminRoleSchema) }),
    "Could not load roles",
  );
}

/** PATCH /api/admin/users/{id}/role. Returns error message or null. */
export async function adminSetRole(userId: string, role: string): Promise<string | null> {
  return errorOrNull(
    await request(`/api/admin/users/${encodeURIComponent(userId)}/role`, {
      method: "PATCH",
      body: { role },
    }),
    "Role change failed",
  );
}

/** DELETE /api/admin/users/{id} — full account erasure. Error message or null. */
export async function adminDeleteUser(userId: string): Promise<string | null> {
  return errorOrNull(
    await request(`/api/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE" }),
    "Deletion failed",
  );
}

// ---------------------------------------------------------------------------
// Server Sync (requirements.md §13.4; requires can_sync, opt-in per user)
// ---------------------------------------------------------------------------

/** POST /api/projects — save a NEW version (never overwrites; server prunes
 *  versions past 10 per name, same policy as the local save history). Throws
 *  with the server detail on non-2xx (e.g. 501 in local-only mode, 403
 *  without can_sync). */
export async function syncSaveProject(
  name: string,
  description: string | null,
  data: ProjectBundle,
): Promise<ProjectVersionSummary> {
  return unwrap(
    await request("/api/projects", {
      method: "POST",
      body: { name, description, data },
      schema: ProjectVersionSummarySchema,
    }),
    "Save failed",
  );
}

/** GET /api/projects — this user's saved versions, newest first, no bundle
 *  data (kept light — a version list, not a bulk download). Throws on failure. */
export async function syncListProjects(): Promise<ProjectVersionSummary[]> {
  return unwrap(
    await request("/api/projects", { schema: z.array(ProjectVersionSummarySchema) }),
    "Could not load cloud saves",
  );
}

/** GET /api/projects/{id} — one version's full bundle, for Load. Throws on failure. */
export async function syncLoadProject(versionId: string): Promise<ProjectVersionDetail> {
  return unwrap(
    await request(`/api/projects/${encodeURIComponent(versionId)}`, {
      schema: ProjectVersionDetailSchema,
    }),
    "Load failed",
  );
}

// ---------------------------------------------------------------------------
// Working Copy — auto-save that is NOT a version (ADR-0017)
// ---------------------------------------------------------------------------
//
// Opt-in per project and off by default. ADR-0007's guarantee is that a network
// is never stored server-side unless the user opts into Sync; an auto-save that
// uploaded silently would break that sentence rather than stretch it. These
// three are called only for a project the user has switched on.

/** PUT /api/projects/autosave — write this project's Working Copy, replacing
 *  any previous one. Never creates a version. Throws with the server detail. */
export async function syncPutWorkingCopy(
  name: string,
  data: ProjectBundle,
): Promise<WorkingCopyDetail> {
  return unwrap(
    await request("/api/projects/autosave", {
      method: "PUT",
      body: { name, data },
      schema: WorkingCopyDetailSchema,
    }),
    "Auto-save failed",
  );
}

/**
 * GET /api/projects/autosave — the Working Copy for one project name.
 *
 * Returns the full result rather than a bare value, because "there is no
 * Working Copy" (a 404, the normal answer) and "we could not find out" are
 * different facts and the caller must be able to tell them apart. It used to
 * return null for the first and throw for the second, which pushed callers into
 * `.catch(() => null)` — collapsing a server error into "no auto-save exists"
 * and showing the user nothing at all.
 *
 * `ok: true, data: null` means there is none; `ok: false` means we do not know.
 */
export async function syncGetWorkingCopy(
  name: string,
): Promise<ApiResult<WorkingCopyDetail | null>> {
  return request(`/api/projects/autosave?name=${encodeURIComponent(name)}`, {
    schema: WorkingCopyDetailSchema.nullable(),
    absentOn: [404],
  });
}

/** DELETE /api/projects/autosave — drop the stored copy when the user opts a
 *  project out. Opting out must REMOVE the network, not merely stop writing.
 *  A 404 is success: there was nothing stored. */
export async function syncDeleteWorkingCopy(name: string): Promise<void> {
  unwrap(
    await request(`/api/projects/autosave?name=${encodeURIComponent(name)}`, {
      method: "DELETE",
      absentOn: [404],
    }),
    "Could not remove the cloud auto-save",
  );
}

// ---------------------------------------------------------------------------
// EPANET .inp import (ADR-0012)
// ---------------------------------------------------------------------------

export interface ImportInpKnobs {
  targetNodes?: number;
  sourceCrs?: string;
  demandMode?: "peak" | "base" | "avg";
  /** Size of the functionality scale (1..nLevels) node/edge values are
   *  expressed on. Backend default 3. When merging into an existing
   *  project, pass that project's own functionality_scale.length so the
   *  imported values line up with its (untouched) scale. */
  nLevels?: number;
  /** Sweep-drill only: multiplier on the sweep peak velocity for valve capacity,
   *  and for pipe capacity when capacityVelocity is null. Backend default 2.0.
   *  The default uniform design-velocity method ignores it for pipes. */
  capacityMargin?: number;
  /** Sweep-drill only: physical ceiling (m/s) on the margined sweep velocity
   *  (valves always; pipes under the drill). Backend default 3.0. */
  maxVelocity?: number;
}

/** POST /api/import/inp — convert an EPANET water network to a CASCADE
 *  ProjectBundle. Pure transformation server-side: nothing persisted. The
 *  skeletonization + hydraulic sweep can take ~10 s on large networks. */
export async function importInp(
  filename: string,
  content: string,
  knobs: ImportInpKnobs = {},
): Promise<ImportInpResponse> {
  return unwrap(
    await request("/api/import/inp", {
      method: "POST",
      body: {
        filename,
        content,
        target_nodes: knobs.targetNodes,
        source_crs: knobs.sourceCrs,
        demand_mode: knobs.demandMode,
        n_levels: knobs.nLevels,
        capacity_margin: knobs.capacityMargin,
        max_velocity: knobs.maxVelocity,
      },
      schema: ImportInpResponseSchema,
      timeoutMs: IMPORT_TIMEOUT_MS,
    }),
    "Import failed",
  );
}

/** DELETE /api/projects/{id}. Returns an error message, or null on success. */
export async function syncDeleteProject(versionId: string): Promise<string | null> {
  return errorOrNull(
    await request(`/api/projects/${encodeURIComponent(versionId)}`, { method: "DELETE" }),
    "Delete failed",
  );
}
