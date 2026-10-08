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

/**
 * Retired `attribute_mutations` (`{"<elementId>.<field>": value}`) as `set`
 * operations, one per scalar leaf (ADR-0021, revised 2026-10-08). The key splits
 * on its LAST dot, since an element id may contain dots; an object value becomes
 * one operation per nested value. A list or null has no operation form and
 * throws. Mirrors `mutations_to_operations` in CASCADE-backend/schemas/config.py.
 */
export function mutationsToOperations(mutations: Record<string, unknown>): AttributeOperation[] {
  const out: AttributeOperation[] = [];
  const walk = (element: string, path: string[], value: unknown): void => {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      for (const [key, inner] of Object.entries(value)) walk(element, [...path, key], inner);
    } else if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
      out.push({ element, path, op: "set", value });
    } else {
      throw new Error(`attribute_mutations[${element}.${path[0]}]: this value has no Attribute Operation form`);
    }
  };
  for (const [key, value] of Object.entries(mutations)) {
    const dot = key.lastIndexOf(".");
    if (dot <= 0 || dot === key.length - 1) throw new Error(`attribute_mutations key "${key}" is not "<elementId>.<field>"`);
    walk(key.slice(0, dot), [key.slice(dot + 1)], value);
  }
  return out;
}

/** An Event as stored before 2026-10-08: its mutations become operations ahead of its own. */
export function migrateEventMutations(event: unknown): unknown {
  if (typeof event !== "object" || event === null || !("attribute_mutations" in event)) return event;
  const { attribute_mutations: mutations, ...rest } = event as Record<string, unknown> & { attribute_operations?: unknown[] };
  const migrated = mutationsToOperations((mutations ?? {}) as Record<string, unknown>);
  if (migrated.length === 0) return rest;
  return { ...rest, attribute_operations: [...migrated, ...(rest.attribute_operations ?? [])] };
}
