"use client";

/**
 * GlobalViewCanvas — read-only merged view of all canvases.
 *
 * Each Canvas occupies its own group region laid out side-by-side.
 * Within each group, nodes are placed at their actual stored positions
 * (i.e., the same relative layout visible in the single-canvas editor).
 * The same custom node renderers as FlowCanvas are reused so shapes,
 * colours, and direct-damage overlays are consistent.
 * Inter-canvas edges are rendered dashed.
 * This view is read-only: no editing, no tool interactions.
 */

import { useEffect, useMemo } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  ReactFlowProvider,
  MarkerType,
  ConnectionMode,
  useReactFlow,
  getNodesBounds,
  getViewportForBounds,
  type Node as RFNode,
  type Edge as RFEdge,
  getBezierPath,
  BaseEdge,
  type EdgeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useCanvasStore, selectOrderedCanvases } from "@/store/canvas-store";
import { useConfigStore } from "@/store/config-store";
import { useUiStore } from "@/store/ui-store";
import { useShallow } from "zustand/react/shallow";
import { nodeTypes } from "./cascade-node";
import { ZoomSlider } from "./zoom-slider";
import { levelColor } from "@/lib/colors";

// ---------------------------------------------------------------------------
// Group node — coloured background labelled with the canvas name
// ---------------------------------------------------------------------------

function CanvasGroupNode({ data }: { data: { label: string; color: string } }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        border: `2px solid ${data.color}`,
        borderRadius: 12,
        background: `${data.color}18`,
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: -22,
          left: 8,
          fontSize: 11,
          fontWeight: 600,
          color: data.color,
          whiteSpace: "nowrap",
        }}
      >
        {data.label}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bezier edge shared by both intra- and inter-canvas edges in this view
// ---------------------------------------------------------------------------

function GlobalEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition,
  data,
  selected,
  markerEnd,
}: {
  id: string;
  sourceX: number; sourceY: number;
  targetX: number; targetY: number;
  sourcePosition: Parameters<typeof getBezierPath>[0]["sourcePosition"];
  targetPosition: Parameters<typeof getBezierPath>[0]["targetPosition"];
  data?: { isInterCanvas: boolean; color: string };
  selected?: boolean;
  markerEnd?: string;
}) {
  const [edgePath] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  });

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      style={{
        stroke: selected ? "#3b82f6" : (data?.color ?? "#94a3b8"),
        strokeWidth: selected ? 2.5 : 1.5,
        strokeDasharray: data?.isInterCanvas ? "6 3" : undefined,
      }}
      markerEnd={markerEnd}
    />
  );
}

const edgeTypes: EdgeTypes = { globalEdge: GlobalEdge as EdgeTypes[string] };

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const GROUP_PADDING = 60;      // px padding around the nodes within each group
const GROUP_COL_GAP = 120;     // horizontal gap between adjacent canvas groups
const NODE_BOX = 72;           // conservative bounding-box size per node (px)

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

function GlobalViewCanvas() {
  const allNodes = useCanvasStore((s) => s.nodes);
  const allEdges = useCanvasStore((s) => s.edges);
  const canvases = useCanvasStore(useShallow(selectOrderedCanvases));
  const scaleLevels = useConfigStore(useShallow((s) => s.config.functionality_scale));

  const { getNodes } = useReactFlow();

  // Register capture while this canvas is mounted, overwriting the per-canvas
  // registration from FlowCanvas (which is unmounted in global view).
  useEffect(() => {
    const IMG_W = 1200;
    const IMG_H = 800;

    async function capture(): Promise<string | undefined> {
      try {
        const { toPng } = await import("html-to-image");
        const nodes = getNodes();
        const viewport = document.querySelector<HTMLElement>(".react-flow__viewport");
        if (!viewport || nodes.length === 0) return undefined;

        const bounds = getNodesBounds(nodes);
        const { x, y, zoom } = getViewportForBounds(bounds, IMG_W, IMG_H, 0.5, 2, 20);

        return await toPng(viewport, {
          backgroundColor: "#ffffff",
          width: IMG_W,
          height: IMG_H,
          style: {
            width: `${IMG_W}px`,
            height: `${IMG_H}px`,
            transform: `translate(${x}px, ${y}px) scale(${zoom})`,
          },
        });
      } catch {
        return undefined;
      }
    }

    useUiStore.getState().registerCaptureCanvas(capture);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // register once — capture() reads live DOM state on every call



  const { rfNodes, rfEdges } = useMemo(() => {
    const nodes: RFNode[] = [];
    const edges: RFEdge[] = [];
    const renderedNodeIds = new Set<string>();
    // Maps nodeId -> the canvasId of the group it was placed in.
    // Used to decide isInterCanvas by visual position, not data-model membership.
    const nodeGroupMap = new Map<string, string>();

    let groupOffsetX = 40;

    canvases.forEach((canvas) => {
      const canvasNodes = canvas.graph.node_ids
        .map((id) => allNodes[id])
        .filter(Boolean);

      if (canvasNodes.length === 0) {
        // Empty canvas — small placeholder group
        nodes.push({
          id: `group-${canvas.id}`,
          type: "canvasGroup",
          position: { x: groupOffsetX, y: 60 },
          data: { label: canvas.label ?? canvas.id, color: canvas.color ?? "#94a3b8" },
          style: { width: 200, height: 120 },
        });
        groupOffsetX += 200 + GROUP_COL_GAP;
        return;
      }

      // Use stored positions; fall back to a simple grid for unpositioned nodes
      const positioned = canvasNodes.map((node, i) => ({
        node,
        x: node.position?.x ?? (i % 4) * 100,
        y: node.position?.y ?? Math.floor(i / 4) * 100,
      }));

      // Bounding box of all node positions within this canvas
      const minX = Math.min(...positioned.map((p) => p.x));
      const minY = Math.min(...positioned.map((p) => p.y));
      const maxX = Math.max(...positioned.map((p) => p.x));
      const maxY = Math.max(...positioned.map((p) => p.y));

      const groupW = (maxX - minX) + 2 * GROUP_PADDING + NODE_BOX;
      const groupH = (maxY - minY) + 2 * GROUP_PADDING + NODE_BOX;

      nodes.push({
        id: `group-${canvas.id}`,
        type: "canvasGroup",
        position: { x: groupOffsetX, y: 60 },
        data: { label: canvas.label ?? canvas.id, color: canvas.color ?? "#94a3b8" },
        style: { width: groupW, height: groupH },
      });

      positioned.forEach(({ node, x, y }) => {
        if (renderedNodeIds.has(node.id)) return; // shared node — render only once in first canvas
        renderedNodeIds.add(node.id);
        nodeGroupMap.set(node.id, canvas.id);
        nodes.push({
          id: node.id,
          type: node.node_type?.toLowerCase() ?? "service",
          parentId: `group-${canvas.id}`,
          extent: "parent",
          position: {
            x: (x - minX) + GROUP_PADDING,
            y: (y - minY) + GROUP_PADDING,
          },
          data: { ...node },
        });
      });

      groupOffsetX += groupW + GROUP_COL_GAP;
    });

    // Edges — deduplicated across canvases.
    // isInterCanvas is true when source and target land in different visual groups,
    // regardless of which canvas's edge_ids the edge came from.
    const seenEdgeIds = new Set<string>();

    canvases.forEach((canvas) => {
      canvas.graph.edge_ids.forEach((eid) => {
        if (seenEdgeIds.has(eid)) return;
        seenEdgeIds.add(eid);
        const edge = allEdges[eid];
        if (!edge) return;
        // Skip if either endpoint was never rendered
        if (!renderedNodeIds.has(edge.source) || !renderedNodeIds.has(edge.target)) return;
        // Inter-canvas = endpoints are in different visual groups
        const isInterCanvas = nodeGroupMap.get(edge.source) !== nodeGroupMap.get(edge.target);
        const edgeColor = levelColor(scaleLevels, edge.functionality);
        edges.push({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle ?? null,
          targetHandle: edge.targetHandle ?? null,
          type: "globalEdge",
          data: { isInterCanvas, color: edgeColor },
          markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor, width: 14, height: 10 },
        });
      });
    });

    return { rfNodes: nodes, rfEdges: edges };
  }, [canvases, allNodes, allEdges, scaleLevels]);

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={{ ...nodeTypes, canvasGroup: CanvasGroupNode as never }}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        connectionMode={ConnectionMode.Loose}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnScroll={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#d1d5db" />
        <ZoomSlider />
      </ReactFlow>

      {/* Read-only badge */}
      <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-1.5 rounded-md bg-white/80 px-2.5 py-1 text-xs font-medium text-zinc-500 shadow-sm ring-1 ring-zinc-200 backdrop-blur-sm dark:bg-zinc-900/80 dark:ring-zinc-700">
        Read-only · All canvases
      </div>
    </div>
  );
}

// Named for its actual caller (editor-shell renders the "grouped" — i.e.
// global — view): one export, not a definition plus a same-file alias.
export function GroupedViewCanvasWithProvider() {
  return (
    <ReactFlowProvider>
      <GlobalViewCanvas />
    </ReactFlowProvider>
  );
}
