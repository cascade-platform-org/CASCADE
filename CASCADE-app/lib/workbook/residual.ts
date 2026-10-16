/**
 * residual.ts — what the visible sheets cannot say, and the hidden `_cascade`
 * sheet that keeps it (ADR-0023 §2).
 *
 * After the sheets are written, they are read back and compared with the
 * project. Every remaining difference (an order the rows do not keep, a list
 * that was empty rather than absent, a cell value the spreadsheet will
 * recompute) is an entry: the path, a hash of what the sheets give there, and
 * the project's value. Reading applies an entry only while the sheets still
 * give that same value, so an edit a person made in the sheet always wins.
 *
 * `_cascade` rows are `key | part | text`; a text longer than a cell is split
 * into parts, never inside a surrogate pair.
 */

import { CELL_LIMIT } from "./cells";
import { type Cell, type SheetModel, textCell } from "./model";
import { getIn, hashOf, isObject, jsonEqual, own, setIn, type Json, type JsonObject } from "./paths";

export const CASCADE_SHEET = "_cascade";
export const WORKBOOK_FORMAT = "cascade.workbook/v1";

export interface ResidualEntry {
  /** The path from the bundle's root (`project` or `config` first). */
  p: string[];
  /** Hash of what the sheets give at `p`. */
  h: string;
  /** The project's value there; absent when the project has none (`d`). */
  v?: Json;
  d?: true;
}

/** Every difference between what the sheets give (`derived`) and the project (`original`), at the shallowest path. */
export function residual(derived: unknown, original: unknown, path: string[] = []): ResidualEntry[] {
  if (isObject(derived) && isObject(original)) {
    const out: ResidualEntry[] = [];
    for (const k of new Set([...Object.keys(derived), ...Object.keys(original)])) {
      out.push(...residual(own(derived, k), own(original, k), [...path, k]));
    }
    return out;
  }
  if (Array.isArray(derived) && Array.isArray(original) && derived.length === original.length) {
    // The same items in another order is one entry for the whole list, not one per position.
    const sorted = (a: unknown[]) => a.map(hashOf).sort().join(",");
    if (!jsonEqual(derived, original) && sorted(derived) === sorted(original)) return [{ p: path, h: hashOf(derived), v: original as Json }];
    return derived.flatMap((x, i) => residual(x, original[i], [...path, String(i)]));
  }
  if (hashOf(derived) === hashOf(original)) return [];
  return [{ p: path, h: hashOf(derived), ...(original === undefined ? { d: true as const } : { v: original as Json }) }];
}

/** Apply the entries whose hash still matches; how many were set aside because the sheet changed there. */
export function applyResidual(root: JsonObject, entries: readonly ResidualEntry[]): number {
  let stale = 0;
  for (const e of entries) {
    if (e.p.length === 0) continue;
    if (hashOf(getIn(root, e.p)) !== e.h) { stale++; continue; }
    setIn(root, e.p, e.d ? undefined : e.v);
  }
  return stale;
}

/** Split text into parts that fit a cell, never between the halves of a surrogate pair. */
function parts(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + CELL_LIMIT, text.length);
    const code = text.charCodeAt(end - 1);
    if (end < text.length && code >= 0xd800 && code <= 0xdbff) end--;
    out.push(text.slice(i, end));
    i = end;
  }
  return out.length ? out : [""];
}

/** The `_cascade` sheet holding these texts by key. */
export function writeCascadeSheet(entries: readonly [key: string, text: string][]): SheetModel {
  const rows: (Cell | null)[][] = [[textCell("key"), textCell("part"), textCell("text")]];
  for (const [key, text] of entries) {
    parts(text).forEach((t, i) => rows.push([textCell(key), { v: i + 1 }, textCell(t === "" ? "​" : t)]));
  }
  return { name: CASCADE_SHEET, rows, hidden: true };
}

/** The `_cascade` sheet's texts by key, parts joined in order. */
export function readCascadeSheet(sheet: SheetModel | undefined): Map<string, string> {
  const byKey = new Map<string, [number, string][]>();
  for (const row of sheet?.rows.slice(1) ?? []) {
    const key = row[0]?.v;
    const part = row[1]?.v;
    const text = row[2]?.v;
    if (typeof key !== "string") continue;
    const list = byKey.get(key) ?? [];
    list.push([typeof part === "number" ? part : list.length + 1, typeof text === "string" ? (text === "​" ? "" : text) : text === undefined || text === null ? "" : String(text)]);
    byKey.set(key, list);
  }
  return new Map([...byKey].map(([k, ps]) => [k, ps.sort((a, b) => a[0] - b[0]).map(([, t]) => t).join("")]));
}
