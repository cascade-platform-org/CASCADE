"use client";

import React from "react";
import { Palette, X } from "lucide-react";
import { useAnalysisStore } from "@/store/analysis-store";
import { buildColorMap } from "@/lib/analysis-legend";
import { buildHeatmapLegend } from "@/lib/analysis-legend";
import { LegendView } from "./legend-view";
import type { AnalysisResult } from "@/lib/topological-analysis";

interface HeatmapControlsProps {
  /**
   * The Analysis Metric's name as this section spells it. It travels with the
   * heatmap into the canvas legend, so the user reading colours on the canvas
   * sees the same name the Analysis page used.
   */
  title: string;
  result?: AnalysisResult;
  edgeResult?: AnalysisResult;
}

export function HeatmapControls({ title, result, edgeResult }: HeatmapControlsProps) {
  const heatmapActive = useAnalysisStore((s) => s.heatmapActive);
  const applyHeatmap = useAnalysisStore((s) => s.applyHeatmap);
  const clearHeatmap = useAnalysisStore((s) => s.clearHeatmap);
  const closeAnalysisPage = useAnalysisStore((s) => s.closeAnalysisPage);

  function handleToggle() {
    if (heatmapActive) {
      // Clearing does NOT minimize: the user is standing in the Analysis page
      // and has just removed the overlay, so there is nothing on the canvas to
      // go and look at.
      clearHeatmap();
      return;
    }
    const nodeColors = result ? buildColorMap(result) : {};
    const edgeColors = edgeResult ? buildColorMap(edgeResult) : {};
    applyHeatmap(
      { ...nodeColors, ...edgeColors },
      buildHeatmapLegend({ title, result, edgeResult }),
    );
    // Applying an overlay to a canvas the full-page Analysis overlay is hiding
    // is useless on its own. The button used to only apply and ask the user, in
    // its own label, to go press Minimize in the top bar — so it read as a
    // promise it did not keep. Minimizing is the same action that button runs;
    // the heatmap survives it (only the X clears).
    closeAnalysisPage();
  }

  const legend = useAnalysisStore((s) => s.heatmapLegend);
  const hasMultiple = !!(legend?.nodes && legend?.edges);

  return (
    <div className="space-y-2">
      <button
        onClick={handleToggle}
        className={`flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
          heatmapActive
            ? "border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-300"
            : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
        }`}
      >
        {heatmapActive ? <X size={13} /> : <Palette size={13} />}
        {heatmapActive ? "Clear heatmap" : "Apply heatmap & minimize"}
      </button>

      {heatmapActive && legend?.nodes && (
        <div className="rounded-lg border border-zinc-100 p-2 dark:border-zinc-800">
          {hasMultiple && (
            <p className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-zinc-400">Nodes</p>
          )}
          <LegendView legend={legend.nodes} />
        </div>
      )}
      {heatmapActive && legend?.edges && (
        <div className="rounded-lg border border-zinc-100 p-2 dark:border-zinc-800">
          {hasMultiple && (
            <p className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-zinc-400">Edges</p>
          )}
          <LegendView legend={legend.edges} />
        </div>
      )}
    </div>
  );
}
