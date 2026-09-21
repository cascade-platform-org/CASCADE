"use client";

import { useCallback, useEffect } from "react";
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

  const apply = useCallback(() => {
    const nodeColors = result ? buildColorMap(result) : {};
    const edgeColors = edgeResult ? buildColorMap(edgeResult) : {};
    applyHeatmap(
      { ...nodeColors, ...edgeColors },
      buildHeatmapLegend({ title, result, edgeResult }),
    );
  }, [applyHeatmap, title, result, edgeResult]);

  // Paint a freshly computed Analysis Metric onto the canvas without being
  // asked. Scores that nobody has looked at yet are the reason the user ran the
  // metric, and the Analysis window floats over the canvas, so there is nothing
  // to get out of the way first — the overlay simply appears beside the numbers
  // that explain it.
  //
  // This fires once per Result rather than once per render: every route into a
  // new Result (a run finishing, an Operativity re-weighting) replaces the
  // object, and every route that invalidates one — switching section, metric or
  // scope — sets it to null and unmounts this component. So a Result the user
  // has explicitly cleared cannot be resurrected by a re-render, and a heatmap
  // already on screen follows a re-weighting instead of going stale.
  useEffect(() => {
    if (!result && !edgeResult) return;
    apply();
  }, [result, edgeResult, apply]);

  // The button is now the way back after an explicit Clear, and the way out.
  // It used to also close the Analysis page on apply, because the page was a
  // full-screen overlay and an overlay on the canvas underneath was invisible
  // until you got the page out of the way.
  function handleToggle() {
    if (heatmapActive) {
      clearHeatmap();
      return;
    }
    apply();
  }

  const legend = useAnalysisStore((s) => s.heatmapLegend);
  const hasMultiple = !!(legend?.nodes && legend?.edges);

  return (
    <div className="space-y-2">
      <button
        onClick={handleToggle}
        className={`flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
          heatmapActive
            ? "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300"
            : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
        }`}
      >
        {heatmapActive ? <X size={13} /> : <Palette size={13} />}
        {heatmapActive ? "Clear heatmap" : "Apply heatmap to canvas"}
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
