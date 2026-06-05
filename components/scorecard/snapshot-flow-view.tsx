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
  MarkerType,
  type Node as RFNode,
  type Edge as RFEdge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { nodeTypes, edgeTypes } from "@/components/canvas/flow-canvas";
import type { GraphSnapshot } from "@/lib/schemas/network";

interface Props {
  snapshot: GraphSnapshot;
  /** Tailwind height class, e.g. "h-56". Defaults to h-52. */
  heightClass?: string;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapshot],
  );

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
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

export function SnapshotFlowView({ snapshot, heightClass = "h-52" }: Props) {
  return (
    <div className={`w-full ${heightClass}`}>
      <ReactFlowProvider>
        <SnapshotFlow snapshot={snapshot} />
      </ReactFlowProvider>
    </div>
  );
}
