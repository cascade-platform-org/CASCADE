/**
 * api-client.ts — Thin HTTP client for the CASCADE backend.
 *
 * All calls validate responses with Zod at the boundary.
 * No auth token handling here yet (deferred to Slice 4).
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
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
