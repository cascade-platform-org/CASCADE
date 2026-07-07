/**
 * api-client.ts — Thin HTTP client for the CASCADE backend.
 *
 * The ONLY place that talks to the backend: every endpoint call lives here so
 * the base URL, error handling, and response validation (Zod at the boundary)
 * are defined once. When auth lands (Slice 4), the Authorization header is
 * added here and every caller gets it for free.
 */
import { z } from "zod";
import { PropagationResultSchema, type PropagationResult } from "@/lib/schemas/propagation";
import {
  EngineAlgorithmsSchema,
  ProjectVersionSummarySchema,
  ProjectVersionDetailSchema,
  type EngineAlgorithms,
  type PropagationRequest,
  type ProjectVersionSummary,
  type ProjectVersionDetail,
} from "@/lib/schemas/api";
import type { ProjectBundle } from "@/lib/file-io";
import {
  MeResponseSchema,
  AuthConfigSchema,
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

/**
 * fetch for session-protected endpoints; on a 401, transparently rotate the
 * session cookies once (shared across concurrent callers) and retry.
 */
async function authedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const send = () => fetch(url, init);
  let res = await send();
  if (res.status === 401 && _refresher) {
    const refreshed = await refreshOnce();
    if (refreshed) res = await send(); // the rotated cookie rides automatically
  }
  return res;
}

/** fetch with an abort-based timeout, so no request can hang the caller. */
async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 5_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Auth endpoints
// ---------------------------------------------------------------------------

/**
 * GET /api/auth/config — UNauthenticated: whether the backend enforces auth.
 * Returns null on network error/timeout. Read this before a user has a token
 * (the token-gated /me can't reveal auth_enabled to a guest).
 */
export async function fetchAuthConfig(): Promise<boolean | null> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/auth/config`);
    if (!res.ok) return null;
    return AuthConfigSchema.parse(await res.json()).auth_enabled;
  } catch {
    return null;
  }
}

/** GET /api/auth/me — current identity (session cookie carries the auth). */
export async function fetchMe(): Promise<MeResponse | null> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/auth/me`);
    if (!res.ok) return null;
    return MeResponseSchema.parse(await res.json());
  } catch {
    return null;
  }
}

/** The URL that starts the OIDC (Zitadel) login redirect. `state` is the
 *  anti-CSRF value the callback page validates when the IdP returns it.
 *  `codeChallenge` is the PKCE (RFC 7636) S256 challenge — the backend is a
 *  public client, so this replaces a client_secret at token exchange. */
export function oidcLoginUrl(state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${API_BASE}/api/auth/login?${params.toString()}`;
}

/** Exchange an OIDC authorization code via the backend, which sets the
 *  httpOnly session cookies on success (no tokens in the body — JS never sees
 *  them). `codeVerifier` is the PKCE verifier generated before the redirect. */
export async function exchangeOidcCode(
  code: string,
  codeVerifier: string,
): Promise<boolean> {
  try {
    const params = new URLSearchParams({ code, code_verifier: codeVerifier });
    const res = await fetchWithTimeout(
      `${API_BASE}/api/auth/callback?${params.toString()}`,
      {},
      15_000,
    );
    return res.ok;
  } catch {
    return false;
  }
}

/** Rotate the session cookies via the refresh cookie. false => must re-login. */
export async function refreshSession(): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/api/auth/refresh`,
      { method: "POST" },
      15_000,
    );
    return res.ok;
  } catch {
    return false;
  }
}

/** POST /api/auth/logout — clears the session cookies; returns the IdP's
 *  end_session URL the browser must visit to kill the SSO session too (null
 *  when auth is off or the IdP exposes none). */
export async function logoutSession(): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/auth/logout`, { method: "POST" });
    if (!res.ok) return null;
    const body = (await res.json()) as { logout_url?: string | null };
    return body.logout_url ?? null;
  } catch {
    return null;
  }
}

/** DELETE /api/auth/me — self-service GDPR account erasure (app DB + IdP).
 *  Returns an error message, or null on success. */
export async function deleteMyAccount(): Promise<string | null> {
  try {
    const res = await authedFetch(`${API_BASE}/api/auth/me`, { method: "DELETE" });
    if (res.ok) return null;
    const detail = await res.text().catch(() => res.statusText);
    return `Deletion failed (${res.status}): ${detail}`;
  } catch {
    return "Deletion failed: network error.";
  }
}
const HEALTH_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

/**
 * Pings GET /api/health. Returns true if the server responds with 2xx within
 * the timeout, false on any network error or non-2xx status.
 */
export async function checkServerHealth(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/api/health`, {
      method: "GET",
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Propagation
// ---------------------------------------------------------------------------

/**
 * POST /api/propagate — send a PropagationRequest, return the validated result.
 * Throws an Error with the server detail on non-2xx responses, and a ZodError
 * if the response does not match PropagationResultSchema.
 */
export async function postPropagate(payload: PropagationRequest): Promise<PropagationResult> {
  const response = await authedFetch(`${API_BASE}/api/propagate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(`Server returned ${response.status}: ${detail}`);
  }

  return PropagationResultSchema.parse(await response.json());
}

// ---------------------------------------------------------------------------
// Engine metadata
// ---------------------------------------------------------------------------

/**
 * GET /api/engine/algorithms — graph types and heuristics the engine supports.
 * Throws on non-2xx responses or schema mismatch.
 */
export async function getEngineAlgorithms(): Promise<EngineAlgorithms> {
  const response = await authedFetch(`${API_BASE}/api/engine/algorithms`);
  if (!response.ok) throw new Error(`Server returned ${response.status}`);
  return EngineAlgorithmsSchema.parse(await response.json());
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

/** GET /api/admin/users — all accounts. Throws on non-2xx. */
export async function adminListUsers(): Promise<AdminUser[]> {
  const res = await authedFetch(`${API_BASE}/api/admin/users`);
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  return z.array(AdminUserSchema).parse(await res.json());
}

/** GET /api/admin/roles — role names + permissions. Throws on non-2xx. */
export async function adminListRoles(): Promise<AdminRole[]> {
  const res = await authedFetch(`${API_BASE}/api/admin/roles`);
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  return z.array(AdminRoleSchema).parse(await res.json());
}

/** PATCH /api/admin/users/{id}/role. Returns error message or null. */
export async function adminSetRole(userId: string, role: string): Promise<string | null> {
  const res = await authedFetch(`${API_BASE}/api/admin/users/${encodeURIComponent(userId)}/role`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  if (res.ok) return null;
  const detail = await res.text().catch(() => res.statusText);
  return `Role change failed (${res.status}): ${detail}`;
}

/** DELETE /api/admin/users/{id} — full account erasure. Error message or null. */
export async function adminDeleteUser(userId: string): Promise<string | null> {
  const res = await authedFetch(`${API_BASE}/api/admin/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
  });
  if (res.ok) return null;
  const detail = await res.text().catch(() => res.statusText);
  return `Deletion failed (${res.status}): ${detail}`;
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
  const res = await authedFetch(`${API_BASE}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, description, data }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`Save failed (${res.status}): ${detail}`);
  }
  return ProjectVersionSummarySchema.parse(await res.json());
}

/** GET /api/projects — this user's saved versions, newest first, no bundle
 *  data (kept light — a version list, not a bulk download). Throws on non-2xx. */
export async function syncListProjects(): Promise<ProjectVersionSummary[]> {
  const res = await authedFetch(`${API_BASE}/api/projects`);
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  return z.array(ProjectVersionSummarySchema).parse(await res.json());
}

/** GET /api/projects/{id} — one version's full bundle, for Load. Throws on non-2xx. */
export async function syncLoadProject(versionId: string): Promise<ProjectVersionDetail> {
  const res = await authedFetch(`${API_BASE}/api/projects/${encodeURIComponent(versionId)}`);
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  return ProjectVersionDetailSchema.parse(await res.json());
}

/** DELETE /api/projects/{id}. Returns an error message, or null on success. */
export async function syncDeleteProject(versionId: string): Promise<string | null> {
  const res = await authedFetch(`${API_BASE}/api/projects/${encodeURIComponent(versionId)}`, {
    method: "DELETE",
  });
  if (res.ok) return null;
  const detail = await res.text().catch(() => res.statusText);
  return `Delete failed (${res.status}): ${detail}`;
}
