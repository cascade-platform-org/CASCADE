/**
 * table.ts — records as a sheet and back (ADR-0023 §2): one row per record,
 * one column per field path (`supply_capacity.water.rate`), a column key ending
 * in `[]` for a list of texts, a key starting with `~` for a read-only column
 * (a label beside an id), ignored on reading.
 *
 * A nested object becomes one column per leaf, so a map keyed by Category,
 * Event or property is a column per key; a field named in `opaque`, or one
 * with more than MAX_FAMILY leaves across the records, is one JSON column.
 */

import { Blobs, readValue, writeFreeValue, writeJson, writeValue } from "./cells";
import { type Cell, type CellRef, type Problem, type SheetModel, cellText, textCell } from "./model";
import { formatKey, isObject, own, parseKey, type Json, type JsonObject } from "./paths";

/** More leaf columns than this under one field and the field is written as one JSON column. */
const MAX_FAMILY = 200;

interface Leaf {
  path: string[];
  /** The path as a column key. */
  key: string;
  value: Json;
  list: boolean;
}

export function leaves(rec: JsonObject, opaque: ReadonlySet<string> = new Set(), prefix: string[] = []): Leaf[] {
  const out: Leaf[] = [];
  for (const [k, v] of Object.entries(rec)) {
    if (v === undefined) continue;
    const path = [...prefix, k];
    const key = formatKey(path);
    if (opaque.has(key)) out.push({ path, key, value: v, list: false });
    else if (Array.isArray(v)) out.push({ path, key, value: v, list: v.every((x) => typeof x === "string") });
    else if (isObject(v) && Object.keys(v).length > 0) out.push(...leaves(v, opaque, path));
    else out.push({ path, key, value: v, list: false });
  }
  return out;
}

export interface TableSpec {
  name: string;
  /** Keys of the columns that come first, in this order, when some record has them. */
  first?: string[];
  /** Field keys written whole, as one JSON column. */
  opaque?: string[];
  /** Read-only columns: each `~key` is written right after `after`, from the record. */
  derived?: { key: string; after: string; value: (rec: JsonObject) => string | undefined }[];
}

/** A field that may hold a number, true/false or text: written with `writeFreeValue`. */
const isFreeTyped = (path: readonly string[]) => path[0] === "properties" || (path.length === 1 && path[0] === "value");

/** The records as a sheet. */
export function writeTable(spec: TableSpec, records: readonly JsonObject[], blobs: Blobs): SheetModel {
  const opaque = new Set(spec.opaque ?? []);
  // A field with too many leaves (a properties map of hundreds of keys) is one JSON column.
  let perRecord = records.map((rec) => leaves(rec, opaque));
  const family = new Map<string, Set<string>>();
  for (const ls of perRecord) for (const l of ls) {
    const top = formatKey(l.path.slice(0, 1));
    if (!family.has(top)) family.set(top, new Set());
    family.get(top)!.add(l.key);
  }
  const wide = [...family].filter(([, keys]) => keys.size > MAX_FAMILY).map(([top]) => top);
  if (wide.length > 0) {
    wide.forEach((top) => opaque.add(top));
    perRecord = records.map((rec) => leaves(rec, opaque));
  }

  const columns = new Map<string, { list: boolean }>();
  for (const ls of perRecord) for (const l of ls) {
    columns.set(l.key, { list: (columns.get(l.key)?.list ?? true) && l.list });
  }
  const first = (spec.first ?? []).filter((k) => columns.has(k));
  const rest = [...columns.keys()].filter((k) => !first.includes(k)).sort();
  const ordered: { header: string; key?: string; derived?: (rec: JsonObject) => string | undefined }[] = [];
  for (const key of [...first, ...rest]) {
    ordered.push({ header: key + (columns.get(key)!.list ? "[]" : ""), key });
    for (const d of spec.derived ?? []) if (d.after === key) ordered.push({ header: d.key, derived: d.value });
  }

  const rows: (Cell | null)[][] = [ordered.map((c) => textCell(c.header))];
  records.forEach((rec, i) => {
    const byKey = new Map(perRecord[i].map((l) => [l.key, l]));
    rows.push(ordered.map((c) => {
      if (c.derived) {
        const text = c.derived(rec);
        return text === undefined ? null : textCell(text);
      }
      const leaf = byKey.get(c.key!);
      if (!leaf) return null;
      const list = columns.get(c.key!)!.list;
      // A list column reads a plain text as a list, so anything else in it is written in its JSON form.
      if (list && !Array.isArray(leaf.value)) return writeJson(leaf.value, blobs);
      return !list && isFreeTyped(leaf.path) ? writeFreeValue(leaf.value, blobs) : writeValue(leaf.value, blobs, list);
    }));
  });
  return { name: spec.name, rows };
}

export interface HeaderColumn {
  col: number;
  path: string[];
  /** The path as a column key. */
  key: string;
  list: boolean;
}

/** A record read from a row: its fields, the row, and where each field path came from. */
export interface ReadRecord {
  record: JsonObject;
  row: number;
  /** Field key → column, for the fields this row fills. */
  cols: Map<string, number>;
  /** The sheet's data columns (shared by its rows). */
  columns: readonly HeaderColumn[];
}

/** The header row: data columns by key; a `~` column is skipped, an unreadable one reported. */
export function readHeader(sheet: SheetModel, problems: Problem[], fixed?: (text: string) => boolean): { columns: HeaderColumn[]; other: { col: number; text: string }[] } {
  const header = sheet.rows[0] ?? [];
  const columns: HeaderColumn[] = [];
  const other: { col: number; text: string }[] = [];
  const seen = new Set<string>();
  header.forEach((c, col) => {
    const text = cellText(c);
    if (text === "" || text.startsWith("~")) return;
    if (fixed && !fixed(text)) { other.push({ col, text }); return; }
    const list = text.endsWith("[]");
    const path = parseKey(list ? text.slice(0, -2) : text);
    const at: CellRef = { sheet: sheet.name, row: 0, col };
    if (!path) { problems.push({ severity: "warning", at, message: `column "${text}" is not a field path; it is ignored` }); return; }
    const key = formatKey(path);
    if (seen.has(key)) { problems.push({ severity: "error", at, message: `column "${text}" appears twice` }); return; }
    seen.add(key);
    columns.push({ col, path, key, list });
  });
  return { columns, other };
}

/** Write a value at a path of a record; why not, when a column above or below it is also filled. */
export function place(rec: JsonObject, path: readonly string[], value: Json): string | null {
  let cur: JsonObject = rec;
  for (let k = 0; k < path.length - 1; k++) {
    const next = own(cur, path[k]);
    if (next === undefined) cur = cur[path[k]] = {};
    else if (isObject(next)) cur = next;
    else return `${formatKey(path.slice(0, k + 1))} is filled too, so ${formatKey(path)} has nowhere to go`;
  }
  const last = path[path.length - 1];
  if (own(cur, last) !== undefined) return `${formatKey(path)} is filled, and so is a column inside it`;
  cur[last] = value;
  return null;
}

/** True when a row has no value in any of these columns. */
const blankRow = (row: readonly (Cell | null)[] | undefined, cols: readonly number[]) =>
  !row || cols.every((c) => { const x = row[c]; return !x || (x.v === null && x.f === undefined) || x.v === ""; });

/** The sheet's records, every cell read; problems name their cell. */
export function readTable(sheet: SheetModel, blobs: readonly string[], problems: Problem[]): ReadRecord[] {
  const { columns } = readHeader(sheet, problems);
  const out: ReadRecord[] = [];
  for (let row = 1; row < sheet.rows.length; row++) {
    const cells = sheet.rows[row];
    if (blankRow(cells, columns.map((c) => c.col))) continue;
    const record: JsonObject = {};
    const cols = new Map<string, number>();
    for (const c of columns) {
      const at: CellRef = { sheet: sheet.name, row, col: c.col };
      const read = readValue(cells?.[c.col], blobs, c.list);
      if ("absent" in read) continue;
      if ("error" in read) { problems.push({ severity: "error", at, message: read.error }); continue; }
      const why = place(record, c.path, read.value);
      if (why) { problems.push({ severity: "error", at, message: why }); continue; }
      cols.set(c.key, c.col);
    }
    out.push({ record, row, cols, columns });
  }
  return out;
}
