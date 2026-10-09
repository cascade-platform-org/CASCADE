/**
 * model-text-v2.ts — Bulk operations as plain changes (ADR-0022, revised
 * 2026-10-08). Pure.
 *
 * Written for an LLM, which knows what it wants ("halve every Source's
 * supply") and not how the model stores it. Each change names a field the way
 * a person does (`supply`, `demand`, `importance`), and a field holding a
 * number on one Element and a Stock on another is resolved per Element; things
 * are addressed by id, never by list position; and deleting a thing takes what
 * refers to it along. Plain changes compile, in order, into the patch the check
 * already understands (`checkChange`), so there is no second check.
 *
 * A change that matches an Element it cannot apply to refuses the whole set,
 * naming the Element; with `skip_unfit` it leaves that Element out, and the
 * preview lists it as skipped. Each change becomes a group of the preview,
 * with what it matched and what it skipped.
 */

import { z } from "zod";
import { ElementFilterSchema, type AttributeOperation } from "@/lib/schemas/attribute-operation";
import { FieldPathSchema, isSafeKey } from "@/lib/schemas/field-path";
import { applyOperationTo, operationTargets } from "@/lib/attribute-operations";
import { canvasesById } from "@/lib/element-filter";
import { deepEqual } from "@/lib/graph-diff";
import { eventFollowUps, registryFollowUps } from "@/lib/model-text-sections";
import { MODEL_TEXT_FORMAT, applyPatchOps, encodePointerKey as enc, isPlain as isRec, checkChange, modelTextContext, parseChangeValue, parseJsonText, type ChangeSet, type CheckedChange, type PatchOp, type Preview, type PreviewLine } from "@/lib/model-text";
import type { ProjectBundle } from "@/lib/file-io";

export const PLAIN_FORMAT = "cascade.model-change/v2";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/** The fields a change names, each resolved per Element (`resolvePaths`). */
const FIELD_NAMES = [
  "supply", "level", "throughput", "capacity", "demand", "priority", "backup_duration", "dependency_level",
  "importance", "functionality", "direct_damage", "expected_repair_time", "cost_of_disservice_per_day", "label",
  "vulnerability", "property",
] as const;
type FieldName = (typeof FIELD_NAMES)[number];

const VERBS = ["set", "scale", "increase", "cap", "floor"] as const;
type Verb = (typeof VERBS)[number];
const OP_OF: Record<Verb, AttributeOperation["op"]> = { set: "set", scale: "mul", increase: "add", cap: "at_most", floor: "at_least" };

const KINDS = ["node", "edge", "event", "category", "canvas", "simulation"] as const;
type Kind = (typeof KINDS)[number];

const Text = z.string().min(1).refine(isSafeKey, { message: "__proto__, constructor and prototype are not allowed" });
const Why = { why: z.string().optional() };
const Record_ = z.record(z.string(), z.unknown());

/** What a verb names: a field name, or a raw path. */
const FieldRef = z.union([z.enum(FIELD_NAMES), FieldPathSchema]).optional();

const ValueChangeSchema = z
  .object({
    set: FieldRef,
    scale: FieldRef,
    increase: FieldRef,
    cap: FieldRef,
    floor: FieldRef,
    to: z.union([z.number(), z.boolean(), z.string()]).optional(),
    by: z.number().optional(),
    id: Text.optional(),
    where: ElementFilterSchema.optional(),
    category: Text.optional(),
    event: Text.optional(),
    key: Text.optional(),
    skip_unfit: z.boolean().optional(),
    ...Why,
  })
  .strict()
  .superRefine((c, ctx) => {
    const verbs = VERBS.filter((v) => c[v] !== undefined);
    if (verbs.length !== 1) { ctx.addIssue({ code: "custom", message: `give exactly one of ${VERBS.join(", ")}` }); return; }
    const verb = verbs[0];
    if ((verb === "scale" || verb === "increase") && c.by === undefined) ctx.addIssue({ code: "custom", path: ["by"], message: `${verb} needs "by" (a number)` });
    if (verb !== "scale" && verb !== "increase" && c.to === undefined) ctx.addIssue({ code: "custom", path: ["to"], message: `${verb} needs "to"` });
    if ((verb === "cap" || verb === "floor") && typeof c.to !== "number") ctx.addIssue({ code: "custom", path: ["to"], message: `${verb} needs a number "to"` });
    if ((c.id === undefined) === (c.where === undefined)) ctx.addIssue({ code: "custom", message: 'give exactly one of "id" (an Element) or "where" (a filter)' });
    if (c[verb] === "vulnerability" && c.event === undefined) ctx.addIssue({ code: "custom", path: ["event"], message: 'vulnerability needs "event", the Event id' });
    if (c[verb] === "property" && c.key === undefined) ctx.addIssue({ code: "custom", path: ["key"], message: 'property needs "key"' });
  });
type ValueChange = z.infer<typeof ValueChangeSchema>;

/** The one verb a value change carries (the schema guarantees exactly one), and the field it names. */
function verbOf(c: ValueChange): { verb: Verb; field: FieldName | string[] } {
  const verb = VERBS.find((v) => c[v] !== undefined)!;
  return { verb, field: c[verb]! };
}

const AddSchema = z.object({ add: z.enum(KINDS), value: Record_, canvas: Text.optional(), ...Why }).strict();
const UpdateSchema = z.object({ update: z.enum(KINDS), id: Text, value: Record_, ...Why }).strict();
const DeleteSchema = z
  .object({ delete: z.enum(KINDS), id: Text.optional(), where: ElementFilterSchema.optional(), ...Why })
  .strict()
  .refine((c) => (c.id === undefined) !== (c.where === undefined), { message: 'give exactly one of "id" or "where"' })
  .refine((c) => c.where === undefined || c.delete === "node" || c.delete === "edge", { message: '"where" deletes nodes or edges only' });
const ConnectSchema = z
  .object({
    connect: z.object({ from: Text, to: Text, id: Text.optional(), capacity: z.number().min(0).optional(), functionality: z.number().int().min(1).optional() }).strict(),
    ...Why,
  })
  .strict();
const DisconnectSchema = z.object({ disconnect: z.object({ from: Text, to: Text }).strict(), ...Why }).strict();

type Change =
  | { type: "value"; c: ValueChange }
  | { type: "add"; c: z.infer<typeof AddSchema> }
  | { type: "update"; c: z.infer<typeof UpdateSchema> }
  | { type: "delete"; c: z.infer<typeof DeleteSchema> }
  | { type: "connect"; c: z.infer<typeof ConnectSchema> }
  | { type: "disconnect"; c: z.infer<typeof DisconnectSchema> };

const issues = (err: z.ZodError, at: string) => err.issues.map((i) => `${at}${i.path.length ? `.${i.path.join(".")}` : ""}: ${i.message}`);

/** One change, by the verb it carries, so a mistake is reported against the shape that was meant. */
function parseChange(raw: unknown, at: string): { change: Change } | { errors: string[] } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { errors: [`${at}: a change is an object, e.g. { "set": "importance", "to": 2, "id": "n1" }`] };
  const has = (k: string) => Object.hasOwn(raw, k);
  const pick = <T,>(schema: z.ZodType<T>, type: Change["type"]) => {
    const r = schema.safeParse(raw);
    return r.success ? { change: { type, c: r.data } as Change } : { errors: issues(r.error, at) };
  };
  if (has("add")) return pick(AddSchema, "add");
  if (has("update")) return pick(UpdateSchema, "update");
  if (has("delete")) return pick(DeleteSchema, "delete");
  if (has("connect")) return pick(ConnectSchema, "connect");
  if (has("disconnect")) return pick(DisconnectSchema, "disconnect");
  if (VERBS.some(has)) return pick(ValueChangeSchema, "value");
  return { errors: [`${at}: no verb — start a change with one of ${[...VERBS, "add", "update", "delete", "connect", "disconnect"].join(", ")}`] };
}

const PlainSetSchema = z.object({ format: z.literal(PLAIN_FORMAT), notes: z.string().optional(), changes: z.array(z.unknown()).min(1) }).strict();

export interface PlainSet {
  notes?: string;
  changes: Change[];
}

/** A parsed JSON value as plain changes, or every reason it is not. */
export function parsePlainValue(value: unknown): { ok: true; set: PlainSet } | { ok: false; errors: string[] } {
  const top = PlainSetSchema.safeParse(value);
  if (!top.success) return { ok: false, errors: issues(top.error, "(root)") };
  const errors: string[] = [];
  const changes: Change[] = [];
  top.data.changes.forEach((raw, i) => {
    const r = parseChange(raw, `changes[${i}]`);
    if ("errors" in r) errors.push(...r.errors);
    else changes.push(r.change);
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, set: { notes: top.data.notes, changes } };
}

// ---------------------------------------------------------------------------
// Field names → stored paths, per Element
// ---------------------------------------------------------------------------

type Rec = Record<string, unknown>;

const PROFILE_FIELDS = new Set<FieldName>(["demand", "priority", "backup_duration", "dependency_level"]);

/**
 * Where a field name lives on one Element: one path per Category it covers,
 * or why it does not fit this Element. A supply or capacity that is a Stock is
 * addressed by its `rate` (its supply per period); `level` only exists on a Stock.
 */
function resolvePaths(
  el: Rec,
  kind: "node" | "edge",
  field: FieldName | string[],
  opts: { category?: string; event?: string; key?: string },
): { paths: string[][] } | { unfit: string } {
  if (Array.isArray(field)) return { paths: [field] };
  const perCategory = (container: string, leaf: (v: unknown) => string[] | string): { paths: string[][] } | { unfit: string } => {
    const record = el[container];
    const cats = opts.category !== undefined ? [opts.category] : isRec(record) ? Object.keys(record) : [];
    if (!isRec(record) || cats.length === 0) return { unfit: `has no ${container}` };
    const paths: string[][] = [];
    for (const cat of cats) {
      if (!Object.hasOwn(record, cat)) return { unfit: `has no ${container} for ${cat}` };
      const tail = leaf(record[cat]);
      if (typeof tail === "string") return { unfit: tail };
      paths.push([container, cat, ...tail]);
    }
    return { paths };
  };
  const stockRate = (v: unknown) => (isRec(v) ? ["rate"] : []);
  switch (field) {
    case "supply":
      return kind === "node" ? perCategory("supply_capacity", stockRate) : { unfit: "an edge has capacity, not supply" };
    case "level":
      return kind === "node"
        ? perCategory("supply_capacity", (v) => (isRec(v) ? ["level"] : "its supply is a number, not a Stock (only a Stock has a level)"))
        : isRec(el.capacity) ? { paths: [["capacity", "level"]] } : { unfit: "its capacity is not a Stock" };
    case "throughput":
      return kind === "node" ? perCategory("throughput_capacity", () => []) : { unfit: "an edge has capacity, not throughput" };
    case "capacity":
      return kind === "edge" ? { paths: [isRec(el.capacity) ? ["capacity", "rate"] : ["capacity"]] } : { unfit: "a node has supply and throughput; capacity is an edge's" };
    case "vulnerability":
      return { paths: [["vulnerability_levels", opts.event ?? ""]] };
    case "property":
      return { paths: [["properties", opts.key ?? ""]] };
    default:
      if (PROFILE_FIELDS.has(field)) {
        return kind === "node" ? perCategory("category_dependency_profiles", () => [field]) : { unfit: `an edge has no ${field}` };
      }
      return { paths: [[field]] };
  }
}

// ---------------------------------------------------------------------------
// Compile
// ---------------------------------------------------------------------------

export interface ChangeGroup {
  /** The change in words: "scale supply × 0.5 — 2 nodes". */
  title: string;
  why?: string;
  /** What it touched (`node:p1`, `event:flood`): the preview lines it owns. */
  subjects: string[];
  skipped: { id: string; reason: string }[];
  /** The change's position in the reply; absent on the follow-on group. */
  index?: number;
  /** Left out by the person (partial apply): compiled as if absent. */
  left_out?: boolean;
}

export type Compiled = { ok: true; patch: PatchOp[]; groups: ChangeGroup[]; notes?: string } | { ok: false; errors: string[] };

/** Where each kind of thing lives, and how it is found by id. */
const LISTS: Record<Exclude<Kind, "node" | "edge">, { pointer: string; read: (b: ProjectBundle) => Rec[]; id: (x: Rec) => unknown; name?: (x: Rec) => unknown }> = {
  event: { pointer: "/config/events", read: (b) => b.config.events as unknown as Rec[], id: (x) => x.id },
  category: { pointer: "/config/categories", read: (b) => b.config.categories as unknown as Rec[], id: (x) => x.name },
  canvas: { pointer: "/project/canvases", read: (b) => b.project.canvases as unknown as Rec[], id: (x) => x.id, name: (x) => x.label },
  simulation: { pointer: "/project/temporal_simulations", read: (b) => (b.project.temporal_simulations ?? []) as unknown as Rec[], id: (x) => x.id, name: (x) => (x.timeline as Rec | undefined)?.name },
};

/** A listed thing's position, by its id or (Canvases, Simulations) its name; -1 when absent. */
const findIn = (b: ProjectBundle, kind: Exclude<Kind, "node" | "edge">, ref: string) => {
  const list = LISTS[kind];
  const items = list.read(b);
  const byId = items.findIndex((x) => list.id(x) === ref);
  return byId >= 0 ? byId : items.findIndex((x) => list.name?.(x) === ref);
};

/** JSON Merge Patch (RFC 7386): objects merge, `null` removes a key, anything else replaces. */
function mergePatch(target: unknown, patch: unknown): unknown {
  if (!isRec(patch)) return patch;
  const out: Rec = isRec(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = mergePatch(out[k], v);
  }
  return out;
}

const describe = (verb: Verb, field: FieldName | string[], c: ValueChange) => {
  const name = Array.isArray(field) ? field.join(" › ") : field === "vulnerability" ? `vulnerability to ${c.event}` : field === "property" ? `property ${c.key}` : field;
  const amount = verb === "scale" ? `× ${c.by}` : verb === "increase" ? `+ ${c.by}` : verb === "cap" ? `at most ${String(c.to)}` : verb === "floor" ? `at least ${String(c.to)}` : `→ ${JSON.stringify(c.to)}`;
  return `${verb} ${name}${c.category ? ` (${c.category})` : ""} ${amount}`;
};

/** A change in a few words, before it is compiled: what a left-out change is listed as. */
function headline(change: Change): string {
  switch (change.type) {
    case "value": {
      const { verb, field } = verbOf(change.c);
      return describe(verb, field, change.c);
    }
    case "add": return `add ${change.c.add} ${JSON.stringify(change.c.value[change.c.add === "category" ? "name" : "id"] ?? "")}`;
    case "update": return `update ${change.c.update} "${change.c.id}"`;
    case "delete": return `delete ${change.c.delete} ${change.c.id !== undefined ? `"${change.c.id}"` : "by filter"}`;
    case "connect": return `connect ${change.c.connect.from} → ${change.c.connect.to}`;
    case "disconnect": return `disconnect ${change.c.disconnect.from} → ${change.c.disconnect.to}`;
  }
}

/** Columns of the grid a node added without a position is placed on, and its spacing. */
const GRID = { columns: 6, dx: 200, dy: 140, gap: 160 };

/**
 * Plain changes as the patch they amount to, applied in order on a copy so
 * each change sees the ones before it. Errors name the change and the Element.
 * Changes whose index is in `leaveOut` are skipped where they stand (partial
 * apply), so error indices stay the reply's.
 */
export function compilePlain(bundle: ProjectBundle, set: PlainSet, leaveOut?: ReadonlySet<number>): Compiled {
  const draft = structuredClone({ project: bundle.project, config: bundle.config }) as ProjectBundle;
  const root = draft as unknown as Rec;
  const n = draft.config.functionality_scale.length;
  const patch: PatchOp[] = [];
  const groups: ChangeGroup[] = [];
  const errors: string[] = [];

  /** Apply ops to the draft and keep them; their failures are this change's errors. */
  const emit = (at: string, ops: PatchOp[]) => {
    const failed = applyPatchOps(root, ops);
    errors.push(...failed.map((e) => `${at}: ${e}`));
    patch.push(...ops);
  };
  // Nodes added without a position go on a grid below their Canvas's nodes.
  const grid = new Map<number, { x: number; y: number; k: number }>();
  const nextPosition = (ci: number) => {
    let g = grid.get(ci);
    if (!g) {
      const placed = draft.project.canvases[ci].graph.node_ids.flatMap((id) => draft.project.nodes[id]?.position ?? []);
      g = placed.length
        ? { x: Math.min(...placed.map((p) => p.x)), y: Math.max(...placed.map((p) => p.y)) + GRID.gap, k: 0 }
        : { x: 0, y: 0, k: 0 };
      grid.set(ci, g);
    }
    const position = { x: g.x + (g.k % GRID.columns) * GRID.dx, y: g.y + Math.floor(g.k / GRID.columns) * GRID.dy };
    g.k++;
    return position;
  };
  const targetsOf = (selector: { element?: string; where?: ValueChange["where"] }) =>
    operationTargets(selector, { nodes: draft.project.nodes, edges: draft.project.edges, canvases: canvasesById(draft.project.canvases) });
  /** Add an edge on the Canvases holding both its ends, or else its source's. */
  const addEdge = (at: string, record: Rec & { id: string; source?: string; target?: string }, group: ChangeGroup) => {
    const has = (k: number, id: string | undefined) => id !== undefined && draft.project.canvases[k].graph.node_ids.includes(id);
    const all = draft.project.canvases.map((_, k) => k);
    const both = all.filter((k) => has(k, record.source) && has(k, record.target));
    const where = both.length > 0 ? both : all.filter((k) => has(k, record.source));
    emit(at, [
      { op: "add", path: `/project/edges/${enc(record.id)}`, value: record },
      ...where.map((k): PatchOp => ({ op: "replace", path: `/project/canvases/${k}/graph/edge_ids`, value: [...draft.project.canvases[k].graph.edge_ids, record.id] })),
    ]);
    group.subjects.push(`edge:${record.id}`, ...where.map((k) => `canvas:${draft.project.canvases[k].id}`));
  };
  const canvasIndex = (ref: string | undefined): number | string => {
    const list = draft.project.canvases;
    if (ref === undefined) return list.length === 1 ? 0 : `say which Canvas with "canvas" (one of: ${list.map((c) => c.label ?? c.id).join(", ")})`;
    const i = list.findIndex((c) => c.id === ref || c.label === ref);
    return i >= 0 ? i : `no Canvas "${ref}"`;
  };
  const removeElements = (registry: "nodes" | "edges", ids: string[]): { ops: PatchOp[]; subjects: string[] } => {
    const ops: PatchOp[] = ids.map((id) => ({ op: "remove", path: `/project/${registry}/${enc(id)}` }));
    const follow = registryFollowUps(draft, registry, ids, [], {}, undefined);
    const subjects = [
      ...ids.map((id) => `${registry === "nodes" ? "node" : "edge"}:${id}`),
      ...follow.flatMap((op) => {
        const edge = /^\/project\/edges\/(.+)$/.exec(op.path);
        if (edge) return [`edge:${edge[1]}`];
        const canvas = /^\/project\/canvases\/(\d+)\//.exec(op.path);
        return canvas ? [`canvas:${draft.project.canvases[Number(canvas[1])]?.id}`] : [];
      }),
    ];
    return { ops: [...ops, ...follow], subjects };
  };

  set.changes.forEach((change, i) => {
    const at = `changes[${i}]`;
    const before = errors.length;
    const group: ChangeGroup = { title: "", why: change.c.why, subjects: [], skipped: [], index: i };
    if (leaveOut?.has(i)) {
      groups.push({ ...group, title: headline(change), left_out: true });
      return;
    }

    if (change.type === "value") {
      const c = change.c;
      const { verb, field } = verbOf(c);
      const op = OP_OF[verb];
      const value = (verb === "scale" || verb === "increase" ? c.by : c.to)!;
      const targets = targetsOf({ element: c.id, where: c.where });
      if (targets.length === 0) errors.push(`${at}: ${c.id !== undefined ? `no Element "${c.id}"` : "the filter matches no Element"}`);
      let changed = 0;
      for (const id of targets) {
        const kind = id in draft.project.nodes ? "node" : "edge";
        const registry = (kind === "node" ? draft.project.nodes : draft.project.edges) as unknown as Record<string, Rec>;
        let el = registry[id];
        const resolved = resolvePaths(el, kind, field, c);
        let unfit = "unfit" in resolved ? resolved.unfit : undefined;
        if (!unfit && "paths" in resolved) {
          for (const path of resolved.paths) {
            const r = applyOperationTo(el, kind, { element: id, path, op, value }, n);
            if ("error" in r) { unfit = r.error; break; }
            el = r.element;
          }
        }
        if (unfit) {
          if (c.skip_unfit) group.skipped.push({ id, reason: unfit });
          else errors.push(`${at} on ${id}: ${unfit}${targets.length > 1 ? ' (add "skip_unfit": true to leave such Elements out)' : ""}`);
          continue;
        }
        if (!deepEqual(el, registry[id])) {
          emit(at, [{ op: "replace", path: `/project/${kind}s/${enc(id)}`, value: el }]);
          group.subjects.push(`${kind}:${id}`);
          changed++;
        }
      }
      group.title = `${describe(verb, field, c)} — ${changed} changed${group.skipped.length ? `, ${group.skipped.length} skipped` : ""} of ${targets.length} matched`;
    } else if (change.type === "add") {
      const { add: kind, value } = change.c;
      const id = kind === "category" ? value.name : value.id;
      if (typeof id !== "string" || !id) errors.push(`${at}: a new ${kind} needs ${kind === "category" ? '"name"' : '"id"'}`);
      else if (kind === "node" || kind === "edge") {
        const registry = kind === "node" ? draft.project.nodes : draft.project.edges;
        if (id in registry) errors.push(`${at}: ${kind} "${id}" already exists; use "update"`);
        else {
          const record: Rec & { id: string } = { functionality: n, ...value, id };
          if (kind === "edge") addEdge(at, record, group);
          else {
            const ci = canvasIndex(change.c.canvas);
            if (typeof ci === "string") errors.push(`${at}: ${ci}`);
            else {
              const node = { ...record, position: record.position ?? nextPosition(ci) };
              emit(at, [
                { op: "add", path: `/project/nodes/${enc(id)}`, value: node },
                { op: "replace", path: `/project/canvases/${ci}/graph/node_ids`, value: [...draft.project.canvases[ci].graph.node_ids, id] },
              ]);
              group.subjects.push(`node:${id}`, `canvas:${draft.project.canvases[ci].id}`);
            }
          }
        }
      } else {
        const list = LISTS[kind];
        if (list.read(draft).some((x) => list.id(x) === id)) errors.push(`${at}: ${kind} "${id}" already exists; use "update"`);
        else {
          const record = kind === "canvas" ? { graph: { graph_type: "generic", node_ids: [], edge_ids: [] }, ...value } : value;
          if (kind === "simulation" && draft.project.temporal_simulations === undefined) emit(at, [{ op: "add", path: "/project/temporal_simulations", value: [] }]);
          emit(at, [{ op: "add", path: `${list.pointer}/-`, value: record }]);
          group.subjects.push(`${kind}:${id}`);
        }
      }
      group.title = `add ${kind} ${typeof id === "string" ? `"${id}"` : ""}`;
    } else if (change.type === "update") {
      const { update: kind, id, value } = change.c;
      let pointer: string | undefined;
      let current: unknown;
      if (kind === "node" || kind === "edge") {
        current = (kind === "node" ? draft.project.nodes : draft.project.edges)[id];
        pointer = `/project/${kind}s/${enc(id)}`;
      } else {
        const k = findIn(draft, kind, id);
        if (k >= 0) { current = LISTS[kind].read(draft)[k]; pointer = `${LISTS[kind].pointer}/${k}`; }
      }
      if (current === undefined || pointer === undefined) errors.push(`${at}: no ${kind} "${id}"`);
      else {
        const merged = mergePatch(current, value) as Rec;
        const idKey = kind === "category" ? "name" : "id";
        if (merged[idKey] !== (current as Rec)[idKey]) errors.push(`${at}: the ${idKey} of a ${kind} cannot change; add a new one and delete this one`);
        else {
          emit(at, [{ op: "replace", path: pointer, value: merged }]);
          group.subjects.push(`${kind}:${(current as Rec)[idKey] as string}`);
        }
      }
      group.title = `update ${kind} "${id}"`;
    } else if (change.type === "delete") {
      const { delete: kind, id, where } = change.c;
      if (kind === "node" || kind === "edge") {
        const registry = kind === "node" ? draft.project.nodes : draft.project.edges;
        const ids = id !== undefined ? (id in registry ? [id] : []) : targetsOf({ where: { ...where!, kind } });
        if (ids.length === 0) errors.push(`${at}: ${id !== undefined ? `no ${kind} "${id}"` : `the filter matches no ${kind}`}`);
        else {
          const removal = removeElements(kind === "node" ? "nodes" : "edges", ids);
          emit(at, removal.ops);
          group.subjects.push(...removal.subjects);
        }
        group.title = `delete ${ids.length} ${kind}${ids.length === 1 ? "" : "s"}${id !== undefined ? ` "${id}"` : ""}`;
      } else {
        const list = LISTS[kind];
        const k = findIn(draft, kind, id!);
        if (k < 0) errors.push(`${at}: no ${kind} "${id}"`);
        else {
          const realId = String(list.id(list.read(draft)[k]));
          // An Event's vulnerability levels on Elements go with it.
          const follow = kind === "event" ? eventFollowUps(draft, [realId]) : [];
          emit(at, [{ op: "remove", path: `${list.pointer}/${k}` }, ...follow]);
          group.subjects.push(...follow.map((op) => op.path.startsWith("/project/nodes/") ? `node:${op.path.split("/")[3]}` : `edge:${op.path.split("/")[3]}`));
          group.subjects.push(`${kind}:${realId}`);
        }
        group.title = `delete ${kind} "${id}"`;
      }
    } else if (change.type === "connect") {
      const { from, to, id, capacity, functionality } = change.c.connect;
      for (const end of [from, to]) if (!(end in draft.project.nodes)) errors.push(`${at}: no node "${end}"`);
      let edgeId = id ?? `edge-${from}-${to}`;
      for (let k = 2; !id && edgeId in draft.project.edges; k++) edgeId = `edge-${from}-${to}-${k}`;
      if (id && id in draft.project.edges) errors.push(`${at}: edge "${id}" already exists`);
      if (errors.length === before) {
        addEdge(at, { id: edgeId, source: from, target: to, functionality: functionality ?? n, ...(capacity !== undefined ? { capacity } : {}) }, group);
      }
      group.title = `connect ${from} → ${to}`;
    } else {
      const { from, to } = change.c.disconnect;
      const ids = Object.values(draft.project.edges).filter((e) => e.source === from && e.target === to).map((e) => e.id);
      if (ids.length === 0) errors.push(`${at}: no edge from "${from}" to "${to}"`);
      else {
        const removal = removeElements("edges", ids);
        emit(at, removal.ops);
        group.subjects.push(...removal.subjects);
      }
      group.title = `disconnect ${from} → ${to}`;
    }
    groups.push(group);
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, patch, groups, notes: set.notes };
}

/** The change set the check reads: the compiled patch, no element operations. */
export const asChangeSet = (patch: PatchOp[]): ChangeSet => ({ format: MODEL_TEXT_FORMAT, patch, elements: [] });

// ---------------------------------------------------------------------------
// Preview by change
// ---------------------------------------------------------------------------

export interface PreviewGroup extends ChangeGroup {
  lines: PreviewLine[];
}

/** The preview's lines under the change that made them; lines no change claims go last, as follow-on. */
export function groupPreview(preview: Preview, groups: readonly ChangeGroup[]): PreviewGroup[] {
  const owner = new Map<string, number>();
  groups.forEach((g, i) => g.subjects.forEach((s) => { if (!owner.has(s)) owner.set(s, i); }));
  const out: PreviewGroup[] = groups.map((g) => ({ ...g, lines: [] }));
  const rest: PreviewLine[] = [];
  for (const line of preview.lines) {
    const i = line.subject !== undefined ? owner.get(line.subject) : undefined;
    if (i === undefined) rest.push(line);
    else out[i].lines.push(line);
  }
  if (rest.length > 0) out.push({ title: "Follow-on changes", subjects: [], skipped: [], lines: rest });
  return out;
}

// ---------------------------------------------------------------------------
// What an LLM needs: the format, a census of the fields, a worked example
// ---------------------------------------------------------------------------

export const PLAIN_REFERENCE = `Format "${PLAIN_FORMAT}" — JSON, strict (unknown keys are errors). Changes apply in order.

{
  "format": "${PLAIN_FORMAT}",
  "notes": "one line: what this does and why (shown to the person)",
  "changes": [ …one object per change, each may carry "why": "…" ]
}

Change a value on Elements — a verb naming a field, then "to" or "by", then "id" (one Element) or "where" (a filter):
  { "set": FIELD, "to": value }        write it
  { "scale": FIELD, "by": 0.5 }        multiply        { "increase": FIELD, "by": -2 }   add
  { "cap": FIELD, "to": 10 }           at most          { "floor": FIELD, "to": 1 }      at least
  FIELD: ${FIELD_NAMES.map((f) => `"${f}"`).join(", ")}, or a raw path ["properties", "x"].
    supply / throughput / demand / priority / backup_duration / dependency_level are per Category: add
    "category": "water" for one, or leave it out for every Category the Element has. A supply or capacity
    that is a Stock is changed through its "rate" (per period) automatically; "level" is a Stock's content.
    vulnerability needs "event": "<event id>" (levels lost when it strikes); property needs "key".
  "where": { "kind": "node"|"edge", "node_type", "category", "canvas", "label_contains", "exclude": [ids] }
  A change that matches an Element it cannot apply to (no such field, a number where a Stock is expected)
  refuses the whole set and names it; add "skip_unfit": true to leave such Elements out instead.

Add, update, delete things by id (never by position):
  { "add": "node"|"edge"|"event"|"category"|"canvas"|"simulation", "value": { …the whole thing… } }
      a node also takes "canvas": "<id or label>" (needed when there are several); functionality defaults to N;
      without "position" it is placed on a grid below its Canvas's nodes
  { "update": KIND, "id": "<id>", "value": { …only the fields to change… } }   null removes a field
  { "delete": KIND, "id": "<id>" }   or for nodes/edges { "delete": "node", "where": { … } }
      deleting a node takes its edges and its Canvas places along, an edge its Canvas places, an Event its
      vulnerability levels: never edit those yourself
  { "connect": { "from": "<node>", "to": "<node>", "capacity": 4 } }      a new edge, on the Canvases of its ends
  { "disconnect": { "from": "<node>", "to": "<node>" } }
  (A category's id is its "name"; a simulation's or canvas's id may also be given as its name/label.)

Nothing changes until the person reads the preview and confirms; a version of the project is kept first.`;

/** Numbers as a range; Stocks by their rate. */
function summarize(values: unknown[]): string {
  const nums = values.filter((v): v is number => typeof v === "number");
  const stocks = values.filter(isRec);
  const fmt = (xs: number[]) => (xs.length ? (Math.min(...xs) === Math.max(...xs) ? `${xs[0]}` : `${Math.min(...xs)}–${Math.max(...xs)}`) : "");
  const parts = [
    nums.length && `number ×${nums.length} (${fmt(nums)})`,
    stocks.length && `Stock ×${stocks.length} (rate ${fmt(stocks.map((s) => s.rate).filter((r): r is number => typeof r === "number"))})`,
    values.length - nums.length - stocks.length > 0 && `other ×${values.length - nums.length - stocks.length}`,
  ].filter(Boolean);
  return parts.join(", ");
}

/** Append `value` to the list at `key`, creating it. */
function pushTo<T>(map: Map<string, T[]>, key: string, value: T) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * Which fields each kind of Element has, with their shapes and ranges, and
 * the values a filter can use: what a change can rely on, without the model.
 */
export function fieldCensus(bundle: ProjectBundle): string {
  const { project, config } = bundle;
  const byType = new Map<string, Rec[]>();
  for (const nd of Object.values(project.nodes)) pushTo(byType, nd.node_type ?? "(no type)", nd as unknown as Rec);
  const lines: string[] = [byType.size
    ? "## Field census (what each kind of Element has: shape and range)"
    : "## Field census\nThe model has no Elements yet: everything you add is new."];
  for (const [type, nodes] of byType) {
    const fields = new Map<string, unknown[]>();
    const note = (name: string, v: unknown) => pushTo(fields, name, v);
    for (const nd of nodes) {
      for (const [container, name] of [["supply_capacity", "supply"], ["throughput_capacity", "throughput"]] as const) {
        if (isRec(nd[container])) for (const [cat, v] of Object.entries(nd[container] as Rec)) note(`${name}.${cat}`, v);
      }
      if (isRec(nd.category_dependency_profiles)) {
        for (const [cat, prof] of Object.entries(nd.category_dependency_profiles as Rec)) {
          for (const f of ["demand", "priority"]) { const v = isRec(prof) ? prof[f] : undefined; if (v !== undefined) note(`${f}.${cat}`, v); }
        }
      }
      if (nd.importance !== undefined) note("importance", nd.importance);
      if (isRec(nd.vulnerability_levels)) for (const [ev, v] of Object.entries(nd.vulnerability_levels as Rec)) note(`vulnerability.${ev}`, v);
    }
    const summary = [...fields].map(([name, vs]) => `  - ${name}: ${summarize(vs)}${vs.length < nodes.length ? `; absent on ${nodes.length - vs.length}` : ""}`);
    lines.push(`- ${type} (${nodes.length} nodes)${summary.length ? `\n${summary.join("\n")}` : ": no supply, demand or importance"}`);
  }
  const edges = Object.values(project.edges);
  if (edges.length) lines.push(`- edges (${edges.length}): capacity ${summarize(edges.filter((e) => e.capacity !== undefined).map((e) => e.capacity)) || "none set"}`);
  const labels = Object.values(project.nodes).map((nd) => nd.label).filter((l): l is string => !!l);
  lines.push(
    "## Values a filter can use",
    `- node_type: ${[...byType.keys()].join(", ")}`,
    `- category: ${config.categories.map((c) => c.name).join(", ")}`,
    `- canvas: ${project.canvases.map((c) => c.label ?? c.id).join(", ")}`,
    `- labels (sample): ${labels.slice(0, 30).join(", ")}${labels.length > 30 ? ", …" : ""}`,
  );
  return lines.join("\n");
}

/** A worked example on this model's own ids: what the empty box shows. Valid, and changes nothing until applied. */
export function starterPlain(bundle: ProjectBundle): string {
  const nodes = Object.values(bundle.project.nodes);
  const source = nodes.find((nd) => isRec(nd.supply_capacity));
  const service = nodes.find((nd) => nd.node_type === "Service") ?? nodes[0];
  const event = bundle.config.events.find((e) => e.type !== "restorative");
  const changes: Rec[] = [];
  if (source?.node_type) changes.push({ scale: "supply", by: 0.9, where: { kind: "node", node_type: source.node_type }, why: `Example: every ${source.node_type} node supplies 10% less` });
  if (service) changes.push({ set: "importance", to: 2, id: service.id, why: `Example: ${service.label ?? service.id} matters twice as much` });
  if (event && service) changes.push({ set: "vulnerability", event: event.id, to: 1, id: service.id, skip_unfit: true, why: `Example: ${event.label} costs it one level` });
  if (changes.length === 0) changes.push({ add: "event", value: { id: "evt-example", label: "Example hazard", type: "hazard", frequency_per_10y: 1 } });
  return JSON.stringify({ format: PLAIN_FORMAT, notes: "An example on this model: edit it, or replace it with an LLM's reply.", changes }, null, 2);
}

/** Ids of Elements an error message names, as the model knows them: the words of the errors, looked up once. */
function namedElements(bundle: ProjectBundle, errors: readonly string[]): string[] {
  const words = new Set(errors.join("\n").split(/[\s"():,]+/));
  const ids = [...Object.keys(bundle.project.nodes), ...Object.keys(bundle.project.edges)];
  return ids.filter((id) => words.has(id)).slice(0, 10);
}

/**
 * For the LLM that wrote a refused change set: what was wrong, the change set,
 * and the stored JSON of every Element the errors name, to fix it in one go.
 */
export function repairContext(bundle: ProjectBundle, text: string, errors: readonly string[], section?: string): string {
  const named = namedElements(bundle, errors);
  const record = (id: string) => bundle.project.nodes[id] ?? bundle.project.edges[id];
  const what = section ? `the "${section}" section` : "the change set";
  // The JSON alone: a whole reply carries its own fences and prose.
  const json = parseJsonText(text);
  const shown = json.ok ? JSON.stringify(json.value, null, 2) : text;
  return [
    `The CASCADE app refused ${what} you wrote. Fix it and reply with the WHOLE corrected ${section ? "section" : "change set"} in ONE \`\`\`json block. Keep everything that was right.`,
    `## What the app found\n${errors.map((e) => `- ${e}`).join("\n")}`,
    `## ${section ? `The section: ${section}` : "The change set"}\n\`\`\`json\n${shown}\n\`\`\``,
    ...(named.length ? [`## The Elements named above, as stored\n\`\`\`json\n${JSON.stringify(Object.fromEntries(named.map((id) => [id, record(id)])), null, 1)}\n\`\`\``] : []),
    ...(section ? [] : [`## The format\n${PLAIN_REFERENCE}`]),
  ].join("\n\n");
}

// ---------------------------------------------------------------------------
// The Bulk operations box
// ---------------------------------------------------------------------------

/** What the LLM is given for Bulk operations: plain changes, the field census, the model. */
export const bulkContext = (bundle: ProjectBundle, focus?: string): string =>
  modelTextContext(bundle, undefined, { reference: PLAIN_REFERENCE, extra: [fieldCensus(bundle), ...(focus ? [focus] : [])].join("\n\n") });

export type BulkResult = { checked: CheckedChange; groups?: PreviewGroup[]; notes?: string };

/**
 * The Bulk operations text checked against `bundle`: plain changes (v2),
 * grouped by change, or a change set written in the original form (v1).
 */
export function checkBulkText(bundle: ProjectBundle, text: string, leaveOut?: ReadonlySet<number>): BulkResult {
  const json = parseJsonText(text);
  if (!json.ok) return { checked: json };
  const format = typeof json.value === "object" && json.value !== null ? (json.value as Rec).format : undefined;
  if (format !== PLAIN_FORMAT) {
    const v1 = parseChangeValue(json.value);
    return { checked: v1.ok ? checkChange(bundle, v1.change) : v1 };
  }
  const parsed = parsePlainValue(json.value);
  if (!parsed.ok) return { checked: parsed };
  const compiled = compilePlain(bundle, parsed.set, leaveOut);
  if (!compiled.ok) return { checked: compiled };
  const checked = checkChange(bundle, asChangeSet(compiled.patch));
  return { checked, groups: checked.ok ? groupPreview(checked.preview, compiled.groups) : undefined, notes: compiled.notes };
}
