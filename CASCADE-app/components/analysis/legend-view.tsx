"use client";

/**
 * legend-view.tsx — renders an Analysis Heatmap colour key.
 *
 * Shared by the Analysis page (below the Apply button) and the canvas legend
 * (bottom-right overlay, after minimizing). One renderer so the two cannot
 * disagree about what a colour means; the key itself is derived in
 * `lib/analysis-legend.ts`.
 */

import type { Legend } from "@/lib/analysis-legend";

export function LegendView({ legend }: { legend: Legend }) {
  if (legend.type === "gradient") {
    return (
      <>
        <div className="mb-1 flex justify-between gap-2 text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400">
          <span className="truncate">{legend.minLabel}</span>
          <span className="truncate">{legend.maxLabel}</span>
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
