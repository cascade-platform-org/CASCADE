"use client";

import { useMemo, useState } from "react";
import { Play, RotateCcw, Save, Download, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTemporalSimulationStore } from "@/store/temporal-simulation-store";
import { useAuthStore } from "@/store/auth-store";
import { useUiStore } from "@/store/ui-store";
import { useConfigStore, selectN } from "@/store/config-store";
import { brandColor } from "@/lib/brand";
import { cancelTemporalSimulationRun, endTemporalSimulationRun, exportRunCsv, savePeriodsToScorecard, startTemporalSimulationRun } from "@/lib/temporal-simulation-run";
import type { RunRecord } from "@/lib/step-operator";
import { STANDARD_COLUMNS, formatMetric, runTable } from "@/lib/temporal-metrics";
import {
  EXPLAIN_END_RUN,
  EXPLAIN_EXPORT_CSV,
  EXPLAIN_SAVE_SCORECARD,
  explainDisplay,
  explainRun,
  explainSelectPeriod,
} from "@/lib/temporal-simulation-explainers";
import { Notices, Segmented, SmallButton, useEventLookup, usePlan } from "./fields";


const NONE: ReadonlySet<number> = new Set();

export function RunTab() {
  const unsaved = useTemporalSimulationStore((s) => s.unsaved);
  const running = useTemporalSimulationStore((s) => s.running);
  const progress = useTemporalSimulationStore((s) => s.runProgress);
  const runError = useTemporalSimulationStore((s) => s.runError);
  const runWarnings = useTemporalSimulationStore((s) => s.runRecord?.warnings);
  // The Run View: a finished run is shown, and its periods can be selected.
  const hasRun = useTemporalSimulationStore((s) => s.runRecord !== null);
  const canPropagate = useAuthStore((s) => s.hasPermission("can_propagate"));
  const serverReachable = useUiStore((s) => s.serverReachable);
  const selected = useTemporalSimulationStore((s) => s.selectedPeriod);
  const display = useTemporalSimulationStore((s) => s.display);
  const reading = useTemporalSimulationStore((s) => s.levelReading);
  const metrics = useTemporalSimulationStore((s) => s.metrics);
  const standard = useTemporalSimulationStore((s) => s.standardMetrics);
  // Before a run: the shown standard Metrics' names, a column each before the custom ones.
  const standardNames = standard.map((m) => STANDARD_COLUMNS[m]);
  const levelScale = useConfigStore((s) => s.config.level_scale);
  const record = useTemporalSimulationStore((s) => s.runRecord);
  const n = useConfigStore(selectN);
  // The run's table: computed at read time from the run record (ADR-0019 §4).
  const table = useMemo(() => (record ? runTable(record, metrics.map((m) => m.metric), n, standard) : null), [record, metrics, n, standard]);
  const { explain, selectPeriod, setDisplay, setLevelReading } = useTemporalSimulationStore.getState();
  const { eventLabel } = useEventLookup();
  // Periods unticked for Save to Scorecard; every period starts ticked, for each new run.
  const [unticked, setUnticked] = useState<{ record: RunRecord | null; numbers: ReadonlySet<number> }>({ record: null, numbers: new Set() });
  const skipped = unticked.record === record ? unticked.numbers : NONE;
  const tick = (numbers: number[], on: boolean) =>
    setUnticked({ record, numbers: new Set(on ? [...skipped].filter((x) => !numbers.includes(x)) : [...skipped, ...numbers]) });

  const plan = usePlan();
  const toSave = hasRun ? plan.periods.map((p) => p.number).filter((x) => !skipped.has(x)) : [];
  // The plan's errors, then the schema errors that keep the draft out of the project: either blocks a run.
  const errors = useMemo(() => [...plan.errors, ...unsaved], [plan, unsaved]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SmallButton
          tone="accent"
          disabled={running || plan.periods.length === 0 || errors.length > 0 || !canPropagate || !serverReachable}
          title={!canPropagate ? "Running needs an account allowed to Propagate" : !serverReachable ? "Server unreachable" : undefined}
          onClick={() => {
            explain(explainRun(plan, eventLabel));
            void startTemporalSimulationRun();
          }}
        >
          <Play size={11} /> Run
        </SmallButton>
        <span className="text-xs text-zinc-500">
          {plan.periods.length} periods · {plan.engineCalls} Propagations ({plan.engineCalls} Engine Evaluations)
        </span>
        <span className="flex-1" />
        <SmallButton disabled={!running} onClick={() => { endTemporalSimulationRun(); explain(EXPLAIN_END_RUN); }} title="Reset does the same">
          <RotateCcw size={11} /> End run
        </SmallButton>
      </div>

      {progress && (
        <div role="status" className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 p-2 text-xs text-blue-800 dark:border-blue-900 dark:bg-blue-900/20 dark:text-blue-300">
          <span className="shrink-0">Running {progress.label && `· ${progress.label}`}</span>
          <progress className="h-1.5 flex-1" max={Math.max(1, progress.total)} value={progress.done} />
          <span className="shrink-0 tabular-nums">{progress.done} / {progress.total} Propagations</span>
          <SmallButton onClick={cancelTemporalSimulationRun}><Square size={10} /> Cancel</SmallButton>
        </div>
      )}

      <Notices tone="error" alert items={runError ? [runError] : []} />
      <Notices tone="warning" items={runWarnings ?? []} />
      <Notices tone="error" items={errors} />
      <Notices tone="warning" items={plan.warnings} />

      {hasRun && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-zinc-200 p-2 dark:border-zinc-700">
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Canvas colours</span>
          <Segmented
            value={display}
            options={[{ id: "functionality", label: "Functionality" }, { id: "level", label: "Level" }]}
            onChange={(d) => { setDisplay(d); explain(explainDisplay(d, reading)); }}
          />
          {display === "level" && (
            <>
              <Segmented
                value={reading}
                options={[{ id: "level", label: "Level" }, { id: "change", label: "Change" }]}
                onChange={(r) => { setLevelReading(r); explain(explainDisplay("level", r)); }}
              />
              <div className="flex items-center gap-1" onClick={() => explain(explainDisplay("level", reading))}>
                {levelScale.map((b) => (
                  <span key={b.label} className="flex items-center gap-1 text-[10px] text-zinc-500">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: brandColor(b.role, b.step) }} />{b.label}
                  </span>
                ))}
              </div>
            </>
          )}
          <span className="flex-1" />
          <SmallButton onClick={() => { explain(EXPLAIN_EXPORT_CSV); if (table) void exportRunCsv(table); }}><Download size={11} /> Export CSV</SmallButton>
          <SmallButton
            onClick={() => {
              explain(EXPLAIN_SAVE_SCORECARD);
              if (table) void savePeriodsToScorecard(table, toSave).then((count) => {
                if (count > 0) useUiStore.getState().pushToast({ message: `Saved ${count} period${count === 1 ? "" : "s"} to the Scorecard.`, variant: "success", durationMs: 3000 });
              });
            }}
            disabled={toSave.length === 0}
            title="Saves the ticked periods, one Scorecard entry each"
          >
            <Save size={11} /> Save {toSave.length} period{toSave.length === 1 ? "" : "s"} to Scorecard
          </SmallButton>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-[10px] uppercase tracking-wider text-zinc-400 dark:border-zinc-700">
              {hasRun && (
                <th className="py-1 pr-1">
                  <input
                    type="checkbox"
                    title="Tick or untick every period for Save to Scorecard"
                    checked={skipped.size === 0}
                    onChange={(e) => tick(plan.periods.map((p) => p.number), e.target.checked)}
                  />
                </th>
              )}
              <th className="py-1 pr-2 font-semibold">#</th>
              <th className="py-1 pr-2 font-semibold">Period</th>
              <th className="py-1 pr-2 font-semibold">Phases</th>
              {table
                ? table.columns.map((c) => <th key={c.key} className="py-1 pr-2 font-semibold">{c.label}</th>)
                : [...standardNames, ...metrics.map((m) => m.metric.name || "metric")].map((m, i) => <th key={i} className="py-1 pr-2 font-semibold">{m}</th>)}
            </tr>
          </thead>
          <tbody>
            {plan.periods.map((p) => (
              <tr
                key={p.number}
                onClick={() => { if (hasRun) selectPeriod(p.number); explain(explainSelectPeriod(p, eventLabel)); }}
                className={cn(
                  "cursor-pointer border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/60",
                  selected === p.number && hasRun && "bg-blue-50 dark:bg-blue-900/20",
                )}
              >
                {hasRun && (
                  <td className="py-1 pr-1" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" title="Save this period to the Scorecard" checked={!skipped.has(p.number)} onChange={(e) => tick([p.number], e.target.checked)} />
                  </td>
                )}
                <td className="py-1 pr-2 text-zinc-400">{p.number}</td>
                <td className="py-1 pr-2 font-medium text-zinc-700 dark:text-zinc-200">{p.label}</td>
                <td className="py-1 pr-2">
                  <span className="flex flex-wrap gap-1">
                    {p.phases.map((ph) => (
                      <span
                        key={ph.index}
                        title={ph.events.map(eventLabel).join(", ") || "no Events"}
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[10px]",
                          ph.propagate ? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800",
                        )}
                      >
                        P{ph.index + 1}{ph.propagate ? " ▶" : ""}{ph.events.length ? ` ·${ph.events.length}` : ""}
                      </span>
                    ))}
                  </span>
                </td>
                {table
                  ? table.rows[p.number - 1]?.values.map((v, i) => <td key={i} className="py-1 pr-2 tabular-nums text-zinc-700 dark:text-zinc-200">{formatMetric(v)}</td>)
                  : [...standardNames, ...metrics].map((_, i) => <td key={i} className="py-1 pr-2 text-zinc-300" title="Computed from the run record after a run">—</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[11px] text-zinc-400">▶ propagates · ·n Events. After a run, click a period to show its end state on the canvas; the Metric columns are computed from the run record.</p>
      </div>
    </div>
  );
}
