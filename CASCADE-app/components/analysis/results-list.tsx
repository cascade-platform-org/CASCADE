"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { useAnalysisStore } from "@/store/analysis-store";
import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore, selectN } from "@/store/config-store";
import { getElementLabel, type LabelField } from "@/lib/analysis-legend";
import { scoreToColor } from "@/lib/colors";
import type { AnalysisResult } from "@/lib/topological-analysis";

const LABEL_OPTIONS: { value: LabelField; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "importance", label: "Importance" },
  { value: "cost", label: "Cost/day" },
  { value: "weighted_loss", label: "Weighted loss" },
  { value: "functionality", label: "Functionality" },
];

interface ResultsListProps {
  result: AnalysisResult;
  /** Maximum rows to show before "show more". */
  limit?: number;
}

type KindFilter = "all" | "node" | "edge";

export function ResultsList({ result, limit = 15 }: ResultsListProps) {
  const [showAll, setShowAll] = React.useState(false);
  const [kindFilter, setKindFilter] = React.useState<KindFilter>("all");
  const labelField = useAnalysisStore((s) => s.labelField);
  const setLabelField = useAnalysisStore((s) => s.setLabelField);
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const n = useConfigStore(selectN);

  const filtered = kindFilter === "all" ? result.ranked : result.ranked.filter((e) => e.kind === kindFilter);
  const filteredValues = filtered.map((e) => e.score);
  const min = filteredValues.length ? Math.min(...filteredValues) : result.min;
  const max = filteredValues.length ? Math.max(...filteredValues) : result.max;
  const avg = filteredValues.length ? filteredValues.reduce((a, b) => a + b, 0) / filteredValues.length : result.avg;
  const range = max - min || 1;
  const visible = showAll ? filtered : filtered.slice(0, limit);

  return (
    <div className="flex flex-col gap-3">
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2 rounded-lg border border-zinc-100 bg-zinc-50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-900">
        <div className="text-center">
          <div className="font-bold text-zinc-800 dark:text-zinc-100">{max.toFixed(3)}</div>
          <div className="text-zinc-400">Max</div>
        </div>
        <div className="text-center">
          <div className="font-bold text-zinc-800 dark:text-zinc-100">{avg.toFixed(3)}</div>
          <div className="text-zinc-400">Avg</div>
        </div>
        <div className="text-center">
          <div className="font-bold text-zinc-800 dark:text-zinc-100">{min.toFixed(3)}</div>
          <div className="text-zinc-400">Min</div>
        </div>
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-3 text-xs">
        <span className="text-zinc-500">Show as:</span>
        <select
          value={labelField}
          onChange={(e) => setLabelField(e.target.value as LabelField)}
          className="rounded border border-zinc-200 bg-white px-2 py-0.5 text-xs text-zinc-700 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
        >
          {LABEL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <div className="ml-auto flex overflow-hidden rounded border border-zinc-200 dark:border-zinc-700">
          {(["all", "node", "edge"] as KindFilter[]).map((k) => (
            <button
              key={k}
              onClick={() => { setKindFilter(k); setShowAll(false); }}
              className={cn(
                "px-2 py-0.5 text-[10px] font-medium transition-colors",
                kindFilter === k
                  ? "bg-indigo-600 text-white"
                  : "text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800",
              )}
            >
              {k === "all" ? "All" : k === "node" ? "Nodes" : "Edges"}
            </button>
          ))}
        </div>
      </div>

      {/* Ranked list */}
      <div className="max-h-[480px] space-y-1 overflow-y-auto pr-1">
        {visible.map((item) => {
          const normalised = (item.score - min) / range;
          const color = scoreToColor(normalised);
          const label = getElementLabel(item.id, item.kind, nodes, edges, labelField, n);

          return (
            <div
              key={item.id}
              className="flex items-center gap-2 rounded-lg border border-zinc-100 bg-white px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-900"
            >
              {/* Colour swatch */}
              <div className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: color }} />

              {/* Rank */}
              <span className="w-6 shrink-0 font-bold text-zinc-400">#{item.rank}</span>

              {/* Kind badge */}
              <span className={cn(
                "shrink-0 rounded px-1 py-0.5 text-[10px] font-medium",
                item.kind === "node"
                  ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                  : "bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
              )}>
                {item.kind}
              </span>

              {/* Label */}
              <span className="min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-300" title={label}>
                {label}
              </span>

              {/* Score */}
              <span className="shrink-0 font-mono font-bold text-indigo-700 dark:text-indigo-400">
                {item.score.toFixed(3)}
              </span>
            </div>
          );
        })}
      </div>

      {filtered.length > limit && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
        >
          {showAll ? "Show less" : `Show all ${filtered.length} elements`}
        </button>
      )}
    </div>
  );
}
