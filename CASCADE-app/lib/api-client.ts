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

// ---------------------------------------------------------------------------
// Propagation
// ---------------------------------------------------------------------------

/**
 * POST /api/propagate — send a PropagationRequest, return the validated result.
 * Throws an Error with the server detail on non-2xx responses, and a ZodError
 * if the response does not match PropagationResultSchema.
 */
export async function postPropagate(payload: PropagationRequest): Promise<PropagationResult> {
  const response = await fetch(`${API_BASE}/api/propagate`, {
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
  const response = await fetch(`${API_BASE}/api/engine/algorithms`);
  if (!response.ok) throw new Error(`Server returned ${response.status}`);
  return EngineAlgorithmsSchema.parse(await response.json());
}
