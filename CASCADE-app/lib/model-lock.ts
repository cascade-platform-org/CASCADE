/**
 * model-lock.ts — the one read-only check for a shown Temporal Simulation run
 * (ADR-0019 §1).
 *
 * Every writer of the model asks here: canvas-store's Element and Canvas
 * writers, config-store's Save and merge, LLM Design's apply, Event application
 * from the Action Bar. The run itself does not depend on this check — it computes
 * on a Propagation Context captured when it started (lib/propagation-call.ts) —
 * so the lock protects what the Run View shows: an edit now would be invisible,
 * and End run would show a model the run never saw.
 */

import { useTemporalSimulationStore } from "@/store/temporal-simulation-store";
import { useUiStore } from "@/store/ui-store";

let lockToastAt = 0;

/**
 * True while a Temporal Simulation run is computing or shown, and the caller
 * must then refuse its write. Says so in a toast, at most every few seconds,
 * and makes End run pulse. Canvas metadata (label, colour, map viewport) and
 * the active Canvas stay writable: they are not the model the run computed on.
 */
export function modelLocked(): boolean {
  if (!useTemporalSimulationStore.getState().running) return false;
  useTemporalSimulationStore.getState().cueEndRun();
  const now = Date.now();
  if (now - lockToastAt > 3000) {
    lockToastAt = now;
    useUiStore.getState().pushToast({
      message: "A Temporal Simulation run is shown, so the model is read-only. End run or Reset to edit it.",
      variant: "info",
      durationMs: 3500,
    });
  }
  return true;
}
