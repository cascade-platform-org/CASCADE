/**
 * cells.ts — one value as one cell, and back (ADR-0023 §2–§3).
 *
 * Cells describe themselves: a number cell is a number, a true/false cell a
 * boolean, a text cell a string. What a plain cell cannot hold is written as
 * `json:` and the JSON: null, an empty list or object, a list in a column that
 * is not a list column, and text a spreadsheet would change or that reads as
 * one of these markers (it is empty, starts with `json:` or `@cascade:`, holds
 * control characters or `_xHHHH_`, which spreadsheet files decode). Text longer than a
 * cell holds is a `@cascade:blob/<n>` reference to the hidden `_cascade` sheet.
 *
 * A list column (key ending in `[]`) holds a list of texts joined by `; `.
 */

import type { Cell } from "./model";
import type { Json } from "./paths";

/** What a cell holds at most; spreadsheets refuse more than 32,767 characters. */
export const CELL_LIMIT = 32000;
const JSON_PREFIX = "json:";
const BLOB_PREFIX = "@cascade:blob/";
const LIST_SEPARATOR = "; ";

const XML_ESCAPE = /_x[0-9A-Fa-f]{4}_/;

/** Texts too long for a cell, kept in `_cascade` and referred to by number. */
export class Blobs {
  readonly texts: string[] = [];
  ref(text: string): string {
    this.texts.push(text);
    return `${BLOB_PREFIX}${this.texts.length - 1}`;
  }
}

/** True when text must be written in its `json:` form to come back as it is. */
function needsJson(s: string): boolean {
  // An empty text would be an empty cell, which reads as no value.
  return s === "" || s.startsWith(JSON_PREFIX) || s.startsWith("@cascade:") || XML_ESCAPE.test(s) || !isWellFormed(s);
}

/** No lone surrogate (a spreadsheet file cannot hold one) and no control character but tab, LF and CR. */
function isWellFormed(s: string): boolean {
  return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s) && !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(s);
}

/** JSON text a spreadsheet keeps: `_` before `xHHHH_` and every control character as \u escapes. */
function safeJson(v: Json): string {
  return JSON.stringify(v)
    .replace(/_x([0-9A-Fa-f]{4})_/g, "\\u005fx$1_")
    .replace(/[\ud800-\udfff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

const textOrBlob = (s: string, blobs: Blobs): Cell => ({ v: s.length > CELL_LIMIT ? blobs.ref(s) : s, text: true });

/** True for a list a list column holds plainly: texts with no separator, no line break, no edge spaces, none empty. */
const isPlainList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string" && x !== "" && x.trim() === x && !x.includes(";") && !x.includes("\n") && !needsJson(x));

/** A value as its JSON form, `json:` and the JSON. */
export const writeJson = (v: Json, blobs: Blobs): Cell => textOrBlob(JSON_PREFIX + safeJson(v), blobs);

/** A value as a cell; `list` for a list column. */
export function writeValue(v: Json, blobs: Blobs, list = false): Cell {
  if (typeof v === "number" || typeof v === "boolean") return { v };
  if (typeof v === "string") return needsJson(v) ? writeJson(v, blobs) : textOrBlob(v, blobs);
  if (list && isPlainList(v)) return textOrBlob(v.join(LIST_SEPARATOR), blobs);
  return writeJson(v, blobs);
}

export type ReadResult =
  | { value: Json; date?: boolean; text?: string }
  | { absent: true }
  | { error: string };

/** A cell as a value; `list` for a list column. Blob references are resolved from `_cascade`. */
export function readValue(c: Cell | null | undefined, blobs: readonly string[], list = false): ReadResult {
  if (!c || (c.v === null && c.f === undefined)) return { absent: true };
  if (c.error) return { error: `the cell holds an error (${c.w ?? "#ERROR"})` };
  if (c.v === null) return { error: "a formula without a stored value: open and save the file in a spreadsheet app, or type the value" };
  if (typeof c.v === "boolean") return { value: c.v };
  if (typeof c.v === "number") return { value: c.v, ...(c.date ? { date: true, text: c.w } : {}), ...(c.w !== undefined ? { text: c.w } : {}) };
  let s = c.v;
  if (s.startsWith(BLOB_PREFIX)) {
    const n = Number(s.slice(BLOB_PREFIX.length));
    if (!Number.isInteger(n) || blobs[n] === undefined) return { error: `${s}: the hidden _cascade sheet has no such text` };
    s = blobs[n];
  }
  if (s.startsWith(JSON_PREFIX)) {
    try {
      return { value: JSON.parse(s.slice(JSON_PREFIX.length)) as Json };
    } catch {
      return { error: `the text after "json:" is not valid JSON` };
    }
  }
  if (list) return { value: s === "" ? [] : s.split(";").map((x) => x.trim()).filter((x) => x !== "") };
  return { value: s };
}
