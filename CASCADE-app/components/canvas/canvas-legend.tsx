"use client";

/**
 * canvas-legend.tsx — collapsible bottom-right legend overlay: Functionality
 * colour scale + Node Type shapes. Replaces the React Flow MiniMap.
 *
 * While an Analysis Heatmap is applied the Functionality block is REPLACED, not
 * supplemented: the Analysis Heatmap overrides every Element's fill (see
 * `cascade-node.tsx` / `cascade-edge.tsx`), so a Functionality scale shown
 * alongside it would be a key to colours that are not on screen. Shapes are
 * unaffected by the overlay, so Node Types stays either way.
 */

import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useConfigStore } from "@/store/config-store";
import { useAnalysisStore } from "@/store/analysis-store";
import { LegendView } from "@/components/analysis/legend-view";
import { FALLBACK_LEVEL_COLOR } from "@/lib/colors";

// ---------------------------------------------------------------------------
// Canvas Legend — replaces MiniMap, bottom-right overlay
// ---------------------------------------------------------------------------

function LegendShape({ type, size = 14, fill }: { type: string; size?: number; fill: string }) {
  const h = size * 0.5;
  if (type === "source") {
    return (
      <svg width={size} height={size} style={{ flexShrink: 0 }}>
        <polygon points={`${h},0 ${size},${h} ${h},${size} 0,${h}`} fill={fill} />
      </svg>
    );
  }
  if (type === "infrastructure") {
    const o = size * 0.2; const e = size - o;
    const pts = [[o,0],[e,0],[size,o],[size,e],[e,size],[o,size],[0,e],[0,o]]
      .map(([x,y]) => `${x},${y}`).join(" ");
    return <svg width={size} height={size} style={{ flexShrink: 0 }}><polygon points={pts} fill={fill} /></svg>;
  }
  if (type === "personnel") {
    return <svg width={size} height={size} style={{ flexShrink: 0 }}><rect x={1} y={1} width={size-2} height={size-2} rx={size*0.2} fill={fill} /></svg>;
  }
  // service / default → circle
  return <svg width={size} height={size} style={{ flexShrink: 0 }}><circle cx={h} cy={h} r={h-1} fill={fill} /></svg>;
}

/**
 * Remounts the panel whenever the Analysis Heatmap goes on or off, which resets
 * its collapsed/expanded state to open.
 *
 * Applying a heatmap now minimizes the Analysis page straight onto the canvas,
 * so a legend the user had collapsed an hour ago would hide the only key to the
 * colours they were just sent to look at. A `key` does this without an effect,
 * and so without fighting react-hooks/set-state-in-effect.
 */
export function CanvasLegend() {
  const heatmapActive = useAnalysisStore((s) => s.heatmapActive);
  return <LegendPanel key={heatmapActive ? "analysis" : "functionality"} heatmapActive={heatmapActive} />;
}

function LegendPanel({ heatmapActive }: { heatmapActive: boolean }) {
  const scaleLevels = useConfigStore(useShallow((s) => s.config.functionality_scale));
  const heatmapLegend = useAnalysisStore((s) => s.heatmapLegend);
  const [open, setOpen] = useState(true);

  // Both blocks are shown for an Analysis Heatmap that scored nodes AND edges;
  // labelling them is only worth the two lines when there are two.
  const showsBoth = !!(heatmapLegend?.nodes && heatmapLegend?.edges);

  const NODE_TYPES = [
    { type: "source", label: "Source" },
    { type: "infrastructure", label: "Infrastructure" },
    { type: "service", label: "Service" },
    { type: "personnel", label: "Personnel" },
  ];

  return (
    <div
      data-export-ignore
      className={cn(
        "absolute bottom-3 right-3 z-10",
        // Analysis Metric names and swatch labels ("In downstream cone") need
        // more room than a Functionality level label.
        heatmapActive ? "max-w-[220px]" : "max-w-[180px]",
      )}
    >
      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white/90 text-xs shadow-sm backdrop-blur-sm dark:border-zinc-700 dark:bg-zinc-900/90">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between px-3 py-1.5 font-semibold text-zinc-500 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          <span className="truncate">{heatmapActive ? "Analysis" : "Legend"}</span>
          <ChevronDown size={11} className={cn("transition-transform", !open && "-rotate-90")} />
        </button>

        {open && (
          <div className="space-y-2.5 border-t border-zinc-100 px-3 py-2 dark:border-zinc-800">
            {heatmapActive && heatmapLegend ? (
              /* Analysis Heatmap key — what the overridden colours mean. */
              <div>
                <div
                  className="mb-1 truncate text-[9px] font-semibold uppercase tracking-widest text-indigo-500 dark:text-indigo-400"
                  title={heatmapLegend.title}
                >
                  {heatmapLegend.title}
                </div>
                {heatmapLegend.nodes && (
                  <div className="mb-1.5">
                    {showsBoth && (
                      <div className="mb-0.5 text-[9px] text-zinc-400">Nodes</div>
                    )}
                    <LegendView legend={heatmapLegend.nodes} />
                  </div>
                )}
                {heatmapLegend.edges && (
                  <div>
                    {showsBoth && (
                      <div className="mb-0.5 text-[9px] text-zinc-400">Edges</div>
                    )}
                    <LegendView legend={heatmapLegend.edges} />
                  </div>
                )}
              </div>
            ) : (
              /* Functionality levels */
              <div>
                <div className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-zinc-400">
                  Functionality
                </div>
                <div className="space-y-0.5">
                  {[...scaleLevels].reverse().map((lvl) => (
                    <div key={lvl.level} className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ backgroundColor: lvl.color }} />
                      <span className="text-zinc-600 dark:text-zinc-400 truncate">{lvl.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Node types */}
            <div>
              <div className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-zinc-400">
                Node Types
              </div>
              <div className="space-y-0.5">
                {NODE_TYPES.map(({ type, label }) => (
                  <div key={type} className="flex items-center gap-1.5">
                    <LegendShape type={type} size={13} fill={FALLBACK_LEVEL_COLOR} />
                    <span className="text-zinc-600 dark:text-zinc-400">{label}</span>
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}

