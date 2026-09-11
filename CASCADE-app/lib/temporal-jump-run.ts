/**
 * temporal-jump-run.ts — the lifecycle of one Temporal Jump run.
 *
 * A **Temporal Jump** advances simulated time and, like any Event, writes to the
 * graph and pushes an Any Graph Update. A *run* is the extra state that lives
 * OUTSIDE the graph for as long as the user keeps jumping: the pre-jump Scenario
 * the `−Xh` control restores, the hours elapsed so far, and the history entry
 * the run started from.
 *
 * That state used to have no owner. It sat as three loose fields on `ui-store`,
 * and the four operations over it were spread across three layers: starting and
 * extending a run lived in `action-bar.tsx`, reverting one lived in a helper
 * beside it, ending one because the scenario ended lived in `network-utils.ts`,
 * and partially unwinding one lived in `canvas-store`'s `clearEvent`. Nothing
 * could answer "is a run active, and what ends it" in one place — which is
 * exactly how Reset came to end the scenario without ending the run, leaving the
 * `−Xh` control offering to rewind into a scenario that was over.
 *
 * Everything a run needs is here. The pure half (`remainingJumpHours`,
 * `nextJumpHours`) reads a Scenario and nothing else; the imperative half calls
 * `getState()` and is safe outside React render, the same convention as
 * `network-utils.ts`.
 */

import { useCanvasStore } from "@/store/canvas-store";
import { useHistoryStore } from "@/store/history-store";
import { useUiStore } from "@/store/ui-store";
import { temporalJumpEvent } from "@/lib/event-application";
import { runWithHistory } from "@/lib/run-with-history";

// ---------------------------------------------------------------------------
// Reading a Scenario's remaining time (pure)
// ---------------------------------------------------------------------------

/**
 * Every distinct Functionality Time still pending in a Scenario, ascending.
 *
 * These are the only jump lengths that change anything: a Temporal Jump
 * subtracts N hours from every positive Functionality Time, so jumping to any
 * value between two ticks expires exactly the same set of Elements as jumping to
 * the lower one. The `−Xh` slider draws one tick per entry, and the largest is
 * the furthest a jump can usefully go.
 */
export function remainingJumpHours(snapshot: {
  nodes: Record<string, { functionality_time?: number }>;
  edges: Record<string, { functionality_time?: number }>;
}): number[] {
  const seen = new Set<number>();
  for (const registry of [snapshot.nodes, snapshot.edges]) {
    for (const el of Object.values(registry)) {
      const ft = el.functionality_time ?? 0;
      if (ft > 0) seen.add(ft);
    }
  }
  return [...seen].sort((a, b) => a - b);
}

/**
 * The shortest pending Functionality Time, or null when nothing is counting
 * down. This is the step auto-advance takes: jumping straight to the nearest
 * expiry is what makes each step change something.
 */
export function nextJumpHours(snapshot: Parameters<typeof remainingJumpHours>[0]): number | null {
  return remainingJumpHours(snapshot)[0] ?? null;
}

// ---------------------------------------------------------------------------
// The run (store-bound)
// ---------------------------------------------------------------------------

/**
 * Advance simulated time by `hours`, starting a run if none is in progress.
 *
 * The graph write goes through `applyEvent`, which pushes its own
 * `event_applied` entry — pushing a second one here would double the undo stack
 * per jump and let Clear Event find the entry that carries no reversal.
 *
 * No Propagation is run: whether a jump is followed by one is the caller's
 * policy (the auto-propagate toggle), and the engine call is async.
 */
export function extendRun(hours: number, n: number): void {
  const canvas = useCanvasStore.getState();
  if (useUiStore.getState().temporalJumpRevertSnapshot === null) {
    // First jump of the run: remember the Scenario to come back to, and the
    // entry that was newest when it started, so the Situation can be rewound to
    // what was live before the run.
    useUiStore.getState().saveTemporalRevertSnapshot(
      canvas.toGraphSnapshot(),
      useHistoryStore.getState().updateHistory[0]?.id ?? null,
    );
  }
  canvas.applyEvent(temporalJumpEvent(hours), n);
  useUiStore.getState().addTemporalElapsedHours(hours);
}

/**
 * Rewind the whole run and end it. Returns the hours reverted, or 0 when no run
 * was active — so callers can report honestly without reading the store twice.
 *
 * The entry is `temporal_jump_revert`, not a plain manual edit: the Situation
 * has to recognise it and rewind to the scenario that was live before the jumps
 * (`lib/scenario-history.ts`), otherwise the canvas would show the pre-jump
 * state while the Situation window still reported the jumps and their
 * Propagation.
 */
export function revertRun(scope: "local" | "global"): number {
  const ui = useUiStore.getState();
  const snapshot = ui.temporalJumpRevertSnapshot;
  const hours = ui.temporalJumpElapsedHours;
  if (!snapshot || hours === 0) return 0;

  runWithHistory(
    () => useCanvasStore.getState().restoreSnapshot(snapshot),
    `Revert temporal jumps (−${hours}h)`,
    {
      scope,
      updateType: "temporal_jump_revert",
      revertsToEntryId: ui.temporalJumpRevertFromEntryId,
    },
  );
  endRun();
  return hours;
}

/**
 * End the run without touching the graph — the run's state is discarded, the
 * jumps themselves stand.
 *
 * This is what **Reset** calls. A run belongs to the scenario being ended: left
 * alone, `−Xh` would go on offering to rewind to a snapshot taken inside a
 * scenario that is over, dropping the graph back into a cascade with no Scenario
 * Baseline behind it — the history fold stops at the Reset, so nothing could
 * undo it again.
 */
export function endRun(): void {
  useUiStore.getState().clearTemporalJumpProgress();
}
