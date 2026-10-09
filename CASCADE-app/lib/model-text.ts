/**
 * model-text.ts — change everything a project saves (the project file and the
 * Model Configuration) through a text: the LLM Design (ADR-0022). Pure: no
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
import { DIFF_ABSENT, ProjectSchema, type Edge, type Node, type Project } from "@/lib/schemas/network";
import { NODE_TYPES } from "@/lib/schemas/primitives";
import { applyOperationTo, operationTargets } from "@/lib/attribute-operations";
import { canvasesById } from "@/lib/element-filter";
import { deepEqual, diffGraph } from "@/lib/graph-diff";
import { validateBundle } from "@/lib/project-validation";
import { ELEMENT_PATHS, MODEL_PRIMER, SIMULATION_REFERENCE, extractJson } from "@/lib/temporal-simulation-text";
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
export type PatchOp = z.infer<typeof PatchOpSchema>;

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

/**
 * Stages 1–3: the text as a JSON value, or why not. Accepts bare JSON or a
 * whole LLM reply (its first ```json block).
 */
export function parseJsonText(text: string): { ok: true; value: unknown } | { ok: false; errors: string[] } {
  if (text.length > MAX_TEXT_CHARS) return { ok: false, errors: [`The text is ${text.length.toLocaleString()} characters; the limit is ${MAX_TEXT_CHARS.toLocaleString()}. Split the change.`] };
  let value: unknown;
  try {
    // Bare JSON as it is (a section may be a list, which the reply extractor would cut to its braces).
    value = JSON.parse(text);
  } catch {
    try {
      value = JSON.parse(extractJson(text));
    } catch (e) {
      return { ok: false, errors: [`Not valid JSON: ${(e as Error).message}`] };
    }
  }
  const shape = scanJson(value);
  return shape ? { ok: false, errors: [shape] } : { ok: true, value };
}

/** Stages 1–4: the text as a change set, or why not. */
export function parseChangeText(text: string): ParsedChange {
  const json = parseJsonText(text);
  return json.ok ? parseChangeValue(json.value) : json;
}

/** Stage 4 alone, for a value already through stages 1–3. */
export function parseChangeValue(value: unknown): ParsedChange {
  const parsed = ChangeSetSchema.safeParse(value);
  return parsed.success ? { ok: true, change: parsed.data } : { ok: false, errors: issues(parsed.error) };
}

// ---------------------------------------------------------------------------
// JSON Pointer
// ---------------------------------------------------------------------------

/** One key as a JSON Pointer segment: `~` becomes `~0`, then `/` becomes `~1`. */
export const encodePointerKey = (key: string): string => key.replace(/~/g, "~0").replace(/\//g, "~1");

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
    if (Array.isArray(parent) && !/^\d+$/.test(key)) {
      return `${op.op} ${op.path}: /${segments.slice(0, i).join("/")} is a list; address an item by its position (0, 1, …), not "${key}"`;
    }
    if (!isContainer(next)) return `${op.op} ${op.path}: /${segments.slice(0, i + 1).join("/")} does not exist`;
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

/** Apply patch operations in place on `root` (a copy of `{ project, config }`), in order; the reasons any could not apply. */
export function applyPatchOps(root: Record<string, unknown>, ops: readonly PatchOp[]): string[] {
  return ops.flatMap((op) => applyPatchOp(root, op) ?? []);
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

const UNKNOWN_EVENT = new Set(["NODE_UNKNOWN_EVENT", "EDGE_UNKNOWN_EVENT"]);

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
  // A file load only warns about a vulnerability to an unknown Event; an edit that introduces one made a mistake.
  const refused = (i: (typeof found)[number]) => i.severity === "error" || UNKNOWN_EVENT.has(i.code);
  errors.push(...found.filter(refused).map((i) => i.message));
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, after, preview: previewChange(before, after), warnings: found.filter((i) => !refused(i)).map((i) => i.message) };
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

export interface PreviewLine {
  kind: "add" | "remove" | "change";
  /** What changed, in words a person reads: `Node "Pump 1" (p1) › capacity`. */
  where: string;
  before?: string;
  after?: string;
  /** The thing it belongs to (`node:p1`, `event:flood`), for grouping lines under the change that made them. */
  subject?: string;
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

/** A JSON object: not null, not a list. */
export const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** A record's identity in a list: its `id`, or a Category's `name`. */
const identity = (x: unknown): string | undefined =>
  isPlain(x) ? (typeof x.id === "string" ? x.id : typeof x.name === "string" ? x.name : undefined) : undefined;
const hasIds = (v: unknown[]) => v.every((x) => identity(x) !== undefined);

/** The subject kind of a list's records, by the list's key. */
const SUBJECT_OF: Record<string, string> = { events: "event", categories: "category", temporal_simulations: "simulation", scorecard: "scorecard", canvases: "canvas" };

/** Leaf-level changes between two JSON values; lists of records with ids (or names) are matched by them. */
function jsonChanges(before: unknown, after: unknown, where: string, out: PreviewLine[], subject?: string, key?: string): void {
  if (deepEqual(before, after)) return;
  if (before === undefined) { out.push({ kind: "add", where, after: shortValue(after), subject }); return; }
  if (after === undefined) { out.push({ kind: "remove", where, before: shortValue(before), subject }); return; }
  if (isPlain(before) && isPlain(after)) {
    for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) jsonChanges(before[k], after[k], `${where} › ${k}`, out, subject, k);
    return;
  }
  if (Array.isArray(before) && Array.isArray(after) && hasIds(before) && hasIds(after)) {
    const a = new Map(before.map((x) => [identity(x)!, x]));
    const b = new Map(after.map((x) => [identity(x)!, x]));
    const kind = key ? SUBJECT_OF[key] : undefined;
    for (const id of new Set([...a.keys(), ...b.keys()])) jsonChanges(a.get(id), b.get(id), `${where} "${id}"`, out, kind ? `${kind}:${id}` : subject);
    return;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const scalar = (v: unknown) => typeof v !== "object" || v === null;
    if (before.every(scalar) && after.every(scalar)) {
      // A list of values (a Canvas's node ids): what joined and what left reads better than a shifted list.
      const [was, now] = [new Set(before), new Set(after)];
      const added = after.filter((v) => !was.has(v));
      const gone = before.filter((v) => !now.has(v));
      if (added.length > 0) out.push({ kind: "add", where, after: shortValue(added), subject });
      if (gone.length > 0) out.push({ kind: "remove", where, before: shortValue(gone), subject });
      if (added.length === 0 && gone.length === 0) out.push({ kind: "change", where: `${where} (order)`, before: shortValue(before), after: shortValue(after), subject });
      return;
    }
    // A list of records without ids (a Timeline's Steps): item by item.
    for (let i = 0; i < Math.max(before.length, after.length); i++) jsonChanges(before[i], after[i], `${where}[${i}]`, out, subject);
    return;
  }
  out.push({ kind: "change", where, before: shortValue(before), after: shortValue(after), subject });
}

const present = (v: unknown) => (v === DIFF_ABSENT ? undefined : v);

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
      const subject = `${kind.toLowerCase()}:${r.id}`;
      if (r.op === "add") lines.push({ kind: "add", where: name, subject });
      else if (r.op === "remove") lines.push({ kind: "remove", where: name, subject });
      // A Graph Diff marks an absent side with DIFF_ABSENT; the preview reads it as "added" or "removed".
      else for (const f of r.fields) jsonChanges(present(f.before), present(f.after), `${name} › ${[f.field, ...(f.path ?? (f.key ? [f.key] : []))].join(" › ")}`, lines, subject);
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


const MODEL_TEXT_REFERENCE = `Format "${MODEL_TEXT_FORMAT}" — JSON, strict (unknown keys are errors).

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

"patch" and "elements" are each optional. Paths start at /project or /config: everything the project file and the Model Configuration hold
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

/** What an Event's fields mean (`EventDefinitionSchema`), for an LLM that adds or edits one. */
const EVENT_FIELDS = `## Event fields (config.events[])
- "id": any unique string (a new one: short and readable, e.g. "evt-flood"); keep existing ids, other parts refer to them
- "label": the name shown; "type": "hazard" | "disservice" | "restorative"
- "frequency_per_10y": expected occurrences in 10 years (0.1 = once a century); not meaningful for restorative
- optional: "icon" (a Lucide icon name), "temporal_simulation_only" (true: used only in Temporal Simulations),
  "expected_recovery_time" (hours, disservice), "default_repair_time" (hours, hazard),
  "attribute_operations" (operations applied when it fires; a restorative Event does only these)
- which Elements a hazard or disservice hits is on the Elements: "vulnerability_levels": { "<event id>": levels lost }`;

const ID_RULES = `## Ids and values
- Keep every existing id. A new Element or Event needs a unique id: any string not used yet.
- A node needs "id" and "functionality"; give it a "label" and a "node_type" (${NODE_TYPES.map((t) => `"${t}"`).join(", ")}).
  An edge needs "id", "source", "target" (node ids) and "functionality". A node feeds others only through edges.
- Functionality is an integer 1..N (N = fully operational, the scale is below). Quantities (supply, demand,
  capacity) are numbers ≥ 0 in the Category's unit. "importance" is a positive weight (1 = default).
- "responsibility_share" and "functionality_time" are written by the engine and by Events: leave them as they are.
- "position" is where the node sits on its Canvas (x to the right, y downward); place a new node near the
  ones it relates to.
- A field the section does not show is optional: leave it out unless asked. To delete an entry, leave its key
  (or its item) out.`;

/** A value's shape: numbers as "n", objects by their keys; two Elements of one shape need the same paths. */
const shapeOf = (v: unknown): unknown =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shapeOf(x)])) : typeof v;

/** At most this many examples: enough to show every kind, few enough to stay compact. */
const MAX_EXAMPLES = 12;

/**
 * One Element per Node Type and supply shape, trimmed of layout: the shapes a
 * bulk operation addresses. A Type whose supplies differ in shape (a plain
 * number here, a Stock there) shows one of each, since each needs its own path.
 */
function exampleElements(project: Project): string[] {
  const trim = ({ position: _p, geo: _g, responsibility_share: _r, ...rest }: Node) => rest;
  const byType = new Map<string, Node>();
  for (const nd of Object.values(project.nodes)) {
    if (byType.size === MAX_EXAMPLES) break;
    const key = `${nd.node_type ?? ""}\n${JSON.stringify(shapeOf(nd.supply_capacity))}`;
    if (!byType.has(key)) byType.set(key, nd);
  }
  if (byType.size === 0) return [];
  const edge = Object.values(project.edges)[0];
  return [[
    "## One Element of each kind, as stored (read a field's shape here before operating on it)",
    "```json",
    JSON.stringify({ nodes: [...byType.values()].map(trim), ...(edge ? { edge } : {}) }, null, 1),
    "```",
  ].join("\n")];
}

/**
 * What an LLM needs to edit the model: the primer, the field reference, and a
 * compact picture of the project (ids and names, never the whole bundle). With
 * `section`, the reply asked for is that section's JSON, edited, with what the
 * app does around it; without, a change set (Bulk operations).
 */
export function modelTextContext(
  bundle: ProjectBundle,
  section?: { label: string; json: string; pointer: string; registry?: "nodes" | "edges"; onCanvas?: boolean },
  /** For Bulk operations in plain changes (`lib/model-text-v2.ts`): its format, and what it adds (the field census). */
  bulk?: { reference: string; extra: string },
): string {
  const { project } = bundle;
  const sectionNotes = section && [
    section.registry === "nodes" && "- Deleting a node here also deletes its edges and removes it from every Canvas: do not edit those yourself.",
    section.registry && section.onCanvas && "- An Element you add here is placed on this Canvas.",
    section.registry && "- An edge needs \"source\" and \"target\" node ids; edges are edited in the Edges section.",
  ].filter(Boolean).join("\n");
  return [
    ...(section
      ? [
        `You are editing a CASCADE infrastructure-resilience model. Below is its "${section.label}" section (${section.pointer}) as JSON. Reply with ONE \`\`\`json block holding the WHOLE section, edited, and nothing else in the block; keep everything you were not asked to change exactly as it is. The app checks the result against the model's schema, shows the person every change, and applies nothing until they confirm.`,
        ...(sectionNotes ? [`## What the app does with this section\n${sectionNotes}`] : []),
        `## The section: ${section.label}\n\`\`\`json\n${section.json}\n\`\`\``,
      ]
      : [
        "You are editing a CASCADE infrastructure-resilience model. Reply with ONE ```json block holding a change set in the format below; change only what was asked. The app checks it, shows the person every change, and applies nothing until they confirm.",
        bulk?.reference ?? MODEL_TEXT_REFERENCE,
      ]),
    MODEL_PRIMER,
    ELEMENT_PATHS,
    ...(section?.pointer.startsWith("/project/temporal_simulations") ? [SIMULATION_REFERENCE] : []),
    ...(section?.pointer.startsWith("/config/events") || !section ? [EVENT_FIELDS] : []),
    ID_RULES,
    ...(section ? [] : [...(bulk ? [bulk.extra] : []), ...exampleElements(project)]),
    "# The rest of the model, for reference",
    modelLists(bundle),
  ].join("\n\n");
}

/** True when a pasted text is an LLM Design change set (either format), e.g. an LLM's reply. */
export const isChangeSetText = (text: string): boolean => /"format"\s*:\s*"cascade\.model-change\/v\d+"/.test(text);

/** The model's ids and names, list by list (capped at 300 each): what an LLM refers to. */
export function modelLists(bundle: ProjectBundle): string {
  const limit = 300;
  const { project, config } = bundle;
  const lines = (title: string, items: string[]) =>
    `## ${title} (${items.length})\n${items.slice(0, limit).join("\n")}${items.length > limit ? `\n… ${items.length - limit} more` : ""}`;
  return [
    lines("Canvases", project.canvases.map((c) => `- ${c.id} — ${c.label}`)),
    lines("Nodes", Object.values(project.nodes).map((nd) => `- ${nd.id} — ${nd.label ?? ""} — ${nd.node_type ?? ""}${nd.node_categories?.length ? ` — ${nd.node_categories.join(", ")}` : ""}`)),
    lines("Edges", Object.values(project.edges).map((e) => `- ${e.id} — ${e.source} → ${e.target}`)),
    lines("Events", config.events.map((e) => `- ${e.id} — ${e.label} — ${e.type}`)),
    lines("Categories", config.categories.map((c) => `- ${c.name} (${c.category_type})`)),
    `## Functionality scale\n1..${config.functionality_scale.length} (${config.functionality_scale.length} = fully operational)`,
    `## Temporal Simulations\n${(project.temporal_simulations ?? []).map((s) => `- ${s.id} — ${s.timeline.name}`).join("\n") || "(none)"}`,
  ].join("\n\n");
}
