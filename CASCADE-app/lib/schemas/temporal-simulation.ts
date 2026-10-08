/**
 * temporal-simulation.ts — a Temporal Simulation document (ADR-0019): Timeline,
 * profile, Metrics and Propagation scope. A project keeps any number of them,
 * with an id each, at `Project.temporal_simulations`.
 *
 * Mirrors `CASCADE-backend/schemas/temporal_simulation.py`. The same schema
 * validates what the window edits and what a person (or an LLM) pastes as text,
 * so the two forms can never disagree. Objects are strict: a misspelt key is an
 * error, which is what catches a hallucinated field.
 */

import { z } from "zod";
import { FieldPathSchema } from "./field-path";
import { AttributeOperationSchema, ElementFilterSchema } from "./attribute-operation";

export const CalendarUnitSchema = z.enum(["hour", "day", "week", "month", "quarter", "year", "none"]);
export type CalendarUnit = z.infer<typeof CalendarUnitSchema>;

/** An Event a Phase fires: every period of its Step, or `every: N` — the Step's periods N, 2N, 3N… */
export const PhaseEventSchema = z
  .object({ event: z.string().min(1), every: z.number().int().min(1).default(1) })
  .strict();

export const PhaseSchema = z
  .object({
    /** A bare Event id reads as `{event: id, every: 1}`. */
    events: z
      .array(z.union([z.string().min(1).transform((event) => ({ event, every: 1 })), PhaseEventSchema]))
      .default([]),
    propagate: z.boolean().default(true),
    /** Hours that pass at the start of the Phase, before its Events (backups count down); absent or 0: none. */
    advance_hours: z.number().int().min(0).optional(),
  })
  .strict();
export type Phase = z.infer<typeof PhaseSchema>;

export const StepSchema = z
  .object({
    label: z.string().min(1),
    unit: CalendarUnitSchema,
    repeat: z.number().int().min(1).default(1),
    phases: z.array(PhaseSchema),
  })
  .strict();
export type Step = z.infer<typeof StepSchema>;

export const TimelineSchema = z
  .object({
    name: z.string(),
    steps: z.array(StepSchema),
  })
  .strict();
export type Timeline = z.infer<typeof TimelineSchema>;

export const AggregateSchema = z.enum(["sum", "mean", "min", "max", "count", "share_where", "percentile"]);
export const ComparisonSchema = z.enum(["<", "<=", ">", ">=", "==", "!="]);

/** Keeps only values passing the comparison; also the predicate of `share_where`. */
export const ValueFilterSchema = z.object({ cmp: ComparisonSchema, value: z.number() }).strict();

/** ADR-0019 §4: a view definition, evaluated per period over the run record. */
export const MetricSchema = z
  .object({
    name: z.string(),
    target: ElementFilterSchema,
    path: FieldPathSchema,
    read: z.enum(["state", "change"]),
    /** For `change`: the 1-based Phase whose diff is read; absent = the whole period. */
    phase: z.number().int().min(1).optional(),
    aggregate: AggregateSchema,
    /** For `percentile`: 0–100. */
    percentile: z.number().min(0).max(100).optional(),
    value_filter: ValueFilterSchema.optional(),
  })
  .strict();
export type Metric = z.infer<typeof MetricSchema>;

/** The standard Metrics a run's table can show before the project's own (ADR-0019 §4). */
export const StandardMetricSchema = z.enum(["operativity", "coverage", "stock_level"]);
export type StandardMetric = z.infer<typeof StandardMetricSchema>;
export const STANDARD_METRICS = StandardMetricSchema.options;

export const TEMPORAL_SIMULATION_FORMAT = "cascade.temporal-simulation/v1";

export const SimulationScopeSchema = z.enum(["global", "local"]);
export type SimulationScope = z.infer<typeof SimulationScopeSchema>;

const simulationFields = {
  format: z.literal(TEMPORAL_SIMULATION_FORMAT),
  timeline: TimelineSchema,
  /** Period label → operations applied at the start of that period, in order. */
  profile: z.record(z.string(), z.array(AttributeOperationSchema)).default({}),
  metrics: z.array(MetricSchema).default([]),
  /** The standard Metrics shown; all three when absent. */
  standard_metrics: z.array(StandardMetricSchema).default([...STANDARD_METRICS]),
  /** Every Propagation of a run uses it: global, every Canvas; local, the Canvas `canvas` only. */
  scope: SimulationScopeSchema.default("global"),
  /** For `local`: the Canvas id the run propagates. */
  canvas: z.string().min(1).optional(),
};

/** A local scope names its Canvas; a global one names none. */
function canvasWithLocalScope(doc: { scope: SimulationScope; canvas?: string }, ctx: z.RefinementCtx) {
  if (doc.scope === "local" && doc.canvas === undefined) ctx.addIssue({ code: "custom", path: ["canvas"], message: "a local scope needs `canvas`, the Canvas id it runs on" });
  if (doc.scope === "global" && doc.canvas !== undefined) ctx.addIssue({ code: "custom", path: ["canvas"], message: "`canvas` is only for a local scope" });
}

export const TemporalSimulationSchema = z.object(simulationFields).strict().superRefine(canvasWithLocalScope);
export type TemporalSimulation = z.infer<typeof TemporalSimulationSchema>;

/** One of a project's Temporal Simulations: the document, with the id the window selects it by. Its text leaves the id out. */
export const StoredTemporalSimulationSchema = z
  .object({ ...simulationFields, id: z.string().min(1) })
  .strict()
  .superRefine(canvasWithLocalScope);
export type StoredTemporalSimulation = z.infer<typeof StoredTemporalSimulationSchema>;

/** The id a project's first Temporal Simulation gets: a migrated one, an imported one. */
export const FIRST_SIMULATION_ID = "simulation-1";

/**
 * A project saved before 2026-10-08 held one `temporal_simulation`; it becomes
 * the list's only entry. Mirrors `_one_simulation_to_list` on the Pydantic Project.
 */
export function migrateProjectSimulations(project: unknown): unknown {
  if (typeof project !== "object" || project === null || !("temporal_simulation" in project)) return project;
  const { temporal_simulation: single, ...rest } = project as Record<string, unknown>;
  const list = rest.temporal_simulations;
  if (typeof single === "object" && single !== null && !(Array.isArray(list) && list.length > 0)) {
    return { ...rest, temporal_simulations: [{ id: FIRST_SIMULATION_ID, ...single }] };
  }
  return rest;
}
