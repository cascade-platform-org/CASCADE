/**
 * attribute-operations.ts — `new = op(current, value)` at a field path (ADR-0021).
 *
 * Pure. Event application (`lib/event-application.ts`) runs these as its last
 * pass; a Temporal Simulation's profile is the same operations without an Event
 * around them (ADR-0019 §1).
 *
 * NOTHING IS CLAMPED. A result the Element's schema rejects, an arithmetic
 * operation on an absent value, or a path that runs into a number is refused
 * with a reason, and that Element keeps its value. Clamping silently would turn
 * a modelling mistake into a plausible-looking number.
 */

import { matchElements, type FilterableModel } from "@/lib/element-filter";
import { writeFieldValue } from "@/lib/graph-diff";
import type { AttributeOperation } from "@/lib/schemas/attribute-operation";
import { EdgeSchema, NodeSchema } from "@/lib/schemas/network";

type Rec = Record<string, unknown>;

const isObject = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

/** The value at `path` (undefined when absent), or why the path cannot be followed. */
export function readPath(record: Rec, path: readonly string[]): { value: unknown } | { error: string } {
  let current: unknown = record;
  for (let depth = 0; depth < path.length; depth++) {
    if (current === undefined) return { value: undefined };
    if (!isObject(current)) return { error: `${path.slice(0, depth).join(" › ")} holds a value, not an object` };
    current = current[path[depth]];
  }
  return { value: current };
}

/** `op(current, value)`, or why it cannot be computed. */
function computeOperation(
  op: AttributeOperation["op"],
  current: unknown,
  value: AttributeOperation["value"],
): { value: unknown } | { error: string } {
  if (op === "set") return { value };
  if (typeof value !== "number") return { error: `${op} needs a number value` };
  if (current === undefined) return { error: `${op} on an absent value (only set can create one)` };
  if (typeof current !== "number") return { error: `${op} on a value that is not a number` };
  switch (op) {
    case "add": return { value: current + value };
    case "mul": return { value: current * value };
    case "at_most": return { value: Math.min(current, value) };
    case "at_least": return { value: Math.max(current, value) };
  }
}

/** The Elements an operation acts on, in id order: its one Element if it exists, or its filter's matches. */
export function operationTargets(op: AttributeOperation, model: FilterableModel): string[] {
  if (op.where) return matchElements(op.where, model);
  return op.element !== undefined && (op.element in model.nodes || op.element in model.edges) ? [op.element] : [];
}

/**
 * Apply one operation to one Element: the Element after it, or why not. The
 * result must pass the Element's schema, and Functionality stays within 1..n.
 */
export function applyOperationTo(
  element: Rec,
  kind: "node" | "edge",
  op: AttributeOperation,
  n: number,
): { element: Rec } | { error: string } {
  const where = op.path.join(" › ");
  const read = readPath(element, op.path);
  if ("error" in read) return { error: `${where}: ${read.error}` };
  const result = computeOperation(op.op, read.value, op.value);
  if ("error" in result) return { error: `${where}: ${result.error}` };

  const [field, ...inside] = op.path;
  const next: Rec = { ...element };
  writeFieldValue(next, field, inside, result.value);
  const parsed = (kind === "node" ? NodeSchema : EdgeSchema).safeParse(next);
  if (!parsed.success) {
    return { error: `${where} = ${String(result.value)} is not a valid value (${parsed.error.issues[0]?.message ?? "schema"})` };
  }
  if (field === "functionality" && typeof next.functionality === "number" && next.functionality > n) {
    return { error: `${where} = ${next.functionality} is above the top Functionality level (${n})` };
  }
  return { element: next };
}
