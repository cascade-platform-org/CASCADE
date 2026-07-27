"use client";

/**
 * canvas-legend.tsx — collapsible bottom-right legend overlay: Functionality
 * colour scale + Node Type shapes. Replaces the React Flow MiniMap.
 */

import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useConfigStore } from "@/store/config-store";
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

export function CanvasLegend() {
  const scaleLevels = useConfigStore(useShallow((s) => s.config.functionality_scale));
  const [open, setOpen] = useState(true);

  const NODE_TYPES = [
    { type: "source", label: "Source" },
    { type: "infrastructure", label: "Infrastructure" },
    { type: "service", label: "Service" },
    { type: "personnel", label: "Personnel" },
  ];

  return (
    <div data-export-ignore className="absolute bottom-3 right-3 z-10 max-w-[180px]">
      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white/90 text-xs shadow-sm backdrop-blur-sm dark:border-zinc-700 dark:bg-zinc-900/90">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between px-3 py-1.5 font-semibold text-zinc-500 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          <span>Legend</span>
          <ChevronDown size={11} className={cn("transition-transform", !open && "-rotate-90")} />
        </button>

        {open && (
          <div className="space-y-2.5 border-t border-zinc-100 px-3 py-2 dark:border-zinc-800">
            {/* Functionality levels */}
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

