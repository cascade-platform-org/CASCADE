/**
 * temporal-simulation-text.ts — the plain-text form of a Temporal Simulation
 * definition, for bulk editing and for LLM round-trips.
 *
 * The text is JSON validated by `TemporalSimulationDocSchema`, the same schema
 * the window edits through, so a definition written by hand, in the window or by
 * an LLM is one object. Pure: no store access.
 */

import type { ZodError } from "zod";
import {
  TEMPORAL_SIMULATION_FORMAT,
  TemporalSimulationDocSchema,
  type AttributeOperation,
  type Metric,
  type TemporalSimulationDoc,
  type Timeline,
} from "@/lib/temporal-simulation-schema";
import { filterMisuse, matchElements, type FilterableModel } from "@/lib/element-filter";
import { planTimeline } from "@/lib/timeline-plan";
import type { EventDefinition, ModelConfiguration } from "@/lib/schemas/config";

/** One profile operation as the window lists it: the period it belongs to, and the operation. */
export interface ProfileEntry {
  id: string;
  label: string;
  op: AttributeOperation;
}

export interface MetricEntry {
  id: string;
  metric: Metric;
}

export interface SimulationDraft {
  timeline: Timeline;
  profile: ProfileEntry[];
  metrics: MetricEntry[];
}

export function draftToDoc(d: SimulationDraft): TemporalSimulationDoc {
  const profile: Record<string, AttributeOperation[]> = {};
  for (const e of d.profile) (profile[e.label] ??= []).push(e.op);
  return { format: TEMPORAL_SIMULATION_FORMAT, timeline: d.timeline, profile, metrics: d.metrics.map((m) => m.metric) };
}

export function docToDraft(doc: TemporalSimulationDoc, newId: () => string): SimulationDraft {
  return {
    timeline: doc.timeline,
    profile: Object.entries(doc.profile).flatMap(([label, ops]) => ops.map((op) => ({ id: newId(), label, op }))),
    metrics: doc.metrics.map((metric) => ({ id: newId(), metric })),
  };
}

export const serializeDoc = (doc: TemporalSimulationDoc): string => JSON.stringify(doc, null, 2);

/**
 * Pull the JSON out of pasted text. Accepts bare JSON, or a whole LLM reply:
 * the first ```json fenced block wins, else the outermost braces.
 */
export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*\n([\s\S]*?)```/);
  if (fenced) return fenced[1];
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  return first >= 0 && last > first ? text.slice(first, last + 1) : text;
}

const formatIssues = (err: ZodError): string[] =>
  err.issues.map((i) => `${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`);

export type ParseResult = { ok: true; doc: TemporalSimulationDoc } | { ok: false; errors: string[] };

export function parseDocText(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(extractJson(text));
  } catch (e) {
    return { ok: false, errors: [`Not valid JSON: ${(e as Error).message}`] };
  }
  const parsed = TemporalSimulationDocSchema.safeParse(raw);
  return parsed.success ? { ok: true, doc: parsed.data } : { ok: false, errors: formatIssues(parsed.error) };
}

/** Problems a valid document can still have against THIS project. Reported; applying is still allowed. */
export function docWarnings(doc: TemporalSimulationDoc, events: EventDefinition[], model: FilterableModel): string[] {
  const out: string[] = [];
  const eventIds = new Set(events.map((e) => e.id));
  const unknownEvents = new Set<string>();
  doc.timeline.steps.forEach((s) => s.phases.forEach((p) => p.events.forEach((id) => { if (!eventIds.has(id)) unknownEvents.add(id); })));
  doc.timeline.every.forEach((r) => r.events.forEach((id) => { if (!eventIds.has(id)) unknownEvents.add(id); }));
  if (unknownEvents.size) out.push(`Unknown Event ids: ${[...unknownEvents].join(", ")}. Create them in Config → Events.`);

  const plan = planTimeline(doc.timeline);
  out.push(...plan.warnings);
  const labels = new Set(plan.periods.map((p) => p.label));
  for (const [label, ops] of Object.entries(doc.profile)) {
    if (!labels.has(label)) out.push(`Profile label "${label}" is not a period of the Timeline; its ${ops.length} operation(s) never apply.`);
    ops.forEach((op, i) => {
      const where = `profile["${label}"][${i}]`;
      if (op.element !== undefined && !(op.element in model.nodes) && !(op.element in model.edges)) {
        out.push(`${where}: no Element "${op.element}".`);
      }
      if (op.where) {
        filterMisuse(op.where).forEach((m) => out.push(`${where}.where: ${m}.`));
        if (matchElements(op.where, model).length === 0) out.push(`${where}.where matches no Element.`);
      }
    });
  }
  doc.metrics.forEach((m, i) => {
    filterMisuse(m.target).forEach((x) => out.push(`metrics[${i}].target: ${x}.`));
    if (matchElements(m.target, model).length === 0) out.push(`metrics[${i}] ("${m.name}"): target matches no Element.`);
  });
  return out;
}

export const FORMAT_REFERENCE = `Format "${TEMPORAL_SIMULATION_FORMAT}" — JSON, strict (unknown keys are errors).

{
  "format": "${TEMPORAL_SIMULATION_FORMAT}",
  "timeline": {
    "name": string,
    "steps": [                         // run in order
      { "label": string,               // first period: day YYYY-MM-DD | week YYYY-Www | month YYYY-MM | quarter YYYY-Qn | year YYYY | none: any text
        "unit": "day"|"week"|"month"|"quarter"|"year"|"none",
        "repeat": int >= 1,            // consecutive periods; the label advances by the unit (none: label#2, label#3…)
        "phases": [                    // run in order inside each period
          { "events": [EventId…],      // applied in order
            "propagate": bool }        // then one Propagation (one Engine Evaluation)
        ] }
    ],
    "every": [ { "every": N, "phase": k (1-based), "events": [EventId…] } ]   // add Events to Phase k of periods N, 2N, 3N…
  },
  "profile": {                         // period label → operations applied at the start of that period
    "<label>": [
      { "element": ElementId            // exactly one of "element" or "where"
        "where": Filter,
        "path": ["supply_capacity", "<category>", "rate"],   // field path as a list
        "op": "set"|"add"|"mul"|"at_most"|"at_least",        // at_most caps at value; at_least raises to value
        "value": number (string/bool only with "set") }
    ]
  },
  "metrics": [
    { "name": string, "target": Filter, "path": [..],
      "read": "state"|"change",        // end-of-period value, or after − before
      "phase": k (optional, change only), "aggregate": "sum"|"mean"|"min"|"max"|"count"|"share_where"|"percentile",
      "percentile": 0–100 (optional), "value_filter": { "cmp": "<"|"<="|">"|">="|"=="|"!=", "value": number } (optional) }
  ]
}

Filter (every given condition must hold; resolved again each time it is used):
  { "kind": "node"|"edge", "canvas": id or label, "category": string,
    "node_type": "Source"|"Infrastructure"|"Service"|"Personnel" (nodes only),
    "label_contains": string (an edge reads as "source label → target label"),
    "exclude": [ElementId…] (matches to leave out) }

Semantics to respect:
- A period has no duration. Time passes only through a Temporal Jump Event placed in a Phase or an "every" rule.
- A run starts with a Reset. Shortage is recomputed before every Propagation; Event-imposed damage stays until an Event changes it.
- Stocks (supply_capacity.<category> or an edge capacity as an object with rate, inflow, level, min, max, max_draw, retention, efficiency)
  are integrated once per period, right after the last propagating Phase. Levels are typed in their stored sign (positive = available to draw).
- Events used only here should be "Temporal Simulation only" in Config → Events.`;

/**
 * What an LLM needs to write a definition from zero: the concepts, what a
 * `path` can reach, and how a run executes. Kept beside FORMAT_REFERENCE so the
 * two are edited together.
 */
const PRIMER = `## What CASCADE models

CASCADE models networks of Elements (nodes and edges) that depend on each other: water, power, ICT, people.
Each Element has a Functionality on an integer scale 1..N (1 = critical, N = fully operational).
A Propagation is one engine run: it reads supplies, demands, capacities and dependencies, and lowers the
Functionality of Elements whose needs are not met (it never raises it).

Categories are the resources that flow or are required:
- SourceToDemands: a quantity flows from sources (supply_capacity) through edges (capacity) to consumers
  (category_dependency_profiles.<category>.demand); a consumer short of supply degrades.
- Requisite: a logical dependency; the Element needs its suppliers to be working, no quantity involved.

An Event perturbs the model: a hazard (physical damage), a disservice (no damage), or a temporal jump
(advances time by its hours: every positive functionality_time — a backup's remaining hours — drops by that
amount, and a backup reaching 0 fails its Element). Which Elements an Event hits is set on the Elements
(vulnerability_levels), not in this definition. Events are created in Config → Events; this definition only
refers to them by id. Events used only in simulations are marked "Temporal Simulation only".

## What a Temporal Simulation is

A saved run over many periods (months, weeks…). A period has no duration of its own: time passes only
where a temporal jump Event is placed. Each period runs, in order:
1. its profile operations (the per-period inputs: rates, demands, capacities);
2. each Phase in order: apply the Phase's Events (and any "every" rule's Events for that period), then,
   if "propagate" is true, run one Propagation. Before every Propagation, degradation caused by shortage is
   reset, so a shortage lasts only as long as its cause; damage imposed by an Event stays until another
   Event changes it (a repair is an Event).
A run always starts from a Reset (every Element operational). Each propagating Phase costs one engine
evaluation, so periods × propagating Phases is the run's cost: keep Phases that do not need a Propagation
at "propagate": false.

Use two Phases when an Event must be read on its own (e.g. a settlement after the period's work),
otherwise one. Use "every" for policies that recur every N periods instead of repeating Steps.

## What a "path" can reach (profile operations and Metrics)

Node fields:
- ["supply_capacity", "<category>"]                              how much the node supplies per period
- ["throughput_capacity", "<category>"]                          how much it can pass on
- ["category_dependency_profiles", "<category>", "demand"]        how much it needs per period
- ["category_dependency_profiles", "<category>", "priority"]      1–10, who is served first in a shortage
- ["category_dependency_profiles", "<category>", "backup_duration"]  hours a backup lasts
- ["functionality"]                                              1..N (an operation here acts like an Event)
- ["functionality_time"]                                         remaining backup hours
- ["direct_damage"], ["expected_repair_time"]
- ["importance"], ["cost_of_disservice_per_day"], ["properties", "<key>"]
Edge fields: ["capacity"], ["functionality"], ["functionality_time"], ["direct_damage"], ["properties", "<key>"].
Stocks (a value that accumulates across periods: a reservoir level, an hours balance) are specified but not
built yet; until then operate on the plain numbers above.

Operations: set (write the value), add, mul, at_most (cap at the value), at_least (raise to the value).
The last four need a number. An operation on a field the Element does not have is rejected (except set).

## Choosing Elements

"element": one id. "where": a filter — kind (node|edge), canvas, category, node_type, label_contains —
every given condition must hold; "exclude" leaves out listed ids. A filter is resolved each time the
operation runs, so prefer it over many single-Element operations.

## Metrics

A Metric is a read-out computed per period from the recorded run: for the Elements its target selects, read
"path" — "state" at the end of the period, or "change" (after − before) over one Phase or the whole period —
and aggregate (sum, mean, min, max, count, share_where, percentile). It never changes the run.`;

/** A complete, valid definition used as the worked example (tested to parse). */
export const EXAMPLE_DOC: TemporalSimulationDoc = {
  format: TEMPORAL_SIMULATION_FORMAT,
  timeline: {
    name: "Six months of a dry season, with quarterly maintenance",
    steps: [
      {
        label: "2024-01",
        unit: "month",
        repeat: 6,
        phases: [
          { events: ["advance-one-month"], propagate: true },
          { events: [], propagate: false },
        ],
      },
    ],
    every: [{ every: 3, phase: 2, events: ["pump-maintenance"] }],
  },
  profile: {
    "2024-01": [
      { where: { kind: "node", category: "water", node_type: "Source" }, path: ["supply_capacity", "water"], op: "set", value: 100 },
    ],
    "2024-03": [
      { where: { kind: "node", category: "water", node_type: "Source" }, path: ["supply_capacity", "water"], op: "mul", value: 0.8 },
    ],
    "2024-04": [
      { where: { kind: "node", node_type: "Service", label_contains: "hospital" }, path: ["category_dependency_profiles", "water", "priority"], op: "set", value: 10 },
    ],
  },
  metrics: [
    { name: "mean Functionality of services", target: { kind: "node", node_type: "Service" }, path: ["functionality"], read: "state", aggregate: "mean" },
    { name: "services degraded", target: { kind: "node", node_type: "Service" }, path: ["functionality"], read: "state", aggregate: "count", value_filter: { cmp: "<", value: 4 } },
  ],
};

/** A self-contained prompt: the primer, the format, a worked example, this project, and the current definition. */
export function llmContext(
  doc: TemporalSimulationDoc,
  config: Pick<ModelConfiguration, "events" | "categories" | "functionality_scale">,
  model: FilterableModel,
): string {
  const { events } = config;
  const nodes = Object.values(model.nodes);
  const edges = Object.values(model.edges);
  const nodeTypes = [...new Set(nodes.map((n) => n.node_type).filter(Boolean))];
  const listElements = nodes.length + edges.length <= 300;
  const fmt = (r: Record<string, number> | undefined) => Object.entries(r ?? {}).map(([k, v]) => `${k} ${v}`).join(", ");
  const lines = [
    "# CASCADE Temporal Simulation — write the definition",
    "",
    "You are writing the JSON definition of a Temporal Simulation for CASCADE. Read the primer, follow the format",
    "exactly (unknown keys are errors), use only the Event ids and Element ids listed under \"This project\", and",
    "reply with the complete JSON in one ```json block. It is pasted back into CASCADE, validated, and shown",
    "before anything is applied. If an Event you need does not exist, say so: the user creates it in",
    "Config → Events (as \"Temporal Simulation only\") and gives you its id.",
    "",
    PRIMER,
    "",
    "## Format",
    "```",
    FORMAT_REFERENCE,
    "```",
    "",
    "## Worked example (another project; its ids are placeholders)",
    "```json",
    serializeDoc(EXAMPLE_DOC),
    "```",
    "",
    "## This project",
    `Functionality scale (N = ${config.functionality_scale.length}): ${[...config.functionality_scale].sort((a, b) => a.level - b.level).map((l) => `${l.level} ${l.label}`).join(", ")}`,
    `Categories: ${config.categories.map((c) => `${c.name} (${c.category_type})`).join(", ") || "(none)"}`,
    "Events (id — label — type — used in):",
    ...(events.length
      ? events.map((e) => `- ${e.id} — ${e.label} — ${e.type}${e.type === "temporal_jump" && e.duration_hours ? ` (${e.duration_hours} h)` : ""} — ${e.temporal_simulation_only ? "Temporal Simulation only" : "scenario"}`)
      : ["- (none yet)"]),
    `Canvases: ${Object.values(model.canvases).map((c) => `${c.id} (${c.label})`).join(", ") || "(none)"}`,
    `Node types: ${nodeTypes.join(", ") || "(none)"}`,
    `${nodes.length} nodes, ${edges.length} edges.`,
  ];
  if (listElements) {
    lines.push("Nodes (id — label — type — supplies / needs):");
    nodes.forEach((n) => {
      const needs = Object.entries(n.category_dependency_profiles ?? {}).map(([c, p]) => `${c}${p.demand !== undefined ? ` ${p.demand}` : ""}`).join(", ");
      lines.push(`- ${n.id} — ${n.label ?? ""} — ${n.node_type ?? ""} — supplies: ${fmt(n.supply_capacity) || "—"} / needs: ${needs || "—"}`);
    });
    lines.push("Edges (id — source → target — capacity):");
    edges.forEach((e) => lines.push(`- ${e.id} — ${e.source} → ${e.target}${e.capacity !== undefined ? ` — ${e.capacity}` : ""}`));
  } else {
    lines.push("Too many Elements to list: select them with \"where\" filters (kind, canvas, category, node_type, label_contains).");
  }
  lines.push("", "## Current definition (edit this)", "```json", serializeDoc(doc), "```");
  return lines.join("\n");
}
