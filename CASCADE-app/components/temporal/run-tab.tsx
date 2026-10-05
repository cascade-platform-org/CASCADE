"use client";

import { useMemo } from "react";
import { Play, RotateCcw, Undo2, Eraser, Eye, Save, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useConfigStore } from "@/store/config-store";
import { timelineKey, useTemporalSimulationStore } from "@/store/temporal-simulation-store";
import { planTimeline } from "@/lib/timeline-plan";
import {
  EXPLAIN_CLEAR_RUN,
  EXPLAIN_RESET_RUN,
  EXPLAIN_SAVE_SCORECARD,
  EXPLAIN_SHOW_STATE,
  EXPLAIN_STALE,
  EXPLAIN_UNDO_RUN,
  explainDisplay,
  explainRun,
  explainSelectPeriod,
} from "@/lib/temporal-simulation-explainers";
import { Segmented, SmallButton } from "./fields";

/** Default Level Scale bands. Tailwind ramps are brand-driven (CLAUDE.md §5). */
const LEVEL_BANDS = [
  { label: "large deficit", cls: "bg-red-600" },
  { label: "deficit", cls: "bg-red-300" },
  { label: "balanced", cls: "bg-zinc-300" },
  { label: "surplus", cls: "bg-blue-300" },
  { label: "large surplus", cls: "bg-blue-600" },
];

export function RunTab() {
  const timeline = useTemporalSimulationStore((s) => s.timeline);
  const lastRunKey = useTemporalSimulationStore((s) => s.lastRunKey);
  const selected = useTemporalSimulationStore((s) => s.selectedPeriod);
  const display = useTemporalSimulationStore((s) => s.display);
  const reading = useTemporalSimulationStore((s) => s.levelReading);
  const metrics = useTemporalSimulationStore((s) => s.metrics);
  const { explain, markRun, selectPeriod, setDisplay, setLevelReading } = useTemporalSimulationStore.getState();
  const events = useConfigStore((s) => s.config.events);
  const eventLabel = (id: string) => events.find((e) => e.id === id)?.label ?? id;

  const plan = useMemo(() => planTimeline(timeline), [timeline]);
  const hasRun = lastRunKey !== null;
  const stale = hasRun && lastRunKey !== timelineKey(timeline);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SmallButton
          tone="accent"
          disabled={plan.periods.length === 0}
          onClick={() => {
            explain(explainRun(plan, eventLabel));
            if (plan.warnings.length === 0) markRun();
          }}
        >
          <Play size={11} /> {hasRun ? "Re-run (dry)" : "Run (dry)"}
        </SmallButton>
        <span className="text-xs text-zinc-500">
          {plan.periods.length} periods · {plan.engineCalls} Propagations ({plan.engineCalls} Engine Evaluations)
        </span>
        <span className="flex-1" />
        <SmallButton disabled={!hasRun} onClick={() => explain(EXPLAIN_UNDO_RUN)} title="Ctrl+Z"><Undo2 size={11} /> Undo run</SmallButton>
        <SmallButton disabled={!hasRun} onClick={() => explain(EXPLAIN_CLEAR_RUN)} title="Ctrl+R"><Eraser size={11} /> Clear run</SmallButton>
        <SmallButton disabled={!hasRun} onClick={() => explain(EXPLAIN_RESET_RUN)}><RotateCcw size={11} /> Reset</SmallButton>
      </div>

      {plan.warnings.length > 0 && (
        <ul className="space-y-1 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          {plan.warnings.map((w, i) => <li key={i} className="flex gap-1.5"><AlertTriangle size={12} className="mt-0.5 shrink-0" />{w}</li>)}
        </ul>
      )}

      {stale && (
        <button
          type="button"
          onClick={() => explain(EXPLAIN_STALE)}
          className="flex w-full items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-left text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300"
        >
          <AlertTriangle size={12} /> The Timeline changed since the last run — the run is stale. Click for what that means.
        </button>
      )}

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
                {LEVEL_BANDS.map((b) => (
                  <span key={b.label} className="flex items-center gap-1 text-[10px] text-zinc-500">
                    <span className={cn("h-2.5 w-2.5 rounded-sm", b.cls)} />{b.label}
                  </span>
                ))}
              </div>
            </>
          )}
          <span className="flex-1" />
          <SmallButton disabled={selected === null} onClick={() => explain(EXPLAIN_SAVE_SCORECARD)}><Save size={11} /> Save period to Scorecard</SmallButton>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-[10px] uppercase tracking-wider text-zinc-400 dark:border-zinc-700">
              <th className="py-1 pr-2 font-semibold">#</th>
              <th className="py-1 pr-2 font-semibold">Period</th>
              <th className="py-1 pr-2 font-semibold">Phases</th>
              <th className="py-1 pr-2 font-semibold">Hours</th>
              <th className="py-1 pr-2 font-semibold">Operativity</th>
              {metrics.map((m) => <th key={m.id} className="py-1 pr-2 font-semibold">{m.name || "metric"}</th>)}
              <th />
            </tr>
          </thead>
          <tbody>
            {plan.periods.map((p) => (
              <tr
                key={p.number}
                onClick={() => { if (hasRun) { selectPeriod(p.number); } explain(explainSelectPeriod(p, eventLabel)); }}
                className={cn(
                  "cursor-pointer border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/60",
                  selected === p.number && hasRun && "bg-blue-50 dark:bg-blue-900/20",
                )}
              >
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
                        P{ph.index + 1}{ph.propagate ? " ▶" : ""}{ph.events.length ? ` ·${ph.events.length}` : ""}{ph.integratesAfter ? " ∫" : ""}
                      </span>
                    ))}
                  </span>
                </td>
                <td className="py-1 pr-2 text-zinc-500">{p.advanceHours}</td>
                <td className="py-1 pr-2 text-zinc-300" title="Computed at read time from the run record">—</td>
                {metrics.map((m) => <td key={m.id} className="py-1 pr-2 text-zinc-300">—</td>)}
                <td className="py-1">
                  {hasRun && (
                    <button
                      type="button"
                      title="Show full state"
                      className="text-zinc-400 hover:text-blue-600"
                      onClick={(e) => { e.stopPropagation(); explain(EXPLAIN_SHOW_STATE); }}
                    >
                      <Eye size={12} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[11px] text-zinc-400">▶ propagates · ·n Events · ∫ Stocks integrate after this Phase. Values show “—” because the prototype never calls the engine.</p>
      </div>
    </div>
  );
}
