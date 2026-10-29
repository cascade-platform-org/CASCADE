"use client";

/**
 * CanvasMiniMap — an overview of the whole network, bottom left above the zoom
 * slider (the legend holds the bottom right, the Situation window the top
 * right). Nodes are painted at their Functionality level; a Canvas region or
 * cluster in its own colour. It starts folded to a "Map" button; − folds it
 * again (ui-store, shared by every view, kept for the session). Drag or scroll
 * inside it to move the view.
 * Must be a child of <ReactFlow>. Excluded from canvas captures by its class
 * and by data-export-ignore on the button.
 *
 * The MiniMap draws only nodes that carry a size: the views give theirs
 * initialWidth/initialHeight (toRFNode, the Grouped view's regions).
 */

import { MiniMap, Panel, type Node as RFNode } from "@xyflow/react";
import { Map as MapIcon, Minus } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useConfigStore } from "@/store/config-store";
import { useUiStore } from "@/store/ui-store";
import { levelColor } from "@/lib/colors";
import { brandColor } from "@/lib/brand";

const WIDTH = 180;
const HEIGHT = 120;
const ABOVE_ZOOM = 52; // clear of the zoom slider, the bottom-left Panel below

const BUTTON = "flex items-center gap-1 rounded-md bg-white/90 px-1.5 py-0.5 text-xs text-zinc-600 shadow-sm ring-1 ring-zinc-200 hover:bg-zinc-100 dark:bg-zinc-900/90 dark:text-zinc-300 dark:ring-zinc-700 dark:hover:bg-zinc-800";

export function CanvasMiniMap() {
  const scale = useConfigStore(useShallow((s) => s.config.functionality_scale));
  const open = useUiStore((s) => s.minimapOpen);
  const setOpen = useUiStore((s) => s.setMinimapOpen);

  if (!open) {
    return (
      <Panel position="bottom-left" style={{ marginBottom: ABOVE_ZOOM }} data-export-ignore>
        <button type="button" className={BUTTON} title="Show the overview map" onClick={() => setOpen(true)}>
          <MapIcon size={12} /> Map
        </button>
      </Panel>
    );
  }

  const nodeColor = (node: RFNode): string => {
    const data = node.data as { functionality?: unknown; color?: unknown; levelColor?: unknown };
    if (node.type === "canvasGroup") return `${String(data.color)}22`;
    if (node.type === "canvasCluster") return String(data.levelColor ?? data.color);
    return typeof data.functionality === "number"
      ? levelColor(scale, data.functionality)
      : brandColor("neutral", 400);
  };

  return (
    <>
      <MiniMap
        position="bottom-left"
        style={{ marginBottom: ABOVE_ZOOM, width: WIDTH, height: HEIGHT }}
        pannable
        zoomable
        nodeColor={nodeColor}
        nodeStrokeWidth={0}
        bgColor={brandColor("neutral", 50)}
        maskColor={`${brandColor("neutral", 300)}88`}
        ariaLabel="Overview of the whole network"
      />
      {/* The fold button rides on the map's top-right corner. */}
      <Panel
        position="bottom-left"
        style={{ marginBottom: ABOVE_ZOOM + HEIGHT - 22, marginLeft: 15 + WIDTH - 24 }}
        data-export-ignore
      >
        <button type="button" className={BUTTON} title="Hide the overview map" aria-label="Hide the overview map"
          onClick={() => setOpen(false)}>
          <Minus size={12} />
        </button>
      </Panel>
    </>
  );
}
