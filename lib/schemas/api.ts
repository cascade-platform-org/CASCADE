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

// Engine response schemas (ElementUpdateSchema, PropagationResultSchema) live
// in ./propagation — import them from there or from the "@/lib/schemas" barrel.

// ---------------------------------------------------------------------------
// Authentication (OAuth2 / OIDC)
// ---------------------------------------------------------------------------

/**
 * The four built-in RBAC roles. Must stay in sync with backend/auth/rbac.py
 * and the role definitions in backend/db/seed.sql.
 *
 * viewer   → can_view_analysis only
 * analyst  → can_propagate, can_view_analysis, can_sync
 * manager  → can_propagate, can_view_analysis, can_sync, can_manage_users
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
// Inferred TypeScript types
// ---------------------------------------------------------------------------

export type UserRole = z.infer<typeof UserRoleSchema>;
export type AuthUser = z.infer<typeof AuthUserSchema>;
export type TokenPair = z.infer<typeof TokenPairSchema>;
export type PropagationRequest = z.infer<typeof PropagationRequestSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type HeuristicParamMeta = z.infer<typeof HeuristicParamMetaSchema>;
export type HeuristicMeta = z.infer<typeof HeuristicMetaSchema>;
export type GraphTypeMeta = z.infer<typeof GraphTypeMetaSchema>;
export type EngineAlgorithms = z.infer<typeof EngineAlgorithmsSchema>;
