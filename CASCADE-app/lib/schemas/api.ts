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
  /** users.id UUID (as text); absent in local-only mode. Mirrors AuthUser.db_id. */
  db_id: z.string().nullable().optional(),
});

// TokenPair was removed on both sides of the boundary when tokens moved into
// httpOnly cookies (backend schemas/auth.py has the matching note): /callback
// and /refresh now return {"ok": true} and set cookies, so there is no token
// response body left to describe.

// ---------------------------------------------------------------------------
// Server Sync — GET/POST/DELETE /api/projects (requirements.md §13.4)
// ---------------------------------------------------------------------------

/** The exact envelope lib/file-io.ts already saves/loads locally
 *  (ProjectBundle) — reused here so sync round-trips the identical shape. */
export const ProjectBundleSchema = z.object({
  project: ProjectSchema,
  config: ModelConfigurationSchema,
});

/** One saved version, without the (potentially large) bundle — the list view. */
export const ProjectVersionSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const ProjectVersionDetailSchema = ProjectVersionSummarySchema.extend({
  data: ProjectBundleSchema,
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
// Inferred TypeScript types
// ---------------------------------------------------------------------------

export type UserRole = z.infer<typeof UserRoleSchema>;
export type AuthUser = z.infer<typeof AuthUserSchema>;
export type ProjectVersionSummary = z.infer<typeof ProjectVersionSummarySchema>;
export type ProjectVersionDetail = z.infer<typeof ProjectVersionDetailSchema>;
export type PropagationRequest = z.infer<typeof PropagationRequestSchema>;
export type HeuristicParamMeta = z.infer<typeof HeuristicParamMetaSchema>;
export type HeuristicMeta = z.infer<typeof HeuristicMetaSchema>;
export type GraphTypeMeta = z.infer<typeof GraphTypeMetaSchema>;
export type EngineAlgorithms = z.infer<typeof EngineAlgorithmsSchema>;
