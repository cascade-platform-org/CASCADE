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

import { planTimeline } from "@/lib/timeline-plan";
import { profileToRows, rowsToProfile, type ProfileRow } from "@/lib/temporal-simulation-text";
import { ProjectSchema } from "@/lib/schemas/network";
import { ModelConfigurationSchema } from "@/lib/schemas/config";
import type { ProjectBundle } from "@/lib/schemas/bundle";
import { Blobs, readValue, writeJson, writeValue } from "./cells";
import { a1, type Cell, type CellRef, type Problem, type SheetModel, type WorkbookModel, textCell } from "./model";
import { clone, formatKey, getIn, isObject, jsonEqual, own, parseKey, setIn, type Json, type JsonObject } from "./paths";
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

const OP_FIRST = ["element", "where.kind", "where.canvas", "where.node_type", "where.category", "where.label_contains", "where.exclude", "path", "op", "value", "parameter", "series", "of"];

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
const OP_TOPS = new Set(["simulation", "element", "where", "path", "op", "parameter", "series", "of"]);
const PERIOD_PREFIX = "period:";

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
  const header = (l: string) => {
    const top = parseKey(l)?.[0];
    return (top !== undefined && OP_TOPS.has(top)) || l.startsWith(PERIOD_PREFIX) || l.startsWith("~") || l === "" ? `${PERIOD_PREFIX}${l}` : l;
  };
  block.rows[0].push(...labels.map((l) => textCell(header(l))));
  // A profile value may be a number, true/false or text, so true/false is written in its json: form (see isFreeTyped).
  const cellOf = (v: Json) => (typeof v === "boolean" ? writeJson(v, blobs) : writeValue(v, blobs));
  rows.forEach((r, i) => block.rows[i + 1].push(...labels.map((l) => (Object.hasOwn(r.values, l) ? cellOf(r.values[l]) : null))));
  return block;
}

/** The visible sheets and what `_cascade` keeps besides the residual. */
function visibleSheets(bundle: ProjectBundle): { sheets: SheetModel[]; cascade: [string, string][] } {
  const P = clone(bundle.project) as unknown as JsonObject;
  const C = clone(bundle.config) as unknown as JsonObject;
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
  }, events.flatMap((e) => ((e.attribute_operations as JsonObject[]) ?? []).map((op) => ({ event: String(e.id), ...op }))), blobs));
  sheets.push(writeTable(SPEC.graphTypes, (C.graph_types as JsonObject[]) ?? [], blobs));
  sheets.push(writeTable(SPEC.templates, Object.entries((C.node_defaults as Record<string, JsonObject>) ?? {}).map(([name, t]) => ({ name, ...t })), blobs));

  const sims = (P.temporal_simulations as JsonObject[] | undefined) ?? [];
  sheets.push(writeTable(SPEC.simulations, sims.map((s) => ({ ...without(s, ["profile", "metrics", "parameters"]), timeline: without(s.timeline as JsonObject, ["steps"]) })), blobs));
  sheets.push(writeTable(SPEC.steps, sims.flatMap((s) => stepRows(String(s.id), ((s.timeline as JsonObject).steps as Json[]) ?? [])), blobs));
  sheets.push(writeTable(SPEC.parameters, sims.flatMap((s) => ((s.parameters as JsonObject[]) ?? []).map((p) => ({ simulation: String(s.id), ...p }))), blobs));
  sheets.push(profileSheet(sims, blobs));
  sheets.push(writeTable(SPEC.metrics, sims.flatMap((s) => ((s.metrics as JsonObject[]) ?? []).map((m) => ({ simulation: String(s.id), ...m }))), blobs));

  // Series: an index, then one sheet each, elements down and period labels across.
  const taken = new Set(RESERVED);
  const series = (P.series as JsonObject[] | undefined) ?? [];
  const seriesSheets = series.map((x) => {
    const title = freshTitle(`${SERIES_PREFIX}${String(x.name)}`, taken);
    const rows = x.rows as Record<string, Record<string, Json>>;
    const labels = [...new Set(Object.values(rows).flatMap((r) => Object.keys(r)))];
    const sheet: SheetModel = {
      name: title,
      rows: [
        [textCell("element"), textCell("~label"), ...labels.map((l) => textCell(l === "" || l.startsWith("~") || l === "element" || l.startsWith(PERIOD_PREFIX) ? `${PERIOD_PREFIX}${l}` : l))],
        ...Object.entries(rows).map(([key, r]) => [
          textCell(key),
          textCell(key === "*" ? "(every Element without its own row)" : label(key) ?? edgeLabel(key) ?? ""),
          ...labels.map((l) => (Object.hasOwn(r, l) ? writeValue(r[l], blobs) : null)),
        ]),
      ],
    };
    return { index: { ...without(x, ["rows"]), sheet: title }, sheet };
  });
  sheets.push(writeTable(SPEC.seriesIndex, seriesSheets.map((s) => s.index), blobs), ...seriesSheets.map((s) => s.sheet));

  // Custom sheets: an index, then each as it is, values and formulas.
  const custom = (P.sheets as JsonObject[] | undefined) ?? [];
  const customSheets = custom.map((x) => {
    const title = freshTitle(String(x.name), taken);
    // A formula is written without its value, as the file holds it: the app computes it on opening, and the
    // residual keeps the last value only until then.
    const rows = (x.rows as (JsonObject | null)[][]).map((r) => r.map((c): Cell | null => (c === null ? null : c.f !== undefined ? { v: null, f: String(c.f) } : { v: (c.v ?? null) as Cell["v"] })));
    return { index: { ...without(x, ["rows"]), sheet: title }, sheet: { name: title, rows } };
  });
  sheets.push(writeTable(SPEC.sheetsIndex, customSheets.map((s) => s.index), blobs), ...customSheets.map((s) => s.sheet));

  const cascade: [string, string][] = [["format", WORKBOOK_FORMAT]];
  if (P.update_history !== undefined) cascade.push(["project.update_history", JSON.stringify(P.update_history)]);
  if (P.scorecard !== undefined) cascade.push(["project.scorecard", JSON.stringify(P.scorecard)]);
  blobs.texts.forEach((t, i) => cascade.push([`blob/${i}`, t]));
  return { sheets, cascade };
}

/** A project that a Workbook cannot hold without loss; the path names what (a codec defect, to report). */
class WorkbookLossError extends Error {
  constructor(readonly path: string[]) {
    super(`This project cannot be written as a workbook without loss at ${path.join(" › ") || "(root)"}; save it as JSON.`);
  }
}

/** The bundle as a Workbook model; throws WorkbookLossError rather than lose anything. */
export function encodeWorkbook(bundle: ProjectBundle): WorkbookModel {
  const original = clone(bundle) as unknown as JsonObject;
  const { sheets, cascade } = visibleSheets(bundle);
  const draft: WorkbookModel = { sheets: [...sheets, writeCascadeSheet(cascade)] };
  const derived = decodeWorkbook(draft).raw;
  const entries = residual(derived, original);
  const model: WorkbookModel = { sheets: [...sheets, writeCascadeSheet([...cascade, ...(entries.length ? [["residual", JSON.stringify(entries)] as [string, string]] : [])])] };
  const back = decodeWorkbook(model).raw;
  if (!jsonEqual(back, original)) {
    const first = residual(back, original)[0];
    throw new WorkbookLossError(first?.p ?? []);
  }
  return model;
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
  for (const [key, col] of r.cols) {
    const path = parseKey(key);
    if (path) locate.set(pathKey([...base, ...path]), { sheet, row: r.row, col });
  }
}

const str = (v: Json | undefined) => (typeof v === "string" ? v : v === undefined || v === null ? undefined : String(v));

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
  const eventIndex = new Map(events.map((e, i) => [String(e.id), i]));
  for (const r of table(SHEETS.operations)) {
    const id = str(r.record.event);
    const i = id === undefined ? undefined : eventIndex.get(id);
    if (i === undefined) { err(SHEETS.operations, r.row, r.cols.get("event") ?? 0, id === undefined ? "a row without an event id" : `no Event "${id}" in Events`); continue; }
    const ops = (events[i].attribute_operations ??= []) as Json[];
    note(locate, ["config", "events", String(i), "attribute_operations", String(ops.length)], r, SHEETS.operations);
    delete r.record.event;
    ops.push(r.record);
  }
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

  decodeSimulations(byName, blobs, table, locate, problems, P);
  decodeSeries(byName, blobs, table, locate, problems, P);
  decodeCustomSheets(byName, table, locate, problems, P);

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

type TableReader = (name: string) => ReadRecord[];

function decodeSimulations(byName: Map<string, SheetModel>, blobs: readonly string[], table: TableReader, locate: Locator, problems: Problem[], P: JsonObject) {
  const sims = table(SHEETS.simulations).map((r) => r);
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
  const owner = (r: ReadRecord, sheet: string): number | null => {
    const id = str(r.record.simulation);
    const i = id === undefined ? undefined : index.get(id);
    if (i === undefined) { problems.push({ severity: "error", at: { sheet, row: r.row, col: r.cols.get("simulation") ?? 0 }, message: id === undefined ? "a row without a simulation id" : `no Temporal Simulation "${id}" in Simulations` }); return null; }
    delete r.record.simulation;
    return i;
  };

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

  for (const r of table(SHEETS.parameters)) {
    const i = owner(r, SHEETS.parameters);
    if (i === null) continue;
    const params = docs[i].parameters as Json[];
    note(locate, ["project", "temporal_simulations", String(i), "parameters", String(params.length)], r, SHEETS.parameters);
    params.push(r.record);
  }
  for (const r of table(SHEETS.metrics)) {
    const i = owner(r, SHEETS.metrics);
    if (i === null) continue;
    const metrics = docs[i].metrics as Json[];
    note(locate, ["project", "temporal_simulations", String(i), "metrics", String(metrics.length)], r, SHEETS.metrics);
    metrics.push(r.record);
  }

  // Profile: the operation block, then one column per period label.
  const sheet = byName.get(SHEETS.profile);
  if (sheet) {
    const isOpColumn = (text: string) => {
      if (text.startsWith(PERIOD_PREFIX)) return false;
      const top = parseKey(text.endsWith("[]") ? text.slice(0, -2) : text)?.[0];
      return top !== undefined && OP_TOPS.has(top);
    };
    const { other } = readHeader(sheet, [], isOpColumn);
    const periods = other.map(({ col, text }) => ({ col, label: text.startsWith(PERIOD_PREFIX) ? text.slice(PERIOD_PREFIX.length) : text }));
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

function decodeSeries(byName: Map<string, SheetModel>, blobs: readonly string[], table: TableReader, locate: Locator, problems: Problem[], P: JsonObject) {
  if (!byName.has(SHEETS.series)) return;
  P.series = table(SHEETS.series).map((r, i) => {
    note(locate, ["project", "series", String(i)], r, SHEETS.series);
    const title = str(r.record.sheet);
    delete r.record.sheet;
    const rows: JsonObject = {};
    const sheet = title === undefined ? undefined : byName.get(title);
    if (!sheet) { problems.push({ severity: "error", at: { sheet: SHEETS.series, row: r.row, col: r.cols.get("sheet") ?? 0 }, message: `no sheet "${title ?? ""}" for this Series` }); }
    else {
      const header = sheet.rows[0] ?? [];
      const labels = header.map((c, col) => {
        if (col < 2 || !c || c.v === null) return null;
        const text = typeof c.v === "string" ? c.v : c.date && c.w ? c.w : String(c.v);
        return text.startsWith(PERIOD_PREFIX) ? text.slice(PERIOD_PREFIX.length) : text;
      });
      sheet.rows.slice(1).forEach((row, k) => {
        const key = row[0]?.v;
        if (key === null || key === undefined || key === "") return;
        const id = typeof key === "string" ? key : row[0]?.w ?? String(key);
        if (Object.hasOwn(rows, id)) { problems.push({ severity: "error", at: { sheet: sheet.name, row: k + 1, col: 0 }, message: `the element "${id}" has two rows` }); return; }
        const values: JsonObject = {};
        labels.forEach((label, col) => {
          if (label === null) return;
          const read = readValue(row[col], blobs);
          if ("absent" in read) return;
          if ("error" in read) { problems.push({ severity: "error", at: { sheet: sheet.name, row: k + 1, col }, message: read.error }); return; }
          values[label] = read.value;
          locate.set(pathKey(["project", "series", String(i), "rows", id, label]), { sheet: sheet.name, row: k + 1, col });
        });
        rows[id] = values;
      });
    }
    return { ...r.record, rows };
  });
}

function decodeCustomSheets(byName: Map<string, SheetModel>, table: TableReader, locate: Locator, problems: Problem[], P: JsonObject) {
  if (!byName.has(SHEETS.sheets)) return;
  P.sheets = table(SHEETS.sheets).map((r, i) => {
    note(locate, ["project", "sheets", String(i)], r, SHEETS.sheets);
    const title = str(r.record.sheet);
    delete r.record.sheet;
    const sheet = title === undefined ? undefined : byName.get(title);
    if (!sheet) problems.push({ severity: "error", at: { sheet: SHEETS.sheets, row: r.row, col: r.cols.get("sheet") ?? 0 }, message: `no sheet "${title ?? ""}"` });
    const rows = (sheet?.rows ?? []).map((row) => row.map((c) => (c === null || (c.v === null && c.f === undefined) ? null : { v: c.error ? null : c.v, ...(c.f !== undefined ? { f: c.f } : {}) })));
    return { ...r.record, rows: rows as unknown as Json };
  });
}

// ---------------------------------------------------------------------------
// Validate, repairing what spreadsheets do to values
// ---------------------------------------------------------------------------

const cellAt = (model: WorkbookModel, ref: CellRef) => model.sheets.find((s) => s.name === ref.sheet)?.rows[ref.row]?.[ref.col] ?? null;

/** The cell nearest to a path: its own, or the closest record or sheet above it. */
function nearest(locate: Locator, path: readonly (string | number)[]): CellRef | undefined {
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
    if (/^[+-]?\d+,\d+$/.test(t)) return { value: Number(t.replace(",", ".")), note: `read "${t}" as a number with a decimal comma` };
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
  for (let round = 0; round < 6; round++) {
    const project = ProjectSchema.safeParse(raw.project);
    const config = ModelConfigurationSchema.safeParse(raw.config);
    const issues = [
      ...(project.success ? [] : project.error.issues.map((i) => ({ ...i, path: ["project", ...i.path.map(String)] }))),
      ...(config.success ? [] : config.error.issues.map((i) => ({ ...i, path: ["config", ...i.path.map(String)] }))),
    ];
    if (issues.length === 0 && project.success && config.success) {
      return { bundle: problems.some((p) => p.severity === "error") ? null : { project: project.data, config: config.data }, problems };
    }
    let fixed = 0;
    for (const issue of issues) {
      if (issue.code !== "invalid_type") continue;
      const ref = decoded.locate.get(pathKey(issue.path));
      if (!ref) continue;
      const fix = repair(cellAt(model, ref), String((issue as { expected?: unknown }).expected));
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
