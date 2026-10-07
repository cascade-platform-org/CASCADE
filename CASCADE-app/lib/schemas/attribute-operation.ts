/**
 * attribute-operation.ts — Attribute Operations and Element Filters (ADR-0021).
 *
 * Mirrors `ElementFilter` and `AttributeOperation` in
 * `CASCADE-backend/schemas/config.py`. A module of its own because both an
 * Event (config.ts) and a project's Temporal Simulation (network.ts, through
 * temporal-simulation.ts) hold them, and config.ts already imports network.ts.
 */

import { z } from "zod";

/**
 * Selects Elements by what they are. Every given condition must hold; an
 * absent one does not constrain. Resolved when the operation runs, against the
 * model at that moment, and applied in Element-id order. `exclude` removes
 * hand-unticked matches by id, so an Element that starts matching later is
 * still included.
 */
export const ElementFilterSchema = z
  .object({
    kind: z.enum(["node", "edge"]).default("node"),
    /** Canvas id or label. */
    canvas: z.string().optional(),
    /** Nodes only: a Node Type, built-in or custom. */
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
export const AttributeOperationSchema = z
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
