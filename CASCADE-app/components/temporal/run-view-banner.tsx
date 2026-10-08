"use client";

/**
 * RunViewBanner — under the Action Bar while a Temporal Simulation run is
 * computing or shown (ADR-0019 §3). The canvas then paints a run period, not
 * the model, so this has to be visible with the window closed: which period,
 * stepping through periods, and End run, which pulses when something the run
 * blocks is used (`end-run-cue.ts`).
 */

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useTemporalSimulationStore } from "@/store/temporal-simulation-store";
import { endTemporalSimulationRun } from "@/lib/temporal-simulation-run";
import { cn } from "@/lib/utils";
import { CUE_CLASS, useEndRunCue, useRunLockedPresses } from "./end-run-cue";

export function RunViewBanner() {
  const running = useTemporalSimulationStore((s) => s.running);
  const progress = useTemporalSimulationStore((s) => s.runProgress);
  const record = useTemporalSimulationStore((s) => s.runRecord);
  const selected = useTemporalSimulationStore((s) => s.selectedPeriod);
  const { selectPeriod, openWindow } = useTemporalSimulationStore.getState();
  const { cued, ref } = useEndRunCue<HTMLButtonElement>();
  // Mounted once with the editor, so the one listener for blocked controls lives here.
  useRunLockedPresses();
  if (!running) return null;

  const total = record?.periods.length ?? 0;
  const btn = "rounded p-0.5 hover:bg-blue-100 disabled:opacity-30 dark:hover:bg-blue-900/40";
  return (
    <div role="status" className="flex h-8 shrink-0 items-center gap-2 border-b border-blue-200 bg-blue-50 px-3 text-xs text-blue-800 dark:border-blue-900 dark:bg-blue-900/20 dark:text-blue-300">
      <button type="button" className="font-semibold hover:underline" onClick={openWindow}>Temporal Simulation</button>
      {record ? (
        <>
          <button type="button" className={btn} title="Previous period" disabled={selected <= 1} onClick={() => selectPeriod(selected - 1)}><ChevronLeft size={13} /></button>
          <span className="tabular-nums">
            Period {selected} / {total} · <span className="font-medium">{record.periods[selected - 1]?.label}</span>
          </span>
          <button type="button" className={btn} title="Next period" disabled={selected >= total} onClick={() => selectPeriod(selected + 1)}><ChevronRight size={13} /></button>
          <span className="text-blue-600/80 dark:text-blue-400/80">The canvas shows this period, read-only. Your model is unchanged.</span>
        </>
      ) : (
        <span>Running… {progress ? `${progress.done} / ${progress.total} Propagations${progress.label ? ` · ${progress.label}` : ""}` : ""}. The model is read-only until the run ends.</span>
      )}
      <span className="flex-1" />
      <button ref={ref} type="button" className={cn("flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-blue-100 dark:hover:bg-blue-900/40", cued && CUE_CLASS)} onClick={() => endTemporalSimulationRun()}>
        <X size={12} /> End run
      </button>
    </div>
  );
}
