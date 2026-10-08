/**
 * model-text.ts — change everything a project saves (the project file and the
 * Model Configuration) through a text: the Model text (ADR-0022). Pure: no
 * store access; `lib/model-text-apply.ts` is the store-facing side.
 *
 * The text is a CHANGE SET, never the whole bundle: a model can be megabytes,
 * which no text box or LLM context holds, and a whole-bundle replace would hide
 * what actually changed. Two lists, applied in order:
 *
 *   patch     JSON Patch (RFC 6902: add, replace, remove) at a JSON Pointer
 *             into `{ project, config }` — any part a file holds, except
 *             `project.update_history`, which is the app's record of what
 *             happened (undo reads it) and stays read-only;
 *   elements  Attribute Operations (ADR-0021) on Elements, by id or filter —
 *             the bulk form ("every pump: capacity × 0.8").
 *
 * THE CHECK, in order; the first stage that fails stops it, and nothing is
 * changed until a person confirms the preview:
 *   1. size and nesting limits on the text;
 *   2. `JSON.parse` only — nothing in the text is ever executed;
 *   3. no key `__proto__`, `constructor` or `prototype` anywhere in it;
 *   4. the change set's own strict schema;
 *   5. a dry run on a copy (paths must exist; operations must apply);
 *   6. the result must pass the full Project and Configuration schemas;
 *   7. and the reference checks a loaded file gets (`validateBundle`): an
 *      edge's endpoints, a Canvas's members; plus unique Event and Temporal
 *      Simulation ids and registry keys that match their record's id.
 */

import { z } from "zod";
import { AttributeOperationSchema } from "@/lib/schemas/attribute-operation";
import { isSafeKey } from "@/lib/schemas/field-path";
import { ModelConfigurationSchema } from "@/lib/schemas/config";
import { ProjectSchema, type Edge, type Node, type Project } from "@/lib/schemas/network";
import { applyOperationTo, operationTargets } from "@/lib/attribute-operations";
import { canvasesById } from "@/lib/element-filter";
import { deepEqual, diffGraph } from "@/lib/graph-diff";
import { validateBundle } from "@/lib/project-validation";
import { extractJson } from "@/lib/temporal-simulation-text";
import type { ProjectBundle } from "@/lib/file-io";

export const MODEL_TEXT_FORMAT = "cascade.model-change/v1";

/** Limits on the text: far above any real change set, far below what would hang the tab. */
export const MAX_TEXT_CHARS = 2_000_000;
export const MAX_DEPTH = 48;

const PatchOpSchema = z
  .object({
    op: z.enum(["add", "replace", "remove"]),
    /** JSON Pointer into `{ project, config }`, e.g. `/config/events/-`. */
    path: z.string(),
    value: z.unknown().optional(),
  })
  .strict()
  .refine((o) => o.op === "remove" || o.value !== undefined, { message: "add and replace need a `value`", path: ["value"] });
type PatchOp = z.infer<typeof PatchOpSchema>;

const ChangeSetSchema = z
  .object({
    format: z.literal(MODEL_TEXT_FORMAT),
    patch: z.array(PatchOpSchema).default([]),
    elements: z.array(AttributeOperationSchema).default([]),
  })
  .strict();
export type ChangeSet = z.infer<typeof ChangeSetSchema>;

const issues = (err: z.ZodError, prefix = ""): string[] =>
  err.issues.map((i) => `${prefix}${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`);

// ---------------------------------------------------------------------------
// 1–4. Parse
// ---------------------------------------------------------------------------

/** The first problem with a parsed value's shape: too deep, or a key that reaches a prototype. */
function scanJson(value: unknown): string | null {
  const stack: { v: unknown; depth: number; where: string }[] = [{ v: value, depth: 0, where: "(root)" }];
  while (stack.length > 0) {
    const { v, depth, where } = stack.pop()!;
    if (typeof v !== "object" || v === null) continue;
    if (depth > MAX_DEPTH) return `${where}: nested deeper than ${MAX_DEPTH} levels`;
    for (const key of Object.keys(v)) {
      if (!isSafeKey(key)) return `${where}: the key "${key}" is not allowed (__proto__, constructor and prototype never are)`;
      stack.push({ v: (v as Record<string, unknown>)[key], depth: depth + 1, where: `${where === "(root)" ? "" : `${where}.`}${key}` });
    }
  }
  return null;
}

export type ParsedChange = { ok: true; change: ChangeSet } | { ok: false; errors: string[] };

/** Stages 1–4: the text as a change set, or why not. Accepts bare JSON or a whole LLM reply. */
export function parseChangeText(text: string): ParsedChange {
  if (text.length > MAX_TEXT_CHARS) return { ok: false, errors: [`The text is ${text.length.toLocaleString()} characters; the limit is ${MAX_TEXT_CHARS.toLocaleString()}. Split the change.`] };
  let raw: unknown;
  try {
    raw = JSON.parse(extractJson(text));
  } catch (e) {
    return { ok: false, errors: [`Not valid JSON: ${(e as Error).message}`] };
  }
  const shape = scanJson(raw);
  if (shape) return { ok: false, errors: [shape] };
  const parsed = ChangeSetSchema.safeParse(raw);
  return parsed.success ? { ok: true, change: parsed.data } : { ok: false, errors: issues(parsed.error) };
}

// ---------------------------------------------------------------------------
// JSON Pointer
// ---------------------------------------------------------------------------

/** A JSON Pointer's segments: `~1` is `/`, `~0` is `~`. */
const decodePointer = (path: string): string[] => path.slice(1).split("/").map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));

/** A JSON Pointer's segments, or why it cannot address the bundle for a write. */
export function parsePointer(path: string): { segments: string[] } | { error: string } {
  if (!path.startsWith("/")) return { error: `"${path}" must start with "/" (a JSON Pointer, e.g. /config/events/0)` };
  const segments = decodePointer(path);
  const unsafe = segments.find((s) => !isSafeKey(s));
  if (unsafe !== undefined) return { error: `"${path}": "${unsafe}" is not allowed in a path` };
  const [root, field] = segments;
  if (root !== "project" && root !== "config") return { error: `"${path}" must start with /project or /config` };
  if (root === "project" && field === undefined) return { error: `"${path}": replace a part of the project (e.g. /project/nodes), not the whole project` };
  if (root === "project" && field === "update_history") return { error: `"${path}": update_history is the app's record of what happened and is read-only` };
  return { segments };
}

const isContainer = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Apply one patch operation in place on `root` (a copy), or say why it cannot. */
function applyPatchOp(root: Record<string, unknown>, op: PatchOp): string | null {
  const pointer = parsePointer(op.path);
  if ("error" in pointer) return pointer.error;
  const { segments } = pointer;
  let parent: unknown = root;
  for (const [i, key] of segments.slice(0, -1).entries()) {
    const next: unknown = Array.isArray(parent) ? parent[Number(key)] : isContainer(parent) && Object.hasOwn(parent, key) ? parent[key] : undefined;
    if (!isContainer(next) || (Array.isArray(parent) && !/^\d+$/.test(key))) {
      return `${op.op} ${op.path}: /${segments.slice(0, i + 1).join("/")} does not exist`;
    }
    parent = next;
  }
  const last = segments[segments.length - 1];
  const value = op.value === undefined ? undefined : structuredClone(op.value);
  if (Array.isArray(parent)) {
    const index = last === "-" && op.op === "add" ? parent.length : /^\d+$/.test(last) ? Number(last) : -1;
    const bound = op.op === "add" ? parent.length : parent.length - 1;
    if (index < 0 || index > bound) return `${op.op} ${op.path}: no index ${last} in a list of ${parent.length}`;
    if (op.op === "add") parent.splice(index, 0, value);
    else if (op.op === "replace") parent[index] = value;
    else parent.splice(index, 1);
    return null;
  }
  if (!isContainer(parent)) return `${op.op} ${op.path}: the parent holds a value, not an object or list`;
  if (op.op !== "add" && !Object.hasOwn(parent, last)) return `${op.op} ${op.path}: nothing there to ${op.op}`;
  if (op.op === "remove") delete parent[last];
  else parent[last] = value;
  return null;
}

/** The value at a pointer, for "Copy section" (reading may address anything); undefined when there is none. */
export function readPointer(bundle: ProjectBundle, path: string): unknown {
  if (!path.startsWith("/")) return undefined;
  let v: unknown = bundle;
  for (const key of decodePointer(path)) {
    if (!isContainer(v) || !isSafeKey(key)) return undefined;
    v = Array.isArray(v) ? v[Number(key)] : Object.hasOwn(v, key) ? v[key] : undefined;
  }
  return v;
}

// ---------------------------------------------------------------------------
// 5–7. Dry run and check
// ---------------------------------------------------------------------------

export type CheckedChange =
  | { ok: true; after: ProjectBundle; preview: Preview; warnings: string[] }
  | { ok: false; errors: string[] };

/** Ids the reference checks of `validateBundle` do not cover. */
function idProblems(bundle: ProjectBundle): string[] {
  const out: string[] = [];
  for (const [kind, registry] of [["node", bundle.project.nodes], ["edge", bundle.project.edges]] as const) {
    for (const [key, el] of Object.entries(registry)) if (el.id !== key) out.push(`project.${kind}s["${key}"] has id "${el.id}"; the key and the id must match`);
  }
  const twice = (ids: string[]) => ids.filter((id, i) => ids.indexOf(id) !== i);
  for (const id of new Set(twice(bundle.config.events.map((e) => e.id)))) out.push(`config.events: the id "${id}" is used twice`);
  for (const id of new Set(twice((bundle.project.temporal_simulations ?? []).map((s) => s.id)))) out.push(`project.temporal_simulations: the id "${id}" is used twice`);
  for (const id of new Set(twice(bundle.project.canvases.map((c) => c.id)))) out.push(`project.canvases: the id "${id}" is used twice`);
  return out;
}

const issueKey = (i: { code: string; message: string }) => `${i.code}\n${i.message}`;

/**
 * Stages 5–7: the bundle `change` would produce, with its preview, or every
 * reason it cannot. `before` is never modified.
 */
export function checkChange(before: ProjectBundle, change: ChangeSet): CheckedChange {
  const draft = structuredClone({ project: before.project, config: before.config }) as unknown as Record<string, unknown>;
  const errors: string[] = [];
  change.patch.forEach((op, i) => {
    const problem = applyPatchOp(draft, op);
    if (problem) errors.push(`patch[${i}]: ${problem}`);
  });
  if (errors.length > 0) return { ok: false, errors };

  // The schemas first: the operations below read nodes, edges and the scale.
  const project = ProjectSchema.safeParse(draft.project);
  const config = ModelConfigurationSchema.safeParse(draft.config);
  if (!project.success) errors.push(...issues(project.error, "project."));
  if (!config.success) errors.push(...issues(config.error, "config."));
  if (errors.length > 0) return { ok: false, errors };

  // The text's own values are what is kept; the schema's output would add defaults the preview would then report.
  const after = draft as unknown as ProjectBundle;
  const n = after.config.functionality_scale.length;
  const model = { nodes: after.project.nodes, edges: after.project.edges, canvases: canvasesById(after.project.canvases) };
  change.elements.forEach((op, i) => {
    const targets = operationTargets(op, model);
    if (targets.length === 0) errors.push(`elements[${i}]: ${op.element !== undefined ? `no Element "${op.element}"` : "the filter matches no Element"}`);
    for (const id of targets) {
      const kind = id in after.project.nodes ? "node" : "edge";
      const registry = (kind === "node" ? after.project.nodes : after.project.edges) as Record<string, Node | Edge>;
      const result = applyOperationTo(registry[id] as unknown as Record<string, unknown>, kind, op, n);
      if ("error" in result) errors.push(`elements[${i}] on ${id}: ${result.error}`);
      else registry[id] = result.element as unknown as Node & Edge;
    }
  });

  errors.push(...idProblems(after));
  const known = new Set(validateBundle(before).map(issueKey));
  const found = validateBundle(after).filter((i) => !known.has(issueKey(i)));
  errors.push(...found.filter((i) => i.severity === "error").map((i) => i.message));
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, after, preview: previewChange(before, after), warnings: found.filter((i) => i.severity === "warning").map((i) => i.message) };
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

interface PreviewLine {
  kind: "add" | "remove" | "change";
  /** What changed, in words a person reads: `Node "Pump 1" (p1) › capacity`. */
  where: string;
  before?: string;
  after?: string;
}

export interface Preview {
  /** Elements, Canvases and the rest, counted. */
  counts: { add: number; remove: number; change: number };
  lines: PreviewLine[];
}

/** A value, short enough for one line of the preview. */
function shortValue(v: unknown): string {
  const text = v === undefined ? "(absent)" : JSON.stringify(v);
  return text.length > 90 ? `${text.slice(0, 87)}…` : text;
}

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const hasIds = (v: unknown[]): v is { id: string }[] => v.every((x) => isPlain(x) && typeof x.id === "string");

/** Leaf-level changes between two JSON values; lists of records with ids are matched by id. */
function jsonChanges(before: unknown, after: unknown, where: string, out: PreviewLine[]): void {
  if (deepEqual(before, after)) return;
  if (before === undefined) { out.push({ kind: "add", where, after: shortValue(after) }); return; }
  if (after === undefined) { out.push({ kind: "remove", where, before: shortValue(before) }); return; }
  if (isPlain(before) && isPlain(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) jsonChanges(before[key], after[key], `${where} › ${key}`, out);
    return;
  }
  if (Array.isArray(before) && Array.isArray(after) && hasIds(before) && hasIds(after)) {
    const a = new Map(before.map((x) => [x.id, x]));
    const b = new Map(after.map((x) => [x.id, x]));
    for (const id of new Set([...a.keys(), ...b.keys()])) jsonChanges(a.get(id), b.get(id), `${where} "${id}"`, out);
    return;
  }
  out.push({ kind: "change", where, before: shortValue(before), after: shortValue(after) });
}

const elementName = (kind: string, id: string, record: { label?: string } | undefined) =>
  `${kind} ${record?.label ? `"${record.label}" (${id})` : id}`;

function previewChange(before: ProjectBundle, after: ProjectBundle): Preview {
  const lines: PreviewLine[] = [];
  const snap = (p: Project) => ({ nodes: p.nodes, edges: p.edges, canvases: p.canvases });
  const diff = diffGraph(snap(before.project), snap(after.project));
  for (const [kind, list, registry] of [
    ["Node", diff.nodes, after.project.nodes],
    ["Edge", diff.edges, after.project.edges],
    ["Canvas", diff.canvases, Object.fromEntries(after.project.canvases.map((c) => [c.id, c]))],
  ] as const) {
    for (const r of list) {
      const record = (r.record ?? (registry as Record<string, { label?: string }>)[r.id]) as { label?: string } | undefined;
      const name = elementName(kind, r.id, record);
      if (r.op === "add") lines.push({ kind: "add", where: name });
      else if (r.op === "remove") lines.push({ kind: "remove", where: name });
      else for (const f of r.fields) lines.push({ kind: "change", where: `${name} › ${[f.field, ...(f.path ?? (f.key ? [f.key] : []))].join(" › ")}`, before: shortValue(f.before), after: shortValue(f.after) });
    }
  }
  if (diff.canvas_order) lines.push({ kind: "change", where: "Canvas order", before: shortValue(diff.canvas_order_before), after: shortValue(diff.canvas_order) });
  const rest = (p: Project) => { const { nodes: _n, edges: _e, canvases: _c, update_history: _h, ...r } = p; return r; };
  jsonChanges(rest(before.project), rest(after.project), "project", lines);
  jsonChanges(before.config, after.config, "config", lines);
  const counts = { add: 0, remove: 0, change: 0 };
  for (const l of lines) counts[l.kind]++;
  return { counts, lines };
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

export const STARTER_TEXT = JSON.stringify({ format: MODEL_TEXT_FORMAT, patch: [], elements: [] }, null, 2);

export const MODEL_TEXT_REFERENCE = `Format "${MODEL_TEXT_FORMAT}" — JSON, strict (unknown keys are errors).

{
  "format": "${MODEL_TEXT_FORMAT}",
  "patch": [                          // JSON Patch (RFC 6902), applied in order
    { "op": "add",     "path": "/config/events/-", "value": { ...an Event... } },   // "-" appends to a list
    { "op": "replace", "path": "/project/nodes/J12/label", "value": "Junction 12" },
    { "op": "remove",  "path": "/project/edges/e7" }
  ],
  "elements": [                       // Attribute Operations, after the patch
    { "where": { "node_type": "Infrastructure", "label_contains": "pump" },
      "path": ["supply_capacity", "water"], "op": "mul", "value": 0.8 },
    { "element": "J12", "path": ["functionality"], "op": "set", "value": 3 }
  ]
}

Paths start at /project or /config: everything the project file and the Model Configuration hold
(nodes, edges, canvases, meta, scorecard, temporal_simulations; events, categories,
functionality_scale, …). /project/update_history is read-only. "~1" writes a "/" inside a key,
"~0" a "~". add creates or replaces a key, or inserts into a list; replace needs something there;
remove deletes it.

Removing an Element: remove it from /project/nodes (or edges), from every Canvas's graph.node_ids
(edge_ids), and remove its edges — the check refuses a reference to something that is gone.

Operations: set, add, mul, at_most (cap at value), at_least (raise to value); "element" (one id) or
"where" (kind, canvas, category, node_type, label_contains, exclude). Nothing is clamped: a value the
Element's schema refuses is an error.

Nothing changes until the preview is confirmed; a version of the whole project is kept first.`;

/** A compact picture of the project for an LLM: ids and names, never the whole bundle. */
export function modelTextContext(bundle: ProjectBundle, limit = 300): string {
  const { project, config } = bundle;
  const nodes = Object.values(project.nodes);
  const edges = Object.values(project.edges);
  const lines = (title: string, items: string[]) =>
    `## ${title} (${items.length})\n${items.slice(0, limit).join("\n")}${items.length > limit ? `\n… ${items.length - limit} more` : ""}`;
  return [
    "You are editing a CASCADE infrastructure-resilience model. Reply with ONE ```json block holding a change set in the format below; change only what was asked.",
    MODEL_TEXT_REFERENCE,
    lines("Canvases", project.canvases.map((c) => `- ${c.id} — ${c.label}`)),
    lines("Nodes", nodes.map((nd) => `- ${nd.id} — ${nd.label ?? ""} — ${nd.node_type ?? ""}${nd.node_categories?.length ? ` — ${nd.node_categories.join(", ")}` : ""}`)),
    lines("Edges", edges.map((e) => `- ${e.id} — ${e.source} → ${e.target}`)),
    lines("Events", config.events.map((e) => `- ${e.id} — ${e.label} — ${e.type}`)),
    lines("Categories", config.categories.map((c) => `- ${c.name}`)),
    `## Functionality scale\n1..${config.functionality_scale.length}`,
    `## Temporal Simulations\n${(project.temporal_simulations ?? []).map((s) => `- ${s.id} — ${s.timeline.name}`).join("\n") || "(none)"}`,
    "Ask for any part's full JSON if you need it (the app's Copy section).",
  ].join("\n\n");
}
