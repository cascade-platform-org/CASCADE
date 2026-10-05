"use client";

/**
 * TemporalSimulationWindow — PROTOTYPE of the Temporal Simulation UI
 * (ADR-0019/0020/0021, requirements §9.6).
 *
 * Every control edits a local draft (`store/temporal-simulation-store.ts`) and
 * shows, in the bottom panel, what the built feature will do. Nothing here
 * writes to the canvas or history or calls the engine; the only real logic is
 * the pure plan (`lib/timeline-plan.ts`) and the Stock formulas
 * (`lib/stock-math.ts`), which the built feature keeps.
 */

import React from "react";
import { CalendarClock, ListOrdered, Play, Sigma, Database, Info, Braces } from "lucide-react";
import { cn } from "@/lib/utils";
import { FloatingWindow } from "@/components/ui/floating-window";
import { TEMPORAL_SIMULATION_ANCHOR_ID } from "@/lib/ui-anchors";
import { useTemporalSimulationStore, type SimTab } from "@/store/temporal-simulation-store";
import { useUiStore } from "@/store/ui-store";
import { EXPLAIN_TAB } from "@/lib/temporal-simulation-explainers";
import { TimelineTab } from "./timeline-tab";
import { RunTab } from "./run-tab";
import { MetricsTab } from "./metrics-tab";
import { StockTab } from "./stock-tab";
import { TextTab } from "./text-tab";

const TABS: { id: SimTab; label: string; icon: React.ReactNode }[] = [
  { id: "timeline", label: "Timeline", icon: <ListOrdered size={15} /> },
  { id: "run", label: "Run", icon: <Play size={15} /> },
  { id: "metrics", label: "Metrics", icon: <Sigma size={15} /> },
  { id: "stock", label: "Stock", icon: <Database size={15} /> },
  { id: "text", label: "Text", icon: <Braces size={15} /> },
];

/** "What this will do": the only subscriber to `explanation`, so explaining re-renders this panel alone. */
function ExplanationPanel() {
  const explanation = useTemporalSimulationStore((s) => s.explanation);
  return (
    <section
      aria-live="polite"
      className="max-h-[40%] shrink-0 overflow-y-auto border-t border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/60"
    >
      <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-200">
        <Info size={13} className="text-blue-600" /> What this will do — {explanation.title}
      </p>
      <ul className="list-disc space-y-0.5 pl-5 text-xs text-zinc-600 dark:text-zinc-400">
        {explanation.lines.map((l, i) => <li key={i}>{l}</li>)}
      </ul>
      {explanation.refs.length > 0 && (
        <p className="mt-1.5 text-[10px] text-zinc-400">Specified in: {explanation.refs.join(" · ")}</p>
      )}
    </section>
  );
}

export function TemporalSimulationWindow() {
  const open = useTemporalSimulationStore((s) => s.open);
  const tab = useTemporalSimulationStore((s) => s.tab);
  // The window floats above modals; step aside while Config is open ("Create
  // new Event" opens it) and come back when it closes.
  const configModalOpen = useUiStore((s) => s.configModalOpen);
  const { closeWindow, setTab, explain } = useTemporalSimulationStore.getState();

  return (
    <FloatingWindow
      open={open && !configModalOpen}
      onClose={closeWindow}
      title="Temporal Simulation — prototype"
      icon={<CalendarClock size={15} className="shrink-0 text-blue-600 dark:text-blue-400" />}
      flyToOnClose={TEMPORAL_SIMULATION_ANCHOR_ID}
      storageKey="cascade.temporal-simulation.window"
      defaultSize={{ w: 960, h: 680 }}
      minSize={{ w: 640, h: 400 }}
    >
      <nav className="flex w-40 shrink-0 flex-col gap-0.5 border-r border-zinc-200 p-2 dark:border-zinc-800">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => { setTab(t.id); explain(EXPLAIN_TAB[t.id]); }}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors",
              tab === t.id
                ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800",
            )}
          >
            <span className={cn(tab === t.id ? "text-blue-600" : "text-zinc-400")}>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-[11px] text-amber-800 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-300">
          Prototype: this edits a draft and explains each interaction below. Your model, the history and the engine are never touched.
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {tab === "timeline" && <TimelineTab />}
          {tab === "run" && <RunTab />}
          {tab === "metrics" && <MetricsTab />}
          {tab === "stock" && <StockTab />}
          {tab === "text" && <TextTab />}
        </div>
        <ExplanationPanel />
      </div>
    </FloatingWindow>
  );
}
