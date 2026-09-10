/**
 * graph-diff.ts — what one Any Graph Update changed, field by field (ADR-0017).
 *
 * Replaces the pair of whole GraphSnapshots every history entry used to carry,
 * which measured 97.6% of a project file and 40× the model it described.
 *
 * THE ONE INVARIANT: this module never names a field. It enumerates the keys
 * actually present on each record. Since ADR-0015 a Rule may assign any
 * attribute, including a custom `properties` key, and the moment a differ knows
 * field names the next new attribute silently stops being undoable — nothing
 * throws, undo just leaves a value behind. Whole snapshots had this property for
 * free and it is the one virtue of theirs worth preserving.
 *
 * `properties` is the single exception, and it is a shape rule rather than a
 * field rule: it is diffed one level deep because `ElementUpdate.properties` is
 * MERGED onto an Element (`lib/element-update.ts`), so a Rule adding one key to
 * a 20-key object would otherwise store that whole object on both sides. Every
 * other compound field is replaced wholesale by whoever writes it, so storing it
 * whole is both exact and cheaper.
 *
 * Diffs carry BOTH directions, so undo applies one backwards and redo applies
 * the same one forwards, against the live graph. There is no chain to replay
 * from a base snapshot, and so no checkpointing question.
 */

import { DIFF_ABSENT } from "@/lib/schemas/network";
import type {
  Canvas,
  Edge,
  FieldChange,
  GraphDiff,
  GraphSnapshot,
  Node,
  RecordDiff,
} from "@/lib/schemas/network";

/** Anything the differ can walk: an Element or a Canvas. */
type Record_ = Record<string, unknown>;

/**
 * Erase a registry's static element type so it can be walked generically.
 *
 * The differ deliberately knows no field names (see the module docstring), so
 * every registry it touches has to lose `Node`/`Edge`/`Canvas` at the door. One
 * named helper rather than the same double cast written out at a dozen sites.
 */
function asRecords<T>(registry: Readonly<Record<string, T>>): Readonly<Record<string, Record_>> {
  return registry as unknown as Readonly<Record<string, Record_>>;
}

// ---------------------------------------------------------------------------
// Equality
// ---------------------------------------------------------------------------

/**
 * Structural equality, used to decide whether a field changed at all.
 *
 * Object key ORDER is deliberately ignored: immer and the spread copies all over
 * the stores reorder keys freely, and a differ that treated that as a change
 * would record an entry for every no-op write — exactly the 99 KB-for-nothing
 * entry ADR-0017 measured in the shipped sample.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    // NaN is not === itself; treat two NaNs as unchanged rather than as an
    // edit that can never be undone.
    return Number.isNaN(a) && Number.isNaN(b);
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const ao = a as Record_;
  const bo = b as Record_;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) {
    if (!deepEqual(ao[k], bo[k])) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Diffing
// ---------------------------------------------------------------------------

function diffFields(before: Record_, after: Record_): FieldChange[] {
  const changes: FieldChange[] = [];
  const fields = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const field of fields) {
    const b = before[field];
    const a = after[field];

    if (field === "properties" && isPlainObject(b) && isPlainObject(a)) {
      for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) {
        const bk = key in b ? b[key] : DIFF_ABSENT;
        const ak = key in a ? a[key] : DIFF_ABSENT;
        if (!deepEqual(bk, ak)) changes.push({ field, key, before: bk, after: ak });
      }
      continue;
    }

    const bv = field in before ? b : DIFF_ABSENT;
    const av = field in after ? a : DIFF_ABSENT;
    if (!deepEqual(bv, av)) changes.push({ field, before: bv, after: av });
  }
  return changes;
}

function isPlainObject(v: unknown): v is Record_ {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function diffRegistry(
  before: Readonly<Record<string, Record_>>,
  after: Readonly<Record<string, Record_>>,
): RecordDiff[] {
  const out: RecordDiff[] = [];
  for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const b = before[id];
    const a = after[id];
    if (b === undefined && a !== undefined) {
      out.push({ id, op: "add", fields: [], record: a });
    } else if (b !== undefined && a === undefined) {
      out.push({ id, op: "remove", fields: [], record: b });
    } else if (b !== undefined && a !== undefined) {
      // Reference equality is the fast path that matters: applyEventToSnapshot
      // and mergeUpdatesIntoSnapshot are copy-on-write per Element, so an
      // untouched Element is the SAME object and needs no walk at all.
      if (b === a) continue;
      const fields = diffFields(b, a);
      if (fields.length > 0) out.push({ id, op: "update", fields });
    }
  }
  return out;
}

function byId(canvases: readonly Canvas[]): Record<string, Record_> {
  return asRecords(Object.fromEntries(canvases.map((c) => [c.id, c]))) as Record<string, Record_>;
}

/** Everything that changed between two Scenarios, in both directions. */
export function diffGraph(before: GraphSnapshot, after: GraphSnapshot): GraphDiff {
  const beforeOrder = before.canvases.map((c) => c.id);
  const afterOrder = after.canvases.map((c) => c.id);
  const orderChanged = !deepEqual(beforeOrder, afterOrder);

  return {
    nodes: diffRegistry(asRecords(before.nodes), asRecords(after.nodes)),
    edges: diffRegistry(asRecords(before.edges), asRecords(after.edges)),
    canvases: diffRegistry(byId(before.canvases), byId(after.canvases)),
    ...(orderChanged ? { canvas_order: afterOrder, canvas_order_before: beforeOrder } : {}),
  };
}

/** True when the update changed nothing an undo could restore. */
export function isEmptyDiff(diff: GraphDiff): boolean {
  return (
    diff.nodes.length === 0 &&
    diff.edges.length === 0 &&
    diff.canvases.length === 0 &&
    diff.canvas_order === undefined
  );
}

/** Serialised size in bytes — the unit ADR-0017's history byte budget counts in. */
export function diffByteSize(diff: GraphDiff): number {
  return JSON.stringify(diff).length;
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

export type DiffDirection = "forward" | "backward";

/**
 * Write one field's value onto a record, IN PLACE.
 *
 * The single home for the DIFF_ABSENT rule and the `properties` sub-key rule,
 * shared by diff application here and by Scenario Baseline reversal
 * (`lib/scenario-baseline.ts`). Both undo the same kinds of write, so a change
 * to "delete versus set" semantics has to land in one place or the two drift.
 *
 * `key` addresses a sub-key of `field` (only `properties` is diffed that deep).
 * DIFF_ABSENT deletes rather than writing `null`, which an
 * optional-but-not-nullable Zod/Pydantic field would reject.
 */
export function writeFieldValue(
  record: Record_,
  field: string,
  key: string | undefined,
  value: unknown,
): void {
  if (key !== undefined) {
    const props = isPlainObject(record[field]) ? { ...(record[field] as Record_) } : {};
    if (value === DIFF_ABSENT) delete props[key];
    else props[key] = value;
    // A record whose last property was removed keeps `properties: {}` rather
    // than losing the key: `{}` and absent are indistinguishable to every
    // consumer, and dropping it would need a second sentinel to undo.
    record[field] = props;
    return;
  }
  if (value === DIFF_ABSENT) delete record[field];
  else record[field] = value;
}

function applyFields(record: Record_, fields: readonly FieldChange[], dir: DiffDirection): Record_ {
  const out: Record_ = { ...record };
  for (const change of fields) {
    writeFieldValue(out, change.field, change.key, dir === "forward" ? change.after : change.before);
  }
  return out;
}

function applyToRegistry(
  registry: Readonly<Record<string, Record_>>,
  diffs: readonly RecordDiff[],
  dir: DiffDirection,
): Record<string, Record_> {
  if (diffs.length === 0) return registry as Record<string, Record_>;
  const out = { ...registry };
  for (const d of diffs) {
    // "add" means the record exists on the `after` side, so applying forwards
    // inserts it and backwards deletes it. "remove" is the mirror.
    const existsAfter = d.op === "add";
    const inserts = d.op !== "update" && existsAfter === (dir === "forward");
    const deletes = d.op !== "update" && !inserts;

    if (inserts) {
      if (d.record) out[d.id] = d.record as Record_;
    } else if (deletes) {
      delete out[d.id];
    } else {
      const existing = out[d.id];
      // A record the diff describes but the graph no longer has is skipped, not
      // resurrected — the same tolerance `reverseMutations` already has, so a
      // diff survives an Element being deleted after it was recorded.
      if (existing) out[d.id] = applyFields(existing, d.fields, dir);
    }
  }
  return out;
}

/**
 * Apply a Graph Diff to a Scenario. Pure.
 *
 * `backward` is undo, `forward` is redo. Untouched records keep their identity,
 * matching `applyEventToSnapshot` and `mergeUpdatesIntoSnapshot` — consumers
 * diff by reference to count affected Elements.
 */
export function applyGraphDiff(
  snapshot: GraphSnapshot,
  diff: GraphDiff,
  dir: DiffDirection,
): GraphSnapshot {
  if (isEmptyDiff(diff)) return snapshot;

  const nodes = applyToRegistry(asRecords(snapshot.nodes), diff.nodes, dir) as unknown as Record<string, Node>;
  const edges = applyToRegistry(asRecords(snapshot.edges), diff.edges, dir) as unknown as Record<string, Edge>;

  const canvasMap = applyToRegistry(byId(snapshot.canvases), diff.canvases, dir);
  const targetOrder = dir === "forward" ? diff.canvas_order : diff.canvas_order_before;
  const order =
    targetOrder ??
    // No recorded order change: keep the Scenario's own order, and append any
    // Canvas the diff added (it has no place in the old sequence).
    snapshot.canvases.map((c) => c.id).filter((id) => id in canvasMap);
  const seen = new Set(order);
  const canvases = [
    ...order.flatMap((id) => (canvasMap[id] ? [canvasMap[id] as unknown as Canvas] : [])),
    ...Object.keys(canvasMap)
      .filter((id) => !seen.has(id))
      .map((id) => canvasMap[id] as unknown as Canvas),
  ];

  return { ...snapshot, nodes, edges, canvases };
}

// ---------------------------------------------------------------------------
// Materialising a past Scenario
// ---------------------------------------------------------------------------

/**
 * Rebuild the Scenario as it was BEFORE `entries` were applied, by walking the
 * live graph backwards through them.
 *
 * `entries` must be newest-first, exactly as `update_history` is stored. This is
 * what the Save-to-Scorecard dialog and the unsaved-run scan use in place of the
 * whole snapshot they used to read off the entry: bounded by HISTORY_LIMIT, and
 * anchored on the live state rather than on a stored base.
 *
 * A legacy entry (snapshot pair, no diff) short-circuits the walk: its own
 * `before` IS the answer, and is more trustworthy than continuing past an entry
 * whose changes were never recorded as a diff.
 */
/**
 * Rebuild the Scenario on each side of one history entry.
 *
 * Both callers that need a whole Scenario out of the history want the same
 * pair, and both were deriving the slice boundaries by hand — one from
 * `indexOf`, one from a loop index, each with its own off-by-one. The `after`
 * side is derived from the `before` side by applying that entry's own diff
 * forwards, rather than by a second independent walk back from `live`.
 *
 * `history` is newest-first, as `update_history` is stored. Falls back to the
 * live graph for an entry that is not in this history.
 */
export function materialiseAround(
  live: GraphSnapshot,
  history: readonly { id?: string; diff?: GraphDiff; before?: GraphSnapshot }[],
  index: number,
): { before: GraphSnapshot; after: GraphSnapshot } {
  if (index < 0 || index >= history.length) return { before: live, after: live };
  const entry = history[index];
  const before = materialiseBefore(live, history.slice(0, index + 1));
  const after = entry.diff
    ? applyGraphDiff(before, entry.diff, "forward")
    : materialiseBefore(live, history.slice(0, index));
  return { before, after };
}

export function materialiseBefore(
  live: GraphSnapshot,
  entries: readonly { diff?: GraphDiff; before?: GraphSnapshot }[],
): GraphSnapshot {
  let snapshot = live;
  for (const entry of entries) {
    if (entry.diff) {
      snapshot = applyGraphDiff(snapshot, entry.diff, "backward");
    } else if (entry.before) {
      return entry.before;
    }
  }
  return snapshot;
}
