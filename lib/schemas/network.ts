/**
 * Zod schemas for the project graph (nodes, edges, canvases, project).
 *
 * These are the canonical frontend type definitions. TypeScript types are
 * inferred via z.infer<> — do not write separate interface files for the same
 * shapes. When the Pydantic schemas in backend/schemas/network.py change, run
 * `python backend/scripts/export_json_schema.py` to regenerate this file.
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

export const CategoryBlockSchema = z.object({
  /** 1..N. N = fully dependent (strict thresholds), 1 = barely dependent (high tolerance). */
  dependency_level: z.number().int().min(1),
  backup: z.boolean().optional(),
  /** Hours the backup can sustain the element. Only when backup = true. */
  backup_duration: z.number().int().min(0).optional(),
  /** Resource amount requested. SourceToDemands categories only. */
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
  node_type: z.enum(["Source", "Infrastructure", "Service", "Personnel"]).optional(),
  /** One or more category names from the config. */
  node_categories: z.array(z.string()).optional(),
  /** Remaining hours in time_warning state. 0 when not in time_warning. */
  functionality_time: z.number().int().min(0).optional(),
  /** Physical breakage set by a hazard — requires active repair. */
  direct_damage: z.boolean().optional(),
  /** Estimated repair duration when direct_damage = true. */
  expected_repair_time: z.number().int().min(0).optional(),
  importance: z.number().optional(),
  cost_of_disservice_per_day: z.number().optional(),
  position: PositionSchema.optional(),
  geo: GeoCoordSchema.optional(),
  /** Maximum resource supply per category. Source nodes only. */
  supply_capacity: z.record(z.string(), z.number()).optional(),
  /** Maximum throughput. Infrastructure nodes only. */
  capacity: z.number().optional(),
  category_blocks: z.record(z.string(), CategoryBlockSchema).optional(),
  /** Sensitivity to each hazard/disservice: keyed by hazard id, value 1..N. */
  vulnerability_levels: z.record(z.string(), z.number().int().min(1)).optional(),
  /** Upstream elements that caused current degradation. Set by engine or on hazard apply. */
  direct_causes: z.array(z.string()).optional(),
  /** Free-form attributes; hazard attribute_mutations may write here. */
  properties: z.record(z.string(), z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// Edge
// ---------------------------------------------------------------------------

/**
 * Edges carry no category or category_blocks.
 * The propagation engine infers which categories flow through an edge from the
 * intersection of the source node's supply and the target node's demands.
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
  direct_causes: z.array(z.string()).optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
});

/** An edge that crosses canvas boundaries. Extends Edge with canvas anchors. */
export const InterCanvasEdgeSchema = EdgeSchema.extend({
  source_canvas: z.string(),
  target_canvas: z.string(),
});

// ---------------------------------------------------------------------------
// Canvas & Project
// ---------------------------------------------------------------------------

export const CanvasSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  /** Display colour for canvas tabs and layer controls (hex string, e.g. "#3b82f6"). */
  color: z.string().optional(),
  /**
   * EPSG code for the CRS used by node geo fields.
   * Defaults to "EPSG:4326" (WGS84 decimal degrees) when absent.
   */
  crs: z.string().optional(),
  /** When true, node positions have meaningful geo coordinates in Canvas.crs. */
  georeferenced: z.boolean().optional(),
  nodes: z.array(NodeSchema).optional(),
  edges: z.array(EdgeSchema).optional(),
});

export const ProjectMetaSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Graph snapshot (used in simulation history)
// ---------------------------------------------------------------------------

/**
 * Lightweight snapshot of the graph state at a point in time.
 * Stores only canvas data — not project meta or history — so snapshots
 * are self-contained and do not nest recursively.
 */
export const GraphSnapshotSchema = z.object({
  canvases: z.array(CanvasSchema),
  inter_canvas_edges: z.array(InterCanvasEdgeSchema).optional(),
});

/**
 * Metadata captured from a propagation run, stored alongside a history entry.
 * Lighter than a full PropagationResult — no per-element updates, just run stats.
 */
export const PropagationMetaSchema = z.object({
  scope: z.enum(["local", "global"]),
  iterations: z.number().int().min(0),
  warnings: z.array(z.string()).default([]),
  /** ISO 8601 UTC timestamp when the engine completed the run. */
  computed_at: z.string(),
});

// ---------------------------------------------------------------------------
// Simulation history
// ---------------------------------------------------------------------------

/**
 * One entry in the simulation history: a before/after graph snapshot pair.
 *
 * Created when the user applies a hazard, clears a hazard, or receives a
 * propagation result. Restoring a state means replacing the current canvases
 * with `entry.after.canvases` (or `entry.before.canvases` to undo).
 *
 * The project caps the array at 20 entries (latest first) in the store layer.
 */
export const SimulationHistoryEntrySchema = z.object({
  id: z.string(),
  /** ISO 8601 UTC. */
  timestamp: z.string(),
  event_type: z.enum(["hazard_applied", "hazard_cleared", "propagation"]),
  /** Human-readable label shown in the history panel. */
  label: z.string(),
  scope: z.enum(["local", "global"]).optional(),
  /** Canvas id — set for local-scope events. */
  canvas_id: z.string().optional(),
  /** Hazard definition id — set for hazard events. */
  hazard_id: z.string().optional(),
  before: GraphSnapshotSchema,
  after: GraphSnapshotSchema,
  /** Engine run stats — set for propagation events only. */
  propagation_meta: PropagationMetaSchema.optional(),
});

export const ProjectSchema = z.object({
  /** Must be "2.0". */
  version: z.literal("2.0"),
  meta: ProjectMetaSchema,
  canvases: z.array(CanvasSchema),
  inter_canvas_edges: z.array(InterCanvasEdgeSchema).optional(),
  /**
   * Ring buffer of before/after graph snapshots, latest first.
   * Capped at 20 entries by the store layer — entries beyond that are
   * silently dropped on save.
   */
  simulation_history: z.array(SimulationHistoryEntrySchema).default([]),
});

// ---------------------------------------------------------------------------
// Inferred TypeScript types
// ---------------------------------------------------------------------------

export type Position = z.infer<typeof PositionSchema>;
export type GeoCoords = z.infer<typeof GeoCoordSchema>;
export type CategoryBlock = z.infer<typeof CategoryBlockSchema>;
export type CategoryBlocks = Record<string, CategoryBlock>;
export type VulnerabilityLevels = Record<string, number>;
/** ElementId or HazardId or "Initialization" (manual edit with no upstream cause). */
export type DirectCause = string;
export type Node = z.infer<typeof NodeSchema>;
export type Edge = z.infer<typeof EdgeSchema>;
export type InterCanvasEdge = z.infer<typeof InterCanvasEdgeSchema>;
export type Canvas = z.infer<typeof CanvasSchema>;
export type ProjectMeta = z.infer<typeof ProjectMetaSchema>;
export type GraphSnapshot = z.infer<typeof GraphSnapshotSchema>;
export type PropagationMeta = z.infer<typeof PropagationMetaSchema>;
export type SimulationHistoryEntry = z.infer<typeof SimulationHistoryEntrySchema>;
export type Project = z.infer<typeof ProjectSchema>;
