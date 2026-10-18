/**
 * codec.ts — a project bundle as a Workbook model, and back (ADR-0023).
 *
 * `encodeWorkbook` writes the sheets, reads them back, keeps what they cannot
 * say in the hidden `_cascade` sheet's residual, and checks the round trip
 * before returning: a Workbook that would lose anything is never produced.
 * `decodeWorkbook` reads a model (one CASCADE wrote, or a person edited) into
 * the raw bundle, with every value's cell, and `parseDecoded` validates it,
 * repairing what a spreadsheet typically does to a value with a warning on the
 * cell. Pure: no file library, no store.
 */

import { deepEqual } from "@/lib/graph-diff";
import { planTimeline } from "@/lib/timeline-plan";
import { withDecimalPoint } from "@/lib/decimal-comma";
import { seriesLabels } from "@/lib/series-edit";
import { profileToRows, rowsToProfile, type ProfileRow } from "@/lib/temporal-simulation-text";
import { ProjectSchema } from "@/lib/schemas/network";
import { ModelConfigurationSchema } from "@/lib/schemas/config";
import type { ProjectBundle } from "@/lib/schemas/bundle";
import { OPERAND_FACTORS } from "@/lib/schemas/attribute-operation";
import { Blobs, readValue, writeFreeValue, writeValue } from "./cells";
import { a1, type Cell, type CellRef, type Problem, type SheetModel, type WorkbookModel, cellText, textCell } from "./model";
import { clone, formatKey, getIn, isObject, own, parseKey, setIn, type Json, type JsonObject } from "./paths";
import { CASCADE_SHEET, WORKBOOK_FORMAT, applyResidual, readCascadeSheet, residual, writeCascadeSheet, type ResidualEntry } from "./residual";
import { leaves, place, readHeader, readTable, writeTable, type ReadRecord, type TableSpec } from "./table";

export const SHEETS = {
  readme: "README",
  project: "Project",
  canvases: "Canvases",
  nodes: "Nodes",
  edges: "Edges",
  categories: "Categories",
  scale: "Functionality scale",
  levels: "Level scale",
  events: "Events",
  operations: "Event operations",
  graphTypes: "Graph types",
  templates: "Node templates",
  simulations: "Simulations",
  steps: "Steps",
  parameters: "Parameters",
  profile: "Profile",
  metrics: "Metrics",
  series: "Series",
  sheets: "Sheets",
} as const;

const RESERVED = new Set<string>([...Object.values(SHEETS), CASCADE_SHEET]);
const SERIES_PREFIX = "S·";

/** Where a decoded value came from: its path from the bundle root → its cell. */
type Locator = Map<string, CellRef>;
const pathKey = (path: readonly (string | number)[]) => JSON.stringify(path.map(String));

const without = (rec: JsonObject, keys: readonly string[]): JsonObject =>
  Object.fromEntries(Object.entries(rec).filter(([k]) => !keys.includes(k)));

/** A sheet title not yet taken, within the 31 characters a sheet name holds. */
function freshTitle(wanted: string, taken: Set<string>): string {
  let title = wanted.slice(0, 31);
  for (let k = 2; taken.has(title); k++) title = `${wanted.slice(0, 31 - ` (${k})`.length)} (${k})`;
  taken.add(title);
  return title;
}

// ---------------------------------------------------------------------------
// Specs of the record sheets
// ---------------------------------------------------------------------------

const OP_FIRST = ["element", "where.kind", "where.canvas", "where.node_type", "where.category", "where.label_contains", "where.exclude", "path", "op", "value", ...OPERAND_FACTORS];

const SPEC = {
  canvases: { name: SHEETS.canvases, first: ["id", "label", "color", "graph.graph_type", "georeferenced"] },
  nodes: { name: SHEETS.nodes, first: ["id", "label", "node_type", "canvases", "node_categories", "functionality"], opaque: ["responsibility_share"] },
  edges: { name: SHEETS.edges, first: ["id", "source", "target", "canvases", "functionality", "capacity"], opaque: ["responsibility_share"] },
  categories: { name: SHEETS.categories, first: ["name", "category_type", "color", "icon"] },
  scale: { name: SHEETS.scale, first: ["level", "label", "color"] },
  levels: { name: SHEETS.levels, first: ["label", "below", "role", "step"] },
  events: { name: SHEETS.events, first: ["id", "label", "type", "temporal_simulation_only", "frequency_per_10y"], opaque: ["direct_damage_effects"] },
  operations: { name: SHEETS.operations, first: ["event", ...OP_FIRST] },
  graphTypes: { name: SHEETS.graphTypes, first: ["name", "local_graph_types"] },
  templates: { name: SHEETS.templates, first: ["name"], opaque: ["responsibility_share"] },
  simulations: { name: SHEETS.simulations, first: ["id", "timeline.name", "scope", "canvas", "standard_metrics", "format"] },
  steps: { name: SHEETS.steps, first: ["simulation", "step", "label", "unit", "repeat", "phase", "advance_hours", "propagate", "events"] },
  parameters: { name: SHEETS.parameters, first: ["simulation", "name", "value", "description"] },
  metrics: { name: SHEETS.metrics, first: ["simulation", "name", "target.kind", "path", "read", "aggregate"] },
  seriesIndex: { name: SHEETS.series, first: ["name", "sheet", "unit", "description"] },
  sheetsIndex: { name: SHEETS.sheets, first: ["name", "sheet", "writes", "computed_at"] },
} satisfies Record<string, TableSpec>;

/** The tops of a Profile row's operation block: a period header that reads as one of them is written `period:<label>`. */
const OP_TOPS = new Set(["simulation", "element", "where", "path", "op", ...OPERAND_FACTORS]);
const PERIOD_PREFIX = "period:";

/** A period label as a column header; one that would read as another column (`isColumn`), or as a skipped one, is written `period:<label>`. */
const periodHeader = (label: string, isColumn: (l: string) => boolean): string =>
  isColumn(label) || label.startsWith(PERIOD_PREFIX) || label.startsWith("~") || label === "" ? `${PERIOD_PREFIX}${label}` : label;
/** A period column's header text as the label it stands for. */
const periodLabel = (text: string): string => (text.startsWith(PERIOD_PREFIX) ? text.slice(PERIOD_PREFIX.length) : text);
/** True when a Profile header names an operation field. */
const isOpColumn = (text: string): boolean => {
  const top = parseKey(text.endsWith("[]") ? text.slice(0, -2) : text)?.[0];
  return top !== undefined && OP_TOPS.has(top);
};

const README_LINES = [
  "CASCADE Workbook (cascade.workbook/v1): the whole project. Open it in CASCADE as you would a .json; edit it here and import it with File → Import changes.",
  "One sheet per kind of record, one row per record. A column is the field path of what it holds (supply_capacity.water.rate is that field of a node).",
  "A column ending in [] holds a list, separated by ; . A column starting with ~ is a label for reading, ignored when the file is read.",
  "Ids are what records are known by: references (source, target, element, event, simulation) are ids. An empty cell is no value, never 0.",
  "A cell starting with json: holds JSON (an empty list, a value a plain cell cannot hold). Profile and S·<name> sheets have one column per period.",
  "Sheets of your own are kept with their formulas. List one in Sheets with the model sheet it writes (Nodes, Events, Parameters, S·<name>…) and its values reach the model through Import changes.",
  "Formulas: XLOOKUP needs LibreOffice 24.8 or later; VLOOKUP and INDEX/MATCH work everywhere.",
  "The hidden _cascade sheet keeps what has no table (history, Scorecard, long texts): leave it as it is.",
];

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/** Steps → one row per Phase (a Step with none: one row without a phase). */
function stepRows(simId: string, steps: Json[]): JsonObject[] {
  const rows: JsonObject[] = [];
  steps.forEach((s, i) => {
    const step = s as JsonObject;
    const head: JsonObject = { simulation: simId, step: i + 1, ...without(step, ["phases"]) };
    const phases = (step.phases as JsonObject[] | undefined) ?? [];
    if (phases.length === 0) rows.push(head);
    phases.forEach((ph, j) => {
      const events = ((ph.events as JsonObject[] | undefined) ?? []).map((e) => (e.every === 1 ? String(e.event) : `${String(e.event)} every ${String(e.every)}`));
      rows.push({ ...head, phase: j + 1, ...without(ph, ["events"]), events });
    });
  });
  return rows;
}

/** The Profile sheet: one row per profile row of every Simulation, one column per period label. */
function profileSheet(sims: JsonObject[], blobs: Blobs): SheetModel {
  let id = 0;
  const rows: { op: JsonObject; values: Record<string, Json> }[] = [];
  const labels: string[] = [];
  const addLabel = (l: string) => { if (!labels.includes(l)) labels.push(l); };
  for (const sim of sims) {
    const timeline = sim.timeline as Parameters<typeof planTimeline>[0];
    planTimeline(timeline).periods.forEach((p) => addLabel(p.label));
    const profile = sim.profile as Parameters<typeof profileToRows>[0];
    Object.keys(profile).forEach(addLabel);
    for (const r of profileToRows(profile, () => String(id++))) {
      const { id: _id, values, ...op } = r;
      rows.push({ op: { simulation: String(sim.id), ...(op as unknown as JsonObject) }, values: values as Record<string, Json> });
    }
  }
  const block = writeTable({ name: SHEETS.profile, first: ["simulation", ...OP_FIRST.filter((k) => k !== "value")] }, rows.map((r) => r.op), blobs);
  block.rows[0].push(...labels.map((l) => textCell(periodHeader(l, isOpColumn))));
  // A profile value may be a number, true/false or text.
  rows.forEach((r, i) => block.rows[i + 1].push(...labels.map((l) => (Object.hasOwn(r.values, l) ? writeFreeValue(r.values[l], blobs) : null))));
  return block;
}

/** Each record of a child list (a Simulation's Parameters, an Event's operations) with its owner's id in `ownerKey`. */
const childRows = (owners: readonly JsonObject[], field: string, ownerKey: string): JsonObject[] =>
  owners.flatMap((o) => ((o[field] as JsonObject[] | undefined) ?? []).map((c) => ({ [ownerKey]: String(o.id), ...c })));

/** The visible sheets and what `_cascade` keeps besides the residual; `bundle` is a copy, read only. */
function visibleSheets(bundle: JsonObject): { sheets: SheetModel[]; cascade: [string, string][] } {
  const P = bundle.project as JsonObject;
  const C = bundle.config as JsonObject;
  const blobs = new Blobs();
  const sheets: SheetModel[] = [{ name: SHEETS.readme, rows: README_LINES.map((l) => [textCell(l)]) }];

  // Project: every project and configuration field no other sheet holds, as key | value.
  const kv = {
    project: without(P, ["nodes", "edges", "canvases", "update_history", "scorecard", "temporal_simulations", "series", "sheets"]),
    config: without(C, ["categories", "events", "functionality_scale", "level_scale", "graph_types", "node_defaults"]),
  };
  sheets.push({
    name: SHEETS.project,
    rows: [[textCell("key"), textCell("value")], ...leaves(kv).map((l) => [textCell(formatKey(l.path) + (l.list ? "[]" : "")), writeValue(l.value, blobs, l.list)])],
  });

  const canvases = (P.canvases as JsonObject[]) ?? [];
  const nodes = (P.nodes as Record<string, JsonObject>) ?? {};
  const edges = (P.edges as Record<string, JsonObject>) ?? {};
  // Canvas membership is a column of the node or edge; each Canvas's lists are rebuilt from it.
  const member = (kind: "node_ids" | "edge_ids") => {
    const m = new Map<string, string[]>();
    for (const c of canvases) {
      for (const id of ((c.graph as JsonObject)[kind] as string[]) ?? []) {
        const list = m.get(id) ?? [];
        if (!list.includes(String(c.id))) list.push(String(c.id));
        m.set(id, list);
      }
    }
    return m;
  };
  const nodeCanvases = member("node_ids");
  const edgeCanvases = member("edge_ids");
  const withCanvases = (rec: JsonObject, list: string[] | undefined) => (list?.length ? { ...rec, canvases: list } : rec);
  const nodeOf = (id: unknown) => own(nodes, String(id)) as JsonObject | undefined;
  const edgeOf = (id: unknown) => own(edges, String(id)) as JsonObject | undefined;
  const label = (id: unknown) => { const n = nodeOf(id); return n ? String(n.label ?? n.id) : undefined; };

  sheets.push(writeTable(SPEC.canvases, canvases.map((c) => ({ ...c, graph: without(c.graph as JsonObject, ["node_ids", "edge_ids"]) })), blobs));
  sheets.push(writeTable(SPEC.nodes, Object.values(nodes).map((n) => withCanvases(n, nodeCanvases.get(String(n.id)))), blobs));
  sheets.push(writeTable({
    ...SPEC.edges,
    derived: [
      { key: "~source_label", after: "source", value: (e) => label(e.source) },
      { key: "~target_label", after: "target", value: (e) => label(e.target) },
    ],
  }, Object.values(edges).map((e) => withCanvases(e, edgeCanvases.get(String(e.id)))), blobs));

  const events = (C.events as JsonObject[]) ?? [];
  sheets.push(writeTable(SPEC.categories, (C.categories as JsonObject[]) ?? [], blobs));
  sheets.push(writeTable(SPEC.scale, (C.functionality_scale as JsonObject[]) ?? [], blobs));
  sheets.push(writeTable(SPEC.levels, (C.level_scale as JsonObject[]) ?? [], blobs));
  sheets.push(writeTable(SPEC.events, events.map((e) => without(e, ["attribute_operations"])), blobs));
  const edgeLabel = (id: unknown) => { const e = edgeOf(id); return e ? `${label(e.source) ?? String(e.source)} → ${label(e.target) ?? String(e.target)}` : undefined; };
  const elementLabel = (op: JsonObject) => (op.element === undefined ? undefined : label(op.element) ?? edgeLabel(op.element));
  sheets.push(writeTable({
    ...SPEC.operations,
    derived: [{ key: "~event_label", after: "event", value: (o) => String(events.find((e) => e.id === o.event)?.label ?? "") || undefined }, { key: "~element_label", after: "element", value: elementLabel }],
  }, childRows(events, "attribute_operations", "event"), blobs));
  sheets.push(writeTable(SPEC.graphTypes, (C.graph_types as JsonObject[]) ?? [], blobs));
  sheets.push(writeTable(SPEC.templates, Object.entries((C.node_defaults as Record<string, JsonObject>) ?? {}).map(([name, t]) => ({ name, ...t })), blobs));

  const sims = (P.temporal_simulations as JsonObject[] | undefined) ?? [];
  sheets.push(writeTable(SPEC.simulations, sims.map((s) => ({ ...without(s, ["profile", "metrics", "parameters"]), timeline: without(s.timeline as JsonObject, ["steps"]) })), blobs));
  sheets.push(writeTable(SPEC.steps, sims.flatMap((s) => stepRows(String(s.id), ((s.timeline as JsonObject).steps as Json[]) ?? [])), blobs));
  sheets.push(writeTable(SPEC.parameters, childRows(sims, "parameters", "simulation"), blobs));
  sheets.push(profileSheet(sims, blobs));
  sheets.push(writeTable(SPEC.metrics, childRows(sims, "metrics", "simulation"), blobs));

  // Series and custom sheets: an index sheet naming each one's own sheet, then those sheets.
  const taken = new Set(RESERVED);
  const indexed = (spec: TableSpec, list: JsonObject[] | undefined, title: (x: JsonObject) => string, rows: (x: JsonObject) => SheetModel["rows"]) => {
    const items = (list ?? []).map((x) => ({ index: { ...without(x, ["rows"]), sheet: freshTitle(title(x), taken) }, x }));
    sheets.push(writeTable(spec, items.map((i) => i.index), blobs), ...items.map((i) => ({ name: String(i.index.sheet), rows: rows(i.x) })));
  };
  // A Series: elements down, period labels across.
  indexed(SPEC.seriesIndex, P.series as JsonObject[] | undefined, (x) => `${SERIES_PREFIX}${String(x.name)}`, (x) => {
    const rows = x.rows as Record<string, Record<string, Json>>;
    const labels = seriesLabels({ rows });
    return [
      [textCell("element"), textCell("~label"), ...labels.map((l) => textCell(periodHeader(l, (h) => h === "element")))],
      ...Object.entries(rows).map(([key, r]) => [
        textCell(key),
        textCell(key === "*" ? "(every Element without its own row)" : label(key) ?? edgeLabel(key) ?? ""),
        ...labels.map((l) => (Object.hasOwn(r, l) ? writeValue(r[l], blobs) : null)),
      ]),
    ];
  });
  // A custom sheet as it is. A formula is written without its value, as the file holds it: the app computes it
  // on opening, and the residual keeps the last value only until then.
  indexed(SPEC.sheetsIndex, P.sheets as JsonObject[] | undefined, (x) => String(x.name), (x) =>
    (x.rows as (JsonObject | null)[][]).map((r) => r.map((c): Cell | null => (c === null ? null : c.f !== undefined ? { v: null, f: String(c.f) } : { v: (c.v ?? null) as Cell["v"] }))));

  const cascade: [string, string][] = [["format", WORKBOOK_FORMAT]];
  if (P.update_history !== undefined) cascade.push(["project.update_history", JSON.stringify(P.update_history)]);
  if (P.scorecard !== undefined) cascade.push(["project.scorecard", JSON.stringify(P.scorecard)]);
  blobs.texts.forEach((t, i) => cascade.push([`blob/${i}`, t]));
  return { sheets, cascade };
}

/** A project that a Workbook cannot hold without loss; the path names what (a codec defect, to report). */
class WorkbookLossError extends Error {
  override name = "WorkbookLossError";
  constructor(readonly path: string[]) {
    super(`This project cannot be written as a workbook without loss at ${path.join(" › ") || "(root)"}; save it as JSON.`);
  }
}

/** The bundle as a Workbook model; throws WorkbookLossError rather than lose anything. */
export function encodeWorkbook(bundle: ProjectBundle): WorkbookModel {
  const original = clone(bundle) as unknown as JsonObject;
  const { sheets, cascade } = visibleSheets(original);
  const derived = decodeWorkbook({ sheets: [...sheets, writeCascadeSheet(cascade)] }).raw;
  const entries = residual(derived, original);
  const cascadeSheet = writeCascadeSheet([...cascade, ...(entries.length ? [["residual", JSON.stringify(entries)] as [string, string]] : [])]);
  // The model differs from the one just read only by the residual in `_cascade`: read it back from that sheet
  // and check it restores the project.
  const text = readCascadeSheet(cascadeSheet).get("residual");
  if (text !== undefined) applyResidual(derived, JSON.parse(text) as ResidualEntry[]);
  if (!deepEqual(derived, original)) throw new WorkbookLossError(residual(derived, original)[0]?.p ?? []);
  return { sheets: [...sheets, cascadeSheet] };
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

export interface Decoded {
  /** The bundle as the sheets give it, before validation. */
  raw: JsonObject;
  locate: Locator;
  problems: Problem[];
  /** Residual entries set aside because the sheet changed there since CASCADE wrote it. */
  stale: number;
}

/** Register a read record's fields: its row at `base`, each field at its column. */
function note(locate: Locator, base: string[], r: ReadRecord, sheet: string) {
  locate.set(pathKey(base), { sheet, row: r.row, col: 0 });
  for (const c of r.columns) {
    if (r.cols.has(c.key)) locate.set(pathKey([...base, ...c.path]), { sheet, row: r.row, col: c.col });
  }
}

const str = (v: Json | undefined) => (typeof v === "string" ? v : v === undefined || v === null ? undefined : String(v));

/** What every part of decoding reads and writes. */
interface DecodeContext {
  byName: Map<string, SheetModel>;
  blobs: readonly string[];
  /** A record sheet's rows, or none when the sheet is absent. */
  table: (name: string) => ReadRecord[];
  locate: Locator;
  problems: Problem[];
}

/** The owner of a child list's rows: its sheet, the id column, and each id's position. */
interface Owners {
  sheet: string;
  key: string;
  noun: string;
  index: Map<string, number>;
}

/** The position of the owner whose id a row names in `owners.key` (taken off the record), or null, reported. */
function ownerOf(ctx: DecodeContext, owners: Owners, r: ReadRecord, sheet: string): number | null {
  const id = str(r.record[owners.key]);
  const i = id === undefined ? undefined : owners.index.get(id);
  if (i === undefined) {
    ctx.problems.push({ severity: "error", at: { sheet, row: r.row, col: r.cols.get(owners.key) ?? 0 }, message: id === undefined ? `a row without a ${owners.key} id` : `no ${owners.noun} "${id}" in ${owners.sheet}` });
    return null;
  }
  delete r.record[owners.key];
  return i;
}

/** A child list sheet's rows (Parameters, Metrics, Event operations) appended to their owner's list. */
function attachChildren(ctx: DecodeContext, sheet: string, owners: Owners, list: (i: number) => Json[], base: (i: number) => string[]) {
  for (const r of ctx.table(sheet)) {
    const i = ownerOf(ctx, owners, r, sheet);
    if (i === null) continue;
    const items = list(i);
    note(ctx.locate, [...base(i), String(items.length)], r, sheet);
    items.push(r.record);
  }
}

/** A model (written by CASCADE or edited by a person) as the raw bundle, with every value's cell. */
export function decodeWorkbook(model: WorkbookModel): Decoded {
  const problems: Problem[] = [];
  const locate: Locator = new Map();
  const byName = new Map(model.sheets.map((s) => [s.name, s]));
  const cascade = readCascadeSheet(byName.get(CASCADE_SHEET));
  const format = cascade.get("format");
  if (format !== undefined && format !== WORKBOOK_FORMAT) problems.push({ severity: "error", message: `this workbook is ${format}; this CASCADE reads ${WORKBOOK_FORMAT}` });
  const blobs: string[] = [];
  for (const [k, t] of cascade) if (k.startsWith("blob/")) blobs[Number(k.slice(5))] = t;
  const table = (name: string): ReadRecord[] => {
    const sheet = byName.get(name);
    return sheet ? readTable(sheet, blobs, problems) : [];
  };
  const err = (sheet: string, row: number, col: number, message: string) => problems.push({ severity: "error", at: { sheet, row, col }, message });
  const ctx: DecodeContext = { byName, blobs, table, locate, problems };

  // Project: key | value.
  const raw: JsonObject = { project: {}, config: {} };
  const kvSheet = byName.get(SHEETS.project);
  kvSheet?.rows.slice(1).forEach((row, i) => {
    const keyText = row[0]?.v;
    if (typeof keyText !== "string" || keyText === "") return;
    const list = keyText.endsWith("[]");
    const path = parseKey(list ? keyText.slice(0, -2) : keyText);
    if (!path || (path[0] !== "project" && path[0] !== "config")) { problems.push({ severity: "warning", at: { sheet: SHEETS.project, row: i + 1, col: 0 }, message: `"${keyText}" is not a project or config field; it is ignored` }); return; }
    const read = readValue(row[1], blobs, list);
    if ("absent" in read) return;
    if ("error" in read) return err(SHEETS.project, i + 1, 1, read.error);
    const why = place(raw, path, read.value);
    if (why) return err(SHEETS.project, i + 1, 1, why);
    locate.set(pathKey(path), { sheet: SHEETS.project, row: i + 1, col: 1 });
  });
  const P = raw.project as JsonObject;
  const C = raw.config as JsonObject;

  // Canvases, then the Elements, whose `canvases` lists rebuild each Canvas's members in row order.
  const canvases = table(SHEETS.canvases).map((r, i) => {
    note(locate, ["project", "canvases", String(i)], r, SHEETS.canvases);
    const c = r.record;
    const graph = isObject(c.graph) ? c.graph : (c.graph = {});
    graph.node_ids = [];
    graph.edge_ids = [];
    return c;
  });
  P.canvases = canvases;
  const canvasById = new Map(canvases.map((c) => [String(c.id), c]));
  const registry = (sheet: string, kind: "nodes" | "edges", members: "node_ids" | "edge_ids") => {
    const out: JsonObject = {};
    for (const r of table(sheet)) {
      const id = str(r.record.id);
      if (id === undefined) { err(sheet, r.row, 0, "a row without an id"); continue; }
      if (Object.hasOwn(out, id)) { err(sheet, r.row, r.cols.get("id") ?? 0, `the id "${id}" is used twice`); continue; }
      const list = r.record.canvases;
      delete r.record.canvases;
      if (Array.isArray(list)) {
        for (const cid of list) {
          const canvas = canvasById.get(String(cid));
          if (!canvas) { err(sheet, r.row, r.cols.get("canvases") ?? 0, `no Canvas "${String(cid)}"`); continue; }
          ((canvas.graph as JsonObject)[members] as Json[]).push(id);
        }
      }
      out[id] = r.record;
      note(locate, ["project", kind, id], r, sheet);
    }
    return out;
  };
  P.nodes = registry(SHEETS.nodes, "nodes", "node_ids");
  P.edges = registry(SHEETS.edges, "edges", "edge_ids");

  const list = (sheet: string, key: string): JsonObject[] => table(sheet).map((r, i) => { note(locate, ["config", key, String(i)], r, sheet); return r.record; });
  C.categories = list(SHEETS.categories, "categories");
  C.functionality_scale = list(SHEETS.scale, "functionality_scale");
  C.level_scale = list(SHEETS.levels, "level_scale");
  const events = list(SHEETS.events, "events");
  const eventOwners: Owners = { sheet: SHEETS.events, key: "event", noun: "Event", index: new Map(events.map((e, i) => [String(e.id), i])) };
  attachChildren(ctx, SHEETS.operations, eventOwners, (i) => (events[i].attribute_operations ??= []) as Json[], (i) => ["config", "events", String(i), "attribute_operations"]);
  C.events = events;
  C.graph_types = list(SHEETS.graphTypes, "graph_types");
  const templates: JsonObject = {};
  for (const r of table(SHEETS.templates)) {
    const name = str(r.record.name);
    if (name === undefined) { err(SHEETS.templates, r.row, 0, "a row without a name"); continue; }
    delete r.record.name;
    templates[name] = r.record;
    note(locate, ["config", "node_defaults", name], r, SHEETS.templates);
  }
  C.node_defaults = templates;

  decodeSimulations(ctx, P);
  decodeIndexed(ctx, P, "series", SHEETS.series, (sheet, i) => seriesRows(ctx, sheet, i));
  // A custom sheet as it is: values and formulas, an error value as no value.
  decodeIndexed(ctx, P, "sheets", SHEETS.sheets, (sheet) =>
    sheet.rows.map((row) => row.map((c) => (c === null || (c.v === null && c.f === undefined) ? null : { v: c.error ? null : c.v, ...(c.f !== undefined ? { f: c.f } : {}) }))) as unknown as Json);

  for (const key of ["update_history", "scorecard"]) {
    const text = cascade.get(`project.${key}`);
    if (text === undefined) continue;
    try { P[key] = JSON.parse(text) as Json; } catch { problems.push({ severity: "error", message: `_cascade: project.${key} is not valid JSON` }); }
  }

  let stale = 0;
  const residualText = cascade.get("residual");
  if (residualText) {
    try { stale = applyResidual(raw, JSON.parse(residualText) as ResidualEntry[]); } catch { problems.push({ severity: "error", message: "_cascade: the residual is not valid JSON" }); }
  }
  return { raw, locate, problems, stale };
}

function decodeSimulations(ctx: DecodeContext, P: JsonObject) {
  const { byName, blobs, table, locate, problems } = ctx;
  const sims = table(SHEETS.simulations);
  if (sims.length === 0 && !byName.has(SHEETS.simulations)) return;
  const index = new Map<string, number>();
  const docs: JsonObject[] = sims.map((r, i) => {
    const id = str(r.record.id) ?? "";
    index.set(id, i);
    note(locate, ["project", "temporal_simulations", String(i)], r, SHEETS.simulations);
    const doc = r.record;
    const timeline = isObject(doc.timeline) ? doc.timeline : (doc.timeline = {});
    timeline.steps = [];
    doc.profile = {};
    doc.metrics = [];
    doc.parameters = [];
    return doc;
  });
  const owners: Owners = { sheet: SHEETS.simulations, key: "simulation", noun: "Temporal Simulation", index };
  const owner = (r: ReadRecord, sheet: string) => ownerOf(ctx, owners, r, sheet);

  // Steps: one row per Phase; the Step's own fields come from its first row.
  for (const r of table(SHEETS.steps)) {
    const i = owner(r, SHEETS.steps);
    if (i === null) continue;
    const steps = (docs[i].timeline as JsonObject).steps as JsonObject[];
    const n = typeof r.record.step === "number" ? r.record.step : steps.length + 1;
    const { step: _s, phase, events, advance_hours, propagate, ...stepFields } = r.record;
    let step = steps[n - 1];
    if (!step) { step = steps[n - 1] = { ...stepFields, phases: [] }; note(locate, ["project", "temporal_simulations", String(i), "timeline", "steps", String(n - 1)], r, SHEETS.steps); }
    if (phase === undefined) continue;
    const ph: JsonObject = { ...(advance_hours !== undefined ? { advance_hours } : {}), ...(propagate !== undefined ? { propagate } : {}) };
    ph.events = (Array.isArray(events) ? events : []).map((e) => {
      if (isObject(e)) return e;
      const m = /^(.*) every (\d+)$/.exec(String(e));
      return m ? { event: m[1], every: Number(m[2]) } : { event: String(e), every: 1 };
    });
    const phases = step.phases as JsonObject[];
    const j = typeof phase === "number" ? phase - 1 : phases.length;
    phases[j] = ph;
    const base = ["project", "temporal_simulations", String(i), "timeline", "steps", String(n - 1), "phases", String(j)];
    locate.set(pathKey(base), { sheet: SHEETS.steps, row: r.row, col: r.cols.get("phase") ?? 0 });
    for (const key of ["advance_hours", "propagate", "events"]) {
      const col = r.cols.get(key);
      if (col !== undefined) locate.set(pathKey([...base, key]), { sheet: SHEETS.steps, row: r.row, col });
    }
  }
  for (const doc of docs) {
    const steps = (doc.timeline as JsonObject).steps as Json[];
    (doc.timeline as JsonObject).steps = steps.filter((s) => s !== undefined).map((s) => ({ ...(s as JsonObject), phases: ((s as JsonObject).phases as Json[]).filter((p) => p !== undefined) }));
  }

  for (const field of ["parameters", "metrics"] as const) {
    attachChildren(ctx, field === "parameters" ? SHEETS.parameters : SHEETS.metrics, owners, (i) => docs[i][field] as Json[], (i) => ["project", "temporal_simulations", String(i), field]);
  }

  // Profile: the operation block, then one column per period label.
  const sheet = byName.get(SHEETS.profile);
  if (sheet) {
    const { other } = readHeader(sheet, [], (text) => !text.startsWith(PERIOD_PREFIX) && isOpColumn(text));
    const periods = other.map(({ col, text }) => ({ col, label: periodLabel(text) }));
    const opSheet: SheetModel = { name: sheet.name, rows: sheet.rows.map((row, k) => (k === 0 ? row.map((c, col) => (periods.some((p) => p.col === col) ? null : c)) : row)) };
    const rowsBySim = new Map<number, ProfileRow[]>();
    for (const r of readTable(opSheet, blobs, problems)) {
      const values: Record<string, Json> = {};
      for (const { col, label } of periods) {
        const read = readValue(sheet.rows[r.row]?.[col], blobs);
        if ("absent" in read) continue;
        if ("error" in read) { problems.push({ severity: "error", at: { sheet: sheet.name, row: r.row, col }, message: read.error }); continue; }
        values[label] = read.value;
      }
      const i = owner(r, SHEETS.profile);
      if (i === null) continue;
      const list = rowsBySim.get(i) ?? [];
      list.push({ ...(r.record as unknown as Omit<ProfileRow, "id" | "values">), id: String(r.row), values: values as ProfileRow["values"] });
      rowsBySim.set(i, list);
      // An operation's cell: the period column of its label (`profile.<label>.<k>.value`), its fields in the row.
      locate.set(pathKey(["project", "temporal_simulations", String(i), "profile"]), { sheet: sheet.name, row: r.row, col: 0 });
    }
    for (const [i, rows] of rowsBySim) {
      const timeline = docs[i].timeline as Parameters<typeof rowsToProfile>[1];
      docs[i].profile = rowsToProfile(rows, timeline) as unknown as JsonObject;
    }
  }
  P.temporal_simulations = docs;
}

/** An index sheet (Series, Sheets) and the sheet each row names: `P[field]`, each record with the rows `read` gives. */
function decodeIndexed(ctx: DecodeContext, P: JsonObject, field: "series" | "sheets", indexSheet: string, read: (sheet: SheetModel, i: number) => Json) {
  if (!ctx.byName.has(indexSheet)) return;
  P[field] = ctx.table(indexSheet).map((r, i) => {
    note(ctx.locate, ["project", field, String(i)], r, indexSheet);
    const title = str(r.record.sheet);
    delete r.record.sheet;
    const sheet = title === undefined ? undefined : ctx.byName.get(title);
    if (!sheet) ctx.problems.push({ severity: "error", at: { sheet: indexSheet, row: r.row, col: r.cols.get("sheet") ?? 0 }, message: `no sheet "${title ?? ""}"` });
    return { ...r.record, rows: sheet ? read(sheet, i) : field === "series" ? {} : [] };
  });
}

/** A Series sheet's rows: element id → period label → value. */
function seriesRows(ctx: DecodeContext, sheet: SheetModel, i: number): JsonObject {
  const rows: JsonObject = {};
  const labels = (sheet.rows[0] ?? []).map((c, col) => (col < 2 || !c || c.v === null ? null : periodLabel(cellText(c))));
  sheet.rows.slice(1).forEach((row, k) => {
    const key = row[0]?.v;
    if (key === null || key === undefined || key === "") return;
    const id = typeof key === "string" ? key : row[0]?.w ?? String(key);
    if (Object.hasOwn(rows, id)) { ctx.problems.push({ severity: "error", at: { sheet: sheet.name, row: k + 1, col: 0 }, message: `the element "${id}" has two rows` }); return; }
    const values: JsonObject = {};
    labels.forEach((label, col) => {
      if (label === null) return;
      const read = readValue(row[col], ctx.blobs);
      if ("absent" in read) return;
      if ("error" in read) { ctx.problems.push({ severity: "error", at: { sheet: sheet.name, row: k + 1, col }, message: read.error }); return; }
      values[label] = read.value;
      ctx.locate.set(pathKey(["project", "series", String(i), "rows", id, label]), { sheet: sheet.name, row: k + 1, col });
    });
    rows[id] = values;
  });
  return rows;
}

// ---------------------------------------------------------------------------
// Validate, repairing what spreadsheets do to values
// ---------------------------------------------------------------------------

/** The cell nearest to a path: its own, or the closest record or sheet above it. */
export function nearest(locate: Locator, path: readonly (string | number)[]): CellRef | undefined {
  for (let k = path.length; k > 0; k--) {
    const ref = locate.get(pathKey(path.slice(0, k)));
    if (ref) return ref;
  }
  return undefined;
}

/** What a cell meant, as the type the schema expects there, with what to tell the person. */
function repair(c: Cell | null, expected: string): { value: Json; note: string; quiet?: boolean } | null {
  if (!c || c.v === null) return null;
  const text = typeof c.v === "string" ? c.v : c.w ?? String(c.v);
  if (expected === "string") {
    if (typeof c.v === "string") return null;
    return { value: text, note: c.date ? `read the date as the text "${text}"` : `read the number as the text "${text}"; if it had leading zeros, type it as text ('007)` };
  }
  if (expected === "number" && typeof c.v === "string") {
    const t = c.v.trim();
    if (/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(t)) return { value: Number(t), note: `read the text "${t}" as a number` };
    const point = withDecimalPoint(t);
    if (point !== t) return { value: Number(point), note: `read "${t}" as a number with a decimal comma` };
    return null;
  }
  if (expected === "boolean") {
    // LibreOffice saves true/false as the numbers 1/0: reading them back is expected, so only a note.
    if (c.v === 1 || c.v === 0) return { value: c.v === 1, note: `read ${c.v} as ${c.v === 1 ? "true" : "false"} (LibreOffice saves true/false as 1/0)`, quiet: true };
    const t = String(c.v).trim().toLowerCase();
    if (t === "true" || t === "1") return { value: true, note: `read "${String(c.v)}" as true` };
    if (t === "false" || t === "0") return { value: false, note: `read "${String(c.v)}" as false` };
  }
  return null;
}

export interface Parsed {
  bundle: ProjectBundle | null;
  problems: Problem[];
}

/** Validate a decoded bundle against the schemas, repairing typed values a spreadsheet changed (each with a warning on its cell). */
export function parseDecoded(decoded: Decoded, model: WorkbookModel): Parsed {
  const problems = [...decoded.problems];
  const raw = decoded.raw;
  const byName = new Map(model.sheets.map((s) => [s.name, s]));
  const cellAt = (ref: CellRef) => byName.get(ref.sheet)?.rows[ref.row]?.[ref.col] ?? null;
  for (let round = 0; round < 6; round++) {
    const project = ProjectSchema.safeParse(raw.project);
    const config = ModelConfigurationSchema.safeParse(raw.config);
    const issues = [
      ...(project.success ? [] : project.error.issues.map((i) => ({ ...i, path: ["project", ...i.path.map(String)] }))),
      ...(config.success ? [] : config.error.issues.map((i) => ({ ...i, path: ["config", ...i.path.map(String)] }))),
    ];
    if (project.success && config.success) {
      return { bundle: problems.some((p) => p.severity === "error") ? null : { project: project.data, config: config.data }, problems };
    }
    let fixed = 0;
    for (const issue of issues) {
      if (issue.code !== "invalid_type") continue;
      const ref = decoded.locate.get(pathKey(issue.path));
      if (!ref) continue;
      const fix = repair(cellAt(ref), String((issue as { expected?: unknown }).expected));
      if (!fix || getIn(raw, issue.path) === fix.value) continue;
      setIn(raw, issue.path, fix.value);
      problems.push({ severity: fix.quiet ? "note" : "warning", at: ref, message: fix.note });
      fixed++;
    }
    if (fixed === 0) {
      for (const issue of issues) {
        const at = nearest(decoded.locate, issue.path);
        problems.push({ severity: "error", ...(at ? { at } : {}), message: `${issue.path.slice(1).join(" › ") || issue.path[0]}: ${issue.message}` });
      }
      return { bundle: null, problems };
    }
  }
  return { bundle: null, problems: [...problems, { severity: "error", message: "the workbook could not be read into a valid project" }] };
}

/** A problem as a person reads it: "Nodes!F7 — message". */
export const describeProblem = (p: Problem) => (p.at ? `${a1(p.at)} — ${p.message}` : p.message);
