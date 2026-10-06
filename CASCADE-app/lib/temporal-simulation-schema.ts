/**
 * temporal-simulation-schema.ts — the Temporal Simulation definition as one
 * validated document: Timeline, profile and Metrics (ADR-0019, ADR-0021).
 *
 * PROTOTYPE. No Pydantic model exists yet, so these Zod schemas are the source
 * of the prototype's types. When the feature is built they move schema-first
 * (Pydantic → JSON Schema → Zod, CLAUDE.md §6) under `lib/schemas/`.
 *
 * The same schema validates what the window edits and what a person (or an
 * LLM) pastes as text, so the two forms can never disagree. Objects are strict:
 * a misspelt key is an error, which is what catches a hallucinated field.
 */

import { z } from "zod";

export const CalendarUnitSchema = z.enum(["hour", "day", "week", "month", "quarter", "year", "none"]);
export type CalendarUnit = z.infer<typeof CalendarUnitSchema>;

/**
 * Selects Elements by what they are. Every given condition must hold; an
 * absent one does not constrain. Resolved when the operation runs, against the
 * model at that moment, and applied in Element-id order. `exclude` removes
 * hand-unticked matches by id, so an Element that starts matching later is
 * still included.
 */
const ElementFilterSchema = z
  .object({
    kind: z.enum(["node", "edge"]).default("node"),
    /** Canvas id or label. */
    canvas: z.string().optional(),
    /** Nodes only: Node Type (Source, Infrastructure, Service, Personnel). */
    node_type: z.string().optional(),
    /** Nodes: tagged, supplied or demanded Category. Edges: the source's supply Category. */
    category: z.string().optional(),
    /** Case-insensitive substring of the label; an edge reads as "source label → target label". */
    label_contains: z.string().optional(),
    /** Matches unticked by hand. */
    exclude: z.array(z.string()).optional(),
  })
  .strict();
export type ElementFilter = z.infer<typeof ElementFilterSchema>;

export const OperationKindSchema = z.enum(["set", "add", "mul", "at_most", "at_least"]);

/** add, mul, at_most and at_least read a number; only set may write text or a boolean. */
export const valueFitsOp = (op: z.infer<typeof OperationKindSchema>, value: unknown): boolean =>
  op === "set" || typeof value === "number";

/** ADR-0021: one operation, on one Element (`element`) or on every match of `where`. */
const AttributeOperationSchema = z
  .object({
    element: z.string().min(1).optional(),
    where: ElementFilterSchema.optional(),
    path: z.array(z.string().min(1)).min(1),
    op: OperationKindSchema,
    value: z.union([z.number(), z.boolean(), z.string()]),
  })
  .strict()
  .refine((o) => (o.element === undefined) !== (o.where === undefined), {
    message: "give exactly one of `element` (an id) or `where` (a filter)",
  })
  .refine((o) => valueFitsOp(o.op, o.value), {
    message: "add, mul, at_most and at_least need a number `value`",
    path: ["value"],
  });
export type AttributeOperation = z.infer<typeof AttributeOperationSchema>;

/**
 * An Event in a Phase. A bare id fires every period of the Step; `every: N`
 * fires on the Step's periods N, 2N, 3N… (counted within the Step).
 */
const PhaseEventSchema = z
  .union([
    z.string().min(1),
    z.object({ event: z.string().min(1), every: z.number().int().min(1).default(1) }).strict(),
  ])
  .transform((v) => (typeof v === "string" ? { event: v, every: 1 } : v));

const TimelinePhaseSchema = z
  .object({
    events: z.array(PhaseEventSchema).default([]),
    propagate: z.boolean().default(true),
  })
  .strict();
export type TimelinePhase = z.infer<typeof TimelinePhaseSchema>;

const TimelineStepSchema = z
  .object({
    label: z.string().min(1),
    unit: CalendarUnitSchema,
    repeat: z.number().int().min(1).default(1),
    phases: z.array(TimelinePhaseSchema),
  })
  .strict();
export type TimelineStep = z.infer<typeof TimelineStepSchema>;

const TimelineSchema = z
  .object({
    name: z.string(),
    steps: z.array(TimelineStepSchema),
  })
  .strict();
export type Timeline = z.infer<typeof TimelineSchema>;

export const AggregateSchema = z.enum(["sum", "mean", "min", "max", "count", "share_where", "percentile"]);
export const ComparisonSchema = z.enum(["<", "<=", ">", ">=", "==", "!="]);

/** ADR-0019 §4: a view definition, evaluated at read time over the run record. */
const MetricSchema = z
  .object({
    name: z.string(),
    target: ElementFilterSchema,
    path: z.array(z.string().min(1)).min(1),
    read: z.enum(["state", "change"]),
    /** For `change`: the 1-based Phase whose diff is read; absent = the whole period. */
    phase: z.number().int().min(1).optional(),
    aggregate: AggregateSchema,
    /** For `percentile`: 0–100. */
    percentile: z.number().min(0).max(100).optional(),
    /** Keeps only values passing the comparison (and is the predicate of `share_where`). */
    value_filter: z
      .object({ cmp: ComparisonSchema, value: z.number() })
      .strict()
      .optional(),
  })
  .strict();
export type Metric = z.infer<typeof MetricSchema>;

export const TEMPORAL_SIMULATION_FORMAT = "cascade.temporal-simulation/v0";

export const TemporalSimulationDocSchema = z
  .object({
    format: z.literal(TEMPORAL_SIMULATION_FORMAT),
    timeline: TimelineSchema,
    /** Period label → operations applied at the start of that period, in order. */
    profile: z.record(z.string(), z.array(AttributeOperationSchema)).default({}),
    metrics: z.array(MetricSchema).default([]),
  })
  .strict();
export type TemporalSimulationDoc = z.infer<typeof TemporalSimulationDocSchema>;
