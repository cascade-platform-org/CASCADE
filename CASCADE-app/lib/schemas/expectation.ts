/**
 * expectation.ts — what a person knows their system does, stated so it can be
 * checked (ADR-0023). Mirrors `schemas/expectation.py`.
 *
 * A `scenario` check applies Events to the Reset model, Propagates, optionally
 * lets hours pass and Propagates again, then asserts on Elements' fields. A
 * `simulation` check runs one of the project's Temporal Simulations and
 * compares one column of its Run table with a value. Results are computed when
 * a check runs and never saved. Client data: the Propagation request leaves it out.
 */

import { z } from "zod";
import { ElementFilterSchema } from "./attribute-operation";
import { FieldPathSchema } from "./field-path";
import { FiniteNumberSchema } from "./operand";
import { ProvenanceSchema } from "./provenance";
import { ComparisonSchema, SimulationScopeSchema } from "./temporal-simulation";

export const ExpectationStatisticSchema = z.enum(["end", "mean", "min", "max", "total"]);

export const ElementAssertionSchema = z
  .object({
    /** One Element, by id. */
    element: z.string().min(1).optional(),
    /** Or every Element the filter selects. */
    where: ElementFilterSchema.optional(),
    /** With `where`: every match must pass, or at least one. */
    quantifier: z.enum(["all", "any"]).default("all"),
    path: FieldPathSchema.default(["functionality"]),
    cmp: ComparisonSchema,
    /** A number, a boolean, or a Functionality scale label (read as its level). */
    value: z.union([z.boolean(), FiniteNumberSchema, z.string()]),
  })
  .strict()
  .refine((a) => (a.element === undefined) !== (a.where === undefined), {
    message: "an assertion names exactly one of `element` and `where`",
  });

export const ScenarioCheckSchema = z
  .object({
    kind: z.literal("scenario"),
    /** EventDefinition ids, applied in order. */
    events: z.array(z.string()).default([]),
    /** Hours that pass after the first Propagation (a Temporal Jump), followed by a second one. */
    advance_hours: z.number().int().min(0).default(0),
    scope: SimulationScopeSchema.default("global"),
    /** For `local`: the Canvas id. */
    canvas: z.string().min(1).optional(),
    assertions: z.array(ElementAssertionSchema).min(1),
  })
  .strict();

export const SimulationCheckSchema = z
  .object({
    kind: z.literal("simulation"),
    /** The Temporal Simulation's id. */
    simulation: z.string().min(1),
    /** The Run table column, as the table names it. */
    column: z.string().min(1),
    period: z.string().min(1).optional(),
    statistic: ExpectationStatisticSchema.optional(),
    cmp: ComparisonSchema,
    value: FiniteNumberSchema,
    /** `==` passes within it, `!=` outside it; the other comparisons ignore it. */
    tolerance: FiniteNumberSchema.min(0).default(0),
  })
  .strict();

export const ExpectationCheckSchema = z.discriminatedUnion("kind", [ScenarioCheckSchema, SimulationCheckSchema]).superRefine((c, ctx) => {
  if (c.kind === "scenario" && (c.scope === "local") !== (c.canvas !== undefined)) {
    ctx.addIssue({ code: "custom", path: ["canvas"], message: "a local scope needs `canvas`, and only a local scope takes one" });
  }
  if (c.kind === "simulation" && (c.period === undefined) === (c.statistic === undefined)) {
    ctx.addIssue({ code: "custom", path: ["period"], message: "a simulation check reads exactly one of `period` and `statistic`" });
  }
});

export const ExpectationSchema = z
  .object({
    id: z.string().min(1),
    /** The person's own words. */
    statement: z.string().min(1),
    check: ExpectationCheckSchema,
    provenance: ProvenanceSchema.optional(),
  })
  .strict();

export type ElementAssertion = z.infer<typeof ElementAssertionSchema>;
export type ScenarioCheck = z.infer<typeof ScenarioCheckSchema>;
export type SimulationCheck = z.infer<typeof SimulationCheckSchema>;
export type ExpectationCheck = z.infer<typeof ExpectationCheckSchema>;
export type Expectation = z.infer<typeof ExpectationSchema>;
