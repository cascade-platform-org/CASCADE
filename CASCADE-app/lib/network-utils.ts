/**
 * network-utils.ts — Shared imperative helpers that operate on Zustand store state.
 *
 * These functions call getState() directly and are safe to call outside React
 * render cycles (event handlers, async callbacks, etc.).
 */

import { useCanvasStore } from "@/store/canvas-store";
import { useHistoryStore } from "@/store/history-store";
import { useAnalysisStore } from "@/store/analysis-store";
import { useConfigStore, selectN } from "@/store/config-store";
import { endRun } from "@/lib/temporal-jump-run";
import { countChangedElements } from "@/lib/graph-diff";
import { runWithHistory } from "@/lib/run-with-history";
import { applyBaselineEntries, forceOperational, resetPlan } from "@/lib/scenario-baseline";

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

/**
 * End the current scenario (ADR-0016). Two independent halves:
 *
 * 1. **Every Element is forced operational** — full Functionality, no backup
 *    countdown, no `direct_damage`, no `expected_repair_time`, no
 *    `responsibility_share`. Unconditional, and it consults nothing.
 * 2. **Machine-written model attributes are reverted** from the **Scenario
 *    Baseline** — a `capacity` a Rule assigned, a custom `properties` key a
 *    cascade merged (ADR-0015). Provenance finds these, so an attribute a Rule
 *    gains later is covered without anyone listing it.
 *
 * Half 1 does not depend on half 2 ON PURPOSE. The Baseline is derived from the
 * update history and can be incomplete — a rewind that crossed a Reset
 * boundary, an entry evicted before retirement, a future bug in the fold — and a
 * Reset that left the network damaged because its own bookkeeping was wrong is a
 * far worse failure than one that repairs an Element it did not strictly have
 * to. Reset is the button a user reaches for when the model is in a state they
 * no longer understand; it has to be the one thing that always works.
 *
 * A hand edit to a MODEL field survives either way: a label fixed, a node moved,
 * or a capacity corrected mid-scenario is authoring work.
 *
 * **No scope parameter.** Reset always covers the whole project: Events reach
 * across Canvases, inter-canvas edges participate under global Propagation, and
 * a half-rewound cascade is a state the model was never in.
 *
 * Returns the number of Elements it actually changed, so callers can report
 * honestly when there was nothing to reset.
 */
export function resetFunctionality(): number {
  const historyStore = useHistoryStore.getState();
  const n = selectN(useConfigStore.getState());

  const before = useCanvasStore.getState().toGraphSnapshot();
  const restored = applyBaselineEntries(before, resetPlan(historyStore.scenarioBaseline()));
  const after = forceOperational(restored, n);

  // Reference identity survives both transforms for an untouched Element, so
  // this counts what genuinely moved rather than the size of the graph.
  const changed = countChangedElements(before, after);

  // A Temporal Jump run belongs to the scenario being ended — see `endRun`.
  endRun();

  if (changed === 0) return 0;

  runWithHistory(
    () => useCanvasStore.getState().restoreSnapshot(after),
    "Reset scenario",
    {
      // Not a plain manual edit: scenario_reset is a session boundary — it ends
      // the current Situation (the Situation window and the Save-to-Scorecard
      // dialog stop treating pre-reset Events as the live scenario), and
      // deriveBaseline stops folding at it, so nothing older is reverted twice.
      updateType: "scenario_reset",
      canvasId: null,
    },
  );

  // The scenario is over, so entries retired past the history cap go with it —
  // otherwise a second Reset would revert to values from a session that ended.
  historyStore.clearRetiredBaseline();

  // The Analysis Heatmap colours mean scores from a Scenario that no longer
  // exists. Leaving it on the canvas is a key to numbers nothing on screen has.
  useAnalysisStore.getState().clearHeatmap();

  return changed;
}
