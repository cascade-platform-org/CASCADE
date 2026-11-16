"use client";

/**
 * cascade-edge.tsx — the CASCADE edge renderer for React Flow.
 *
 * Directed floating edge: it stores no attachment point and is drawn from
 * border to border of its two nodes (lib/floating-edge.ts), bowing apart from
 * an opposite edge. Colour = edge Functionality level (or the Analysis Heatmap
 * override). Inter-canvas edges render dashed. Exports
 * `edgeTypes` (the React Flow registry) and `toRFEdge` (the CASCADE-edge →
 * RF-edge adapter) and `FloatingConnectionLine`, shared by the canvas variants.
 */

import { BaseEdge, type ConnectionLineComponentProps, type EdgeTypes, type Edge as RFEdge } from "@xyflow/react";
import { useConfigStore, selectN, selectLevelColor } from "@/store/config-store";
import { useAnalysisStore } from "@/store/analysis-store";
import { useElementHeatmapColor } from "./snapshot-colors";
import type { Edge as CascadeEdge } from "@/lib/schemas/network";
import { brandColor } from "@/lib/brand";
import { borderPoint } from "@/lib/node-outline";
import { outlineOf, useFloatingPath } from "@/hooks/useFloatingPath";

export function toRFEdge(edge: CascadeEdge, isInterCanvas: boolean, targetCanvasLabel?: string): RFEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "cascadeEdge",
    data: { ...edge, isInterCanvas, targetCanvasLabel },
  };
}


// ---------------------------------------------------------------------------
// Custom edge
// ---------------------------------------------------------------------------

function CascadeEdge({
  id, source, target,
  data,
  selected,
  markerEnd,
}: {
  id: string;
  source: string;
  target: string;
  data?: { functionality: number; isInterCanvas: boolean; targetCanvasLabel?: string };
  selected?: boolean;
  markerEnd?: string;
}) {
  const n = useConfigStore(selectN);
  const functionalityColorEdge = useConfigStore(selectLevelColor(data?.functionality ?? n));
  const liveHeatmap = useAnalysisStore((s) => s.heatmapActive && id ? (s.heatmapColors[id] ?? null) : null);
  const heatmapOverride = useElementHeatmapColor(id, liveHeatmap);
  const levelColor = heatmapOverride ?? functionalityColorEdge;

  // Floating: drawn border to border from the nodes' live positions (lib/floating-edge.ts).
  const floating = useFloatingPath(source, target);
  if (!floating) return null;

  return (
    <BaseEdge
      id={id}
      path={floating.path}
      style={{
        stroke: selected ? brandColor("accent", 500) : levelColor,
        strokeWidth: selected ? 2.5 : 1.5,
        strokeDasharray: data?.isInterCanvas ? "5,4" : undefined,
      }}
      markerEnd={markerEnd}
    />
  );
}

/**
 * The line shown while an edge is being drawn: from the border of the node it
 * starts at, towards the pointer — or to the hovered node's border once the
 * pointer is over one, so the user sees exactly the edge they will get.
 */
export function FloatingConnectionLine({ fromNode, toNode, toX, toY }: ConnectionLineComponentProps) {
  const from = outlineOf(fromNode);
  const toOutline = toNode && toNode.id !== fromNode.id ? outlineOf(toNode) : null;
  const end = toOutline
    ? borderPoint(toOutline, { x: from.cx, y: from.cy })
    : { x: toX, y: toY };
  const start = borderPoint(from, end);
  return (
    <path
      d={`M ${start.x} ${start.y} L ${end.x} ${end.y}`}
      fill="none"
      stroke={brandColor("accent", 500)}
      strokeWidth={2}
      strokeDasharray="5 4"
    />
  );
}

export const edgeTypes: EdgeTypes = {
  cascadeEdge: CascadeEdge as EdgeTypes[string],
};

