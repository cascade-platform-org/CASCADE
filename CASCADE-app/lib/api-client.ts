/**
 * api-client.ts — Thin HTTP client for the CASCADE backend.
 *
 * The ONLY place that talks to the backend: every endpoint call lives here so
 * the base URL, error handling, and response validation (Zod at the boundary)
 * are defined once. When auth lands (Slice 4), the Authorization header is
 * added here and every caller gets it for free.
 */
import { PropagationResultSchema, type PropagationResult } from "@/lib/schemas/propagation";
import {
  EngineAlgorithmsSchema,
  type EngineAlgorithms,
  type PropagationRequest,
} from "@/lib/schemas/api";
import {
  MeResponseSchema,
  AuthConfigSchema,
  type MeResponse,
} from "@/lib/schemas/auth";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ---------------------------------------------------------------------------
// Auth token — set by the auth store when a user signs in. Kept module-level
// (not imported from the store) so this file has no dependency on the store,
// avoiding an import cycle. Every request below picks it up automatically.
// ---------------------------------------------------------------------------

let _authToken: string | null = null;

export function setAuthToken(token: string | null): void {
  _authToken = token;
}

function authHeaders(base?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(base ?? {}) };
  if (_authToken) headers.Authorization = `Bearer ${_authToken}`;
  return headers;
}

// A refresh callback registered by the auth store: on a 401 it obtains a fresh
// access token (or null if refresh failed). Kept as a module-level seam so this
// file never imports the store (no cycle).
let _refresher: (() => Promise<string | null>) | null = null;

export function setTokenRefresher(fn: (() => Promise<string | null>) | null): void {
  _refresher = fn;
}

// Single-flight the refresh: when several requests 401 at once they must share
// ONE refresh call. Otherwise each would present the same refresh token, and an
// IdP that rotates refresh tokens (Zitadel does by default) invalidates it after
// the first — the rest fail and sign the user out spuriously.
let _refreshInFlight: Promise<string | null> | null = null;

function refreshOnce(): Promise<string | null> {
  if (!_refresher) return Promise.resolve(null);
  if (!_refreshInFlight) {
    _refreshInFlight = _refresher().finally(() => {
      _refreshInFlight = null;
    });
  }
  return _refreshInFlight;
}

/**
 * fetch with the Bearer header attached; on a 401, transparently refresh the
 * token once (shared across concurrent callers) and retry. Use for
 * token-protected endpoints.
 */
async function authedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const base = (init.headers as Record<string, string> | undefined) ?? {};
  const send = () => fetch(url, { ...init, headers: authHeaders(base) });
  let res = await send();
  if (res.status === 401 && _authToken && _refresher) {
    const refreshed = await refreshOnce();
    if (refreshed) res = await send(); // authHeaders now carries the new token
  }
  return res;
}

export interface OidcTokens {
  access_token: string;
  refresh_token: string | null;
  expires_in: number | null;
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

/** GET /api/auth/me — current identity (requires a valid token when auth is on). */
export async function fetchMe(): Promise<MeResponse | null> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/auth/me`, {
      headers: authHeaders(),
    });
    if (!res.ok) return null;
    return MeResponseSchema.parse(await res.json());
  } catch {
    return null;
  }
}

/** The URL that starts the OIDC (Zitadel) login redirect. */
export function oidcLoginUrl(): string {
  return `${API_BASE}/api/auth/login`;
}

function toTokens(data: {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}): OidcTokens | null {
  if (!data.access_token) return null;
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? null,
    expires_in: data.expires_in ?? null,
  };
}

/** Exchange an OIDC authorization code for tokens via the backend. */
export async function exchangeOidcCode(code: string): Promise<OidcTokens | null> {
  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/api/auth/callback?code=${encodeURIComponent(code)}`,
      {},
      15_000,
    );
    if (!res.ok) return null;
    return toTokens(await res.json());
  } catch {
    return null;
  }
}

/** Exchange a refresh token for a fresh access token. Null => must re-login. */
export async function refreshTokens(refreshToken: string): Promise<OidcTokens | null> {
  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/api/auth/refresh`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      },
      15_000,
    );
    if (!res.ok) return null;
    const tokens = toTokens(await res.json());
    // Some IdPs don't rotate the refresh token; keep the old one if absent.
    if (tokens && !tokens.refresh_token) tokens.refresh_token = refreshToken;
    return tokens;
  } catch {
    return null;
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
