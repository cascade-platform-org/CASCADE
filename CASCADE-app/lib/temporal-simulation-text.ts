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
import type { EventDefinition } from "@/lib/schemas/config";

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

Filter (every given condition must hold):
  { "kind": "node"|"edge", "canvas": id or label, "node_type": "Source"|"Infrastructure"|"Service"|"Personnel" (nodes),
    "category": string, "from": NodeId (edges), "to": NodeId (edges),
    "property": { "key": string, "equals": value (optional) }, "label_contains": string, "ids": [ElementId…] }

Semantics to respect:
- A period has no duration. Time passes only through a Temporal Jump Event placed in a Phase or an "every" rule.
- A run starts with a Reset. Shortage is recomputed before every Propagation; Event-imposed damage stays until an Event changes it.
- Stocks (supply_capacity.<category> or an edge capacity as an object with rate, inflow, level, min, max, max_draw, retention, efficiency)
  are integrated once per period, right after the last propagating Phase. Levels are typed in their stored sign (positive = available to draw).
- Events used only here should be "Temporal Simulation only" in Config → Events.`;

/** A self-contained prompt: instructions, the format, what exists in this project, and the current definition. */
export function llmContext(doc: TemporalSimulationDoc, events: EventDefinition[], model: FilterableModel): string {
  const nodes = Object.values(model.nodes);
  const edges = Object.values(model.edges);
  const nodeTypes = [...new Set(nodes.map((n) => n.node_type).filter(Boolean))];
  const categories = [...new Set(nodes.flatMap((n) => [...(n.node_categories ?? []), ...Object.keys(n.supply_capacity ?? {}), ...Object.keys(n.category_dependency_profiles ?? {})]))];
  const propKeys = [...new Set([...nodes, ...edges].flatMap((e) => Object.keys(e.properties ?? {})))];
  const listElements = nodes.length + edges.length <= 300;
  const lines = [
    "# CASCADE Temporal Simulation — editable definition",
    "",
    "Edit the JSON definition at the end and reply with the complete JSON in one ```json block. It is pasted back into CASCADE and validated against the format below.",
    "Use only the Event ids and Element ids listed here. Prefer \"where\" filters over listing many Elements.",
    "",
    "## Format",
    "```",
    FORMAT_REFERENCE,
    "```",
    "",
    "## This project",
    `Events (id — label — type — used in):`,
    ...events.map((e) => `- ${e.id} — ${e.label} — ${e.type}${e.type === "temporal_jump" && e.duration_hours ? ` (${e.duration_hours} h)` : ""} — ${e.temporal_simulation_only ? "Temporal Simulation only" : "scenario"}`),
    events.length === 0 ? "- (none yet)" : "",
    `Canvases: ${Object.values(model.canvases).map((c) => `${c.id} (${c.label})`).join(", ") || "(none)"}`,
    `Node types: ${nodeTypes.join(", ") || "(none)"}`,
    `Categories: ${categories.join(", ") || "(none)"}`,
    `Property keys: ${propKeys.join(", ") || "(none)"}`,
    `${nodes.length} nodes, ${edges.length} edges.`,
  ];
  if (listElements) {
    lines.push("Nodes (id — label — type — categories):");
    nodes.forEach((n) => lines.push(`- ${n.id} — ${n.label ?? ""} — ${n.node_type ?? ""} — ${[...new Set([...Object.keys(n.supply_capacity ?? {}).map((c) => `supplies ${c}`), ...Object.keys(n.category_dependency_profiles ?? {}).map((c) => `needs ${c}`)])].join(", ")}`));
    lines.push("Edges (id — source → target):");
    edges.forEach((e) => lines.push(`- ${e.id} — ${e.source} → ${e.target}`));
  } else {
    lines.push("Too many Elements to list: select them with \"where\" filters.");
  }
  lines.push("", "## Current definition", "```json", serializeDoc(doc), "```");
  return lines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");
}
