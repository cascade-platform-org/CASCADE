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
import { PropagationMetaSchema, PropagationResultSchema } from "./propagation";

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
   * Carrying both supply_capacity[c] and category_dependency_profiles[c].demand
   * for the same category is not rejected here or by the engine: the flow pass
   * reads the two independently, so the node enters that category's flow graph
   * as a source AND a consumer. The Inspector flags it (node-inspector.tsx,
   * SupplyDemandConflictWarning); it is a modelling slip, not a schema error.
   */
  supply_capacity: z.record(z.string(), z.number()).optional(),
  category_dependency_profiles: z.record(z.string(), CategoryDependencyProfileSchema).optional(),
  /**
   * Per-Event vulnerability: keyed by EventId, value 0..N−1. Higher = more
   * vulnerable; 0 = immune (same as absent — the inspector slider writes 0
   * rather than deleting the key). Imposed functionality = max(1, N − level).
   */
  vulnerability_levels: z.record(z.string(), z.number().int().min(0).max(100)).optional(),
  /**
   * Persisted last-known responsibility share for this node's current Functionality.
   * Keyed by ElementId or EventId; values in (0, 1] summing to 1.
   * Set by the engine after each Propagation and stored in the project file.
   */
  responsibility_share: z.record(z.string(), z.number().gt(0).lte(1)).optional(),
  /** Raw rule strings — authored with client-side autocomplete; parsed and evaluated by the engine. */
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
  /** Same semantics as on nodes: 0..N−1, 0 = immune (same as absent). */
  vulnerability_levels: z.record(z.string(), z.number().int().min(0).max(100)).optional(),
  /**
   * Persisted last-known responsibility share for this edge's current Functionality.
   * Keyed by ElementId or EventId; values in (0, 1] summing to 1.
   */
  responsibility_share: z.record(z.string(), z.number().gt(0).lte(1)).optional(),
  /** Raw rule strings — authored with client-side autocomplete; parsed and evaluated by the engine. */
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
// Geo anchor — one flow↔geo correspondence point plus zoom levels at anchor time
// ---------------------------------------------------------------------------

export const GeoAnchorSchema = z.object({
  /** Flow-space position of the correspondence point. */
  flow: PositionSchema,
  /** Geographic position of the correspondence point. */
  geo: GeoCoordSchema,
  /** React Flow zoom level at anchor time. */
  rf_zoom: z.number(),
  /** MapLibre zoom level at anchor time. */
  ml_zoom: z.number(),
});

export type GeoAnchor = z.infer<typeof GeoAnchorSchema>;

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
  /** MapLibre tile style id (liberty | bright | positron). */
  map_style: z.string().nullish(),
  /** Saved MapLibre center so the map reopens at the last-navigated position. */
  map_center: GeoCoordSchema.nullish(),
  /** Saved MapLibre zoom level. */
  map_zoom: z.number().nullish(),
  /** Bijective anchor tying one flow-space point to one geographic coordinate. */
  geo_anchor: GeoAnchorSchema.nullish(),
  /**
   * Full text of the original .inp file this canvas was imported from,
   * embedded automatically at import time. Required for graph_type="epanet"
   * propagation — the backend rebuilds the WNTR model from this string per
   * request (fully local-first, works on hosted deployments; see ADR-0013).
   */
  source_inp_content: z.string().nullish(),
  /**
   * demand_mode this canvas was imported with — reused by graph_type="epanet"
   * propagation for a consistent demand baseline. Mirrors the backend's
   * Literal["peak","peak_hour","base","avg"] (schemas/network.py Canvas).
   */
  source_inp_demand_mode: z.enum(["peak", "peak_hour", "base", "avg"]).nullish(),
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

// PropagationMetaSchema lives in ./propagation (shared with PropagationResultSchema).

// ---------------------------------------------------------------------------
// Any Update history
// ---------------------------------------------------------------------------

export const AnyUpdateTypeSchema = z.enum([
  "event_applied",
  "event_cleared",
  "propagation",
  "manual_functionality_update",
  "graph_update",
  // Reset button — Functionality restored to N. A session boundary: it ends
  // the current Situation (deriveSituation stops walking at it).
  "scenario_reset",
  // Temporal Jumps undone — the graph is back to its pre-jump state, so the
  // Situation is the one that was live before those jumps (see lib/situation.ts).
  "temporal_jump_revert",
]);

export const AnyUpdateEntrySchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  update_type: AnyUpdateTypeSchema,
  label: z.string(),
  scope: z.enum(["local", "global"]).optional(),
  canvas_id: z.string().optional(),
  event_id: z.string().optional(),
  /**
   * Populated only on temporal_jump_revert entries: the id of the newest
   * history entry at the moment the pre-jump snapshot was taken. It marks where
   * the reverted Temporal Jumps begin, so deriveSituation can resume from the
   * Situation that was live before them. Absent when that entry had already
   * been evicted from the capped history.
   */
  reverts_to_entry_id: z.string().optional(),
  before: GraphSnapshotSchema,
  after: GraphSnapshotSchema,
  propagation_meta: PropagationMetaSchema.optional(),
  /**
   * Populated only on event_applied entries.
   * Keys: "<elementId>.<fieldName>" (dot-notation, same as attribute_mutations).
   * Values: pre-event field values captured before the event was applied.
   * Used by clearEvent() to revert only the mutated fields, preserving changes
   * made to other fields after the event was applied.
   */
  mutation_reversal: z.record(z.string(), z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// Scorecard — discriminated union (ADR-0006)
// ---------------------------------------------------------------------------

/**
 * Propagation entry: before/after Scenario snapshots from a Propagation run.
 * Backward compat: old project files without `type` field default to "propagation"
 * via the preprocessor on ProjectSchema.scorecard below.
 */
export const PropagationScorecardEntrySchema = z.object({
  type: z.literal("propagation").default("propagation"),
  id: z.string(),
  label: z.string(),
  created_at: z.string(),
  /**
   * EventDefinition.id values for every Event applied since the last Propagation
   * (a user may stack several Events before running one Propagation — see
   * requirements.md §12.3a). Empty for Manual What-If entries. Newest-applied first.
   */
  event_ids: z.array(z.string()).default([]),
  before_propagation: GraphSnapshotSchema,
  after_propagation: GraphSnapshotSchema.optional(),
  after_temporal_jump: GraphSnapshotSchema.optional(),
  temporal_jump_hours: z.number().int().min(1).optional(),
  /** Base64-encoded PNG of GlobalViewCanvas at each snapshot. Captured at save time. */
  before_propagation_image: z.string().optional(),
  after_propagation_image: z.string().optional(),
  after_temporal_jump_image: z.string().optional(),
  propagation_result: PropagationResultSchema.optional(),
});

/**
 * Analysis entry: per-Element scores from a Topological Analysis metric run.
 */
export const AnalysisScorecardEntrySchema = z.object({
  type: z.literal("analysis"),
  id: z.string(),
  label: z.string(),
  created_at: z.string(),
  /** Analysis Metric name, e.g. "betweenness", "vitality", "shapley". */
  metric: z.string(),
  scope: z.enum(["local", "global"]),
  /** Set when scope = "local". */
  canvas_id: z.string().optional(),
  /** Per-Element score at computation time. Keys are element IDs. */
  scores: z.record(z.string(), z.number()).default({}),
  /** Graph state at time of computation. */
  snapshot: GraphSnapshotSchema,
  /** Base64-encoded PNG of the canvas with Analysis Heatmap applied. */
  image_png: z.string().optional(),
});

/** Discriminated union on `type`. */
export const ScorecardEntrySchema = z.discriminatedUnion("type", [
  PropagationScorecardEntrySchema,
  AnalysisScorecardEntrySchema,
]);

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
  /**
   * Graph type assigned to the Global view (all Canvases rendered together).
   * References a name in ModelConfiguration.graph_types.
   * Absent means no type is assigned — engine dispatches per-Canvas only.
   */
  global_graph_type: z.string().optional(),
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
  /**
   * Backward compat: old project files have Propagation entries without a `type`
   * field, and with a singular `event_id` instead of `event_ids` (before Situation
   * gained support for stacking several Events ahead of one Propagation, §12.3a).
   * The preprocessor injects `type: "propagation"` and migrates `event_id` into
   * `event_ids` before the discriminated union parser runs, so old files load
   * correctly without schema migration.
   */
  scorecard: z.preprocess(
    (val) => {
      if (!Array.isArray(val)) return val;
      return val.map((entry: unknown) => {
        if (typeof entry !== "object" || entry === null) return entry;
        const migrated = { ...(entry as Record<string, unknown>) };
        if (!("type" in migrated)) migrated.type = "propagation";
        if ("event_id" in migrated && !("event_ids" in migrated)) {
          const oldId = migrated.event_id;
          migrated.event_ids = typeof oldId === "string" ? [oldId] : [];
          delete migrated.event_id;
        }
        return migrated;
      });
    },
    z.array(ScorecardEntrySchema).default([]),
  ),
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
// GeoAnchor is declared inline above (after GeoAnchorSchema) to keep it close to its schema.
export type ProjectMeta = z.infer<typeof ProjectMetaSchema>;
export type GraphSnapshot = z.infer<typeof GraphSnapshotSchema>;
// PropagationMeta type is exported from ./propagation (via the schemas barrel).
export type AnyUpdateType = z.infer<typeof AnyUpdateTypeSchema>;
export type AnyUpdateEntry = z.infer<typeof AnyUpdateEntrySchema>;
export type PropagationScorecardEntry = z.infer<typeof PropagationScorecardEntrySchema>;
export type AnalysisScorecardEntry = z.infer<typeof AnalysisScorecardEntrySchema>;
export type ScorecardEntry = z.infer<typeof ScorecardEntrySchema>;
export type Project = z.infer<typeof ProjectSchema>;
