/**
 * attribute-operations.ts — `new = op(current, operand)` at a field path (ADR-0021).
 *
 * The operand is `value` times each factor the operation names (ADR-0021,
 * revised 2026-10-12): a Parameter's value, a Series at this Element and the
 * period being run, and the number the Element holds at `of`. The context says
 * which Parameters have a value and which period is running; outside a run
 * there is no period, so a Series cannot be read.
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
import { hasFactors, type AttributeOperation } from "@/lib/schemas/attribute-operation";
import type { EventDefinition } from "@/lib/schemas/config";
import { ALL_ELEMENTS, type Series } from "@/lib/schemas/series";
import { EdgeSchema, NodeSchema } from "@/lib/schemas/network";
import { isSafeKey } from "@/lib/schemas/field-path";

type Rec = Record<string, unknown>;

const isObject = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

/** The value at `path` (undefined when absent), or why the path cannot be followed. */
export function readPath(record: Rec, path: readonly string[]): { value: unknown } | { error: string } {
  let current: unknown = record;
  for (let depth = 0; depth < path.length; depth++) {
    if (current === undefined) return { value: undefined };
    if (!isObject(current)) return { error: `${path.slice(0, depth).join(" › ")} holds a value, not an object` };
    // Own fields only: an inherited name (`constructor`, `toString`) is not a field.
    current = Object.hasOwn(current, path[depth]) ? current[path[depth]] : undefined;
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
  if (isObject(current)) {
    const fields = Object.keys(current);
    return { error: `${op} on an object (${fields.slice(0, 5).join(", ")}${fields.length > 5 ? ", …" : ""}): name one of its fields in the path${"rate" in current ? ', e.g. "rate" for a Stock\'s supply per period' : ""}` };
  }
  if (typeof current !== "number") return { error: `${op} on a value that is not a number` };
  switch (op) {
    case "add": return { value: current + value };
    case "mul": return { value: current * value };
    case "at_most": return { value: Math.min(current, value) };
    case "at_least": return { value: Math.max(current, value) };
  }
}

/** What an operand's factors read besides the Element: the period, the Parameters' values, the project's Series. */
export interface OperandContext {
  /** The label of the period being run; absent outside a run. */
  period?: string;
  /** Parameter name → value, already resolved for this application. */
  parameters: Readonly<Record<string, number>>;
  series: readonly Series[];
}

/** No run, no Parameters, no Series: an operation that names a factor beyond `of` is refused. */
export const NO_CONTEXT: OperandContext = { parameters: {}, series: [] };

/**
 * The context an Event's operations get: its `parameter_defaults` under the
 * values the context already has, so a run's Parameter wins and a hand-fired
 * Event uses its own defaults (ADR-0019, revised 2026-10-12).
 */
export function eventContext(ctx: OperandContext, event: Pick<EventDefinition, "parameter_defaults">): OperandContext {
  return event.parameter_defaults ? { ...ctx, parameters: { ...event.parameter_defaults, ...ctx.parameters } } : ctx;
}

/** A Series' value for this Element at the period: its own row, else the `*` row. */
function seriesValue(ctx: OperandContext, name: string, elementId: string): { value: number } | { error: string } {
  const series = ctx.series.find((s) => s.name === name);
  if (!series) return { error: `no Series ${name}` };
  if (ctx.period === undefined) return { error: `Series ${name} is read only inside a Temporal Simulation run (it needs a period)` };
  const own = Object.hasOwn(series.rows, elementId);
  const row = own ? series.rows[elementId] : Object.hasOwn(series.rows, ALL_ELEMENTS) ? series.rows[ALL_ELEMENTS] : undefined;
  if (!row) return { error: `Series ${name} has no row for this Element and no ${ALL_ELEMENTS} row` };
  const value = Object.hasOwn(row, ctx.period) ? row[ctx.period] : undefined;
  if (typeof value !== "number") return { error: `Series ${name} has no value for ${own ? "this Element" : `its ${ALL_ELEMENTS} row`} in ${ctx.period}` };
  return { value };
}

/** The operand: `value` times each factor the operation names, or why one has no value. */
function operandOf(element: Rec, op: AttributeOperation, ctx: OperandContext): { value: AttributeOperation["value"] } | { error: string } {
  if (!hasFactors(op)) return { value: op.value };
  if (typeof op.value !== "number") return { error: "with of, parameter or series, value is the factor: a number" };
  let operand = op.value;
  if (op.parameter !== undefined) {
    if (!Object.hasOwn(ctx.parameters, op.parameter)) {
      return { error: `Parameter ${op.parameter} has no value here: declare it in the Temporal Simulation, or give the Event a default` };
    }
    operand *= ctx.parameters[op.parameter];
  }
  if (op.series !== undefined) {
    const read = seriesValue(ctx, op.series, String(element.id));
    if ("error" in read) return read;
    operand *= read.value;
  }
  if (op.of !== undefined) {
    const from = op.of.join(" › ");
    if (!op.of.every(isSafeKey)) return { error: `of ${from}: __proto__, constructor and prototype cannot be field names` };
    const read = readPath(element, op.of);
    if ("error" in read) return { error: `of ${from}: ${read.error}` };
    if (typeof read.value !== "number") return { error: `of ${from}: ${read.value === undefined ? "the Element holds no value there" : "not a number"}` };
    operand *= read.value;
  }
  return { value: operand };
}

/** The Elements an operation (or any selector) acts on, in id order: its one Element if it exists, or its filter's matches. */
export function operationTargets(op: Pick<AttributeOperation, "element" | "where">, model: FilterableModel): string[] {
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
  ctx: OperandContext = NO_CONTEXT,
): { element: Rec } | { error: string } {
  const where = op.path.join(" › ");
  if (!op.path.every(isSafeKey)) return { error: `${where}: __proto__, constructor and prototype cannot be field names` };
  const read = readPath(element, op.path);
  if ("error" in read) return { error: `${where}: ${read.error}` };
  const operand = operandOf(element, op, ctx);
  if ("error" in operand) return { error: `${where}: ${operand.error}` };
  const result = computeOperation(op.op, read.value, operand.value);
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
