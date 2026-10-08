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
import { UNSAFE_KEY_MESSAGE, isSafeKey } from "./field-path";
import { PropagationMetaSchema, PropagationResultSchema } from "./propagation";
import { StoredTemporalSimulationSchema, migrateProjectSimulations } from "./temporal-simulation";

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
  backup: z.boolean().optional(),
  /** Hours the backup can sustain the element. SourceToDemands only. */
  backup_duration: z.number().int().min(0).optional(),
  /** Resource amount requested. SourceToDemands only. */
  demand: z.number().min(0).optional(),
  /** Flow allocation priority 1–10. SourceToDemands only. */
  priority: z.number().int().min(1).max(10).optional(),
});

// ---------------------------------------------------------------------------
// Stock (ADR-0020)
// ---------------------------------------------------------------------------

/**
 * A supply rate with a level that persists across Temporal Simulation periods.
 * Sits where a bare number would: `supply_capacity[category]` or an edge's
 * `capacity`. The engine never reads one: `buildPropagationPayload` sends its
 * supply number. With `max_fill` it is storage (§1c): filled and drawn last.
 */
export const StockSchema = z
  .object({
    /** Per-period capacity basis: what a bare number would carry. */
    rate: z.number().min(0),
    /** Credited each period; absent = rate. */
    inflow: z.number().optional(),
    /** Signed amount on hand; positive = available to draw. */
    level: z.number(),
    /** Floor of the level; absent = 0. */
    min: z.number().optional(),
    /** Ceiling of the level; absent = none. */
    max: z.number().optional(),
    /** Most the level may add to supply per period. */
    max_draw: z.number().min(0).optional(),
    /** Set = storage: most it may take from the network per period. */
    max_fill: z.number().min(0).optional(),
    /** Multiplier on the level each period (decay, interest). */
    retention: z.number().min(0).default(1),
    /** Multiplier on the credited inflow (transfer loss). */
    efficiency: z.number().min(0).default(1),
    level_reference: z.number().gt(0).optional(),
    change_reference: z.number().gt(0).optional(),
  })
  .strict()
  .refine((s) => s.max === undefined || s.max >= (s.min ?? 0), {
    message: "a Stock's max must be at least its min (absent min = 0)",
    path: ["max"],
  });
export type Stock = z.infer<typeof StockSchema>;

/** A capacity as stored: a plain per-period number, or a Stock. */
export const CapacityValueSchema = z.union([z.number(), StockSchema]);
export type CapacityValue = z.infer<typeof CapacityValueSchema>;

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
  supply_capacity: z.record(z.string(), CapacityValueSchema).optional(),
  /**
   * Keyed by category. How much this node can PASS ON, as opposed to produce.
   * Effective throughput = throughput_capacity[cat] × (functionality / N);
   * absent means the category's largest declared supply, or unbounded when the
   * category has no source. Lived on the dependency profile as `capacity`
   * until it moved beside `supply_capacity`; the backend migrates old files on
   * load (`Node._migrate_legacy_throughput`).
   */
  throughput_capacity: z.record(z.string(), z.number().min(0)).optional(),
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
  /** Free-form attributes; an Event's Attribute Operations may write here. */
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
  /** A Stock here adds edge capacity and no supply (ADR-0020 §1b). */
  capacity: CapacityValueSchema.optional(),
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
  /** Hex colour for canvas tabs and layer controls — from `CANVAS_PALETTE`. */
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

/**
 * Sentinel for a field that did not exist on one side of a Graph Diff.
 *
 * The single frontend declaration: `lib/event-application.ts` re-exports it as
 * `ABSENT` rather than declaring its own. It must still stay byte-identical to
 * `ABSENT` in `schemas/network.py`, which is the same constant in the other
 * language. Applying a diff that names ABSENT DELETES the key rather than
 * writing `null`: an optional-but-not-nullable field set to `null` fails this
 * schema and desyncs the Scorecard dedup hash from the true state.
 */
export const DIFF_ABSENT = "__CASCADE_ABSENT__";

/**
 * One field's value on each side of a Graph Diff.
 *
 * `field` is data, not part of a string key: MutationReversal's
 * `"<elementId>.<field>"` convention has to split on the last dot, and EPANET
 * element ids contain dots (`J.12.A`).
 *
 * `path` addresses a value nested inside `field` (`["water", "demand"]` inside
 * `category_dependency_profiles`): the differ recurses into objects present on
 * both sides, so one nested write is recorded and reverted alone (ADR-0021,
 * ADR-0020 §4). Absent = the whole field. `key` is the legacy one-step form for
 * `properties`, read as `[key]` (`changePath` in `lib/graph-diff.ts`).
 */
export const FieldChangeSchema = z.object({
  field: z.string(),
  path: z.array(z.string().refine(isSafeKey, UNSAFE_KEY_MESSAGE)).optional(),
  key: z.string().refine(isSafeKey, UNSAFE_KEY_MESSAGE).optional(),
  before: z.unknown(),
  after: z.unknown(),
});

/** One Element or Canvas added, removed, or changed field-by-field. */
export const RecordDiffSchema = z.object({
  id: z.string(),
  op: z.enum(["add", "remove", "update"]),
  fields: z.array(FieldChangeSchema).default([]),
  /** Whole object; set for "add" (the new one) and "remove" (the old one). */
  record: z.record(z.string(), z.unknown()).optional(),
});

/**
 * A field-level, invertible description of what one Any Graph Update changed
 * (ADR-0017). Schema-agnostic: the differ enumerates keys actually present
 * rather than a known field list, so an attribute a Rule gains under ADR-0015
 * stays undoable without anyone editing the differ. Carries both directions,
 * so it applies forwards (redo) and backwards (undo) against the live graph.
 */
export const GraphDiffSchema = z.object({
  nodes: z.array(RecordDiffSchema).default([]),
  edges: z.array(RecordDiffSchema).default([]),
  canvases: z.array(RecordDiffSchema).default([]),
  /** Canvas order after / before — both set only when the order changed. */
  canvas_order: z.array(z.string()).optional(),
  canvas_order_before: z.array(z.string()).optional(),
});

export const AnyUpdateEntrySchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  update_type: AnyUpdateTypeSchema,
  label: z.string(),
  scope: z.enum(["local", "global"]).optional(),
  canvas_id: z.string().optional(),
  event_id: z.string().optional(),
  /**
   * Set only on the event_applied entry for a Temporal Jump (event_id starts
   * with "tj-"): the hours it advanced simulated time by. Read by clearEvent
   * to tell the −Xh revert control how much elapsed time to drop, without
   * parsing it back out of the human-readable label.
   */
  temporal_jump_hours: z.number().int().min(1).optional(),
  /**
   * Populated only on temporal_jump_revert entries: the id of the newest
   * history entry at the moment the pre-jump snapshot was taken. It marks where
   * the reverted Temporal Jumps begin, so deriveSituation can resume from the
   * Situation that was live before them. Absent when that entry had already
   * been evicted from the capped history.
   */
  reverts_to_entry_id: z.string().optional(),
  /**
   * What this update changed, both directions (ADR-0017). Absent only on
   * legacy entries, which carry the `before`/`after` snapshot pair instead.
   * Exactly one of the two is present on any entry this app writes.
   */
  diff: GraphDiffSchema.optional(),
  /** Legacy (pre-ADR-0017) whole-Scenario snapshots. Read, never written. */
  before: GraphSnapshotSchema.optional(),
  after: GraphSnapshotSchema.optional(),
  propagation_meta: PropagationMetaSchema.optional(),
  /**
   * Populated only on event_applied entries.
   * Keys: "<elementId>.<fieldName>" (dot-notation, split on the last dot).
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

/** One Stock as Level Mode showed it when a period was saved (ADR-0019 §6). */
export const StockValueSchema = z.object({
  element: z.string(),
  /** Absent for an edge Stock. */
  category: z.string().optional(),
  /** The level, or its change over the period, per `level_reading`. */
  value: z.number(),
  /** The reference used; absent = none. */
  reference: z.number().optional(),
});

/** One period of a saved run: its end state as a Graph Diff from the entry's `start`, its row, its Stocks' changes. */
export const SimulationPeriodSchema = z.object({
  label: z.string(),
  diff: GraphDiffSchema,
  /** Column name → value at the period (standard and custom Metrics); null = no value. */
  metrics: z.record(z.string(), z.number().nullable()).default({}),
  /** Each Stock's change over the period, with its reference; the level is read off the end state. */
  stock_values: z.array(StockValueSchema).default([]),
  /** Base64-encoded PNG of the Run View at save. */
  image_png: z.string().optional(),
});
export type SimulationPeriod = z.infer<typeof SimulationPeriodSchema>;

/**
 * A Temporal Simulation run saved to the Scorecard (ADR-0019 §4): the periods
 * ticked at save, packed in one entry. The run is not saved, so the entry holds
 * what it shows: the run's start once, each period's end state as a Graph Diff
 * from it, the table's values per period, and each Metric's minimum and mean
 * across the whole run.
 */
export const TemporalSimulationScorecardEntrySchema = z.object({
  type: z.literal("temporal_simulation"),
  id: z.string(),
  label: z.string(),
  created_at: z.string(),
  timeline_name: z.string(),
  start: GraphSnapshotSchema,
  periods: z.array(SimulationPeriodSchema).min(1),
  /** Column name → the smallest value across the run's periods. */
  metric_min: z.record(z.string(), z.number().nullable()).default({}),
  /** Column name → the mean across the run's periods that have a value. */
  metric_mean: z.record(z.string(), z.number().nullable()).default({}),
});

/** Discriminated union on `type`. */
export const ScorecardEntrySchema = z.discriminatedUnion("type", [
  PropagationScorecardEntrySchema,
  AnalysisScorecardEntrySchema,
  TemporalSimulationScorecardEntrySchema,
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

/** The Project's fields: what Pydantic's `Project` describes, before any migration. */
export const ProjectFieldsSchema = z.object({
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
      // A saved period that diffed against a shared base (an hour on 2026-10-08; no run could save one) is dropped.
      return val.filter((entry: unknown) => !(typeof entry === "object" && entry !== null && "base_id" in entry)).map((entry: unknown) => {
        if (typeof entry !== "object" || entry === null) return entry;
        const migrated = { ...(entry as Record<string, unknown>) };
        // A Temporal Simulation entry saved before 2026-10-08: one period with its whole end state.
        if (migrated.type === "temporal_simulation" && "snapshot" in migrated && !("periods" in migrated)) {
          const { snapshot, period_label, metrics, level_reading, stock_values, image_png, ...rest } = migrated;
          return {
            ...rest,
            start: snapshot,
            periods: [{
              label: period_label ?? "",
              diff: { nodes: [], edges: [], canvases: [] },
              metrics: metrics ?? {},
              stock_values: level_reading === "change" ? stock_values ?? [] : [],
              ...(image_png ? { image_png } : {}),
            }],
          };
        }
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
  /**
   * The project's Temporal Simulations (ADR-0019): each a Timeline, profile,
   * Metrics and scope. Input only; runs are not saved. The engine never reads them.
   */
  temporal_simulations: z.array(StoredTemporalSimulationSchema).optional(),
});

/** A project file, migrated (`migrateProjectSimulations`) and validated. */
export const ProjectSchema = z.preprocess(migrateProjectSimulations, ProjectFieldsSchema);

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
export type GraphDiff = z.infer<typeof GraphDiffSchema>;
export type RecordDiff = z.infer<typeof RecordDiffSchema>;
export type FieldChange = z.infer<typeof FieldChangeSchema>;
export type PropagationScorecardEntry = z.infer<typeof PropagationScorecardEntrySchema>;
export type AnalysisScorecardEntry = z.infer<typeof AnalysisScorecardEntrySchema>;
export type TemporalSimulationScorecardEntry = z.infer<typeof TemporalSimulationScorecardEntrySchema>;
export type StockValue = z.infer<typeof StockValueSchema>;
export type ScorecardEntry = z.infer<typeof ScorecardEntrySchema>;
export type Project = z.infer<typeof ProjectSchema>;
