"use client";

/**
 * ZoomSlider — replaces the default React Flow <Controls /> component.
 *
 * Renders inside a React Flow <Panel> at bottom-left.
 * Must be used as a direct child of <ReactFlow> (needs ReactFlowProvider context).
 */

import { useCallback } from "react";
import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { Panel, useReactFlow, useViewport } from "@xyflow/react";
import { cn } from "@/lib/utils";

// Keep in sync with the ReactFlow minZoom/maxZoom in flow-canvas.tsx.
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;

export function ZoomSlider() {
  const { zoomIn, zoomOut, zoomTo, fitView } = useReactFlow();
  const { zoom } = useViewport();

  const pct = Math.round(zoom * 100);

  const handleSlider = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      zoomTo(Number(e.target.value), { duration: 0 });
    },
    [zoomTo],
  );

  return (
    <Panel position="bottom-left">
      <div className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white/90 px-2 py-1.5 shadow-sm backdrop-blur-sm dark:border-zinc-700 dark:bg-zinc-900/90">
        <button
          onClick={() => zoomOut({ duration: 200 })}
          title="Zoom out"
          className="rounded p-0.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
        >
          <ZoomOut size={13} />
        </button>

        <input
          type="range"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={0.01}
          value={zoom}
          onChange={handleSlider}
          className={cn(
            "h-1 w-24 cursor-pointer appearance-none rounded-full bg-zinc-200",
            "accent-blue-500 dark:bg-zinc-600",
          )}
          title={`${pct}%`}
        />

        <button
          onClick={() => zoomIn({ duration: 200 })}
          title="Zoom in"
          className="rounded p-0.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
        >
          <ZoomIn size={13} />
        </button>

        {/* Fit — the way back when the network is off-screen. Panning is on the
            middle mouse button or the Hand tool, neither of which a first-time
            user finds by accident (and a trackpad has no middle button at all),
            so without this control a badly framed canvas is a dead end. */}
        <button
          onClick={() => fitView({ duration: 300, padding: 0.2 })}
          title="Fit the whole network on screen (F)"
          data-tour="fit-view"
          className="rounded p-0.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
        >
          <Maximize2 size={13} />
        </button>

        {/* Percentage label — click resets to 100 % */}
        <button
          onClick={() => zoomTo(1, { duration: 200 })}
          title="Reset zoom to 100 %"
          className="w-9 text-right text-xs tabular-nums text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          {pct}%
        </button>
      </div>
    </Panel>
  );
}
