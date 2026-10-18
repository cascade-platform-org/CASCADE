/**
 * import-changes.ts — an edited Workbook brought into the open project as a
 * change set (ADR-0023 §3). Pure: no store, no file library.
 *
 * Reading (`readImport`, once per file):
 *   1. custom sheets that name a model sheet in `writes` put their values into
 *      it (§4a): a row or column they lack changes nothing, and two sheets
 *      giving one field different values are refused at both cells;
 *   2. a model sheet the file lacks is taken from the open project, so a
 *      missing sheet changes nothing; the project's own residual is read first,
 *      so a cell the person did not touch gives back exactly what the project
 *      holds now, even when the file was written from an older version;
 *   3. a new row gets what it needs to be a record: an id, Functionality N, a
 *      Canvas when the project has one, a place on its grid;
 *   4. the sheets are read and validated as Open does (every problem names its
 *      cell).
 * Composing (`composeImport`, on every leave-out): the difference with the open
 * project is one subject per record or setting (`node:p1`, `scale:level`); the
 * result takes each subject from the file or, left out, from the project, and
 * goes through the same check as an LLM Design edit (`checkBundle`). A missing
 * row is a deletion. What the import adds is marked `origin: "spreadsheet"`
 * with its file, sheet and row, unconfirmed.
 */

import { deepEqual } from "@/lib/graph-diff";
import { checkBundle, previewChange, type CheckedChange, type CheckIssue } from "@/lib/model-text";
import { gridPlacer, groupPreview, type ChangeGroup, type PreviewGroup } from "@/lib/model-text-v2";
import { markAdded } from "@/lib/provenance";
import type { ProjectBundle } from "@/lib/schemas/bundle";
import { ProjectSchema } from "@/lib/schemas/network";
import { ModelConfigurationSchema } from "@/lib/schemas/config";
import type { Provenance } from "@/lib/schemas/provenance";
import { shiftBlob } from "./cells";
import { SHEETS, decodeWorkbook, encodeWorkbook, nearest, parseDecoded, type Decoded } from "./codec";
import { cellText, textCell, type Cell, type CellRef, type Problem, type SheetModel, type WorkbookModel } from "./model";
import { hashOf, isObject, type Json, type JsonObject } from "./paths";
import { CASCADE_SHEET, readCascadeSheet, writeCascadeSheet, type ResidualEntry } from "./residual";
import { readTable } from "./table";

// ---------------------------------------------------------------------------
// 1. Custom sheets' writes
// ---------------------------------------------------------------------------

/** The columns that find a row of each model sheet a custom sheet may write; a Series sheet's is `element`. */
const KEY_COLUMNS: Record<string, string[]> = {
  [SHEETS.project]: ["key"],
  [SHEETS.canvases]: ["id"],
  [SHEETS.nodes]: ["id"],
  [SHEETS.edges]: ["id"],
  [SHEETS.categories]: ["name"],
  [SHEETS.scale]: ["level"],
  [SHEETS.levels]: ["label"],
  [SHEETS.events]: ["id"],
  [SHEETS.graphTypes]: ["name"],
  [SHEETS.templates]: ["name"],
  [SHEETS.simulations]: ["id"],
  [SHEETS.parameters]: ["simulation", "name"],
  [SHEETS.metrics]: ["simulation", "name"],
};

const filled = (c: Cell | null | undefined): c is Cell => !!c && (c.v !== null || c.f !== undefined);

/** The custom sheets listed with a `writes`: their sheet title and the model sheet they write. */
function writers(model: WorkbookModel): { name: string; sheet: string; writes: string; at: CellRef }[] {
  const index = model.sheets.find((s) => s.name === SHEETS.sheets);
  if (!index) return [];
  return readTable(index, [], []).flatMap((r) => {
    const { name, sheet, writes } = r.record;
    return typeof sheet === "string" && typeof writes === "string" && writes !== ""
      ? [{ name: String(name), sheet, writes, at: { sheet: SHEETS.sheets, row: r.row, col: r.cols.get("writes") ?? 0 } }]
      : [];
  });
}

/** The model with every custom sheet's values written into the sheet it names; the sheets it changed are copies. */
function applyWrites(model: WorkbookModel, problems: Problem[]): WorkbookModel {
  const list = writers(model);
  if (list.length === 0) return model;
  const sheets = model.sheets.map((s) => ({ ...s, rows: s.rows }));
  const byName = new Map(sheets.map((s) => [s.name, s]));
  const err = (at: CellRef, message: string) => problems.push({ severity: "error", at, message });
  // "Sheet|row|col" of a target cell → what wrote it, for conflicts.
  const written = new Map<string, { v: Cell["v"]; at: CellRef }>();

  for (const w of list) {
    const source = byName.get(w.sheet);
    const target = byName.get(w.writes);
    const keys = KEY_COLUMNS[w.writes] ?? (w.writes.startsWith("S·") ? ["element"] : null);
    if (!source) { err(w.at, `no sheet "${w.sheet}"`); continue; }
    if (!target || !keys) { err(w.at, `"${w.writes}" is not a sheet a custom sheet can write (one with a key column: Nodes, Events, Parameters, S·<name>…)`); continue; }
    const header = (s: SheetModel) => (s.rows[0] ?? []).map((c) => cellText(c));
    const from = header(source);
    const keyCols = keys.map((k) => from.indexOf(k));
    if (keyCols.some((k) => k < 0)) { err({ sheet: source.name, row: 0, col: 0 }, `writes ${w.writes}: the first row needs the column${keys.length > 1 ? "s" : ""} ${keys.join(", ")}`); continue; }
    // The target's rows by their key, once; its rows are copied before the first write.
    if (target.rows === model.sheets.find((s) => s.name === target.name)?.rows) target.rows = target.rows.map((r) => [...r]);
    const to = header(target);
    const targetKeys = keys.map((k) => to.indexOf(k));
    const rowOf = new Map<string, number>();
    target.rows.forEach((r, i) => { if (i > 0 && targetKeys.every((k) => k >= 0)) rowOf.set(JSON.stringify(targetKeys.map((k) => cellText(r[k]))), i); });

    source.rows.forEach((r, i) => {
      if (i === 0 || !keyCols.every((k) => filled(r[k]))) return;
      const key = keyCols.map((k) => cellText(r[k]));
      const row = rowOf.get(JSON.stringify(key));
      if (row === undefined) {
        problems.push({ severity: "warning", at: { sheet: source.name, row: i, col: keyCols[0] }, message: `no ${key.join(" / ")} in ${w.writes}: this row changes nothing` });
        return;
      }
      from.forEach((field, col) => {
        if (field === "" || field.startsWith("~") || keys.includes(field)) return;
        const c = r[col];
        if (!filled(c)) return;
        const at: CellRef = { sheet: source.name, row: i, col };
        if (c.error) return err(at, `the cell holds an error (${c.w ?? "#ERROR"})`);
        if (c.v === null) return err(at, "a formula without a stored value: open and save the file in a spreadsheet app");
        let tc = to.indexOf(field);
        if (tc < 0) { tc = to.push(field) - 1; target.rows[0] = [...(target.rows[0] ?? []), textCell(field)]; }
        const slot = `${target.name}|${row}|${tc}`;
        const was = written.get(slot);
        if (was && !deepEqual(was.v, c.v)) {
          err(at, `${w.writes} ${key.join(" / ")} › ${field}: another sheet writes ${JSON.stringify(was.v)} here`);
          err(was.at, `${w.writes} ${key.join(" / ")} › ${field}: another sheet writes ${JSON.stringify(c.v)} here`);
          return;
        }
        written.set(slot, { v: c.v, at });
        const line = target.rows[row];
        while (line.length <= tc) line.push(null);
        line[tc] = { v: c.v, ...(c.date ? { date: true, w: c.w } : {}) };
      });
    });
  }
  return { sheets };
}

// ---------------------------------------------------------------------------
// 2. Missing sheets from the open project
// ---------------------------------------------------------------------------

/** The sheets an index sheet (Series, Sheets) names in its `sheet` column. */
const indexed = (index: SheetModel | undefined): string[] =>
  index ? readTable(index, [], []).flatMap((r) => (typeof r.record.sheet === "string" ? [r.record.sheet] : [])) : [];

/**
 * The model with each model sheet it lacks taken from `base` (the open project
 * as a Workbook), their long texts renumbered after the file's, and `base`'s
 * residual read before the file's.
 */
function completeFrom(model: WorkbookModel, base: WorkbookModel): WorkbookModel {
  const have = new Set(model.sheets.map((s) => s.name));
  const baseBy = new Map(base.sheets.map((s) => [s.name, s]));
  const wanted: string[] = Object.values(SHEETS).filter((n) => n !== SHEETS.readme && !have.has(n) && baseBy.has(n));
  // An index sheet taken from the project brings the sheets it names.
  for (const index of [SHEETS.series, SHEETS.sheets]) {
    if (wanted.includes(index)) wanted.push(...indexed(baseBy.get(index)).filter((n) => !have.has(n)));
  }
  const cascade = readCascadeSheet(model.sheets.find((s) => s.name === CASCADE_SHEET));
  const baseCascade = readCascadeSheet(baseBy.get(CASCADE_SHEET));
  const offset = Math.max(-1, ...[...cascade.keys()].filter((k) => k.startsWith("blob/")).map((k) => Number(k.slice(5)))) + 1;

  const sheets = model.sheets.filter((s) => s.name !== CASCADE_SHEET);
  for (const name of wanted) {
    const s = baseBy.get(name)!;
    sheets.push({ ...s, rows: s.rows.map((r) => r.map((c) => shiftBlob(c, offset))) });
  }
  const entries: [string, string][] = [...cascade].filter(([k]) => k !== "residual");
  for (const [k, t] of baseCascade) if (k.startsWith("blob/")) entries.push([`blob/${Number(k.slice(5)) + offset}`, t]);
  // The project's residual first: where the sheets give what the project's would, it restores the project's
  // value exactly, and the file's entries there, written from an older version, no longer match.
  const parse = (t: string | undefined): ResidualEntry[] => { try { return t ? (JSON.parse(t) as ResidualEntry[]) : []; } catch { return []; } };
  const residual = [...parse(baseCascade.get("residual")), ...parse(cascade.get("residual"))];
  if (residual.length > 0) entries.push(["residual", JSON.stringify(residual)]);
  return { sheets: [...sheets, writeCascadeSheet(entries)] };
}

// ---------------------------------------------------------------------------
// 3. New rows
// ---------------------------------------------------------------------------

const slug = (t: string) => t.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "x";

/** Nodes and Edges rows with values but no id get one; each is a note at its row. */
function giveIds(model: WorkbookModel, taken: ReadonlySet<string>, suffix: IdSuffix, notes: Problem[]): WorkbookModel {
  const used = new Set(taken);
  const sheets = model.sheets.map((sheet) => {
    if (sheet.name !== SHEETS.nodes && sheet.name !== SHEETS.edges) return sheet;
    const header = (sheet.rows[0] ?? []).map((c) => cellText(c));
    const col = (k: string) => header.indexOf(k);
    let idCol = col("id");
    const rows = sheet.rows.map((r) => [...r]);
    if (idCol < 0) { idCol = header.length; rows[0] = [...(rows[0] ?? []), textCell("id")]; }
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (filled(r[idCol]) || !r.some((c, k) => k !== idCol && filled(c) && !header[k]?.startsWith("~"))) continue;
      const base = sheet.name === SHEETS.nodes
        ? `n-${slug(cellText(r[col("label")]) || "node")}`
        : `e-${slug(cellText(r[col("source")]))}-${slug(cellText(r[col("target")]))}`;
      let id = `${base}-${suffix(`${sheet.name}|${i}|${base}`)}`;
      for (let k = 1; used.has(id); k++) id = `${base}-${suffix(`${sheet.name}|${i}|${base}|${k}`)}`;
      used.add(id);
      while (r.length <= idCol) r.push(null);
      r[idCol] = textCell(id);
      notes.push({ severity: "note", at: { sheet: sheet.name, row: i, col: idCol }, message: `a new ${sheet.name === SHEETS.nodes ? "node" : "edge"}: given the id ${id}` });
    }
    return { ...sheet, rows };
  });
  return { sheets };
}

/** New nodes and edges (ids `before` lacks) given Functionality N, a Canvas and a position where they have none. */
function fillNew(raw: JsonObject, before: ProjectBundle, locate: Decoded["locate"], notes: Problem[]) {
  const P = raw.project as JsonObject;
  const C = raw.config as JsonObject;
  const scale = Array.isArray(C.functionality_scale) && C.functionality_scale.length > 0 ? C.functionality_scale.length : before.config.functionality_scale.length;
  const canvases = (Array.isArray(P.canvases) ? P.canvases : []).filter(isObject).map((c) => c.graph).filter(isObject);
  const holds = (kind: "node_ids" | "edge_ids", id: string) => canvases.filter((g) => Array.isArray(g[kind]) && (g[kind] as Json[]).includes(id));
  const nodes = isObject(P.nodes) ? P.nodes : {};
  const edges = isObject(P.edges) ? P.edges : {};
  const placers = new Map<JsonObject, () => { x: number; y: number }>();
  const at = (kind: string, id: string) => nearest(locate, ["project", kind, id]);
  const note = (kind: string, id: string, what: string) => notes.push({ severity: "note", ...(at(kind, id) ? { at: at(kind, id) } : {}), message: `${id}: ${what}` });

  for (const [id, n] of Object.entries(nodes)) {
    if (!isObject(n) || Object.hasOwn(before.project.nodes, id)) continue;
    if (n.functionality === undefined) { n.functionality = scale; note("nodes", id, `Functionality ${scale}, fully operational`); }
    let on = holds("node_ids", id);
    if (on.length === 0 && canvases.length === 1) {
      (canvases[0].node_ids as Json[]).push(id);
      on = canvases;
      note("nodes", id, "placed on the only Canvas");
    }
    if (n.position === undefined && on.length > 0) {
      const g = on[0];
      let place = placers.get(g);
      if (!place) {
        place = gridPlacer((g.node_ids as Json[]).flatMap((m) => {
          const p = isObject(nodes[String(m)]) ? (nodes[String(m)] as JsonObject).position : undefined;
          return isObject(p) && typeof p.x === "number" && typeof p.y === "number" ? [{ x: p.x, y: p.y }] : [];
        }));
        placers.set(g, place);
      }
      n.position = place();
    }
  }
  for (const [id, e] of Object.entries(edges)) {
    if (!isObject(e) || Object.hasOwn(before.project.edges, id)) continue;
    if (e.functionality === undefined) { e.functionality = scale; note("edges", id, `Functionality ${scale}, fully operational`); }
    if (holds("edge_ids", id).length > 0) continue;
    // On the Canvases holding both its ends, or else its source's (as LLM Design places an edge).
    const both = canvases.filter((g) => holds("node_ids", String(e.source)).includes(g) && holds("node_ids", String(e.target)).includes(g));
    for (const g of both.length > 0 ? both : holds("node_ids", String(e.source))) (g.edge_ids as Json[]).push(id);
  }
}

// ---------------------------------------------------------------------------
// Numbers a spreadsheet rounded
// ---------------------------------------------------------------------------

/**
 * Equal to the 15 significant digits a spreadsheet keeps (LibreOffice rounds a re-saved .xlsx there, either
 * way at a 5): a relative difference below 1e-14, far below any edit a person makes.
 */
const sameNumber = (a: number, b: number) => a === b || Math.abs(a - b) <= 1e-14 * Math.max(Math.abs(a), Math.abs(b));

/** A list item's identity: its `id`, or else its `name`. */
const identity = (x: unknown): string | undefined =>
  isObject(x) ? (typeof x.id === "string" ? x.id : typeof x.name === "string" ? x.name : undefined) : undefined;

/**
 * `now` with every number that equals, to 15 significant digits, the number at
 * the same place in `was` replaced by that one: a spreadsheet's rounding is no
 * change. List items are matched by id (or name) when they have one.
 */
function keepUnrounded(was: unknown, now: unknown): unknown {
  if (typeof was === "number" && typeof now === "number") return sameNumber(was, now) ? was : now;
  if (Array.isArray(was) && Array.isArray(now)) {
    const byId = new Map(was.flatMap((x) => (identity(x) !== undefined ? [[identity(x)!, x] as const] : [])));
    return now.map((x, i) => keepUnrounded(identity(x) !== undefined ? byId.get(identity(x)!) : was[i], x));
  }
  if (isObject(was) && isObject(now)) {
    return Object.fromEntries(Object.entries(now).map(([k, v]) => [k, Object.hasOwn(was, k) ? keepUnrounded(was[k], v) : v]));
  }
  return now;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export type ReadImport =
  | {
    ok: true;
    file: string;
    /** The open project as the schemas give it (with their defaults, as the file's values have them): what the import is compared with. */
    base: ProjectBundle;
    imported: ProjectBundle;
    decoded: Decoded;
    problems: Problem[];
  }
  | { ok: false; file: string; problems: Problem[] };

/** A bundle as the schemas give it, so a default the file's values carry is no difference. */
function normalized(b: ProjectBundle): ProjectBundle {
  const project = ProjectSchema.safeParse(b.project);
  const config = ModelConfigurationSchema.safeParse(b.config);
  return { project: project.success ? project.data : b.project, config: config.success ? config.data : b.config };
}

/** A new id's ending, from what identifies its row: the same file read again gives the same ids (Apply reads it again). */
type IdSuffix = (seed: string) => string;
const rowSuffix: IdSuffix = (seed) => hashOf(seed).slice(-4).padStart(4, "0");

/** A Workbook `model` read as the project it would make of `before`, or every reason it cannot (each at its cell). */
export function readImport(open: ProjectBundle, model: WorkbookModel, file: string, suffix: IdSuffix = rowSuffix): ReadImport {
  const before = normalized(open);
  const problems: Problem[] = [];
  const written = applyWrites(model, problems);
  const complete = completeFrom(written, encodeWorkbook(before));
  const withIds = giveIds(complete, new Set([...Object.keys(before.project.nodes), ...Object.keys(before.project.edges)]), suffix, problems);
  const decoded = decodeWorkbook(withIds);
  fillNew(decoded.raw, before, decoded.locate, problems);
  const parsed = parseDecoded(decoded, withIds);
  problems.push(...parsed.problems);
  if (!parsed.bundle || problems.some((p) => p.severity === "error")) return { ok: false, file, problems };
  // The history and the Scorecard are the app's records: an import never changes them.
  const { update_history: _h, scorecard: _s, ...rest } = parsed.bundle.project;
  const unrounded = keepUnrounded({ project: { ...before.project, update_history: [], scorecard: [] }, config: before.config }, { project: rest, config: parsed.bundle.config }) as ProjectBundle;
  // So are the project's timestamps: the file's say when it was written.
  const meta = { ...unrounded.project.meta, created_at: before.project.meta.created_at, updated_at: before.project.meta.updated_at };
  for (const k of ["created_at", "updated_at"] as const) if (meta[k] === undefined) delete meta[k];
  const imported: ProjectBundle = { ...unrounded, project: { ...unrounded.project, meta, update_history: before.project.update_history, scorecard: before.project.scorecard } };
  return { ok: true, file, base: before, imported, decoded, problems };
}

// ---------------------------------------------------------------------------
// Subjects and compose
// ---------------------------------------------------------------------------

/** Ids in `after`'s order, those only `before` keeps inserted after their neighbour there; `present` says which stay. */
function mergeIds(before: readonly string[], after: readonly string[], present: (id: string) => boolean): string[] {
  const out = after.filter(present);
  const placed = new Set(out);
  let previous: string | null = null;
  for (const id of before) {
    if (!placed.has(id) && present(id)) {
      out.splice(previous === null ? 0 : out.indexOf(previous) + 1, 0, id);
      placed.add(id);
    }
    if (placed.has(id)) previous = id;
  }
  return out;
}

const PROJECT_PARTS = new Set(["nodes", "edges", "canvases", "update_history", "scorecard", "temporal_simulations", "series", "sheets"]);
const CONFIG_PARTS = new Set(["events", "categories", "graph_types", "node_defaults", "functionality_scale", "level_scale"]);

/** `before` with each subject not in `out` taken from `after`: records, their Canvas membership, settings. */
function compose(before: ProjectBundle, after: ProjectBundle, out: ReadonlySet<string>): ProjectBundle {
  const take = (subject: string) => !out.has(subject);
  const registry = <T>(kind: string, b: Record<string, T>, a: Record<string, T>): Record<string, T> => {
    const side = (id: string) => (take(`${kind}:${id}`) ? a : b);
    const ids = mergeIds(Object.keys(b), Object.keys(a), (id) => Object.hasOwn(side(id), id));
    return Object.fromEntries(ids.map((id) => [id, side(id)[id]]));
  };
  const list = <T>(kind: string, b: readonly T[] | undefined, a: readonly T[] | undefined, idOf: (x: T) => string): T[] | undefined => {
    if (b === undefined && a === undefined) return undefined;
    const reg = (xs: readonly T[] | undefined) => Object.fromEntries((xs ?? []).map((x) => [idOf(x), x]));
    return Object.values(registry(kind, reg(b), reg(a)));
  };
  const pick = <T>(subject: string, b: T, a: T): T => (take(subject) ? a : b);

  const nodes = registry("node", before.project.nodes, after.project.nodes);
  const edges = registry("edge", before.project.edges, after.project.edges);
  const was = new Map(before.project.canvases.map((c) => [c.id, c]));
  const now = new Map(after.project.canvases.map((c) => [c.id, c]));
  // A Canvas's members follow their Elements' subjects: an Element left out keeps the Canvases it had.
  const members = (kind: "node" | "edge", b: readonly string[], a: readonly string[], reg: Record<string, unknown>) =>
    mergeIds(b, a, (id) => Object.hasOwn(reg, id) && (take(`${kind}:${id}`) ? a.includes(id) : b.includes(id)));
  let canvases = (list("canvas", before.project.canvases, after.project.canvases, (c) => c.id) ?? []).map((c) => {
    const [b, a] = [was.get(c.id)?.graph, now.get(c.id)?.graph];
    return { ...c, graph: { ...c.graph, node_ids: members("node", b?.node_ids ?? [], a?.node_ids ?? [], nodes), edge_ids: members("edge", b?.edge_ids ?? [], a?.edge_ids ?? [], edges) } };
  });
  if (!take("order:canvases")) {
    const rank = (id: string) => { const k = before.project.canvases.findIndex((c) => c.id === id); return k < 0 ? Infinity : k; };
    canvases = [...canvases].sort((x, y) => rank(x.id) - rank(y.id));
  }

  const settings = <T extends object>(subject: string, b: T, a: T, parts: ReadonlySet<string>): Partial<T> =>
    Object.fromEntries(Object.entries(take(subject) ? a : b).filter(([k]) => !parts.has(k))) as Partial<T>;
  const optional = <T>(key: string, v: T | undefined) => (v === undefined ? {} : { [key]: v });

  const project = {
    ...settings("settings:project", before.project, after.project, PROJECT_PARTS),
    nodes,
    edges,
    canvases,
    update_history: before.project.update_history,
    scorecard: before.project.scorecard,
    ...optional("temporal_simulations", list("simulation", before.project.temporal_simulations, after.project.temporal_simulations, (s) => s.id)),
    ...optional("series", list("series", before.project.series, after.project.series, (s) => s.name)),
    ...optional("sheets", list("sheet", before.project.sheets, after.project.sheets, (s) => s.name)),
  } as ProjectBundle["project"];
  const config = {
    ...settings("settings:config", before.config, after.config, CONFIG_PARTS),
    events: list("event", before.config.events, after.config.events, (e) => e.id) ?? [],
    categories: list("category", before.config.categories, after.config.categories, (c) => c.name) ?? [],
    graph_types: list("graph_type", before.config.graph_types, after.config.graph_types, (g) => g.name) ?? [],
    node_defaults: registry("template", before.config.node_defaults ?? {}, after.config.node_defaults ?? {}),
    functionality_scale: pick("scale:functionality", before.config.functionality_scale, after.config.functionality_scale),
    ...optional("level_scale", pick("scale:level", before.config.level_scale, after.config.level_scale)),
  } as ProjectBundle["config"];
  return { project, config };
}

/** A subject in words, for its group's title: "Add Node "Pump 1" (p1)". */
function subjectTitle(key: string, before: ProjectBundle, after: ProjectBundle): string {
  const [kind] = key.split(":", 1);
  const id = key.slice(kind.length + 1);
  const fixed: Record<string, string> = {
    "scale:functionality": "Functionality scale", "scale:level": "Level scale", "settings:project": "Project settings",
    "settings:config": "Configuration settings", "order:canvases": "Canvas order",
  };
  if (fixed[key]) return `Change ${fixed[key]}`;
  const find = (b: ProjectBundle): unknown => {
    switch (kind) {
      case "node": return b.project.nodes[id];
      case "edge": return b.project.edges[id];
      case "canvas": return b.project.canvases.find((c) => c.id === id);
      case "event": return b.config.events.find((e) => e.id === id);
      case "category": return b.config.categories.find((c) => c.name === id);
      case "graph_type": return b.config.graph_types.find((g) => g.name === id);
      case "template": return b.config.node_defaults?.[id];
      case "simulation": return b.project.temporal_simulations?.find((s) => s.id === id);
      case "series": return b.project.series?.find((s) => s.name === id);
      case "sheet": return b.project.sheets?.find((s) => s.name === id);
      default: return undefined;
    }
  };
  const [was, now] = [find(before), find(after)];
  const verb = was === undefined ? "Add" : now === undefined ? "Delete" : "Change";
  const rec = (now ?? was) as Record<string, unknown> | undefined;
  const label = (nodeId: unknown) => { const n = after.project.nodes[String(nodeId)] ?? before.project.nodes[String(nodeId)]; return n?.label ?? String(nodeId); };
  const name: Record<string, () => string> = {
    node: () => `Node ${rec?.label ? `"${String(rec.label)}" (${id})` : id}`,
    edge: () => `Edge ${label(rec?.source)} → ${label(rec?.target)} (${id})`,
    canvas: () => `Canvas "${String(rec?.label ?? id)}"`,
    event: () => `Event "${String(rec?.label ?? id)}"`,
    category: () => `Category ${id}`,
    graph_type: () => `Graph type ${id}`,
    template: () => `Node template ${id}`,
    simulation: () => `Temporal Simulation "${String((rec?.timeline as { name?: string } | undefined)?.name || id)}"`,
    series: () => `Series ${id}`,
    sheet: () => `Sheet ${id}`,
  };
  return `${verb} ${name[kind]?.() ?? key}`;
}

/** Lines about which Elements a Canvas holds: they follow the Elements' own subjects. */
const isMembership = (where: string) => /› (graph › )?(node_ids|edge_ids)\b/.test(where);

export interface ComposedImport {
  /** The composed result, checked; its `after` carries the import's provenance marks. */
  checked: CheckedChange;
  /** Every change the file makes, under its subject; `index` is what `leaveOut` holds. */
  groups: PreviewGroup[];
  /** The check's problems, each at its cell when known. */
  problems: Problem[];
  /** Set when the result deletes more than half of the project's Elements: Apply asks for an extra tick. */
  massDeletion?: { removed: number; total: number };
}

/** The import with the subjects whose groups' indices are in `leaveOut` taken from the open project, checked. */
export function composeImport(read: Extract<ReadImport, { ok: true }>, leaveOut: ReadonlySet<number> = new Set()): ComposedImport {
  const { base: before, imported, decoded, file } = read;
  const full = previewChange(before, imported);
  const subjects: string[] = [];
  for (const l of full.lines) if (l.subject !== undefined && !subjects.includes(l.subject)) subjects.push(l.subject);
  const out = new Set(subjects.filter((_, i) => leaveOut.has(i)));
  const groups: ChangeGroup[] = subjects.map((s, i) => {
    // A Canvas whose only change is its members has nothing of its own to leave out.
    const own = !s.startsWith("canvas:") || full.lines.some((l) => l.subject === s && !isMembership(l.where));
    return { title: subjectTitle(s, before, imported) + (own ? "" : " (its members follow their Elements)"), subjects: [s], skipped: [], ...(own ? { index: i } : {}), ...(out.has(s) ? { left_out: true } : {}) };
  });

  const composed = compose(before, imported, out);
  const checked = checkBundle(before, composed);
  const problems: Problem[] = [];
  if (!checked.ok) {
    for (const issue of checked.issues ?? checked.errors.map((message): CheckIssue => ({ message }))) {
      const at = issue.path ? nearest(decoded.locate, issue.path) : undefined;
      problems.push({ severity: "error", ...(at ? { at } : {}), message: issue.message });
    }
    return { checked, groups: groupPreview(full, groups), problems };
  }
  // What the import adds: marked with its file, sheet and row, unconfirmed.
  const eventIndex = new Map(imported.config.events.map((e, i) => [e.id, i]));
  const mark = (key: string): Provenance => {
    const [kind] = key.split(":", 1);
    const id = key.slice(kind.length + 1);
    const path = kind === "event" ? ["config", "events", String(eventIndex.get(id))] : ["project", `${kind}s`, id];
    const at = nearest(decoded.locate, path);
    return { origin: "spreadsheet", confirmed: false, ...(at ? { source: { file, sheet: at.sheet, row: at.row + 1 } } : {}) };
  };
  const after = markAdded(before, checked.after, mark);
  const total = Object.keys(before.project.nodes).length + Object.keys(before.project.edges).length;
  const removed = [...Object.keys(before.project.nodes).filter((id) => !Object.hasOwn(after.project.nodes, id)), ...Object.keys(before.project.edges).filter((id) => !Object.hasOwn(after.project.edges, id))].length;
  return {
    checked: { ...checked, after },
    groups: groupPreview(full, groups),
    problems,
    ...(removed >= 2 && removed > total / 2 ? { massDeletion: { removed, total } } : {}),
  };
}
