"use client";

import React, { useState } from "react";
import { X, Minimize2, BarChart2, BarChart3, Workflow, Network, Zap } from "lucide-react";
import { useAnalysisStore } from "@/store/analysis-store";
import { useScorecardStore } from "@/store/scorecard-store";
import { useCanvasStore } from "@/store/canvas-store";
import { SectionTopological } from "./section-topological";
import { SectionReachability } from "./section-reachability";
import { SectionStructural } from "./section-structural";
import { SectionModelBased } from "./section-model-based";
import { cn } from "@/lib/utils";
import type { AnalysisSection } from "@/store/analysis-store";
import type { AnalysisScorecardEntry } from "@/lib/schemas/network";

// ---------------------------------------------------------------------------
// Save-to-Scorecard dialog
// ---------------------------------------------------------------------------

function SaveDialog({ onClose }: { onClose: () => void }) {
  const [label, setLabel] = useState("");
  const result = useAnalysisStore((s) => s.result);
  const activeMetric = useAnalysisStore((s) => s.activeMetric);
  const scope = useAnalysisStore((s) => s.scope);
  const activeCanvasId = useCanvasStore((s) => s.activeCanvasId);
  const addEntry = useScorecardStore((s) => s.addScorecardEntry);

  function handleSave() {
    if (!result || !label.trim()) return;
    const snapshot = useCanvasStore.getState().toGraphSnapshot();
    const entry: AnalysisScorecardEntry = {
      type: "analysis",
      id: crypto.randomUUID(),
      label: label.trim(),
      created_at: new Date().toISOString(),
      metric: activeMetric,
      scope,
      canvas_id: scope === "local" ? (activeCanvasId ?? undefined) : undefined,
      scores: result.scores,
      snapshot,
    };
    addEntry(entry);
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
          className="mb-4 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 placeholder-zinc-400 focus:border-indigo-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!label.trim() || !result}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
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

  if (!isOpen) return null;

  return (
    <>
      {/* Full-page overlay */}
      <div className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-zinc-950">
        {/* Top bar */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-200 px-4 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <BarChart2 size={16} className="text-indigo-600" />
            <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Topological Analysis</span>
          </div>

          <div className="flex items-center gap-2">
            {/* Save to Scorecard */}
            <button
              onClick={() => setSaveDialogOpen(true)}
              disabled={!result}
              className="rounded-lg border border-indigo-200 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-40 dark:border-indigo-800 dark:text-indigo-400 dark:hover:bg-indigo-900/30"
            >
              Save to Scorecard
            </button>

            {/* Minimize */}
            <button
              onClick={closeAnalysisPage}
              title="Minimize — heatmap persists on canvas"
              className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <Minimize2 size={13} />
              Minimize
            </button>

            {/* Close (clears heatmap) */}
            <button
              onClick={() => {
                useAnalysisStore.getState().clearHeatmap();
                closeAnalysisPage();
              }}
              title="Close and clear heatmap"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex min-h-0 flex-1">
          {/* Left sidebar */}
          <div className="flex w-56 shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800">
            {/* Scope toggle */}
            <div className="border-b border-zinc-100 p-3 dark:border-zinc-800">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-400">Scope</p>
              <div className="flex overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
                {(["local", "global"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setScope(s)}
                    className={cn(
                      "flex-1 py-1.5 text-xs font-medium transition-colors",
                      scope === s
                        ? "bg-indigo-600 text-white"
                        : "text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800",
                    )}
                  >
                    {s === "local" ? "Canvas" : "Global"}
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
                    "flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors",
                    activeSection === sec.id
                      ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300"
                      : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800",
                  )}
                >
                  <span className={cn(activeSection === sec.id ? "text-indigo-600" : "text-zinc-400")}>
                    {sec.icon}
                  </span>
                  {sec.label}
                </button>
              ))}
            </nav>

            {/* Footer hint */}
            <div className="border-t border-zinc-100 p-3 dark:border-zinc-800">
              <p className="text-[10px] text-zinc-400">
                ★ = recommended for current graph type
              </p>
            </div>
          </div>

          {/* Main content */}
          <div className="min-w-0 flex-1 overflow-y-auto p-6">
            <div className="mx-auto max-w-2xl">
              {activeSection === "topological" && <SectionTopological />}
              {activeSection === "reachability" && <SectionReachability />}
              {activeSection === "structural" && <SectionStructural />}
              {activeSection === "model-based" && <SectionModelBased />}
            </div>
          </div>
        </div>
      </div>

      {saveDialogOpen && <SaveDialog onClose={() => setSaveDialogOpen(false)} />}
    </>
  );
}
