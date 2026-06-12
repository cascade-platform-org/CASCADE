/**
 * Zod schemas for the propagation engine's output.
 *
 * Lives in its own module — imported by BOTH network.ts (ScorecardEntry embeds
 * a PropagationResult; AnyUpdateEntry embeds a PropagationMeta) and api.ts /
 * api-client.ts (the /api/propagate response) — so neither needs to import the
 * other. This replaces the previous `z.lazy(() => require("./api"))` workaround
 * for that circular dependency.
 *
 * Mirrors backend/schemas/results.py (and PropagationMeta in network.py). Run
 * `python CASCADE-backend/scripts/export_json_schema.py` after Pydantic changes.
 */
import { z } from "zod";

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
   * Keyed by ElementId or EventId. Values are in (0, 1] and sum to 1 — zero
   * shares are never emitted (a blameless element is simply absent).
   * Identifies which upstream Elements or Events are directly responsible
   * for this Element's degradation, and in what proportion.
   */
  responsibility_share: z.record(z.string(), z.number().gt(0).lte(1)).optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Run metadata shared by PropagationResult (live engine response) and
 * AnyUpdateEntry.propagation_meta (stored history entries). Defined once so
 * the two can never drift — a new metadata field lands in both automatically.
 */
export const PropagationMetaSchema = z.object({
  scope: z.enum(["local", "global"]),
  /** Number of propagation iterations performed. */
  iterations: z.number().int().min(0),
  /** Non-fatal engine warnings (e.g. convergence not reached). */
  warnings: z.array(z.string()).default([]),
  /** ISO timestamp when the engine completed the run. */
  computed_at: z.string(),
});

/** Full engine response: the run metadata plus the per-element deltas. */
export const PropagationResultSchema = PropagationMetaSchema.extend({
  /** Deltas from the engine — apply these on top of the project state. */
  updates: z.array(ElementUpdateSchema),
});

export type ElementUpdate = z.infer<typeof ElementUpdateSchema>;
export type PropagationMeta = z.infer<typeof PropagationMetaSchema>;
export type PropagationResult = z.infer<typeof PropagationResultSchema>;
