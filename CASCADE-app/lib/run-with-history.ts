/**
 * runWithHistory — the component-facing seam for undoable mutations.
 *
 * A binding of `runWithSnapshots` (`lib/history-entry.ts`) to the canvas store.
 * Every change that must be undoable goes through it: components must not
 * hand-roll the snapshot → mutate → push sequence, so "every mutation gets a
 * history entry that correctly describes it" is a property of one function
 * rather than a habit at eight call sites.
 *
 * A plain function (not a hook) so store actions, event handlers, and non-React
 * code can use it. `useHistoryAction` wraps it for hook-style call sites.
 *
 * canvas-store binds `runWithSnapshots` to its own `get()` instead of importing
 * this module, which would be a cycle — same one implementation underneath.
 */
import { useCanvasStore } from "@/store/canvas-store";
import { runWithSnapshots, type HistoryEntryOptions } from "@/lib/history-entry";

export type RunWithHistoryOptions = HistoryEntryOptions;

export function runWithHistory<T>(
  updateFn: () => T,
  label: string,
  opts: RunWithHistoryOptions = {},
): T {
  return runWithSnapshots(
    {
      snapshot: () => useCanvasStore.getState().toGraphSnapshot(),
      activeCanvasId: () => useCanvasStore.getState().activeCanvasId,
    },
    updateFn,
    label,
    opts,
  );
}
