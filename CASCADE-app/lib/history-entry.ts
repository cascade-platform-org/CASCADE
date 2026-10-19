/**
 * history-entry.ts — the one place an Any Graph Update entry is built.
 *
 * `runWithSnapshots` is the single entry point: it snapshots around a mutation,
 * diffs the pair, and pushes exactly one entry. Nothing else may call
 * `pushUpdateEntry` — with Graph Diffs (ADR-0017) a call site that built its own
 * diff could produce an entry that undoes incorrectly and *nothing would fail*;
 * undo would just leave a value behind.
 *
 * This module knows the history store and the differ, and deliberately NOT the
 * canvas store, so both seams can bind to it: `lib/run-with-history.ts` for
 * components, and canvas-store for its own actions. Were the binding here,
 * canvas-store could not use it without a cycle (`npm run audit:circular`).
 */
import { nanoid } from "nanoid";
import { useHistoryStore } from "@/store/history-store";
import { applyGraphDiff, diffGraph, isEmptyDiff } from "@/lib/graph-diff";
import { applyModelDiff, diffModel, isEmptyModelDiff, type ModelSnapshot } from "@/lib/model-diff";
import type { AnyUpdateEntry, GraphDiff, GraphSnapshot, ModelDiff } from "@/lib/schemas/network";

export interface HistoryEntryOptions {
  /** Defaults to "manual_functionality_update" (matches useHistoryAction). */
  updateType?: AnyUpdateEntry["update_type"];
  /** Canvas the change belongs to. `null` omits it (a change spanning canvases). */
  canvasId?: string | null;
  /** Propagation scope, recorded on scoped entries (e.g. temporal-jump revert). */
  scope?: "local" | "global";
  /** EventId for event_applied / event_cleared entries. */
  eventId?: string;
  /**
   * Only for temporal_jump_revert entries: the history entry the graph has been
   * rewound to. See AnyUpdateEntrySchema.reverts_to_entry_id.
   */
  revertsToEntryId?: string | null;
  /**
   * Fields only the mutation itself can compute — `mutation_reversal` for an
   * Event, `propagation_meta` for a Propagation, `temporal_jump_hours` for a
   * Temporal Jump's event_applied entry.
   */
  extra?: Partial<
    Pick<AnyUpdateEntry, "mutation_reversal" | "propagation_meta" | "temporal_jump_hours">
  >;
  /**
   * A run of edits to one thing (typing a label, dragging a slider) is one
   * entry: an Update with the same key folds into the entry the previous one
   * recorded, while that entry is still the newest: anything else recorded in
   * between ends the run, and so does an undo until a redo brings the entry
   * back. A run that ends where it began leaves no entry. `"auto"` keys the
   * run by the fields the edit changed, for writers that cannot name them (a
   * Temporal Simulation edit): typing in one field folds, the next field starts
   * a step of its own.
   */
  coalesce?: string;
}

/**
 * Update types that must record an entry even when the graph did not change.
 *
 * An Event nothing is vulnerable to legitimately changes nothing, and its entry
 * still has to exist: the Situation is derived by finding `event_applied`
 * entries, and `clearEvent` picks one. An Event that left no trace in history
 * would be invisible to both.
 */
const ALWAYS_RECORD = new Set<AnyUpdateEntry["update_type"]>(["event_applied", "event_cleared"]);

/** The entry the last coalescing Update recorded, and its key. In memory only: a reload ends every run. */
let lastRun: { key: string; entryId: string } | null = null;

/** What an entry is diffed between: the graph, the parts beyond it, or both, as the writer can reach them. */
interface Sides {
  graph?: GraphSnapshot;
  model?: ModelSnapshot;
}

const EMPTY_GRAPH_DIFF: GraphDiff = { nodes: [], edges: [], canvases: [] };

/** The fields a step changed, as a coalescing key: each record and each field path, sorted. */
function changedFields(graph: GraphDiff | undefined, model: ModelDiff | undefined): string {
  const keys: string[] = [];
  const add = (prefix: string, r: GraphDiff["nodes"][number]) =>
    r.op === "update" ? r.fields.forEach((f) => keys.push(`${prefix}${r.id}|${[f.field, ...(f.path ?? (f.key ? [f.key] : []))].join(".")}`)) : keys.push(`${prefix}${r.id}|${r.op}`);
  if (graph) for (const kind of ["nodes", "edges", "canvases"] as const) graph[kind].forEach((r) => add(`${kind}:`, r));
  if (model) {
    model.records.forEach((r) => add("", r));
    model.orders.forEach((o) => keys.push(`order:${o.key}`));
  }
  return keys.sort().join("\n");
}

/**
 * Diff `before` → `after` and push one entry. Returns false when the update
 * changed nothing and was therefore not recorded.
 *
 * Module-private on purpose: `runWithSnapshots` below is the only way in, so
 * there is no way to record an entry without the surrounding snapshot pair
 * being taken correctly.
 *
 * A no-op edit used to cost a ~100 KB entry (ADR-0017 measured one in the
 * shipped Palmanova sample) and an undo step that visibly does nothing.
 */
function pushUpdate(
  before: Sides,
  after: Sides,
  label: string,
  opts: HistoryEntryOptions & { activeCanvasId?: string | null } = {},
): boolean {
  const history = useHistoryStore.getState();
  const top = history.updateHistory[0];
  const key = opts.coalesce === "auto"
    ? changedFields(before.graph && after.graph ? diffGraph(before.graph, after.graph) : undefined, before.model && after.model ? diffModel(before.model, after.model) : undefined) || undefined
    : opts.coalesce;
  const continues = key !== undefined && lastRun?.key === key && top?.id === lastRun.entryId && top.diff !== undefined;
  // The run's own start: the newest entry applied backwards, then diffed afresh
  // by the one differ — no second way of combining two diffs.
  const startGraph = continues && before.graph && top?.diff ? applyGraphDiff(before.graph, top.diff, "backward") : before.graph;
  const startModel = continues && before.model && top?.model_diff ? applyModelDiff(before.model, top.model_diff, "backward") : before.model;
  const diff = startGraph && after.graph ? diffGraph(startGraph, after.graph) : EMPTY_GRAPH_DIFF;
  const modelDiff = startModel && after.model ? diffModel(startModel, after.model) : undefined;
  const changesModel = modelDiff !== undefined && !isEmptyModelDiff(modelDiff);
  const updateType = opts.updateType ?? "manual_functionality_update";
  if (continues) history.popUpdateEntry();
  if (isEmptyDiff(diff) && !changesModel && !ALWAYS_RECORD.has(updateType)) {
    // Only a continued run forgets itself here; a no-op elsewhere must not end one.
    if (continues) lastRun = null;
    return false;
  }

  const canvas_id =
    opts.canvasId === null ? undefined : opts.canvasId ?? opts.activeCanvasId ?? undefined;

  const id = nanoid();
  lastRun = key !== undefined ? { key, entryId: id } : null;
  useHistoryStore.getState().pushUpdateEntry({
    id,
    timestamp: new Date().toISOString(),
    update_type: updateType,
    label,
    canvas_id,
    ...(opts.scope ? { scope: opts.scope } : {}),
    ...(opts.eventId ? { event_id: opts.eventId } : {}),
    ...(opts.revertsToEntryId ? { reverts_to_entry_id: opts.revertsToEntryId } : {}),
    ...(opts.extra ?? {}),
    diff,
    ...(changesModel ? { model_diff: modelDiff } : {}),
  });
  return true;
}

/** True while an update is being recorded: an update inside it is part of its entry, never one of its own. */
let recording = false;

/**
 * Snapshot the graph around a mutation and record one entry for it.
 *
 * The whole "before → mutate → after → push" sequence, parameterised only by
 * how to reach the graph. Both seams call this: `lib/run-with-history.ts` binds
 * it to `useCanvasStore` for components, and canvas-store binds it to its own
 * `get()` — which it must, because importing the former would be a cycle. The
 * two bindings are one line each, so there is still exactly one copy of the
 * sequence that could get the ordering wrong.
 */
export function runWithSnapshots<T>(
  source: {
    /** The graph, for an update that may change it. */
    snapshot?: () => GraphSnapshot;
    /** The parts beyond the graph this writer can change (ADR-0017, revised 2026-10-19). */
    model?: () => ModelSnapshot;
    activeCanvasId?: () => string | null | undefined;
  },
  updateFn: () => T,
  label: string,
  opts: HistoryEntryOptions = {},
): T {
  // An update made while another is recorded is part of that one's entry: the outer snapshots hold it.
  if (recording) return updateFn();
  const read = (): Sides => ({ graph: source.snapshot?.(), model: source.model?.() });
  const before = read();
  const activeCanvasId = source.activeCanvasId?.();
  let result: T;
  recording = true;
  try {
    result = updateFn();
  } finally {
    recording = false;
  }
  // Re-read through the source so `after` reflects the committed state, not the
  // state captured before updateFn ran.
  pushUpdate(before, read(), label, { ...opts, activeCanvasId });
  return result;
}
