"use client";

import React, { useState } from "react";
import { BarChart2, BarChart3, Workflow, Network, Zap } from "lucide-react";
import { FloatingWindow } from "@/components/ui/floating-window";
import { useAnalysisStore } from "@/store/analysis-store";
import { useScorecardStore } from "@/store/scorecard-store";
import { useCanvasStore } from "@/store/canvas-store";
import { SectionTopological } from "./section-topological";
import { SectionReachability } from "./section-reachability";
import { SectionStructural } from "./section-structural";
import { SectionModelBased } from "./section-model-based";
import { buildAnalysisEntry } from "@/lib/analysis-entry";
import { cn } from "@/lib/utils";
import type { AnalysisSection } from "@/store/analysis-store";

// ---------------------------------------------------------------------------
// Save-to-Scorecard dialog
// ---------------------------------------------------------------------------

function SaveDialog({ onClose }: { onClose: () => void }) {
  const [label, setLabel] = useState("");
  const result = useAnalysisStore((s) => s.result);
  const scope = useAnalysisStore((s) => s.scope);
  const activeCanvasId = useCanvasStore((s) => s.activeCanvasId);
  const addEntry = useScorecardStore((s) => s.addScorecardEntry);

  function handleSave() {
    if (!result || !label.trim()) return;
    // The metric comes from the Result, never from the store's `activeMetric`
    // — see lib/analysis-entry.ts for what that used to record.
    addEntry(
      buildAnalysisEntry({
        result,
        label,
        scope,
        activeCanvasId,
        snapshot: useCanvasStore.getState().toGraphSnapshot(),
        id: crypto.randomUUID(),
      }),
    );
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-80 rounded-xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 text-sm font-semibold text-zinc-800 dark:text-zinc-100">Save Analysis to Scorecard</h3>
        <input
          autoFocus
          type="text"
          placeholder="Entry label…"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") onClose(); }}
          className="mb-4 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 placeholder-zinc-400 focus:border-blue-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!label.trim() || !result}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar navigation
// ---------------------------------------------------------------------------

const SECTIONS: { id: AnalysisSection; label: string; icon: React.ReactNode }[] = [
  { id: "topological", label: "Centrality", icon: <BarChart3 size={15} /> },
  { id: "reachability", label: "Reachability", icon: <Workflow size={15} /> },
  { id: "structural", label: "Structural", icon: <Network size={15} /> },
  { id: "model-based", label: "Model-Based", icon: <Zap size={15} /> },
];

// ---------------------------------------------------------------------------
// Main analysis page
// ---------------------------------------------------------------------------

export function AnalysisPage() {
  const isOpen = useAnalysisStore((s) => s.analysisPageOpen);
  const closeAnalysisPage = useAnalysisStore((s) => s.closeAnalysisPage);
  const activeSection = useAnalysisStore((s) => s.activeSection);
  const setActiveSection = useAnalysisStore((s) => s.setActiveSection);
  const scope = useAnalysisStore((s) => s.scope);
  const setScope = useAnalysisStore((s) => s.setScope);
  const result = useAnalysisStore((s) => s.result);

  const [saveDialogOpen, setSaveDialogOpen] = useState(false);

  return (
    <>
      <FloatingWindow
        open={isOpen}
        onClose={closeAnalysisPage}
        title="Analysis"
        icon={<BarChart2 size={15} className="shrink-0 text-blue-600 dark:text-blue-400" />}
        storageKey="cascade.analysis.window"
        defaultSize={{ w: 880, h: 620 }}
        minSize={{ w: 560, h: 320 }}
        headerActions={
          <button
            onClick={() => setSaveDialogOpen(true)}
            disabled={!result}
            title={result ? "Save this Analysis to the Scorecard" : "Run an Analysis Metric first"}
            className="rounded-lg border border-blue-200 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-40 dark:border-blue-800 dark:text-blue-400 dark:hover:bg-blue-900/30"
          >
            Save to Scorecard
          </button>
        }
      >
        {/* Left sidebar */}
        <div className="flex w-44 shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800">
          {/* Scope — the same local/global pair CONTEXT.md defines for
              Propagation, and the same choice the Analyse button offers before
              the window is even opened. Both write this one store field. */}
          <div className="border-b border-zinc-100 p-3 dark:border-zinc-800">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-400">Scope</p>
            <div className="flex overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
              {(["local", "global"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setScope(s)}
                  className={cn(
                    "flex-1 py-1.5 text-xs font-medium capitalize transition-colors",
                    scope === s
                      ? "bg-blue-600 text-white"
                      : "text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Section nav */}
          <nav className="flex-1 overflow-y-auto p-2">
            {SECTIONS.map((sec) => (
              <button
                key={sec.id}
                onClick={() => setActiveSection(sec.id)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors",
                  activeSection === sec.id
                    ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                    : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800",
                )}
              >
                <span className={cn(activeSection === sec.id ? "text-blue-600" : "text-zinc-400")}>
                  {sec.icon}
                </span>
                {sec.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Main content */}
        <div className="min-w-0 flex-1 overflow-y-auto p-5">
          <div className="mx-auto max-w-2xl">
            {activeSection === "topological" && <SectionTopological />}
            {activeSection === "reachability" && <SectionReachability />}
            {activeSection === "structural" && <SectionStructural />}
            {activeSection === "model-based" && <SectionModelBased />}
          </div>
        </div>
      </FloatingWindow>

      {saveDialogOpen && <SaveDialog onClose={() => setSaveDialogOpen(false)} />}
    </>
  );
}
