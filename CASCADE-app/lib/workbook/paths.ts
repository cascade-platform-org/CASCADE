/**
 * paths.ts — the Workbook's column keys and the plain-JSON helpers the codec
 * shares (ADR-0023 §2).
 *
 * A column key is the field path of the value it holds, dotted, exactly as an
 * Attribute Operation writes it: `supply_capacity.water.rate`. A segment that a
 * dot would make ambiguous (it holds `.`, `"` or `:`, starts or ends with a
 * space, is empty, or starts with `~`) is written as a JSON string:
 * `properties."a.b"`.
 */

import { isSafeKey } from "@/lib/schemas/field-path";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export const isObject = (v: unknown): v is JsonObject => typeof v === "object" && v !== null && !Array.isArray(v);

/** A key's own value: a key named like an inherited one (valueOf, toString) is a field, never the inherited function. */
export const own = (o: JsonObject, k: string): Json | undefined => (Object.hasOwn(o, k) ? o[k] : undefined);

const PLAIN_SEGMENT = /^[^."~:\s]([^.":]*[^.":\s])?$/;

/** A path as a column key. */
export function formatKey(path: readonly string[]): string {
  return path.map((s) => (PLAIN_SEGMENT.test(s) ? s : JSON.stringify(s))).join(".");
}

/** A column key as a path, or null when it is not one (an unsafe segment included). */
export function parseKey(key: string): string[] | null {
  const out: string[] = [];
  let i = 0;
  while (i < key.length) {
    let segment: string;
    if (key[i] === '"') {
      let j = i + 1;
      while (j < key.length && key[j] !== '"') j += key[j] === "\\" ? 2 : 1;
      if (j >= key.length) return null;
      try { segment = JSON.parse(key.slice(i, j + 1)) as string; } catch { return null; }
      i = j + 1;
    } else {
      const j = key.indexOf(".", i);
      segment = key.slice(i, j < 0 ? key.length : j);
      i = j < 0 ? key.length : j;
      if (segment === "") return null;
    }
    if (!isSafeKey(segment)) return null;
    out.push(segment);
    if (i < key.length) {
      if (key[i] !== ".") return null;
      i++;
      if (i === key.length) return null;
    }
  }
  return out.length > 0 ? out : null;
}

/** The value at a path, or undefined. Own keys only. */
export function getIn(root: unknown, path: readonly string[]): unknown {
  let cur: unknown = root;
  for (const seg of path) {
    if (Array.isArray(cur) && /^\d+$/.test(seg)) cur = cur[Number(seg)];
    else if (isObject(cur) && Object.hasOwn(cur, seg)) cur = cur[seg];
    else return undefined;
  }
  return cur;
}

/** Write a value at a path, creating objects on the way; undefined deletes the key. */
export function setIn(root: JsonObject, path: readonly string[], value: Json | undefined): void {
  let cur: Json = root;
  for (let k = 0; k < path.length - 1; k++) {
    const seg = path[k];
    const next: Json | undefined = Array.isArray(cur) ? cur[Number(seg)] : own(cur as JsonObject, seg);
    if (typeof next !== "object" || next === null) {
      const fresh: JsonObject = {};
      if (Array.isArray(cur)) cur[Number(seg)] = fresh;
      else (cur as JsonObject)[seg] = fresh;
      cur = fresh;
    } else {
      cur = next;
    }
  }
  const last = path[path.length - 1];
  if (Array.isArray(cur)) {
    if (value === undefined) cur.splice(Number(last), 1);
    else cur[Number(last)] = value;
  } else if (value === undefined) {
    delete (cur as JsonObject)[last];
  } else {
    (cur as JsonObject)[last] = value;
  }
}

/** JSON with sorted keys and undefined keys left out: equal values give equal text. */
function canonical(v: unknown): string {
  if (v === undefined) return "undefined";
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : canonical(x))).join(",")}]`;
  if (isObject(v)) {
    return `{${Object.keys(v).filter((k) => own(v, k) !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(own(v, k))}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

/** A short stable hash (cyrb53) of a value's canonical text. */
export function hashOf(v: unknown): string {
  const text = canonical(v);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** A deep copy through JSON: what a file holds. */
export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
