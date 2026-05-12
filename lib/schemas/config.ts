/**
 * Zod schemas for the project configuration (functionality scale, categories,
 * hazards, rules).
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

export const HazardDefinitionSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(["hazard", "disservice"]),
  /** Node/edge IDs in scope for this event. */
  affected: z.array(z.string()),
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
   * Attribute mutations applied to affected elements when this event is triggered.
   * Keys are dot-notation strings: "<elementId>.<propertyKey>".
   */
  attribute_mutations: z.record(z.string(), z.unknown()),
});

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export const RuleDefinitionSchema = z.object({
  id: z.string(),
  type: z.enum(["specific", "intracategorical", "intercategorical"]),
  /** Plain-text expression validated client-side; evaluated by the engine. */
  expression: z.string(),
  enabled: z.boolean(),
  /** Set by the rule validator; undefined = not yet validated. */
  is_valid: z.boolean().optional(),
  /** Set at runtime; true when the rule's conditions are met in current state. */
  is_applicable: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Project config root
// ---------------------------------------------------------------------------

export const ProjectConfigSchema = z.object({
  version: z.string(),
  meta: z.object({
    name: z.string(),
    description: z.string().optional(),
  }),
  /** Ordered 1..N. Index 0 = worst (critical), last = best (operational). */
  functionality_scale: z.array(FunctionalityScaleLevelSchema),
  categories: z.array(CategoryDefinitionSchema),
  hazards: z.array(HazardDefinitionSchema).default([]),
  rules: z.array(RuleDefinitionSchema).default([]),
});

// ---------------------------------------------------------------------------
// Inferred TypeScript types
// ---------------------------------------------------------------------------

export type FunctionalityScaleLevel = z.infer<typeof FunctionalityScaleLevelSchema>;
export type CategoryDefinition = z.infer<typeof CategoryDefinitionSchema>;
export type DirectDamageEffect = z.infer<typeof DirectDamageEffectSchema>;
export type HazardDefinition = z.infer<typeof HazardDefinitionSchema>;
export type RuleDefinition = z.infer<typeof RuleDefinitionSchema>;
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
