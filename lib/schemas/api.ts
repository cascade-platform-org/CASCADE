/**
 * Zod schemas for API request/response types (propagation, auth, sync).
 *
 * Canonical frontend types — inferred via z.infer<>. Mirrors
 * backend/schemas/results.py and backend/schemas/auth.py.
 * Run `python backend/scripts/export_json_schema.py` after Pydantic changes.
 */
import { z } from "zod";
import { ProjectSchema } from "./network";
import { ModelConfigurationSchema } from "./config";

// ---------------------------------------------------------------------------
// Authentication (OAuth2 / OIDC)
// ---------------------------------------------------------------------------

/**
 * The four built-in RBAC roles. Must stay in sync with backend/schemas/auth.py
 * and the role definitions in backend/db/seed.sql.
 *
 * viewer   → can_view_analysis only
 * analyst  → can_propagate, can_view_analysis
 * manager  → can_propagate, can_view_analysis, can_manage_users
 * admin    → wildcard (all permissions)
 */
export const UserRoleSchema = z.enum(["viewer", "analyst", "manager", "admin"]);

export const AuthUserSchema = z.object({
  /** Stable subject identifier from the OIDC provider. */
  sub: z.string(),
  email: z.string().email(),
  display_name: z.string(),
  roles: z.array(UserRoleSchema),
});

export const TokenPairSchema = z.object({
  access_token: z.string(),
  /** Opaque token used to obtain a new access_token without re-login. */
  refresh_token: z.string(),
  /** Seconds until the access_token expires. */
  expires_in: z.number().int().positive(),
  token_type: z.literal("Bearer"),
});

// ---------------------------------------------------------------------------
// Propagation — POST /api/propagate
// ---------------------------------------------------------------------------

/**
 * Sent to POST /api/propagate.
 * Hazard effects (functionality drops, direct_damage, attribute_mutations)
 * are applied client-side before this call. The engine receives the resulting
 * graph state and propagates cascading failures.
 */
export const PropagationRequestSchema = z.object({
  project: ProjectSchema,
  config: ModelConfigurationSchema,
  scope: z.enum(["local", "global"]),
  /** Canvas id to restrict propagation when scope = "local". */
  active_canvas_id: z.string().optional(),
});

/**
 * Engine's update for a single Element (node or edge) after a Propagation.
 * `id` is a globally unique Element ID — look it up directly in
 * Project.nodes or Project.edges. No canvas_id needed.
 */
export const ElementUpdateSchema = z.object({
  id: z.string(),
  functionality: z.number().int().min(1),
  functionality_time: z.number().int().min(0).optional(),
  direct_damage: z.boolean().optional(),
  expected_repair_time: z.number().int().min(0).optional(),
  /**
   * Keyed by ElementId or EventId. Values are in (0, 1] and sum to 1.
   * Identifies which upstream Elements or Events are directly responsible
   * for this Element's degradation, and in what proportion.
   */
  responsibility_share: z.record(z.string(), z.number().gt(0).lte(1)).optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
});

export const PropagationResultSchema = z.object({
  scope: z.enum(["local", "global"]),
  /** Deltas from the engine — apply these on top of the project state. */
  updates: z.array(ElementUpdateSchema),
  /** ISO timestamp when the engine completed the run. */
  computed_at: z.string(),
  /** Number of propagation iterations performed. */
  iterations: z.number().int().min(0),
  /** Non-fatal engine warnings (e.g. convergence not reached, isolated subgraph). */
  warnings: z.array(z.string()).optional(),
});

// ---------------------------------------------------------------------------
// Server-side project sync (opt-in) — /api/projects
// ---------------------------------------------------------------------------

export const RemoteProjectRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const SyncUploadRequestSchema = z.object({
  project: ProjectSchema,
  config: ModelConfigurationSchema,
});

export const SyncDownloadResponseSchema = z.object({
  record: RemoteProjectRecordSchema,
  project: ProjectSchema,
  config: ModelConfigurationSchema,
});

// ---------------------------------------------------------------------------
// Engine algorithms — GET /api/engine/algorithms
// ---------------------------------------------------------------------------

/**
 * Describes one tunable parameter of a heuristic algorithm.
 * The frontend renders a typed form field from this descriptor.
 */
export const HeuristicParamMetaSchema = z.object({
  name: z.string(),
  label: z.string(),
  description: z.string().optional(),
  /** JSON Schema primitive type. */
  type: z.enum(["integer", "number", "boolean", "string"]),
  default: z.unknown().optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  /** Constrained choices for string/integer params. */
  enum: z.array(z.unknown()).optional(),
});

/**
 * Metadata for one engine heuristic.
 * Used to populate the heuristic selector and render parameter forms in the
 * graph-type config UI.
 */
export const HeuristicMetaSchema = z.object({
  /** Stable id used in HeuristicConfig.id in the project config file. */
  id: z.string(),
  label: z.string(),
  description: z.string(),
  /**
   * Graph types this heuristic can be applied to.
   * Empty array = unrestricted (applicable to all graph types).
   */
  applicable_graph_types: z.array(z.string()).default([]),
  default_enabled: z.boolean().default(true),
  /** Tunable parameters. Empty = no configurable parameters. */
  params: z.array(HeuristicParamMetaSchema).default([]),
});

/**
 * Metadata for one engine-known graph type.
 * Used to populate the canvas graph_type selector and show default pipelines.
 */
export const GraphTypeMetaSchema = z.object({
  /** Stable id used in Canvas.graph_type. */
  name: z.string(),
  label: z.string(),
  description: z.string(),
  /**
   * Ordered heuristic ids the engine applies by default for this type.
   * Shown in the UI before the user customises the pipeline.
   */
  default_heuristics: z.array(z.string()),
});

/**
 * Returned by GET /api/engine/algorithms.
 * Read-only metadata — does not change system state.
 * Requires only viewer role.
 */
export const EngineAlgorithmsSchema = z.object({
  graph_types: z.array(GraphTypeMetaSchema),
  heuristics: z.array(HeuristicMetaSchema),
});

// ---------------------------------------------------------------------------
// Generic API envelope
// ---------------------------------------------------------------------------

export const ApiErrorSchema = z.object({
  ok: z.literal(false),
  /** Machine-readable error code, e.g. "VALIDATION_ERROR", "UNAUTHORIZED". */
  code: z.string(),
  message: z.string(),
});

export function ApiSuccessSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({ ok: z.literal(true), data: dataSchema });
}

export function ApiResponseSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.discriminatedUnion("ok", [ApiSuccessSchema(dataSchema), ApiErrorSchema]);
}

// ---------------------------------------------------------------------------
// Batch propagation (async) — POST /api/propagate/batch
// ---------------------------------------------------------------------------

/**
 * One propagation job within a batch request.
 * `item_id` is caller-assigned and echoed back in the job results so the
 * caller can match results to requests without relying on list order.
 *
 * Use batch when running multiple independent scenario comparisons (e.g.
 * sweeping over several hazard configurations). Single propagation runs
 * use the synchronous POST /api/propagate endpoint instead.
 */
export const BatchPropagationItemSchema = z.object({
  item_id: z.string(),
  project: ProjectSchema,
  config: ModelConfigurationSchema,
  scope: z.enum(["local", "global"]),
  active_canvas_id: z.string().optional(),
});

export const BatchPropagationRequestSchema = z.object({
  items: z.array(BatchPropagationItemSchema).min(1),
});

/**
 * Returned immediately by POST /api/propagate/batch.
 * Connect to `stream_url` to receive live SSE events (BatchPropagationJobStatus).
 * Polling GET /api/propagate/batch/{job_id} is also supported.
 */
export const BatchPropagationCreatedResponseSchema = z.object({
  job_id: z.string(),
  status: z.literal("queued"),
  total: z.number().int().min(0),
  /** Server-relative URL for the SSE stream, e.g. /api/propagate/batch/{job_id}/stream */
  stream_url: z.string(),
});

/**
 * Snapshot of a batch job's state.
 *
 * Returned by GET /api/propagate/batch/{job_id} (polling) and sent as
 * individual SSE events on GET /api/propagate/batch/{job_id}/stream.
 * Each SSE message body is a JSON-serialised BatchPropagationJobStatus:
 *
 *   data: {json}\n\n
 *
 * The stream closes after the terminal event where status is "done" or "failed".
 * `results` and `errors` grow incrementally — early events carry partial data.
 */
export const BatchPropagationJobStatusSchema = z.object({
  job_id: z.string(),
  status: z.enum(["queued", "running", "done", "failed"]),
  created_at: z.string(),
  completed_at: z.string().optional(),
  total: z.number().int().min(0),
  completed: z.number().int().min(0),
  /** Keyed by item_id. Present only for completed items. */
  results: z.record(z.string(), PropagationResultSchema).default({}),
  /** Keyed by item_id. Error message for failed items. */
  errors: z.record(z.string(), z.string()).default({}),
});

// ---------------------------------------------------------------------------
// Inferred TypeScript types
// ---------------------------------------------------------------------------

export type UserRole = z.infer<typeof UserRoleSchema>;
export type AuthUser = z.infer<typeof AuthUserSchema>;
export type TokenPair = z.infer<typeof TokenPairSchema>;
export type PropagationRequest = z.infer<typeof PropagationRequestSchema>;
export type ElementUpdate = z.infer<typeof ElementUpdateSchema>;
export type PropagationResult = z.infer<typeof PropagationResultSchema>;
export type RemoteProjectRecord = z.infer<typeof RemoteProjectRecordSchema>;
export type SyncUploadRequest = z.infer<typeof SyncUploadRequestSchema>;
export type SyncDownloadResponse = z.infer<typeof SyncDownloadResponseSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type HeuristicParamMeta = z.infer<typeof HeuristicParamMetaSchema>;
export type HeuristicMeta = z.infer<typeof HeuristicMetaSchema>;
export type GraphTypeMeta = z.infer<typeof GraphTypeMetaSchema>;
export type EngineAlgorithms = z.infer<typeof EngineAlgorithmsSchema>;
export type BatchPropagationItem = z.infer<typeof BatchPropagationItemSchema>;
export type BatchPropagationRequest = z.infer<typeof BatchPropagationRequestSchema>;
export type BatchPropagationCreatedResponse = z.infer<typeof BatchPropagationCreatedResponseSchema>;
export type BatchPropagationJobStatus = z.infer<typeof BatchPropagationJobStatusSchema>;
