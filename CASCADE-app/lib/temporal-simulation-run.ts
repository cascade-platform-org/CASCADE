/**
 * temporal-simulation-run.ts — start, cancel and end a Temporal Simulation run
 * from the window (ADR-0019 §2–§3, §5).
 *
 * The store-facing side of `lib/step-operator.ts`, which stays pure. A run reads
 * the model once, Resets a copy of it, and hands the copy to the step operator
 * with the ordinary Propagation call (`propagateSnapshot`: the Propagate
 * button's payload, one metered Engine Evaluation each, no store written), at
 * the scope Propagate, Simulate and Analyse share, fixed when the run starts
 * and saved into the Simulation then. The model is never written: canvas-store refuses model writes while
 * `running`, and the Run View paints the run record's periods instead.
 */

import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore, selectN } from "@/store/config-store";
import { useHistoryStore } from "@/store/history-store";
import { useTemporalSimulationStore } from "@/store/temporal-simulation-store";
import { propagateSnapshot } from "@/lib/ephemeral-propagation";
import { resetSnapshot } from "@/lib/scenario-baseline";
import { planTimeline } from "@/lib/timeline-plan";
import { checkDoc, draftToDoc } from "@/lib/temporal-simulation-text";
import { RunStopped, runTimeline } from "@/lib/step-operator";
import { runTable, runTableCsv, type RunTable } from "@/lib/temporal-metrics";
import { comparisonCsv, type ComparedRun, type Comparison } from "@/lib/temporal-comparison";
import { buildRunEntry } from "@/lib/period-entry";
import { CSV_FILE, safeName, saveAs } from "@/lib/file-io";
import { useScorecardStore } from "@/store/scorecard-store";
import { useUiStore } from "@/store/ui-store";
import { nanoid } from "nanoid";

let controller: AbortController | null = null;
let comparing: AbortController | null = null;

/**
 * Run the window's definition. Returns when the run is shown or has stopped;
 * a stop is reported through the store's `runError`, naming the period.
 */
export async function startTemporalSimulationRun(): Promise<void> {
  if (useTemporalSimulationStore.getState().running) return;
  // The shared scope, fixed for the run and recorded in the Simulation it runs.
  const { activeCanvasId } = useCanvasStore.getState();
  const shared = useUiStore.getState().propagationScope;
  const want = shared === "local" && activeCanvasId ? { scope: "local" as const, canvas: activeCanvasId } : { scope: "global" as const, canvas: undefined };
  const had = useTemporalSimulationStore.getState();
  // Only a change is written, so a Run alone does not mark the project unsaved.
  if (had.scope !== want.scope || had.canvas !== want.canvas) had.setScope(want.scope, want.canvas);
  const sim = useTemporalSimulationStore.getState();
  const checked = checkDoc(draftToDoc(sim));
  if (!checked.ok) return;
  const plan = planTimeline(checked.doc.timeline);
  if (plan.errors.length > 0 || plan.periods.length === 0) return;

  const fixed = { scope: checked.doc.scope, canvasId: checked.doc.canvas ?? activeCanvasId };

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
      propagate: (snapshot) => (ended() ? Promise.reject(new Error("Cancelled")) : propagateSnapshot(snapshot, fixed)),
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

/** Save the shown run's table (the Run tab's) as CSV through the app's Save-As path. */
export async function exportRunCsv(table: RunTable): Promise<void> {
  const name = useTemporalSimulationStore.getState().timeline.name || "temporal-simulation";
  await saveAs(`${safeName(name)}.csv`, runTableCsv(table), CSV_FILE);
}

/**
 * Save the ticked periods of the shown run as one `temporal_simulation`
 * Scorecard entry: the run's start once, each period as a Graph Diff from it.
 * The period the Run View shows also gets a picture of the canvas. Returns the
 * entry's label.
 */
export async function saveRunToScorecard(table: RunTable, numbers: readonly number[]): Promise<string | null> {
  const sim = useTemporalSimulationStore.getState();
  const record = sim.runRecord;
  if (!record || numbers.length === 0) return null;
  const shown = numbers.includes(sim.selectedPeriod) ? await useUiStore.getState().captureCanvasFn?.() : undefined;
  const entry = buildRunEntry({
    record,
    numbers,
    table,
    timelineName: sim.timeline.name || "Temporal Simulation",
    id: nanoid(),
    ...(shown ? { image: { number: sim.selectedPeriod, png: shown } } : {}),
  });
  useScorecardStore.getState().addScorecardEntry(entry);
  return entry.label;
}

/**
 * Run several saved Temporal Simulations one after the other, each on its own
 * Reset copy of the model and at the shared scope, as Run does, and keep each
 * one's Run table for the Compare tab. Nothing is shown in the Run View and
 * nothing is written. A Simulation that cannot run (an invalid definition, an
 * engine error) is kept with the reason, and the others still run; Cancel
 * keeps the ones already finished.
 */
export async function startComparison(ids: readonly string[]): Promise<void> {
  const sim = useTemporalSimulationStore.getState();
  if (sim.compareProgress || sim.runProgress) return;
  const chosen = sim.simulations.filter((x) => ids.includes(x.id));
  if (chosen.length === 0) return;

  const { activeCanvasId } = useCanvasStore.getState();
  const shared = useUiStore.getState().propagationScope;
  const fixed = shared === "local" && activeCanvasId ? { scope: "local" as const, canvasId: activeCanvasId } : { scope: "global" as const, canvasId: activeCanvasId };
  const config = useConfigStore.getState();
  const n = selectN(config);
  const start = resetSnapshot(useCanvasStore.getState().toGraphSnapshot(), useHistoryStore.getState().scenarioBaseline(), n);

  const prepared = chosen.map(({ id, ...doc }) => {
    const checked = checkDoc(doc);
    const plan = checked.ok ? planTimeline(checked.doc.timeline) : null;
    return { id, name: doc.timeline.name || id, checked, plan };
  });
  const total = prepared.reduce((a, p) => a + (p.plan?.engineCalls ?? 0), 0);

  const mine = new AbortController();
  comparing = mine;
  sim.beginCompare(total);
  const runs: ComparedRun[] = [];
  let done = 0;
  for (const { id, name, checked, plan } of prepared) {
    if (mine.signal.aborted) break;
    if (!checked.ok || !plan || plan.errors.length > 0 || plan.periods.length === 0) {
      const why = !checked.ok ? checked.errors[0] : plan?.errors[0] ?? "its Timeline has no period";
      runs.push({ id, name, table: null, warnings: [], error: `Not run: ${why}` });
      continue;
    }
    const before = done;
    try {
      const record = await runTimeline({
        start,
        plan,
        profile: checked.doc.profile,
        events: config.config.events,
        n,
        propagate: (snapshot) => (mine.signal.aborted ? Promise.reject(new Error("Cancelled")) : propagateSnapshot(snapshot, fixed)),
        signal: mine.signal,
        onProgress: (k, label) => useTemporalSimulationStore.getState().setCompareProgress(before + k, `${name} · ${label}`),
      });
      runs.push({ id, name, table: runTable(record, checked.doc.metrics, n, checked.doc.standard_metrics), warnings: record.warnings });
    } catch (e) {
      if (mine.signal.aborted) break;
      const message = e instanceof RunStopped ? `Stopped: ${e.message} — in period ${e.period}` : `Stopped: ${e instanceof Error ? e.message : String(e)}`;
      runs.push({ id, name, table: null, warnings: [], error: message });
    }
    done = before + plan.engineCalls;
  }
  if (comparing === mine) comparing = null;
  useTemporalSimulationStore.getState().finishCompare(runs, sim.simulations);
}

/** Stop a computing comparison after its current Propagation; the Simulations already run are kept. */
export function cancelComparison(): void {
  comparing?.abort();
}

/** Save the comparison as CSV through the app's Save-As path. */
export async function exportComparisonCsv(comparison: Comparison): Promise<void> {
  await saveAs("temporal-simulation-comparison.csv", comparisonCsv(comparison), CSV_FILE);
}
