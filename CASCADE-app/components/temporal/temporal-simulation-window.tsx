"use client";

/**
 * TemporalSimulationWindow — the project's Temporal Simulations
 * (ADR-0019/0020/0021, requirements §9.6).
 *
 * The picker on top selects which Simulation the tabs edit and Run runs; the
 * tabs edit it through `store/temporal-simulation-store.ts`, which saves every
 * valid edit into the project; the status line says when an
 * edit is not saved and why. Run computes on a Reset copy and shows the Run
 * View (`lib/temporal-simulation-run.ts`); the model is never written. The
 * bottom panel explains each control.
 */

import React from "react";
import { CalendarClock, ListOrdered, Play, Sigma, Info, Braces, Plus, Copy, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { FloatingWindow } from "@/components/ui/floating-window";
import { TEMPORAL_SIMULATION_ANCHOR_ID } from "@/lib/ui-anchors";
import { useTemporalSimulationStore, type SimTab } from "@/store/temporal-simulation-store";
import { useUiStore } from "@/store/ui-store";
import { EXPLAIN_TAB } from "@/lib/temporal-simulation-explainers";
import { TimelineTab } from "./timeline-tab";
import { RunTab } from "./run-tab";
import { MetricsTab } from "./metrics-tab";
import { TextTab } from "./text-tab";
import { SmallButton } from "./fields";
import { useCanvasStore } from "@/store/canvas-store";

/** `definition`: the tab edits the Temporal Simulation, so it is read-only while a run is shown. */
const TABS: { id: SimTab; label: string; icon: React.ReactNode; definition?: true }[] = [
  { id: "timeline", label: "Timeline", icon: <ListOrdered size={15} />, definition: true },
  { id: "run", label: "Run", icon: <Play size={15} /> },
  { id: "metrics", label: "Metrics", icon: <Sigma size={15} />, definition: true },
  { id: "text", label: "Text", icon: <Braces size={15} />, definition: true },
];

/** Whether the definition is in the project, and why not when it is not. */
function SaveStatus() {
  const unsaved = useTemporalSimulationStore((s) => s.unsaved);
  const started = useTemporalSimulationStore((s) => s.simulations.some((x) => x.id === s.selectedId));
  if (unsaved.length > 0) {
    return (
      <div role="status" className="border-b border-red-200 bg-red-50 px-4 py-1.5 text-[11px] text-red-800 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300">
        Not saved in the project — {unsaved[0]}{unsaved.length > 1 ? ` (and ${unsaved.length - 1} more)` : ""}. The project keeps the last valid version.
      </div>
    );
  }
  return (
    <div role="status" className="border-b border-zinc-200 px-4 py-1.5 text-[11px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
      {started ? "Saved in the project." : "A starter Timeline. Your first edit saves it into the project."}
    </div>
  );
}

/**
 * Which Simulation the tabs edit and Run runs, and its scope. Read-only while a
 * run is shown: the run belongs to the selected Simulation.
 */
function SimulationPicker() {
  const simulations = useTemporalSimulationStore((s) => s.simulations);
  const selectedId = useTemporalSimulationStore((s) => s.selectedId);
  const name = useTemporalSimulationStore((s) => s.timeline.name);
  const scope = useTemporalSimulationStore((s) => s.scope);
  const canvas = useTemporalSimulationStore((s) => s.canvas);
  const running = useTemporalSimulationStore((s) => s.running);
  const canvasLabel = useCanvasStore((s) => (canvas === undefined ? undefined : s.canvases[canvas]?.label));
  const { selectSimulation, addSimulation, duplicateSimulation, deleteSimulation } = useTemporalSimulationStore.getState();
  const saved = simulations.some((x) => x.id === selectedId);

  return (
    <div data-run-locked className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
      <select
        aria-label="Temporal Simulation"
        value={selectedId}
        disabled={running}
        onChange={(e) => selectSimulation(e.target.value)}
        className="max-w-[22rem] truncate rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-800 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
      >
        {!saved && <option value={selectedId}>{name} (not saved)</option>}
        {simulations.map((x) => <option key={x.id} value={x.id}>{x.id === selectedId ? name : x.timeline.name}</option>)}
      </select>
      <SmallButton disabled={running} title="A new Temporal Simulation, from the starter Timeline" onClick={addSimulation}><Plus size={11} /> New</SmallButton>
      <SmallButton disabled={running || !saved} title="A copy of this Temporal Simulation" onClick={duplicateSimulation}><Copy size={11} /> Duplicate</SmallButton>
      <SmallButton
        tone="danger"
        disabled={running || !saved}
        title="Delete this Temporal Simulation from the project"
        onClick={() => { if (window.confirm(`Delete the Temporal Simulation "${name}"? Its saved Scorecard entries stay.`)) deleteSimulation(selectedId); }}
      >
        <Trash2 size={11} /> Delete
      </SmallButton>
      <span className="flex-1" />
      <span className="text-[11px] text-zinc-500 dark:text-zinc-400" title="Pick it on the Simulate button's scope side">
        Scope: <span className="font-medium">{scope === "local" ? `local — ${canvasLabel ?? `missing Canvas "${canvas}"`}` : "global"}</span>
      </span>
    </div>
  );
}

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
  const running = useTemporalSimulationStore((s) => s.running);
  const locked = running && TABS.some((t) => t.id === tab && t.definition);
  // The window floats above modals; step aside while Config is open ("Create
  // new Event" opens it) and come back when it closes.
  const configModalOpen = useUiStore((s) => s.configModalOpen);
  const { closeWindow, setTab, explain } = useTemporalSimulationStore.getState();

  return (
    <FloatingWindow
      open={open && !configModalOpen}
      onClose={closeWindow}
      title="Temporal Simulation"
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
        <SimulationPicker />
        <SaveStatus />
        {locked && (
          <div className="border-b border-blue-200 bg-blue-50 px-4 py-1.5 text-[11px] text-blue-800 dark:border-blue-900 dark:bg-blue-900/20 dark:text-blue-300">
            A run is shown, so the definition is read-only. End run (Run tab) to edit it; every change over time goes in before the run.
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {/* The store refuses definition writes while a run is shown (ADR-0019 §1); the disabled
              fieldset says so in the controls. Text stays live so it can be read and copied. */}
          <fieldset data-run-locked disabled={locked && tab !== "text"} className="contents">
          {tab === "timeline" && <TimelineTab />}
          {tab === "run" && <RunTab />}
          {tab === "metrics" && <MetricsTab />}
          {tab === "text" && <TextTab />}
          </fieldset>
        </div>
        <ExplanationPanel />
      </div>
    </FloatingWindow>
  );
}
