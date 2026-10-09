/**
 * temporal-dry-run.ts — what a Temporal Simulation's operations would do to
 * this project's model, found before a run (ADR-0019 §7). Pure.
 *
 * A definition can be valid and still unable to work here: an `add` on a
 * field no Element holds, a Metric reading a path nothing has. A run refuses
 * such an operation and keeps the old value, so the person learns it only
 * after running. This applies the profile and the attribute operations of the
 * Events that fire, period by period, to a copy of the authored model, in the
 * order a run does, and reports what would be refused and which Metrics
 * would read nothing. Propagation is not run: it changes Functionality and
 * Stock levels, never which fields exist.
 */

import { applyOperationTo, operationTargets, readPath } from "@/lib/attribute-operations";
import { matchElements, type FilterableModel } from "@/lib/element-filter";
import { planTimeline } from "@/lib/timeline-plan";
import type { AttributeOperation } from "@/lib/schemas/attribute-operation";
import type { EventDefinition } from "@/lib/schemas/config";
import type { TemporalSimulation } from "@/lib/schemas/temporal-simulation";

type Rec = Record<string, unknown>;

/** Elements named in a message: the first few by label, then how many more. */
const some = (names: string[]) => `${names.slice(0, 3).join(", ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""}`;

export function dryRunProblems(doc: TemporalSimulation, events: readonly EventDefinition[], model: FilterableModel, n: number): string[] {
  const state = new Map<string, Rec>();
  const current = (id: string): Rec => state.get(id) ?? ((model.nodes[id] ?? model.edges[id]) as unknown as Rec);
  const name = (id: string) => String((model.nodes[id]?.label ?? model.edges[id]?.id) ?? id);
  // One entry per distinct reason: the Elements it hits and the period it first does.
  const refused = new Map<string, { names: string[]; first: string }>();
  const byId = new Map(events.map((e) => [e.id, e]));

  const run = (source: string, ops: readonly AttributeOperation[], period: string) => {
    for (const op of ops) {
      for (const id of operationTargets(op, model)) {
        const result = applyOperationTo(current(id), id in model.nodes ? "node" : "edge", op, n);
        if ("element" in result) { state.set(id, result.element); continue; }
        const key = `${source}: ${result.error}`;
        const entry = refused.get(key) ?? { names: [], first: period };
        if (!entry.names.includes(name(id))) entry.names.push(name(id));
        refused.set(key, entry);
      }
    }
  };

  for (const period of planTimeline(doc.timeline).periods) {
    run("profile", doc.profile[period.label] ?? [], period.label);
    for (const phase of period.phases) {
      for (const eventId of phase.events) {
        const event = byId.get(eventId);
        if (event?.attribute_operations) run(`Event "${event.label}"`, event.attribute_operations, period.label);
      }
    }
  }

  const out = [...refused].map(([key, { names, first }]) =>
    `${key} — ${names.length} Element${names.length > 1 ? "s" : ""} (${some(names)}), first in ${first}. A run refuses it and keeps the old value.`);
  doc.metrics.forEach((m, i) => {
    const matched = matchElements(m.target, model);
    if (matched.length === 0) return; // reported by docWarnings
    const holds = matched.some((id) => {
      const r = readPath(current(id), m.path);
      return "value" in r && typeof r.value === "number";
    });
    if (!holds) out.push(`metrics[${i}] ("${m.name}"): none of its ${matched.length} Element${matched.length > 1 ? "s" : ""} holds a number at ${m.path.join(" › ")}, so it shows "—".`);
  });
  return out;
}
