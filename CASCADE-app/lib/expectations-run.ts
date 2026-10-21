/**
 * expectations-run.ts — run the project's Expectations from the app (ADR-0023).
 *
 * The store-facing side of `lib/expectations.ts`, which stays pure. It reads its
 * input once, when the checks start, as a Temporal Simulation run does: the
 * Reset model, the Model Configuration, the Series, the Temporal Simulations,
 * and the Propagation Context every engine call uses (lib/propagation-call.ts),
 * with each check's own scope. Nothing is written but the session's results.
 */

import { useProjectDataStore } from "@/store/project-data-store";
import { useTemporalSimulationStore } from "@/store/temporal-simulation-store";
import { useExpectationRunStore } from "@/store/expectation-run-store";
import { propagateSnapshot } from "@/lib/propagation-call";
import { captureRunInput } from "@/lib/temporal-simulation-run";
import { runExpectations, type ExpectationEnv, type ExpectationResult } from "@/lib/expectations";

let controller: AbortController | null = null;

/** What the checks read from the app, captured now. */
export function captureExpectationEnv(signal?: AbortSignal): ExpectationEnv {
  const { ctx, start, series } = captureRunInput();
  return {
    start,
    config: ctx.config,
    series,
    simulations: useTemporalSimulationStore.getState().simulations,
    // A global check still sends the active Canvas, as every global Propagation does.
    propagate: (snapshot, s) => propagateSnapshot(snapshot, { ...ctx, scope: s.scope, canvasId: s.canvasId ?? ctx.canvasId }),
    signal,
  };
}

/**
 * Run the Expectations named by `ids`, or all of them; one run at a time (a
 * second one throws). The results land in the session store as each one
 * finishes, and are returned.
 */
export async function runProjectExpectations(ids?: readonly string[]): Promise<ExpectationResult[]> {
  const runs = useExpectationRunStore.getState();
  if (runs.progress) throw new Error("Expectations are already running in the app; try again when they finish.");
  const all = useProjectDataStore.getState().expectations;
  const chosen = ids ? all.filter((e) => ids.includes(e.id)) : all;
  if (chosen.length === 0) return [];
  controller = new AbortController();
  runs.begin(chosen.length);
  try {
    return await runExpectations(chosen, captureExpectationEnv(controller.signal), (r) => useExpectationRunStore.getState().record(r));
  } catch {
    return [];
  } finally {
    controller = null;
    useExpectationRunStore.getState().finish();
  }
}

/** Stop after the current engine call; the results already in are kept. */
export function cancelExpectations(): void {
  controller?.abort();
}
