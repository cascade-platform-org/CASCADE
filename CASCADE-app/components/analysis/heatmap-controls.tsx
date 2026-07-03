"use client";

import React from "react";
import { Palette, X } from "lucide-react";
import { useAnalysisStore } from "@/store/analysis-store";
import { buildColorMap } from "@/lib/topological-analysis";
import type { AnalysisResult } from "@/lib/topological-analysis";

interface HeatmapControlsProps {
  result?: AnalysisResult;
  edgeResult?: AnalysisResult;
}

// ---------------------------------------------------------------------------
// Legend helpers
// ---------------------------------------------------------------------------

type LegendItem = { color: string; label: string };
type Legend =
  | { type: "gradient"; low: string; high: string }
  | { type: "swatches"; items: LegendItem[] };

function getLegend(result: AnalysisResult): Legend {
  const { metric, scores } = result;
  switch (metric) {
    case "articulation_points":
      return { type: "swatches", items: [{ color: "#ef4444", label: "Articulation point" }, { color: "#94a3b8", label: "Non-critical" }] };
    case "bridge_edges":
      return { type: "swatches", items: [{ color: "#ef4444", label: "Bridge" }, { color: "#94a3b8", label: "Non-bridge" }] };
    case "downstream_reachability":
      return { type: "swatches", items: [{ color: "#4338ca", label: "Source" }, { color: "#818cf8", label: "In downstream cone" }, { color: "#e2e8f0", label: "Outside cone" }] };
    case "upstream_reachability":
      return { type: "swatches", items: [{ color: "#4338ca", label: "Target" }, { color: "#818cf8", label: "In upstream cone" }, { color: "#e2e8f0", label: "Outside cone" }] };
    case "community": {
      const PALETTE = ["#6366f1","#ec4899","#f59e0b","#10b981","#3b82f6","#ef4444","#8b5cf6","#14b8a6","#f97316","#84cc16"];
      const uniqueVals = [...new Set(Object.values(scores))].sort((a, b) => a - b);
      const items = uniqueVals.slice(0, 10).map((v, i) => ({ color: PALETTE[i % PALETTE.length], label: `Community ${i + 1}` }));
      if (uniqueVals.length > 10) items.push({ color: "#d1d5db", label: `+${uniqueVals.length - 10} more` });
      return { type: "swatches", items };
    }
    case "k_core": {
      const maxK = Math.max(...Object.values(scores), 1);
      return { type: "swatches", items: [
        { color: "rgb(224,231,255)", label: "k=0 (peripheral)" },
        { color: "rgb(49,46,129)",   label: `k=${maxK} (core)` },
      ]};
    }
    default:
      return { type: "gradient", low: "rgb(224,231,255)", high: "rgb(49,46,129)" };
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HeatmapControls({ result, edgeResult }: HeatmapControlsProps) {
  const heatmapActive = useAnalysisStore((s) => s.heatmapActive);
  const applyHeatmap = useAnalysisStore((s) => s.applyHeatmap);
  const clearHeatmap = useAnalysisStore((s) => s.clearHeatmap);

  function handleToggle() {
    if (heatmapActive) {
      clearHeatmap();
    } else {
      const nodeColors = result ? buildColorMap(result) : {};
      const edgeColors = edgeResult ? buildColorMap(edgeResult) : {};
      applyHeatmap({ ...nodeColors, ...edgeColors });
    }
  }

  const nodeLegend = result ? getLegend(result) : null;
  const edgeLegend = edgeResult ? getLegend(edgeResult) : null;
  const hasMultiple = !!(result && edgeResult);

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
        {heatmapActive ? "Clear heatmap (minimize to see canvas)" : "Apply heatmap — then minimize ↓"}
      </button>

      {heatmapActive && nodeLegend && (
        <div className="rounded-lg border border-zinc-100 p-2 dark:border-zinc-800">
          {hasMultiple && (
            <p className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-zinc-400">Nodes</p>
          )}
          <LegendView legend={nodeLegend} />
        </div>
      )}
      {heatmapActive && edgeLegend && (
        <div className="rounded-lg border border-zinc-100 p-2 dark:border-zinc-800">
          {hasMultiple && (
            <p className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-zinc-400">Edges</p>
          )}
          <LegendView legend={edgeLegend} />
        </div>
      )}
    </div>
  );
}

function LegendView({ legend }: { legend: Legend }) {
  if (legend.type === "gradient") {
    return (
      <>
        <div className="mb-1 flex justify-between text-[10px] text-zinc-400">
          <span>Low</span>
          <span>High</span>
        </div>
        <div
          className="h-3 w-full rounded"
          style={{ background: `linear-gradient(to right, ${legend.low}, ${legend.high})` }}
        />
      </>
    );
  }
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {legend.items.map((item) => (
        <div key={item.label} className="flex items-center gap-1">
          <div className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: item.color }} />
          <span className="text-[10px] text-zinc-500 dark:text-zinc-400">{item.label}</span>
        </div>
      ))}
    </div>
  );
}
