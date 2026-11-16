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
/** What one storage exchanged with the network in one Propagation (ADR-0020 §1c). */
export const StoredAmountSchema = z.object({ filled: z.number().min(0), drawn: z.number().min(0) });

/**
 * One Functionality change an engine round committed, in commit order (ADR-0027).
 * `cause`: `edge` took its source's worse level at the round's start (ADR-0004);
 * `flow` a SourceToDemands shortfall; `logical` logical aggregation; `rule` a
 * specific-rule override; `backup` a drop deferred into functionality_time.
 */
export const RoundChangeSchema = z.object({
  id: z.string(),
  functionality: z.number().int().min(1),
  functionality_time: z.number().int().min(0).optional(),
  cause: z.enum(["edge", "flow", "logical", "rule", "backup"]),
  responsibility_share: z.record(z.string(), z.number().gt(0).lte(1)).optional(),
});

/** One engine round, for the Propagation animation (ADR-0027). */
export const PropagationRoundSchema = z.object({
  /** SourceToDemands Category → edge id → amount carried: one routing of the round's solve. */
  flows: z.record(z.string(), z.record(z.string(), z.number())).default({}),
  /** Flow consumer → Category → delivered ÷ demand in this round's solve. */
  served_ratio: z.record(z.string(), z.record(z.string(), z.number())).default({}),
  changes: z.array(RoundChangeSchema).default([]),
});

export const PropagationResultSchema = PropagationMetaSchema.extend({
  /** Deltas from the engine — apply these on top of the project state. */
  updates: z.array(ElementUpdateSchema),
  /** Delivered ÷ demand per flow consumer and Category, fully served included (ADR-0020 §3). */
  served_ratio: z.record(z.string(), z.record(z.string(), z.number())).default({}),
  /** Per storage node and Category: what it filled and drew (ADR-0020 §1c). */
  stored: z.record(z.string(), z.record(z.string(), StoredAmountSchema)).default({}),
  /** Present only when the request asked for `trace` (ADR-0027): one entry per round. */
  rounds: z.array(PropagationRoundSchema).optional(),
});

export type ElementUpdate = z.infer<typeof ElementUpdateSchema>;
export type PropagationMeta = z.infer<typeof PropagationMetaSchema>;
export type PropagationResult = z.infer<typeof PropagationResultSchema>;
export type RoundChange = z.infer<typeof RoundChangeSchema>;
export type PropagationRound = z.infer<typeof PropagationRoundSchema>;

/** Response of POST /api/propagate/batch — one result per coalition, in order. */
export const BatchPropagationResultSchema = z.object({
  results: z.array(PropagationResultSchema),
});
export type BatchPropagationResult = z.infer<typeof BatchPropagationResultSchema>;
