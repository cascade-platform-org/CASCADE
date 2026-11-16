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
 * A Canvas can be collapsed into one cluster node showing its Operativity;
 * edges into it are bundled (lib/canvas-clusters.ts). Display only.
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
  BaseEdge,
  Handle,
  Position,
  type EdgeTypes,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useCanvasStore, selectOrderedCanvases } from "@/store/canvas-store";
import { useShownElements } from "@/hooks/useShownElements";
import { useLevelPaint } from "@/hooks/useLevelPaint";
import { SnapshotColorsProvider } from "@/components/canvas/snapshot-colors";
import { useConfigStore } from "@/store/config-store";
import { useUiStore } from "@/store/ui-store";
import { useShallow } from "zustand/react/shallow";
import { nodeTypes, toRFNode, expandBoundsForLabels } from "./cascade-node";
import { ZoomSlider, MIN_ZOOM, MAX_ZOOM } from "./zoom-slider";
import { CanvasMiniMap } from "./canvas-minimap";
import { CanvasLegend } from "./canvas-legend";
import { levelColor } from "@/lib/colors";
import { brandColor } from "@/lib/brand";
import { clusterNodeId, clusterSummary, drawnEdges, homeCanvases } from "@/lib/canvas-clusters";
import { operativityColor } from "@/lib/scorecard-utils";
import { useAnalysisStore } from "@/store/analysis-store";
import { useFloatingPath } from "@/hooks/useFloatingPath";

// ---------------------------------------------------------------------------
// Group node — coloured background labelled with the canvas name
// ---------------------------------------------------------------------------

interface GroupData {
  label: string;
  color: string;
  onToggle?: () => void;
}

/** The collapse / expand control on a Canvas region or cluster. */
function ToggleButton({ collapsed, onToggle, color }: { collapsed: boolean; onToggle: () => void; color: string }) {
  return (
    <button
      type="button"
      className="nodrag nopan pointer-events-auto rounded px-1 leading-none hover:bg-black/5"
      style={{ color }}
      title={collapsed ? "Expand this canvas" : "Collapse this canvas into one node"}
      aria-label={collapsed ? "Expand canvas" : "Collapse canvas"}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
    >
      {collapsed ? "+" : "−"}
    </button>
  );
}

function CanvasGroupNode({ data }: { data: GroupData }) {
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
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        {data.onToggle && <ToggleButton collapsed={false} onToggle={data.onToggle} color={data.color} />}
        {data.label}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cluster node — a collapsed Canvas: its name, Operativity and size
// ---------------------------------------------------------------------------

interface ClusterData extends GroupData {
  operativity: number;
  count: number;
  levelColor: string;
}

const HIDDEN_HANDLE: React.CSSProperties = { opacity: 0, pointerEvents: "none" };

function CanvasClusterNode({ data }: { data: ClusterData }) {
  return (
    <div
      style={{
        width: CLUSTER_W,
        border: `2px solid ${data.color}`,
        borderRadius: 12,
        background: `${data.color}18`,
        padding: "8px 10px",
      }}
    >
      {/* Edges float to this box's border; the handles only satisfy React Flow. */}
      <Handle type="target" position={Position.Left} style={HIDDEN_HANDLE} />
      <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, color: data.color }}>
        {data.onToggle && <ToggleButton collapsed onToggle={data.onToggle} color={data.color} />}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{data.label}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 4 }}>
        <span style={{ fontSize: 20, fontWeight: 700, color: data.levelColor }}>{data.operativity}%</span>
        <span style={{ fontSize: 10, color: brandColor("neutral", 500) }}>
          Operativity · {data.count} nodes
        </span>
      </div>
      <Handle type="source" position={Position.Right} style={HIDDEN_HANDLE} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Floating edge shared by intra- and inter-canvas edges in this view
// ---------------------------------------------------------------------------

function GlobalEdge({
  id, source, target, label,
  data,
  selected,
  markerEnd,
}: {
  id: string;
  source: string;
  target: string;
  label?: React.ReactNode;
  data?: { isInterCanvas: boolean; color: string };
  selected?: boolean;
  markerEnd?: string;
}) {
  // Border to border, from a node's shape or a collapsed Canvas's box (lib/floating-edge.ts).
  const floating = useFloatingPath(source, target);
  if (!floating) return null;

  return (
    <BaseEdge
      id={id}
      path={floating.path}
      label={label}
      labelX={floating.mid.x}
      labelY={floating.mid.y}
      style={{
        stroke: selected ? brandColor("accent", 500) : (data?.color ?? brandColor("neutral", 400)),
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
const CLUSTER_W = 190;         // width of a collapsed Canvas's cluster node
const CLUSTER_H = 72;          // its height, for the MiniMap (the box sizes itself)

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

function GlobalViewCanvas() {
  // The Run View paints the selected period of a Temporal Simulation run (ADR-0019 §3).
  const { nodes: allNodes, edges: allEdges } = useShownElements();
  const levelPaint = useLevelPaint();
  const canvases = useCanvasStore(useShallow(selectOrderedCanvases));
  const scaleLevels = useConfigStore(useShallow((s) => s.config.functionality_scale));
  const config = useConfigStore((s) => s.config);
  const weightAttr = useAnalysisStore((s) => s.oiWeightAttr);
  // Collapsed Canvases and dragged positions: session view state in ui-store, so
  // they survive leaving the All tab; never saved, cleared when a project loads.
  const collapsedIds = useUiStore((s) => s.groupedCollapsed);
  const collapsed = useMemo(() => new Set(collapsedIds), [collapsedIds]);
  const moved = useUiStore((s) => s.groupedMoved);
  const toggle = (canvasId: string) => useUiStore.getState().toggleGroupedCollapsed(canvasId);
  const onNodesChange = (changes: NodeChange[]) => {
    const drags = changes.flatMap((c) => {
      if (c.type !== "position" || !c.position) return [];
      const canvasId = c.id.startsWith("group-") ? c.id.slice("group-".length)
        : c.id.startsWith(clusterNodeId("")) ? c.id.slice(clusterNodeId("").length) : null;
      return canvasId === null ? [] : [[canvasId, c.position] as const];
    });
    if (drags.length) useUiStore.getState().moveGroupedCanvases(Object.fromEntries(drags));
  };

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

        // Exclude on-screen UI overlays (zoom slider, read-only badge, React Flow
        // panels/attribution) from the export — same as the per-canvas capture.
        const filter = (el: HTMLElement) =>
          !(el instanceof Element &&
            typeof el.matches === "function" &&
            el.matches(
              ".react-flow__panel, .react-flow__controls, .react-flow__minimap, .react-flow__attribution, [data-export-ignore]",
            ));

        // Expand the node-box bounds so centered name labels are not clipped at
        // the edges of the fitted image; geometry lives in cascade-node.tsx.
        const bounds = expandBoundsForLabels(getNodesBounds(nodes));
        const { x, y, zoom } = getViewportForBounds(bounds, IMG_W, IMG_H, 0.5, 2, 20);

        return await toPng(viewport, {
          // Paper, not pure white: a snapshot should look like the canvas it came from.
          backgroundColor: brandColor("neutral", 50),
          width: IMG_W,
          height: IMG_H,
          filter,
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
    return () => useUiStore.getState().registerCaptureCanvas(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // register once — capture() reads live DOM state on every call



  const { rfNodes, rfEdges } = useMemo(() => {
    const nodes: RFNode[] = [];
    const edges: RFEdge[] = [];
    // A node shared by several Canvases is drawn once, in its home (the first).
    const home = homeCanvases(canvases, allNodes);
    const n = scaleLevels.length;

    let groupOffsetX = 40;

    canvases.forEach((canvas) => {
      const color = canvas.color ?? brandColor("neutral", 400);
      const onToggle = () => toggle(canvas.id);
      if (collapsed.has(canvas.id)) {
        const { operativity, count } = clusterSummary(canvas, allNodes, n, weightAttr);
        nodes.push({
          id: clusterNodeId(canvas.id),
          type: "canvasCluster",
          position: moved[canvas.id] ?? { x: groupOffsetX, y: 60 },
          draggable: true,
          data: { label: canvas.label ?? canvas.id, color, onToggle, operativity, count,
                  levelColor: operativityColor(operativity, config) },
          initialWidth: CLUSTER_W,
          initialHeight: CLUSTER_H,
        });
        groupOffsetX += CLUSTER_W + GROUP_COL_GAP;
        return;
      }

      const canvasNodes = canvas.graph.node_ids
        .map((id) => allNodes[id])
        .filter(Boolean);

      if (canvasNodes.length === 0) {
        // Empty canvas — small placeholder group
        nodes.push({
          id: `group-${canvas.id}`,
          type: "canvasGroup",
          position: moved[canvas.id] ?? { x: groupOffsetX, y: 60 },
          draggable: true,
          data: { label: canvas.label ?? canvas.id, color },
          style: { width: 200, height: 120 },
          initialWidth: 200,
          initialHeight: 120,
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
        position: moved[canvas.id] ?? { x: groupOffsetX, y: 60 },
        draggable: true,
        data: { label: canvas.label ?? canvas.id, color, onToggle },
        style: { width: groupW, height: groupH },
        initialWidth: groupW,
        initialHeight: groupH,
      });

      positioned.forEach(({ node, x, y }) => {
        if (home.get(node.id) !== canvas.id) return; // shared node — drawn in its home canvas
        nodes.push({
          ...toRFNode(node, false),
          parentId: `group-${canvas.id}`,
          extent: "parent",
          position: {
            x: (x - minX) + GROUP_PADDING,
            y: (y - minY) + GROUP_PADDING,
          },
        });
      });

      groupOffsetX += groupW + GROUP_COL_GAP;
    });

    // Edges — once each; into a collapsed Canvas they are bundled onto its cluster.
    // isInterCanvas compares the endpoints' home canvases, not the edge's canvas lists.
    drawnEdges(canvases, allEdges, home, collapsed).forEach((d) => {
      const edgeColor = levelColor(scaleLevels, d.functionality);
      edges.push({
        id: d.id,
        source: d.source,
        target: d.target,
        type: "globalEdge",
        label: d.members.length > 1 ? `×${d.members.length}` : undefined,
        data: { isInterCanvas: d.isInterCanvas, color: edgeColor },
        markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor, width: 14, height: 10 },
      });
    });

    return { rfNodes: nodes, rfEdges: edges };
  }, [canvases, allNodes, allEdges, scaleLevels, collapsed, config, weightAttr, moved]);

  return (
    <div className="h-full w-full">
      {/* Level Mode paints Stocks by the Level Scale (ADR-0019 §6); null = the live colours. */}
      <SnapshotColorsProvider value={levelPaint?.colors ?? null}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={{ ...nodeTypes, canvasGroup: CanvasGroupNode as never, canvasCluster: CanvasClusterNode as never }}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        connectionMode={ConnectionMode.Loose}
        // Only Canvas regions and clusters drag (draggable on those nodes); their nodes follow.
        nodesDraggable={false}
        onNodesChange={onNodesChange}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnScroll={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color={brandColor("neutral", 300)} />
        <ZoomSlider />
        <CanvasMiniMap />
      </ReactFlow>
      </SnapshotColorsProvider>

      {/* Legend overlay — bottom right, outside ReactFlow so it never pans/zooms.
          Every canvas view needs it: an Analysis Heatmap applies to the Element
          registry, so its colours show here as much as in the single-canvas view. */}
      <CanvasLegend />


      {/* Read-only badge, then the collapse controls (top centre is search, top right the Situation window) */}
      <div className="absolute left-3 top-3 flex items-center gap-2">
        <div className="pointer-events-none flex items-center gap-1.5 rounded-md bg-white/80 px-2.5 py-1 text-xs font-medium text-zinc-500 shadow-sm ring-1 ring-zinc-200 backdrop-blur-sm dark:bg-zinc-900/80 dark:ring-zinc-700">
          Read-only · All canvases
        </div>
        {canvases.length > 1 && (
          <div data-export-ignore className="flex items-center gap-0.5 rounded-md bg-white/90 px-1 py-1 text-xs font-medium text-zinc-600 shadow-sm ring-1 ring-zinc-200 backdrop-blur-sm dark:bg-zinc-900/90 dark:text-zinc-300 dark:ring-zinc-700">
            <button type="button" className="rounded px-1.5 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              title="Draw every Canvas as one node"
              onClick={() => useUiStore.getState().setGroupedCollapsed(canvases.map((c) => c.id))}>Collapse all</button>
            <button type="button" className="rounded px-1.5 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              onClick={() => useUiStore.getState().setGroupedCollapsed([])}>Expand all</button>
            {Object.keys(moved).length > 0 && (
              <button type="button" className="rounded px-1.5 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                title="Put every Canvas back in a row" onClick={() => useUiStore.getState().clearGroupedMoves()}>Re-arrange</button>
            )}
          </div>
        )}
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
