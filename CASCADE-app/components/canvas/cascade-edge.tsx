"use client";

/**
 * cascade-edge.tsx — the CASCADE edge renderer for React Flow.
 *
 * Directed quadratic-bezier edge; colour = edge Functionality level (or the
 * Analysis Heatmap override). Inter-canvas edges render dashed. Exports
 * `edgeTypes` (the React Flow registry) and `toRFEdge` (the CASCADE-edge →
 * RF-edge adapter) shared by the canvas variants.
 */

import { BaseEdge, Position, type EdgeTypes, type Edge as RFEdge } from "@xyflow/react";
import { useConfigStore, selectN, selectLevelColor } from "@/store/config-store";
import { useAnalysisStore } from "@/store/analysis-store";
import { useElementHeatmapColor } from "./snapshot-colors";
import type { Edge as CascadeEdge } from "@/lib/schemas/network";
import { brandColor } from "@/lib/brand";

export function toRFEdge(edge: CascadeEdge, isInterCanvas: boolean, targetCanvasLabel?: string): RFEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    // Restore the handle ids stored when the edge was first drawn so React Flow
    // routes the curve from/to the correct connection dot on each node.
    sourceHandle: edge.sourceHandle ?? null,
    targetHandle: edge.targetHandle ?? null,
    type: "cascadeEdge",
    data: { ...edge, isInterCanvas, targetCanvasLabel },
  };
}


// ---------------------------------------------------------------------------
// Custom edge
// ---------------------------------------------------------------------------

// Offset applied perpendicular-right of each edge direction so that antiparallel
// pairs (A→B and B→A) land on opposite sides and are both selectable.
const EDGE_CURVE_OFFSET = 4;

function curvedEdgePath(
  sx: number, sy: number,
  tx: number, ty: number,
): string {
  const dx = tx - sx;
  const dy = ty - sy;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  // Right-perpendicular unit vector of the direction sx→tx.
  const px = dy / len;
  const py = -dx / len;
  // Quadratic bezier control point: midpoint shifted right-perpendicular.
  const cx = (sx + tx) / 2 + px * EDGE_CURVE_OFFSET;
  const cy = (sy + ty) / 2 + py * EDGE_CURVE_OFFSET;
  return `M ${sx} ${sy} Q ${cx} ${cy} ${tx} ${ty}`;
}

function CascadeEdge({
  id, sourceX, sourceY, targetX, targetY,
  data,
  selected,
  markerEnd,
}: {
  id: string;
  sourceX: number; sourceY: number;
  targetX: number; targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
  data?: { functionality: number; isInterCanvas: boolean; targetCanvasLabel?: string };
  selected?: boolean;
  markerEnd?: string;
}) {
  const n = useConfigStore(selectN);
  const functionalityColorEdge = useConfigStore(selectLevelColor(data?.functionality ?? n));
  const liveHeatmap = useAnalysisStore((s) => s.heatmapActive && id ? (s.heatmapColors[id] ?? null) : null);
  const heatmapOverride = useElementHeatmapColor(id, liveHeatmap);
  const levelColor = heatmapOverride ?? functionalityColorEdge;

  const edgePath = curvedEdgePath(sourceX, sourceY, targetX, targetY);

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      style={{
        stroke: selected ? brandColor("accent", 500) : levelColor,
        strokeWidth: selected ? 2.5 : 1.5,
        strokeDasharray: data?.isInterCanvas ? "5,4" : undefined,
      }}
      markerEnd={markerEnd}
    />
  );
}

export const edgeTypes: EdgeTypes = {
  cascadeEdge: CascadeEdge as EdgeTypes[string],
};

