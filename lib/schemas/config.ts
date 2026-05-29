/**
 * Zod schemas for the project configuration (functionality scale, categories,
 * events, graph-type heuristic pipelines).
 *
 * Canonical frontend types — inferred via z.infer<>. Mirrors
 * backend/schemas/config.py. Run `python backend/scripts/export_json_schema.py`
 * after changing the Pydantic models.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Functionality scale
// ---------------------------------------------------------------------------

export const FunctionalityScaleLevelSchema = z.object({
  /** Integer level, 1 = worst (critical), N = best (operational). */
  level: z.number().int().min(1),
  label: z.string(),
  /** Hex colour string, e.g. "#ef4444". */
  color: z.string(),
});

// ---------------------------------------------------------------------------
// Category
// ---------------------------------------------------------------------------

export const CategoryDefinitionSchema = z.object({
  name: z.string(),
  /** "SourceToDemands" | "Requisite" | any future type added in config. */
  category_type: z.string(),
  color: z.string().optional(),
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
  type: z.enum(["hazard", "disservice"]),
  /** Expected number of occurrences in a 10-year period. */
  frequency_per_10y: z.number().min(0),
  /** Hours until the disservice self-resolves. Disservices only. */
  expected_recovery_time: z.number().int().min(0).optional(),
  /**
   * Per-element repair times for physical damage. Hazards only.
   * Key = ElementId. Absence means no direct physical damage for that element
   * (functionality drop only, no direct_damage flag).
   */
  direct_damage_effects: z.record(z.string(), DirectDamageEffectSchema).optional(),
  /**
   * Unrestricted field overwrites applied to Elements when this Event is triggered.
   * Keys are dot-notation strings: "<elementId>.<fieldName>".
   * May overwrite any Element field including first-class ones (functionality, direct_damage).
   * direct_damage_effects is kept as a typed complement — do not express physical damage
   * solely via attribute_mutations.
   */
  attribute_mutations: z.record(z.string(), z.unknown()).optional(),
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
 */
export const GraphTypeConfigSchema = z.object({
  name: z.string(),
  heuristics: z.array(HeuristicConfigSchema),
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
  functionality_scale: z.array(FunctionalityScaleLevelSchema),
  categories: z.array(CategoryDefinitionSchema),
  /** Hazard and Disservice definitions. Both types are Events. */
  events: z.array(EventDefinitionSchema).default([]),
  /**
   * Per-graph-type heuristic pipeline overrides.
   * Absent entries use the engine's built-in defaults for that graph type.
   */
  graph_types: z.array(GraphTypeConfigSchema).default([]),
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
