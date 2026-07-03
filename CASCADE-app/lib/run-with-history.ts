/**
 * runWithHistory — the single seam for undoable mutations (Any Graph Update).
 *
 * Wraps a mutation in a before/after GraphSnapshot pair and pushes exactly one
 * AnyUpdateEntry to the history store. Every user-triggered change that must be
 * undoable (CTRL+Z) goes through here — components must not hand-roll the
 * snapshot → mutate → push sequence, so the "every mutation gets a history
 * entry" invariant lives in one place.
 *
 * A plain function (not a hook) so store actions, event handlers, and non-React
 * code can use it. `useHistoryAction` wraps it for hook-style call sites.
 *
 * Store-internal pushes (canvas-store's applyEvent, copy/moveNodesToCanvas) are
 * the exception: they enrich entries with fields only the mutation itself can
 * compute (e.g. `mutation_reversal`) and keep that logic local to the store.
 */
import { nanoid } from "nanoid";
import { useCanvasStore } from "@/store/canvas-store";
import { useHistoryStore } from "@/store/history-store";
import type { AnyUpdateEntry } from "@/lib/schemas/network";

export interface RunWithHistoryOptions {
  /** Defaults to "manual_functionality_update" (matches useHistoryAction). */
  updateType?: AnyUpdateEntry["update_type"];
  /**
   * Canvas the change belongs to. Defaults to the active Canvas;
   * pass `null` to omit (a change spanning canvases, e.g. in the merged view).
   */
  canvasId?: string | null;
  /** Propagation scope, recorded on scoped entries (e.g. temporal-jump revert). */
  scope?: "local" | "global";
  /** EventId for event_applied / event_cleared entries. */
  eventId?: string;
}

export function runWithHistory<T>(
  updateFn: () => T,
  label: string,
  opts: RunWithHistoryOptions = {},
): T {
  const store = useCanvasStore.getState();
  const before = store.toGraphSnapshot();
  const result = updateFn();
  // Re-read via getState() so `after` reflects the committed state, not the
  // state captured before updateFn ran.
  const after = useCanvasStore.getState().toGraphSnapshot();
  const canvas_id =
    opts.canvasId === null ? undefined : opts.canvasId ?? store.activeCanvasId ?? undefined;
  useHistoryStore.getState().pushUpdateEntry({
    id: nanoid(),
    timestamp: new Date().toISOString(),
    update_type: opts.updateType ?? "manual_functionality_update",
    label,
    canvas_id,
    ...(opts.scope ? { scope: opts.scope } : {}),
    ...(opts.eventId ? { event_id: opts.eventId } : {}),
    before,
    after,
  });
  return result;
}
