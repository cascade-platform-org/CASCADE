"use client";

/**
 * CanvasMiniMap — an overview of the whole network, bottom left above the zoom
 * slider (the legend holds the bottom right, the Situation window the top
 * right). Nodes are painted at their Functionality level; a Canvas region or
 * cluster in its own colour. Drag or scroll inside it to move the view.
 * Must be a child of <ReactFlow>. Excluded from canvas captures by its class.
 */

import { MiniMap, type Node as RFNode } from "@xyflow/react";
import { useShallow } from "zustand/react/shallow";
import { useConfigStore } from "@/store/config-store";
import { levelColor } from "@/lib/colors";
import { brandColor } from "@/lib/brand";

export function CanvasMiniMap() {
  const scale = useConfigStore(useShallow((s) => s.config.functionality_scale));

  const nodeColor = (node: RFNode): string => {
    const data = node.data as { functionality?: unknown; color?: unknown; levelColor?: unknown };
    if (node.type === "canvasGroup") return `${String(data.color)}22`;
    if (node.type === "canvasCluster") return String(data.levelColor ?? data.color);
    return typeof data.functionality === "number"
      ? levelColor(scale, data.functionality)
      : brandColor("neutral", 400);
  };

  return (
    <MiniMap
      position="bottom-left"
      // Clear of the zoom slider, which is the bottom-left Panel below it.
      style={{ marginBottom: 52, width: 180, height: 120 }}
      pannable
      zoomable
      nodeColor={nodeColor}
      nodeStrokeWidth={0}
      bgColor={brandColor("neutral", 50)}
      maskColor={`${brandColor("neutral", 300)}88`}
      ariaLabel="Overview of the whole network"
    />
  );
}
