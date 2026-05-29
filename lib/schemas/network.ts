/**
 * Zod schemas for the project graph (nodes, edges, canvases, project).
 *
 * Canonical frontend type definitions — TypeScript types are inferred via z.infer<>.
 * Mirrors backend/schemas/network.py. After Pydantic changes run:
 * `python backend/scripts/export_json_schema.py`
 *
 * Key design decision (ADR-0001):
 * Elements have globally unique IDs and live in a single authoritative registry
 * at the Project level (Project.nodes, Project.edges). Each Canvas/Graph holds
 * only lists of element IDs it visualises — not copies of element data.
 * An element may appear in multiple Canvases without duplication.
 * "Inter-canvas edge" is a UI render-time concept only — no special type exists.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const GeoCoordSchema = z.object({
  lng: z.number(),
  lat: z.number(),
  alt: z.number().optional(),
  /** Override the parent Canvas CRS for this point. Inherits Canvas.crs when absent. */
  crs: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Category block (per-category dependency attributes on a node)
// ---------------------------------------------------------------------------

export const CategoryDependencyProfileSchema = z.object({
  /**
   * 1..N. N = fully dependent (strict thresholds), 1 = barely dependent (high tolerance).
   * Inverse of the Functionality scale: high dependency_level → fails hard on upstream degradation.
   */
  dependency_level: z.number().int().min(1),
  /** Maximum throughput for this category. Degrades proportionally with Functionality. */
  capacity: z.number().min(0).optional(),
  backup: z.boolean().optional(),
  /** Hours the backup can sustain the element. SourceToDemands only. */
  backup_duration: z.number().int().min(0).optional(),
  /** Resource amount requested. SourceToDemands only. */
  demand: z.number().min(0).optional(),
  /** Flow allocation priority 1–10. SourceToDemands only. */
  priority: z.number().int().min(1).max(10).optional(),
});

// ---------------------------------------------------------------------------
// Node
// ---------------------------------------------------------------------------

export const NodeSchema = z.object({
  id: z.string(),
  /** Integer 1 (worst/critical) .. N (best/operational). */
  functionality: z.number().int().min(1),
  label: z.string().optional(),
  /** Free string — valid values defined in Client Configuration, not hardcoded in schema. */
  node_type: z.string().optional(),
  /** One or more category names from the ModelConfiguration. */
  node_categories: z.array(z.string()).optional(),
  /** Remaining hours in time_warning state. 0 when not in time_warning. */
  functionality_time: z.number().int().min(0).optional(),
  /** Physical breakage set by a Hazard — requires active repair. */
  direct_damage: z.boolean().optional(),
  /** Estimated repair duration when direct_damage = true. */
  expected_repair_time: z.number().int().min(0).optional(),
  importance: z.number().optional(),
  cost_of_disservice_per_day: z.number().optional(),
  position: PositionSchema.optional(),
  geo: GeoCoordSchema.optional(),
  /**
   * Maximum resource supply per category. Present only on Source nodes.
   * Effective supply = supply_capacity[cat] × (functionality / N).
   * A node must not carry both supply_capacity[c] and category_dependency_profiles[c].demand
   * for the same category — the engine warns and treats it as supply-only.
   */
  supply_capacity: z.record(z.string(), z.number()).optional(),
  category_dependency_profiles: z.record(z.string(), CategoryDependencyProfileSchema).optional(),
  /** Per-Event vulnerability: keyed by EventId, value 1..N. Higher = more vulnerable (drops further). */
  vulnerability_levels: z.record(z.string(), z.number().int().min(1)).optional(),
  /**
   * Persisted last-known responsibility share for this node's current Functionality.
   * Keyed by ElementId or EventId; values in (0, 1] summing to 1.
   * Set by the engine after each Propagation and stored in the project file.
   */
  responsibility_share: z.record(z.string(), z.number().gt(0).lte(1)).optional(),
  /** Raw rule strings — parsed and validated client-side; evaluated by the engine. */
  rules: z.array(z.string()).optional(),
  /** Free-form attributes; Event attribute_mutations may write here. */
  properties: z.record(z.string(), z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// Edge
// ---------------------------------------------------------------------------

/**
 * Edges carry no category or category_blocks.
 * The engine infers which categories flow through an edge from the
 * intersection of the source node's supply and the target node's demands.
 *
 * "Inter-canvas edge" is a UI concept only — computed at render time when
 * an edge's target node is not in the current Canvas's node_ids.
 * No special type or field exists in the data model.
 */
export const EdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  functionality: z.number().int().min(1),
  functionality_time: z.number().int().min(0).optional(),
  direct_damage: z.boolean().optional(),
  expected_repair_time: z.number().int().min(0).optional(),
  capacity: z.number().optional(),
  vulnerability_levels: z.record(z.string(), z.number().int().min(1)).optional(),
  /**
   * Persisted last-known responsibility share for this edge's current Functionality.
   * Keyed by ElementId or EventId; values in (0, 1] summing to 1.
   */
  responsibility_share: z.record(z.string(), z.number().gt(0).lte(1)).optional(),
  /** Raw rule strings — parsed and validated client-side; evaluated by the engine. */
  rules: z.array(z.string()).optional(),
  /**
   * React Flow handle id on the source node — records which of the six
   * connection dots the edge was drawn from. UI-only; ignored by the engine.
   */
  sourceHandle: z.string().optional(),
  /**
   * React Flow handle id on the target node — records which dot was connected to.
   * UI-only; ignored by the engine.
   */
  targetHandle: z.string().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// Graph — mathematical structure for one Entity
// ---------------------------------------------------------------------------

/**
 * The mathematical structure of one Entity: element references + graph type.
 *
 * node_ids and edge_ids reference elements in the Project-level registry.
 * The same element ID may appear in multiple Graphs without duplication.
 * graph_type tells the engine which heuristic pipeline to apply.
 */
export const GraphSchema = z.object({
  graph_type: z.string(),
  node_ids: z.array(z.string()).default([]),
  edge_ids: z.array(z.string()).default([]),
});

// ---------------------------------------------------------------------------
// Canvas — named UI container for one Graph
// ---------------------------------------------------------------------------

export const CanvasSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  /** Hex colour string for canvas tabs and layer controls, e.g. "#3b82f6". */
  color: z.string().optional(),
  /**
   * EPSG code for the CRS used by node geo fields.
   * Defaults to "EPSG:4326" (WGS84 decimal degrees) when absent.
   */
  crs: z.string().optional(),
  /** When true, node positions have meaningful geo coordinates in Canvas.crs. */
  georeferenced: z.boolean().optional(),
  graph: GraphSchema,
});

// ---------------------------------------------------------------------------
// Graph snapshot (used in Any Update history)
// ---------------------------------------------------------------------------

/**
 * Point-in-time serialisation of the full project graph state.
 * Captures both the element registry and the Canvas membership structure.
 * Used as before/after state in AnyUpdateEntry.
 * Code-level representation of a Scenario.
 */
export const GraphSnapshotSchema = z.object({
  nodes: z.record(z.string(), NodeSchema).default({}),
  edges: z.record(z.string(), EdgeSchema).default({}),
  canvases: z.array(CanvasSchema).default([]),
});

export const PropagationMetaSchema = z.object({
  scope: z.enum(["local", "global"]),
  iterations: z.number().int().min(0),
  warnings: z.array(z.string()).default([]),
  computed_at: z.string(),
});

// ---------------------------------------------------------------------------
// Any Update history
// ---------------------------------------------------------------------------

export const AnyUpdateTypeSchema = z.enum([
  "event_applied",
  "event_cleared",
  "propagation",
  "manual_functionality_update",
  "graph_update",
]);

export const AnyUpdateEntrySchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  update_type: AnyUpdateTypeSchema,
  label: z.string(),
  scope: z.enum(["local", "global"]).optional(),
  canvas_id: z.string().optional(),
  event_id: z.string().optional(),
  before: GraphSnapshotSchema,
  after: GraphSnapshotSchema,
  propagation_meta: PropagationMetaSchema.optional(),
});

// ---------------------------------------------------------------------------
// Scorecard
// ---------------------------------------------------------------------------

/**
 * One entry in the Scorecard: a named Scenario pair (before + after Propagation)
 * explicitly saved by the user.
 *
 * `scenario_before` — the GraphSnapshot fed to the engine (post-Event,
 *   post-manual-edit, or restored from history). Optional only for manually
 *   crafted entries that were never sent to the engine.
 * `scenario_after`  — the GraphSnapshot after the engine's updates have been
 *   merged into the registry. Stored explicitly so the UI can display both
 *   states directly without recomputing from the delta.
 * `propagation_result` — the raw engine delta (ElementUpdate list). Kept for
 *   causal analysis (responsibility_share) and warnings. Optional: absent when
 *   the entry was saved from a manual Scenario without running Propagation.
 *
 * Derived metrics (Operativity Score, cost, breakdown) are computed
 * client-side from the snapshots and are never stored here.
 */
export const ScorecardEntrySchema = z.object({
  id: z.string(),
  label: z.string(),
  created_at: z.string(),
  /** Snapshot of the Scenario fed to the engine (the "before" state). */
  scenario_before: GraphSnapshotSchema,
  /**
   * Snapshot after Propagation results have been applied (the "after" state).
   * Absent when the entry was saved from a manual Scenario without Propagation.
   */
  scenario_after: GraphSnapshotSchema.optional(),
  /**
   * Lazy reference to PropagationResultSchema (defined in api.ts).
   * Use z.lazy to avoid circular import issues at module load time.
   */
  propagation_result: z.lazy(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PropagationResultSchema } = require("./api");
    return PropagationResultSchema.optional();
  }).optional(),
});

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export const ProjectMetaSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export const ProjectSchema = z.object({
  version: z.literal("2.0"),
  meta: ProjectMetaSchema,
  /** Global node registry. Keys are globally unique node IDs. */
  nodes: z.record(z.string(), NodeSchema).default({}),
  /** Global edge registry. Keys are globally unique edge IDs. */
  edges: z.record(z.string(), EdgeSchema).default({}),
  /**
   * Each Canvas holds a Graph whose node_ids/edge_ids reference the registry.
   * An element may appear in multiple Canvases without duplication.
   */
  canvases: z.array(CanvasSchema).default([]),
  /**
   * Ring buffer of Any Update entries, latest first.
   * CTRL+Z pops from this list. Capped at 20 entries by the store layer.
   */
  update_history: z.array(AnyUpdateEntrySchema).default([]),
  /**
   * User-curated atlas of named Scenarios and their Propagation results.
   * Persisted in the project file. Derived metrics are computed client-side.
   */
  scorecard: z.array(ScorecardEntrySchema).default([]),
});

// ---------------------------------------------------------------------------
// Inferred TypeScript types
// ---------------------------------------------------------------------------

export type Position = z.infer<typeof PositionSchema>;
export type GeoCoords = z.infer<typeof GeoCoordSchema>;
export type CategoryDependencyProfile = z.infer<typeof CategoryDependencyProfileSchema>;
export type CategoryDependencyProfiles = Record<string, CategoryDependencyProfile>;
export type VulnerabilityLevels = Record<string, number>;
/** Keyed by ElementId or EventId; values in (0,1] summing to 1. */
export type ResponsibilityShare = Record<string, number>;
export type Node = z.infer<typeof NodeSchema>;
export type Edge = z.infer<typeof EdgeSchema>;
export type Graph = z.infer<typeof GraphSchema>;
export type Canvas = z.infer<typeof CanvasSchema>;
export type ProjectMeta = z.infer<typeof ProjectMetaSchema>;
export type GraphSnapshot = z.infer<typeof GraphSnapshotSchema>;
export type PropagationMeta = z.infer<typeof PropagationMetaSchema>;
export type AnyUpdateType = z.infer<typeof AnyUpdateTypeSchema>;
export type AnyUpdateEntry = z.infer<typeof AnyUpdateEntrySchema>;
export type ScorecardEntry = z.infer<typeof ScorecardEntrySchema>;
export type Project = z.infer<typeof ProjectSchema>;
