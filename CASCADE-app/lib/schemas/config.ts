/**
 * Zod schemas for the project configuration (functionality scale, categories,
 * events, graph-type heuristic pipelines).
 *
 * Canonical frontend types — inferred via z.infer<>. Mirrors
 * backend/schemas/config.py. Run `python backend/scripts/export_json_schema.py`
 * after changing the Pydantic models.
 */
import { z } from "zod";
import { NodeSchema } from "./network";
import { AttributeOperationSchema } from "./attribute-operation";

// ---------------------------------------------------------------------------
// Functionality scale
// ---------------------------------------------------------------------------

export const FunctionalityScaleLevelSchema = z.object({
  /** Integer level, 1 = worst (critical), N = best (operational). */
  level: z.number().int().min(1),
  label: z.string(),
  /** Hex colour string — written by the app from `lib/brand.ts`, never by hand. */
  color: z.string(),
});

// ---------------------------------------------------------------------------
// Category
// ---------------------------------------------------------------------------

export const CategoryDefinitionSchema = z.object({
  name: z.string(),
  /** "SourceToDemands" | "Requisite" | any future type added in config. */
  /**
   * Closed set of engine heuristics (mirrors CategoryType in
   * CASCADE-backend/schemas/config.py): "Requisite" = logical aggregation,
   * "SourceToDemands" = capacitated flow pass. The engine dispatches on
   * exact string equality, so free text would silently disable a category.
   */
  category_type: z.enum(["Requisite", "SourceToDemands"]),
  color: z.string().optional(),
  /** Lucide icon name, e.g. "Droplet", "Zap". Overrides keyword-based auto-detection. */
  icon: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Hazard / disservice
// ---------------------------------------------------------------------------

export const DirectDamageEffectSchema = z.object({
  /** Estimated hours to repair physical damage on this specific element. */
  expected_repair_time: z.number().int().min(0),
});

export const EventDefinitionSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(["hazard", "disservice", "temporal_jump"]),
  /** Lucide icon name shown on the Action Bar button. Falls back to type icon if absent. */
  icon: z.string().optional(),
  /** Expected number of occurrences in a 10-year period. Not meaningful for temporal_jump. */
  frequency_per_10y: z.number().min(0).default(0),
  /** Hours until the disservice self-resolves. Disservices only. */
  expected_recovery_time: z.number().int().min(0).optional(),
  /**
   * Hours to advance the clock. Temporal Jump events only.
   * Used as the default duration when saving to Scorecard.
   */
  duration_hours: z.number().int().min(1).optional(),
  /**
   * Fallback repair time (hours) for Elements this Hazard damages that have no
   * `direct_damage_effects` entry. Hazards only. Leaving it unset means such an
   * Element keeps whatever `expected_repair_time` it already had — it does NOT
   * exempt it from `direct_damage`.
   */
  default_repair_time: z.number().int().min(0).optional(),
  /**
   * Per-Element `expected_repair_time` OVERRIDES, keyed by ElementId. Hazards only.
   * These do not decide which Elements are damaged: a Hazard flags every Element
   * with `vulnerability_levels[event.id] > 0` (requirements §6.4), and this map
   * only refines the repair estimate for some of them.
   */
  direct_damage_effects: z.record(z.string(), DirectDamageEffectSchema).optional(),
  /**
   * True for an Event used only inside a Temporal Simulation (ADR-0019): hidden
   * from the Action Bar and from the Scorecard's uncovered-Event list. Any type
   * may be Temporal-Simulation-only, a Temporal Jump included.
   */
  temporal_simulation_only: z.boolean().optional(),
  /**
   * Unrestricted field overwrites applied to Elements when this Event is triggered.
   * Keys are dot-notation strings: "<elementId>.<fieldName>".
   * May overwrite any Element field including first-class ones (functionality, direct_damage).
   * direct_damage_effects is kept as a typed complement — do not express physical damage
   * solely via attribute_mutations.
   */
  attribute_mutations: z.record(z.string(), z.unknown()).optional(),
  /**
   * Ordered operations on the value a field holds when the Event fires, applied
   * after `attribute_mutations` (ADR-0021). Operations on one Element and path
   * compose in order. Applied client-side (`lib/event-application.ts`).
   */
  attribute_operations: z.array(AttributeOperationSchema).optional(),
});

// ---------------------------------------------------------------------------
// Graph-type heuristic pipeline configuration
// ---------------------------------------------------------------------------

/**
 * One heuristic step in a graph type's propagation pipeline.
 * `id` must match a heuristic known to the engine (GET /api/engine/capabilities).
 * `params` is an opaque dict — keys and value ranges are engine-defined.
 */
export const HeuristicConfigSchema = z.object({
  id: z.string(),
  enabled: z.boolean().default(true),
  /** Heuristic-specific tuning parameters. Validated by the engine, not the frontend. */
  params: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Per-graph-type override of the engine's default heuristic pipeline.
 *
 * `name` must match a Canvas.graph_type value used in the project.
 * `heuristics` is the full ordered pipeline — the engine runs them in this order.
 * If a canvas's graph_type has no entry here the engine uses its built-in defaults.
 *
 * `local_graph_types` is used by the global graph type only (referenced by
 * Project.global_graph_type): it lists the constituent local graph type names
 * whose pipelines compose for a global Propagation. The engine merges those
 * locals' heuristics; because heuristic params are keyed by category, params
 * from different locals coexist without conflict. Absent for a local graph type.
 */
export const GraphTypeConfigSchema = z.object({
  name: z.string(),
  heuristics: z.array(HeuristicConfigSchema).default([]),
  local_graph_types: z.array(z.string()).optional(),
});

// ---------------------------------------------------------------------------
// Project config root
// ---------------------------------------------------------------------------

export const ModelConfigurationSchema = z.object({
  version: z.string(),
  meta: z.object({
    name: z.string(),
    description: z.string().optional(),
  }),
  /** Ordered 1..N. Index 0 = worst (critical), last = best (operational). */
  functionality_scale: z.array(FunctionalityScaleLevelSchema).min(2),
  /**
   * Served-ratio → Functionality level table for the flow pass (ADR-0003).
   * N−1 ascending upper bounds in [0, 1]; entry k is the highest
   * delivered/demand ratio that still reads as level k+1. Absent means the
   * linear split. Beside `functionality_scale` because it says what those
   * levels mean; the engine validates it against them and reports a
   * mismatched table in the run's warnings.
   */
  flow_ratio_thresholds: z.array(z.number()).optional(),
  categories: z.array(CategoryDefinitionSchema),
  /** Hazard and Disservice definitions. Both types are Events. */
  events: z.array(EventDefinitionSchema).default([]),
  /**
   * Per-graph-type heuristic pipeline overrides.
   * Absent entries use the engine's built-in defaults for that graph type.
   */
  graph_types: z.array(GraphTypeConfigSchema).default([]),
  /**
   * Named node templates. Key = user-chosen name.
   * Applied at node creation time; any Node field except id and position can be preset.
   */
  node_defaults: z.record(z.string(), NodeSchema.partial()).default({}),
});

// ---------------------------------------------------------------------------
// Inferred TypeScript types
// ---------------------------------------------------------------------------

export type FunctionalityScaleLevel = z.infer<typeof FunctionalityScaleLevelSchema>;
export type CategoryDefinition = z.infer<typeof CategoryDefinitionSchema>;
export type DirectDamageEffect = z.infer<typeof DirectDamageEffectSchema>;
export type EventDefinition = z.infer<typeof EventDefinitionSchema>;
export type HeuristicConfig = z.infer<typeof HeuristicConfigSchema>;
export type GraphTypeConfig = z.infer<typeof GraphTypeConfigSchema>;
export type ModelConfiguration = z.infer<typeof ModelConfigurationSchema>;
