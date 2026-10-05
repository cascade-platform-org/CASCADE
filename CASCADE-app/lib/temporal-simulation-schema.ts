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

const CalendarUnitSchema = z.enum(["day", "week", "month", "quarter", "year", "none"]);
export type CalendarUnit = z.infer<typeof CalendarUnitSchema>;

/**
 * Selects Elements by what they are. Every given condition must hold; an
 * absent one does not constrain. Resolved when the operation runs, against the
 * model at that moment, and applied in Element-id order.
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
    /** Edges only: source node id. */
    from: z.string().optional(),
    /** Edges only: target node id. */
    to: z.string().optional(),
    /** `properties[key]` exists, and equals `equals` when given. */
    property: z
      .object({ key: z.string().min(1), equals: z.union([z.string(), z.number(), z.boolean()]).optional() })
      .strict()
      .optional(),
    /** Case-insensitive substring of the label (or the id, when there is no label). */
    label_contains: z.string().optional(),
    ids: z.array(z.string()).optional(),
  })
  .strict();
export type ElementFilter = z.infer<typeof ElementFilterSchema>;

const OperationKindSchema = z.enum(["set", "add", "mul", "at_most", "at_least"]);

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
  .refine((o) => o.op === "set" || typeof o.value === "number", {
    message: "add, mul, at_most and at_least need a number `value`",
    path: ["value"],
  });
export type AttributeOperation = z.infer<typeof AttributeOperationSchema>;

const TimelinePhaseSchema = z
  .object({
    events: z.array(z.string()).default([]),
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

const TimelinePeriodicSchema = z
  .object({
    /** Every N-th period, counted 1-based from the run's start (N, 2N, …). */
    every: z.number().int().min(1),
    /** 1-based number of the Phase the Events join. */
    phase: z.number().int().min(1),
    events: z.array(z.string()),
  })
  .strict();

const TimelineSchema = z
  .object({
    name: z.string(),
    steps: z.array(TimelineStepSchema),
    every: z.array(TimelinePeriodicSchema).default([]),
  })
  .strict();
export type Timeline = z.infer<typeof TimelineSchema>;

const AggregateSchema = z.enum(["sum", "mean", "min", "max", "count", "share_where", "percentile"]);

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
      .object({ cmp: z.enum(["<", "<=", ">", ">=", "==", "!="]), value: z.number() })
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
