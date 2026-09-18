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
import { diffGraph, isEmptyDiff } from "@/lib/graph-diff";
import type { AnyUpdateEntry, GraphSnapshot } from "@/lib/schemas/network";

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
function pushGraphUpdate(
  before: GraphSnapshot,
  after: GraphSnapshot,
  label: string,
  opts: HistoryEntryOptions & { activeCanvasId?: string | null } = {},
): boolean {
  const diff = diffGraph(before, after);
  const updateType = opts.updateType ?? "manual_functionality_update";
  if (isEmptyDiff(diff) && !ALWAYS_RECORD.has(updateType)) return false;

  const canvas_id =
    opts.canvasId === null ? undefined : opts.canvasId ?? opts.activeCanvasId ?? undefined;

  useHistoryStore.getState().pushUpdateEntry({
    id: nanoid(),
    timestamp: new Date().toISOString(),
    update_type: updateType,
    label,
    canvas_id,
    ...(opts.scope ? { scope: opts.scope } : {}),
    ...(opts.eventId ? { event_id: opts.eventId } : {}),
    ...(opts.revertsToEntryId ? { reverts_to_entry_id: opts.revertsToEntryId } : {}),
    ...(opts.extra ?? {}),
    diff,
  });
  return true;
}


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
  source: { snapshot: () => GraphSnapshot; activeCanvasId: () => string | null | undefined },
  updateFn: () => T,
  label: string,
  opts: HistoryEntryOptions = {},
): T {
  const before = source.snapshot();
  const activeCanvasId = source.activeCanvasId();
  const result = updateFn();
  // Re-read through the source so `after` reflects the committed state, not the
  // state captured before updateFn ran.
  pushGraphUpdate(before, source.snapshot(), label, { ...opts, activeCanvasId });
  return result;
}
