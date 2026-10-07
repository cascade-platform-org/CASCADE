/**
 * temporal-simulation-run.ts — start, cancel and end a Temporal Simulation run
 * from the window (ADR-0019 §2–§3, §5).
 *
 * The store-facing side of `lib/step-operator.ts`, which stays pure. A run reads
 * the model once, Resets a copy of it, and hands the copy to the step operator
 * with the ordinary Propagation call (`runEphemeralPropagation`: the Propagate
 * button's payload and scope, one metered Engine Evaluation each, no store
 * written). The model is never written: canvas-store refuses model writes while
 * `running`, and the Run View paints the run record's periods instead.
 */

import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore, selectN } from "@/store/config-store";
import { useHistoryStore } from "@/store/history-store";
import { useTemporalSimulationStore } from "@/store/temporal-simulation-store";
import { runEphemeralPropagation } from "@/lib/ephemeral-propagation";
import { resetSnapshot } from "@/lib/scenario-baseline";
import { planTimeline } from "@/lib/timeline-plan";
import { checkDoc, draftToDoc } from "@/lib/temporal-simulation-text";
import { RunStopped, runTimeline } from "@/lib/step-operator";

let controller: AbortController | null = null;

/**
 * Run the window's definition. Returns when the run is shown or has stopped;
 * a stop is reported through the store's `runError`, naming the period.
 */
export async function startTemporalSimulationRun(): Promise<void> {
  const sim = useTemporalSimulationStore.getState();
  if (sim.running) return;
  const checked = checkDoc(draftToDoc(sim));
  if (!checked.ok) return;
  const plan = planTimeline(checked.doc.timeline);
  if (plan.errors.length > 0 || plan.periods.length === 0) return;

  const config = useConfigStore.getState();
  const n = selectN(config);
  const start = resetSnapshot(useCanvasStore.getState().toGraphSnapshot(), useHistoryStore.getState().scenarioBaseline(), n);

  // This run's own controller: End run, Reset or a newer run aborts it, and a
  // project load ends the run in the store; either way its result is dropped.
  const mine = new AbortController();
  controller = mine;
  const superseded = () => controller !== mine || !useTemporalSimulationStore.getState().running;
  const ended = () => mine.signal.aborted || superseded();
  sim.beginRun(plan.engineCalls);
  try {
    const record = await runTimeline({
      start,
      plan,
      profile: checked.doc.profile,
      events: config.config.events,
      n,
      propagate: (snapshot) => (ended() ? Promise.reject(new Error("Cancelled")) : runEphemeralPropagation(snapshot)),
      signal: mine.signal,
      onProgress: (done, label) => useTemporalSimulationStore.getState().setRunProgress(done, label),
    });
    // Ended (End run, Reset, project load, a newer run) while the last call was in flight.
    if (superseded()) return;
    useTemporalSimulationStore.getState().finishRun(record);
  } catch (e) {
    if (superseded()) return;
    const message = e instanceof RunStopped
      ? `${e.message === "Cancelled" ? "Cancelled" : `Stopped: ${e.message}`} — in period ${e.period}. Nothing was kept; the model is unchanged.`
      : `Stopped: ${e instanceof Error ? e.message : String(e)}. The model is unchanged.`;
    useTemporalSimulationStore.getState().failRun(message);
  } finally {
    if (controller === mine) controller = null;
  }
}

/** Stop a computing run after its current Propagation. */
export function cancelTemporalSimulationRun(): void {
  controller?.abort();
}

/**
 * Leave the Run View, or stop a computing run (End run, Reset). The model never
 * changed, so nothing is reverted. Returns whether a run was active.
 */
export function endTemporalSimulationRun(): boolean {
  const sim = useTemporalSimulationStore.getState();
  if (!sim.running) return false;
  controller?.abort();
  sim.endRun();
  return true;
}
