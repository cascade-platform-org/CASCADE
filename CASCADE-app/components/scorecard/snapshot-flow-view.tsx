"use client";

/**
 * SnapshotFlowView — read-only, pannable, zoomable React Flow instance
 * that renders a GraphSnapshot without touching any live store.
 *
 * Each instance runs in its own ReactFlowProvider so it is fully isolated
 * from the editor canvas and from other snapshot views on the same page.
 */

import { useMemo } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  ConnectionMode,
  MarkerType,
  type Node as RFNode,
  type Edge as RFEdge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { nodeTypes } from "@/components/canvas/cascade-node";
import { edgeTypes } from "@/components/canvas/cascade-edge";
import { SnapshotColorsProvider } from "@/components/canvas/snapshot-colors";
import type { GraphSnapshot } from "@/lib/schemas/network";

interface Props {
  snapshot: GraphSnapshot;
  /** Tailwind height class, e.g. "h-56". Defaults to h-52. */
  heightClass?: string;
  /**
   * Element id → colour, for a snapshot saved with an Analysis Heatmap. Omit to
   * render Functionality colours. Either way the view ignores the heatmap that
   * happens to be live on the canvas right now — see `snapshot-colors.tsx`.
   */
  colors?: Record<string, string>;
}

function SnapshotFlow({ snapshot }: Props) {
  const rfNodes: RFNode[] = useMemo(
    () =>
      Object.values(snapshot.nodes).map((node) => ({
        id: node.id,
        type: (node.node_type?.toLowerCase() ?? "service") as string,
        position: node.position ?? { x: 0, y: 0 },
        data: { ...node },
        draggable: false,
        selectable: false,
        focusable: false,
      })),
     
    [snapshot],
  );

  const rfEdges: RFEdge[] = useMemo(
    () =>
      Object.values(snapshot.edges).map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle ?? null,
        targetHandle: edge.targetHandle ?? null,
        type: "cascadeEdge",
        data: { ...edge, isInterCanvas: false },
        selectable: false,
        focusable: false,
      })),
     
    [snapshot],
  );

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      // Handles are all type="source"; Loose lets them act as edge targets too
      // (matches the editor and global view). Without this, target handles like
      // "ml"/"mr" aren't found in Strict mode and edges silently drop (RF #008).
      connectionMode={ConnectionMode.Loose}
      fitView
      fitViewOptions={{ padding: 0.25, minZoom: 0.1, maxZoom: 2 }}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      panOnDrag
      zoomOnScroll
      zoomOnPinch
      preventScrolling={false}
      minZoom={0.05}
      maxZoom={4}
      defaultEdgeOptions={{
        markerEnd: { type: MarkerType.ArrowClosed, width: 10, height: 10 },
      }}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={16} size={0.8} color="#d4d4d8" />
    </ReactFlow>
  );
}

export function SnapshotFlowView({ snapshot, heightClass = "h-52", colors }: Props) {
  // EMPTY_COLORS keeps the provider value referentially stable when no heatmap
  // is supplied, so the subtree does not re-render on every parent render.
  return (
    <div className={`w-full ${heightClass}`}>
      <SnapshotColorsProvider value={colors ?? EMPTY_COLORS}>
        <ReactFlowProvider>
          <SnapshotFlow snapshot={snapshot} />
        </ReactFlowProvider>
      </SnapshotColorsProvider>
    </div>
  );
}

const EMPTY_COLORS: Record<string, string> = {};
