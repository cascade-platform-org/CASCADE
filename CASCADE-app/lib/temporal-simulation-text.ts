/**
 * temporal-simulation-text.ts — the plain-text form of a Temporal Simulation
 * definition, for bulk editing and for LLM round-trips.
 *
 * The text is JSON validated by `TemporalSimulationSchema`, the same schema
 * the window edits through, so a definition written by hand, in the window or by
 * an LLM is one object. Pure: no store access.
 */

import type { ZodError } from "zod";
import { AggregateSchema, CalendarUnitSchema, ComparisonSchema, STANDARD_METRICS, TEMPORAL_SIMULATION_FORMAT, TemporalSimulationSchema, type Metric, type StandardMetric, type TemporalSimulation, type Timeline } from "@/lib/schemas/temporal-simulation";
import { OperationKindSchema, type AttributeOperation } from "@/lib/schemas/attribute-operation";
import { filterMisuse, matchElements, type FilterableModel } from "@/lib/element-filter";
import { planTimeline } from "@/lib/timeline-plan";
import type { EventDefinition, ModelConfiguration } from "@/lib/schemas/config";
import type { CapacityValue } from "@/lib/schemas/network";

/**
 * One row of the profile grid: one operation (target, path, op) and its value in
 * each period that applies it; a label absent from `values` applies nothing.
 * Rows are how the window shows the profile; the document keeps
 * `{label: [operations]}`.
 */
export type ProfileRow = Omit<AttributeOperation, "value"> & {
  id: string;
  values: Record<string, AttributeOperation["value"]>;
};

export interface MetricEntry {
  id: string;
  metric: Metric;
}

export interface SimulationDraft {
  timeline: Timeline;
  profile: ProfileRow[];
  metrics: MetricEntry[];
  standardMetrics: StandardMetric[];
}

/** The operation a row applies in one period. */
export function rowOperation(row: ProfileRow, value: AttributeOperation["value"]): AttributeOperation {
  const target = row.where !== undefined ? { where: row.where } : { element: row.element };
  return { ...target, path: row.path, op: row.op, value };
}

/** Rows → `{label: [operations]}`: a period's operations follow row order; labels in Timeline order, unknown ones after. */
function rowsToProfile(rows: ProfileRow[], timeline: Timeline): Record<string, AttributeOperation[]> {
  const labels = new Set([...planTimeline(timeline).periods.map((p) => p.label), ...rows.flatMap((r) => Object.keys(r.values))]);
  const profile: Record<string, AttributeOperation[]> = {};
  for (const label of labels) {
    const ops = rows.filter((r) => label in r.values).map((r) => rowOperation(r, r.values[label]));
    if (ops.length > 0) profile[label] = ops;
  }
  return profile;
}

/**
 * `{label: [operations]}` → rows. An operation joins an existing row with the
 * same target, path and op when that keeps its period's order; otherwise it
 * starts a row. So rows → document gives back exactly the lists it came from.
 */
function profileToRows(profile: Record<string, AttributeOperation[]>, newId: () => string): ProfileRow[] {
  const rows: ProfileRow[] = [];
  const keys: string[] = [];
  for (const [label, ops] of Object.entries(profile)) {
    let previous = -1;
    for (const { value, ...op } of ops) {
      const key = JSON.stringify([op.element, op.where, op.path, op.op]);
      let i = keys.findIndex((k, j) => j > previous && k === key && !(label in rows[j].values));
      if (i < 0) {
        i = rows.push({ ...op, id: newId(), values: {} }) - 1;
        keys.push(key);
      }
      rows[i].values[label] = value;
      previous = i;
    }
  }
  return rows;
}

export function draftToDoc(d: SimulationDraft): TemporalSimulation {
  return {
    format: TEMPORAL_SIMULATION_FORMAT,
    timeline: d.timeline,
    profile: rowsToProfile(d.profile, d.timeline),
    metrics: d.metrics.map((m) => m.metric),
    standard_metrics: d.standardMetrics,
  };
}

export function docToDraft(doc: TemporalSimulation, newId: () => string): SimulationDraft {
  return {
    timeline: doc.timeline,
    profile: profileToRows(doc.profile, newId),
    metrics: doc.metrics.map((metric) => ({ id: newId(), metric })),
    standardMetrics: doc.standard_metrics,
  };
}

/**
 * JSON text; a Phase Event that fires every period is written as its bare id,
 * and `standard_metrics` only when one is hidden.
 */
export function serializeDoc(doc: TemporalSimulation): string {
  const { standard_metrics, ...rest } = doc;
  const compact = {
    ...rest,
    ...(STANDARD_METRICS.every((m) => standard_metrics.includes(m)) ? {} : { standard_metrics }),
    timeline: {
      ...doc.timeline,
      steps: doc.timeline.steps.map((s) => ({
        ...s,
        phases: s.phases.map((p) => ({ ...p, events: p.events.map((e) => (e.every === 1 ? e.event : e)) })),
      })),
    },
  };
  return JSON.stringify(compact, null, 2);
}

/**
 * Pull the JSON out of pasted text. Accepts bare JSON, or a whole LLM reply:
 * the first ```json fenced block wins, else the outermost braces.
 */
export function extractJson(text: string): string {
  // Fences pair up in order, so another language's block before the JSON cannot shift them.
  const fences = [...text.matchAll(/```([\w-]*)[^\n]*\n([\s\S]*?)```/g)];
  const fenced = fences.find((f) => f[1] === "json") ?? fences.find((f) => f[2].trim().startsWith("{"));
  if (fenced) return fenced[2];
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  return first >= 0 && last > first ? text.slice(first, last + 1) : text;
}

const formatIssues = (err: ZodError): string[] =>
  err.issues.map((i) => `${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`);

export type ParseResult = { ok: true; doc: TemporalSimulation } | { ok: false; errors: string[] };

export function parseDocText(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(extractJson(text));
  } catch (e) {
    return { ok: false, errors: [`Not valid JSON: ${(e as Error).message}`] };
  }
  return checkDoc(raw);
}

/**
 * Validate a document: its normalised form (bare Event ids expanded, defaults
 * filled), or its schema errors worded as `parseDocText` words them, so the
 * tabs' edits get the check pasted text gets.
 */
export function checkDoc(raw: unknown): ParseResult {
  const parsed = TemporalSimulationSchema.safeParse(raw);
  return parsed.success ? { ok: true, doc: parsed.data } : { ok: false, errors: formatIssues(parsed.error) };
}

/** Problems a valid document can still have against THIS project. Reported; applying is still allowed. */
export function docWarnings(doc: TemporalSimulation, events: EventDefinition[], model: FilterableModel): string[] {
  const out: string[] = [];
  const eventIds = new Set(events.map((e) => e.id));
  const unknownEvents = new Set<string>();
  doc.timeline.steps.forEach((s) => s.phases.forEach((p) => p.events.forEach((e) => { if (!eventIds.has(e.event)) unknownEvents.add(e.event); })));
  if (unknownEvents.size) out.push(`Unknown Event ids: ${[...unknownEvents].join(", ")}. Create them in Config → Events.`);

  const plan = planTimeline(doc.timeline);
  out.push(...plan.errors, ...plan.warnings);
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

/** `"a"|"b"|"c"`, from a schema enum, so the reference cannot drift from it. */
const alternatives = (options: readonly string[]) => options.map((o) => `"${o}"`).join("|");

export const FORMAT_REFERENCE = `Format "${TEMPORAL_SIMULATION_FORMAT}" — JSON, strict (unknown keys are errors).

{
  "format": "${TEMPORAL_SIMULATION_FORMAT}",
  "timeline": {
    "name": string,
    "steps": [                         // run in order
      { "label": string,               // first period: hour YYYY-MM-DDTHH | day YYYY-MM-DD | week YYYY-Www | month YYYY-MM | quarter YYYY-Qn | year YYYY | none: any text
        "unit": ${alternatives(CalendarUnitSchema.options)},
        "repeat": int >= 1,            // consecutive periods; the label advances by the unit (none: label#2, label#3…)
        "phases": [                    // run in order inside each period
          { "events": [                // applied in order
              EventId,                 // fires every period of the Step
              { "event": EventId, "every": N }   // fires on the Step's periods N, 2N, 3N…
            ],
            "propagate": bool }        // then one Propagation (one Engine Evaluation)
        ] }
    ]
  },
  "profile": {                         // period label → operations applied at the start of that period
    "<label>": [
      { "element": ElementId            // exactly one of "element" or "where"
        "where": Filter,
        "path": ["supply_capacity", "<category>", "rate"],   // field path as a list
        "op": ${alternatives(OperationKindSchema.options)},        // at_most caps at value; at_least raises to value
        "value": number (string/bool only with "set") }
    ]
  },
  "metrics": [
    { "name": string, "target": Filter, "path": [..],
      "read": "state"|"change",        // end-of-period value, or after − before
      "phase": k (optional, change only), "aggregate": ${alternatives(AggregateSchema.options)},
      "percentile": 0–100 (optional), "value_filter": { "cmp": ${alternatives(ComparisonSchema.options)}, "value": number } (optional) }
  ],
  "standard_metrics": [${alternatives(STANDARD_METRICS)}…]   // optional: the standard columns shown before "metrics"; all by default
}

Filter (every given condition must hold; resolved again each time it is used):
  { "kind": "node"|"edge", "canvas": id or label, "category": string,
    "node_type": string (nodes only; this project's Node Types are listed with it),
    "label_contains": string (an edge reads as "source label → target label"),
    "exclude": [ElementId…] (matches to leave out) }

Semantics to respect:
- A period has no duration. Time passes only through a Temporal Jump Event placed in a Phase.
- A run starts with a Reset. Shortage is recomputed before every Propagation; Event-imposed damage stays until an Event changes it.
- Stocks (supply_capacity.<category> or an edge capacity as an object with rate, inflow, level, min, max, max_draw, max_fill,
  retention, efficiency, level_reference, change_reference) are integrated once per period, right after the last propagating
  Phase. Levels are typed in their stored sign (positive = available to draw). A Stock with max_fill is storage (a tank): it is
  the last source used and the last sink filled, so water passes through it within a period.
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

A saved definition, run over many periods (hours, days, months…). A period has no duration of its own: time passes only
where a temporal jump Event is placed. Each period runs, in order:
1. its profile operations (the per-period inputs: rates, demands, capacities);
2. each Phase in order: apply the Phase's Events that fire this period, then,
   if "propagate" is true, run one Propagation. Before every Propagation, degradation caused by shortage is
   reset, so a shortage lasts only as long as its cause; damage imposed by an Event stays until another
   Event changes it (a repair is an Event).
A run always starts from a Reset (every Element operational). Each propagating Phase costs one engine
evaluation, so periods × propagating Phases is the run's cost: keep Phases that do not need a Propagation
at "propagate": false.

Use two Phases when an Event must be read on its own (e.g. a settlement after the period's work),
otherwise one. An Event written { "event": id, "every": 3 } fires on the 3rd, 6th, 9th… period of its Step
(a quarterly policy in a monthly Step); a bare id fires every period.

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
A supply or edge capacity may be a Stock (a value that accumulates across periods: a reservoir level, an
hours balance); its fields are reached the same way, e.g. ["supply_capacity", "<category>", "rate"].

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
export const EXAMPLE_DOC: TemporalSimulation = {
  format: TEMPORAL_SIMULATION_FORMAT,
  standard_metrics: [...STANDARD_METRICS],
  timeline: {
    name: "Six months of a dry season, with quarterly maintenance",
    steps: [
      {
        label: "2024-01",
        unit: "month",
        repeat: 6,
        phases: [
          { events: [{ event: "advance-one-month", every: 1 }], propagate: true },
          { events: [{ event: "pump-maintenance", every: 3 }], propagate: false },
        ],
      },
    ],
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
  doc: TemporalSimulation,
  config: Pick<ModelConfiguration, "events" | "categories" | "functionality_scale">,
  model: FilterableModel,
): string {
  const { events } = config;
  const nodes = Object.values(model.nodes);
  const edges = Object.values(model.edges);
  const nodeTypes = [...new Set(nodes.map((n) => n.node_type).filter(Boolean))];
  const listElements = nodes.length + edges.length <= 300;
  // A Stock is listed whole, as JSON, so an operation can address its fields by path.
  const capacity = (v: CapacityValue) => (typeof v === "number" ? String(v) : `Stock ${JSON.stringify(v)}`);
  const fmt = (r: Record<string, CapacityValue> | undefined) => Object.entries(r ?? {}).map(([k, v]) => `${k} ${capacity(v)}`).join(", ");
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
    edges.forEach((e) => lines.push(`- ${e.id} — ${e.source} → ${e.target}${e.capacity !== undefined ? ` — ${capacity(e.capacity)}` : ""}`));
  } else {
    lines.push("Too many Elements to list: select them with \"where\" filters (kind, canvas, category, node_type, label_contains).");
  }
  lines.push("", "## Current definition (edit this)", "```json", serializeDoc(doc), "```");
  return lines.join("\n");
}
