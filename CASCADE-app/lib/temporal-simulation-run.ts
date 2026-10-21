/**
 * temporal-simulation-run.ts — start, cancel and end a Temporal Simulation run
 * from the window (ADR-0019 §2–§3, §5).
 *
 * The store-facing side of `lib/step-operator.ts`, which stays pure. Run and
 * Compare read their input once, when they start (`captureRunInput`): a Reset
 * copy of the model, the Model Configuration's Events and scale, the Series,
 * and the Propagation Context every engine call of the run uses
 * (lib/propagation-call.ts) — the scope Propagate, Simulate and Analyse share,
 * fixed then and saved into the Simulation Run starts. Nothing a person edits
 * afterwards reaches a run already computing. The model is never written: the
 * model writers refuse while `running` (lib/model-lock.ts), and the Run View
 * paints the run record's periods instead.
 */

import { useCanvasStore } from "@/store/canvas-store";
import { useHistoryStore } from "@/store/history-store";
import { useTemporalSimulationStore } from "@/store/temporal-simulation-store";
import { useProjectDataStore } from "@/store/project-data-store";
import { parameterValues } from "@/lib/schemas/temporal-simulation";
import { propagateSnapshot, propagationContext } from "@/lib/propagation-call";
import { resetSnapshot } from "@/lib/scenario-baseline";
import { planTimeline, type TimelinePlan } from "@/lib/timeline-plan";
import { checkDoc, draftToDoc } from "@/lib/temporal-simulation-text";
import type { TemporalSimulation } from "@/lib/schemas/temporal-simulation";
import { RunStopped, runTimeline, type RunRecord } from "@/lib/step-operator";
import { runTable, runTableCsv, type RunTable } from "@/lib/temporal-metrics";
import { comparisonCsv, type ComparedRun, type Comparison } from "@/lib/temporal-comparison";
import type { CompareRequest } from "@/lib/temporal-sweep";
import { buildRunEntry } from "@/lib/period-entry";
import { CSV_FILE, safeName, saveAs } from "@/lib/file-io";
import { useScorecardStore } from "@/store/scorecard-store";
import { useUiStore } from "@/store/ui-store";
import { nanoid } from "nanoid";

let controller: AbortController | null = null;
let comparing: AbortController | null = null;

/** What a run reads from the app, captured once when Run or Compare starts (and an Expectations run). */
export function captureRunInput() {
  const ctx = propagationContext();
  const n = ctx.config.functionality_scale.length;
  return {
    ctx,
    n,
    events: ctx.config.events,
    series: useProjectDataStore.getState().series,
    start: resetSnapshot(useCanvasStore.getState().toGraphSnapshot(), useHistoryStore.getState().scenarioBaseline(), n),
  };
}

/**
 * One Timeline run on the captured input. `stopped` is asked before every
 * engine call; once it says yes, the run ends at that period as Cancelled.
 */
function runOn(
  input: ReturnType<typeof captureRunInput>,
  doc: TemporalSimulation,
  plan: TimelinePlan,
  parameters: Record<string, number>,
  run: { signal: AbortSignal; stopped: () => boolean; onProgress: (done: number, label: string) => void },
): Promise<RunRecord> {
  return runTimeline({
    start: input.start,
    plan,
    profile: doc.profile,
    events: input.events,
    n: input.n,
    parameters,
    series: input.series,
    propagate: (snapshot) => (run.stopped() ? Promise.reject(new Error("Cancelled")) : propagateSnapshot(snapshot, input.ctx)),
    signal: run.signal,
    onProgress: run.onProgress,
  });
}

/** A stopped run in words, naming the period when the step operator knows it. */
function stoppedMessage(e: unknown): string {
  if (!(e instanceof RunStopped)) return `Stopped: ${e instanceof Error ? e.message : String(e)}`;
  return `${e.message === "Cancelled" ? "Cancelled" : `Stopped: ${e.message}`} — in period ${e.period}`;
}

/**
 * Run the window's definition. Returns when the run is shown or has stopped;
 * a stop is reported through the store's `runError`, naming the period.
 */
export async function startTemporalSimulationRun(): Promise<void> {
  if (useTemporalSimulationStore.getState().running) return;
  const input = captureRunInput();
  // The shared scope, fixed for the run and recorded in the Simulation it runs.
  // Only a change is written, so a Run alone does not mark the project unsaved.
  const scope = input.ctx.scope;
  const canvas = scope === "local" ? input.ctx.canvasId ?? undefined : undefined;
  const had = useTemporalSimulationStore.getState();
  if (had.scope !== scope || had.canvas !== canvas) had.setScope(scope, canvas);
  const sim = useTemporalSimulationStore.getState();
  const checked = checkDoc(draftToDoc(sim));
  if (!checked.ok) return;
  const plan = planTimeline(checked.doc.timeline);
  if (plan.errors.length > 0 || plan.periods.length === 0) return;

  // This run's own controller: End run, Reset or a newer run aborts it, and a
  // project load ends the run in the store; either way its result is dropped.
  const mine = new AbortController();
  controller = mine;
  const superseded = () => controller !== mine || !useTemporalSimulationStore.getState().running;
  sim.beginRun(plan.engineCalls);
  try {
    const record = await runOn(input, checked.doc, plan, parameterValues(checked.doc), {
      signal: mine.signal,
      stopped: () => mine.signal.aborted || superseded(),
      onProgress: (done, label) => useTemporalSimulationStore.getState().setRunProgress(done, label),
    });
    // Ended (End run, Reset, project load, a newer run) while the last call was in flight.
    if (superseded()) return;
    useTemporalSimulationStore.getState().finishRun(record);
  } catch (e) {
    if (superseded()) return;
    useTemporalSimulationStore.getState().failRun(`${stoppedMessage(e)}. Nothing was kept; the model is unchanged.`);
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
export async function startComparison(requests: readonly CompareRequest[]): Promise<void> {
  const sim = useTemporalSimulationStore.getState();
  if (sim.compareProgress || sim.runProgress) return;
  const byId = new Map(sim.simulations.map((x) => [x.id, x]));
  const chosen = requests.flatMap((r) => {
    const doc = byId.get(r.simulationId);
    return doc ? [{ request: r, doc }] : [];
  });
  if (chosen.length === 0) return;

  const input = captureRunInput();

  // A sweep runs one Simulation many times: it is checked and planned once.
  const checkedById = new Map<string, { checked: ReturnType<typeof checkDoc>; plan: TimelinePlan | null }>();
  const prepared = chosen.map(({ request, doc: { id, ...doc } }) => {
    let entry = checkedById.get(id);
    if (!entry) {
      const checked = checkDoc(doc);
      entry = { checked, plan: checked.ok ? planTimeline(checked.doc.timeline) : null };
      checkedById.set(id, entry);
    }
    return { id, name: request.name, sweep: request.sweep, ...entry };
  });
  const total = prepared.reduce((a, p) => a + (p.plan?.engineCalls ?? 0), 0);

  const mine = new AbortController();
  comparing = mine;
  sim.beginCompare(total);
  const runs: ComparedRun[] = [];
  let done = 0;
  for (const { id, name, sweep, checked, plan } of prepared) {
    if (mine.signal.aborted) break;
    if (!checked.ok || !plan || plan.errors.length > 0 || plan.periods.length === 0) {
      const why = !checked.ok ? checked.errors[0] : plan?.errors[0] ?? "its Timeline has no period";
      runs.push({ id, name, table: null, warnings: [], error: `Not run: ${why}`, sweep });
      continue;
    }
    const before = done;
    try {
      const parameters = parameterValues(checked.doc, sweep ? { [sweep.parameter]: sweep.value } : {});
      const record = await runOn(input, checked.doc, plan, parameters, {
        signal: mine.signal,
        stopped: () => mine.signal.aborted,
        onProgress: (k, label) => useTemporalSimulationStore.getState().setCompareProgress(before + k, `${name} · ${label}`),
      });
      runs.push({ id, name, table: runTable(record, checked.doc.metrics, input.n, checked.doc.standard_metrics), warnings: record.warnings, sweep });
    } catch (e) {
      if (mine.signal.aborted) break;
      runs.push({ id, name, table: null, warnings: [], error: stoppedMessage(e), sweep });
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
