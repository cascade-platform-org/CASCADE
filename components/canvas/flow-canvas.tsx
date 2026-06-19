"use client";

/**
 * FlowCanvas — React Flow canvas for a single CASCADE Canvas.
 *
 * Custom SVG node shapes per Node Type:
 *   Source        → diamond
 *   Infrastructure → octagon
 *   Service       → circle
 *   Personnel     → rounded-square
 *
 * Node size ∝ importance; fill = functionality level color from config.
 * Border ring = category color; segmented if multi-category.
 * functionality_time > 0 → pulsing yellow ring.
 * direct_damage = true  → red ⚡ overlay.
 *
 * Edges: directed arrow, getSmoothStepPath, color = edge functionality color.
 * Inter-canvas edges: dashed + target canvas name label.
 *
 * Performance: onlyRenderVisibleElements=true; selection in network-store.
 */

import {
  ReactFlow,
  Background,
  BackgroundVariant,
  useReactFlow,
  getNodesBounds,
  Handle,
  Position,
  ConnectionMode,
  MarkerType,
  type NodeTypes,
  type EdgeTypes,
  type Node as RFNode,
  type Edge as RFEdge,
  type NodeMouseHandler,
  type OnSelectionChangeFunc,
  getBezierPath,
  BaseEdge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useCallback, useEffect, useMemo, memo, useState, useRef, useReducer } from "react";
import { useShallow } from "zustand/react/shallow";
import { nanoid } from "nanoid";
import { ChevronDown } from "lucide-react";
import { categoryToIcon, subscribeIconsReady } from "@/lib/category-icons";
import { cn } from "@/lib/utils";
import { useCanvasStore, selectActiveCanvas, selectActiveNodes, selectActiveEdges } from "@/store/canvas-store";
import { useHistoryStore } from "@/store/history-store";
import { NodeSearch } from "./node-search";
import { ZoomSlider } from "./zoom-slider";
import { Lasso } from "./lasso";
import { useNetworkStore } from "@/store/network-store";
import { useClipboardStore } from "@/store/clipboard-store";
import { useConfigStore, selectN, selectLevelColor } from "@/store/config-store";
import { useUiStore } from "@/store/ui-store";
import { useAnalysisStore } from "@/store/analysis-store";
import type { Node as CascadeNode, Edge as CascadeEdge } from "@/lib/schemas/network";
import { pickHandles } from "@/lib/edge-routing";
import { CanvasContextMenu } from "./canvas-context-menu";
import { GeoMapBackground } from "@/components/geo/geo-map-background";
import { anchorFlowToGeo } from "@/lib/geo-utils";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_SIZE = 36;  // px at importance 0.5
const MIN_SIZE = 24;
const MAX_SIZE = 56;

function nodeSize(importance: number | undefined): number {
  const imp = importance ?? 0.5;
  return Math.round(MIN_SIZE + (MAX_SIZE - MIN_SIZE) * Math.min(1, Math.max(0, imp)));
}

// ---------------------------------------------------------------------------
// Helpers — convert CASCADE nodes/edges → React Flow format
// ---------------------------------------------------------------------------

export function toRFNode(node: CascadeNode, selected: boolean): RFNode {
  return {
    id: node.id,
    type: (node.node_type?.toLowerCase() ?? "service") as string,
    position: node.position ?? { x: 0, y: 0 },
    data: node,
    selected,
  };
}

function toRFEdge(edge: CascadeEdge, isInterCanvas: boolean, targetCanvasLabel?: string): RFEdge {
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
// SVG shape helpers
// ---------------------------------------------------------------------------

interface ShapeProps {
  size: number;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  strokeDasharray?: string;
  strokeDashoffset?: number;
}

function Diamond({ size, fill, stroke = "#e4e4e7", strokeWidth = 2.5, strokeDasharray, strokeDashoffset }: ShapeProps) {
  const h = size * 0.5;
  return (
    <polygon
      points={`${h},0 ${size},${h} ${h},${size} 0,${h}`}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeDasharray={strokeDasharray}
      strokeDashoffset={strokeDashoffset}
    />
  );
}

function Octagon({ size, fill, stroke = "#e4e4e7", strokeWidth = 2.5, strokeDasharray, strokeDashoffset }: ShapeProps) {
  const o = size * 0.2;
  const e = size - o;
  const points = [
    [o, 0], [e, 0], [size, o], [size, e],
    [e, size], [o, size], [0, e], [0, o],
  ].map(([x, y]) => `${x},${y}`).join(" ");
  return (
    <polygon
      points={points}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeDasharray={strokeDasharray}
      strokeDashoffset={strokeDashoffset}
    />
  );
}

function Circle({ size, fill, stroke = "#e4e4e7", strokeWidth = 2.5, strokeDasharray, strokeDashoffset }: ShapeProps) {
  const r = size * 0.5;
  return (
    <circle
      cx={r} cy={r} r={r - 1}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeDasharray={strokeDasharray}
      strokeDashoffset={strokeDashoffset}
    />
  );
}

function RoundedSquare({ size, fill, stroke = "#e4e4e7", strokeWidth = 2.5, strokeDasharray, strokeDashoffset }: ShapeProps) {
  return (
    <rect
      x={1} y={1}
      width={size - 2} height={size - 2}
      rx={size * 0.2} ry={size * 0.2}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeDasharray={strokeDasharray}
      strokeDashoffset={strokeDashoffset}
    />
  );
}

// ---------------------------------------------------------------------------
// Category → Lucide icon mapping
// Matched by keyword so no schema change is needed. Add more keywords as new
// category names appear in user configs.
// ---------------------------------------------------------------------------

type ShapeType = typeof Diamond | typeof Octagon | typeof Circle | typeof RoundedSquare;

// ---------------------------------------------------------------------------
// Category icons — rendered as absolutely-positioned Lucide icons inside the shape
// ---------------------------------------------------------------------------

interface CategoryItem { name: string; icon?: string }

function CategoryIcons({
  categories,
  size,
}: {
  categories: CategoryItem[];
  size: number;
}) {
  if (categories.length === 0) return null;

  const visible = categories.slice(0, 3);
  const gap = 3;
  const maxTotalW = size * 0.78;
  const iconSize = Math.max(8, Math.min(
    Math.floor(size * 0.45),
    Math.floor((maxTotalW - (visible.length - 1) * gap) / visible.length),
  ));
  const totalW = visible.length * iconSize + (visible.length - 1) * gap;
  const startX = 8 + (size - totalW) / 2;
  const startY = (size - iconSize) / 2;

  return (
    <>
      {visible.map(({ name, icon }, i) => {
        const Icon = categoryToIcon(name, icon);
        return (
          <div
            key={name}
            style={{
              position: "absolute",
              left: startX + i * (iconSize + gap),
              top: startY,
              width: iconSize,
              height: iconSize,
              pointerEvents: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon size={iconSize} color="black" strokeWidth={2.2} />
          </div>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Crack geometry — coordinates in SVG root space (shape starts at x = offsetX)
// ---------------------------------------------------------------------------

function buildCrackPaths(size: number, offsetX: number) {
  const cx = offsetX + size * 0.5;
  const s = size;
  const main = [
    `M ${cx - s * 0.04},0`,
    `L ${cx + s * 0.10},${s * 0.18}`,
    `L ${cx - s * 0.06},${s * 0.26}`,
    `L ${cx + s * 0.12},${s * 0.48}`,
    `L ${cx - s * 0.08},${s * 0.56}`,
    `L ${cx + s * 0.08},${s * 0.75}`,
    `L ${cx - s * 0.04},${s * 0.82}`,
    `L ${cx + s * 0.06},${s}`,
  ].join(" ");
  const branch = [
    `M ${cx + s * 0.12},${s * 0.48}`,
    `L ${cx + s * 0.26},${s * 0.62}`,
    `L ${cx + s * 0.18},${s * 0.72}`,
  ].join(" ");
  return { main, branch };
}

// ---------------------------------------------------------------------------
// Base custom node renderer
// ---------------------------------------------------------------------------

type NodeData = CascadeNode;

// React Flow passes `selected` as a top-level prop, not inside `data`.
function CascadeNodeBase({ data, Shape, selected }: { data: NodeData; Shape: ShapeType; selected?: boolean }) {
  // Re-render once when the full icon cache becomes ready so stored icons show immediately.
  const [, forceRender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => subscribeIconsReady(forceRender), []);

  const size = nodeSize(data.importance);
  const functionalityColor = useConfigStore(selectLevelColor(data.functionality));
  const heatmapOverride = useAnalysisStore((s) => s.heatmapActive ? (s.heatmapColors[data.id] ?? null) : null);
  const levelColor = heatmapOverride ?? functionalityColor;
  const configCategories = useConfigStore((s) => s.config.categories);
  const activeTool = useUiStore((s) => s.activeTool);
  // Build CategoryItem list so CategoryIcons can resolve stored icon names
  const nodeCategories: CategoryItem[] = (data.node_categories ?? []).map((name) => ({
    name,
    icon: configCategories.find((c) => c.name === name)?.icon,
  }));

  const hasTimeWarning = (data.functionality_time ?? 0) > 0;
  const hasDamage = data.direct_damage === true;

  // Crack geometry — computed once; coordinates are in SVG root space (shape offset = 8px)
  const crack = hasDamage ? buildCrackPaths(size, 8) : null;
  // SVG IDs must not contain characters invalid in id/url() — replace anything non-alphanumeric
  const maskId = `frac-${data.id.replace(/[^a-zA-Z0-9]/g, "-")}`;
  const label = data.label ?? data.id;
  const showHandles = activeTool === "add-edge";

  // 6 connection points distributed around the shape perimeter.
  // The shape is drawn inside the SVG with an 8px left offset, so:
  //   shape left edge  = x=8, right edge = x=8+size
  //   shape top = y=0, bottom = y=size
  // All handles are type="source"; ConnectionMode.Loose allows them to act as
  // targets too. Each carries a unique id so React Flow can pick the closest one.
  const handleDot: React.CSSProperties = {
    width: 10, height: 10,
    background: "#3b82f6",
    border: "2px solid #fff",
    borderRadius: "50%",
    opacity: showHandles ? 1 : 0,
    transition: "opacity 0.15s",
    // We override position with left/top below; transform centers the dot.
    transform: "translate(-50%, -50%)",
  };
  const handles = [
    { id: "tl", pos: Position.Top,    x: 8 + size * 0.25, y: 0        },
    { id: "tr", pos: Position.Top,    x: 8 + size * 0.75, y: 0        },
    { id: "ml", pos: Position.Left,   x: 8,               y: size * 0.5 },
    { id: "mr", pos: Position.Right,  x: 8 + size,        y: size * 0.5 },
    { id: "bl", pos: Position.Bottom, x: 8 + size * 0.25, y: size     },
    { id: "br", pos: Position.Bottom, x: 8 + size * 0.75, y: size     },
  ];

  return (
    <div style={{ position: "relative", width: size + 16, height: size + 24 }}>
      {handles.map(({ id, pos, x, y }) => (
        <Handle
          key={id}
          id={id}
          type="source"
          position={pos}
          style={{ ...handleDot, left: x, top: y }}
        />
      ))}

      {/* Pulsing ring for functionality_time */}
      {hasTimeWarning && (
        <div
          className="animate-ping absolute rounded-full opacity-60"
          style={{
            top: 0, left: 4,
            width: size + 8, height: size + 8,
            border: "2px solid #facc15",
            borderRadius: "50%",
          }}
        />
      )}

      <svg
        width={size + 16}
        height={size + 16}
        style={{ overflow: "visible", display: "block" }}
      >
        {/* Selected highlight ring — driven by RF `selected` prop, not data */}
        {selected && (
          <rect
            x={0} y={0}
            width={size + 16} height={size + 16}
            rx={4}
            fill="none"
            stroke="#3b82f6"
            strokeWidth={2}
            strokeDasharray="4 2"
          />
        )}

        {/* SVG mask that cuts the crack gap out of the node when damaged */}
        {crack && (
          <defs>
            <mask id={maskId} maskUnits="userSpaceOnUse">
              {/* White = keep, black = cut through */}
              <rect x={8} y={0} width={size} height={size} fill="white" />
              <path d={crack.main}   stroke="black" strokeWidth={2}   strokeLinecap="round" strokeLinejoin="round" fill="none" />
              <path d={crack.branch} stroke="black" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </mask>
          </defs>
        )}

        {/* Filled shape (functionality colour) — masked to show crack gap */}
        <g mask={crack ? `url(#${maskId})` : undefined}>
          <g transform="translate(8,0)">
            <Shape size={size} fill={levelColor} stroke="none" />
          </g>
        </g>

        {/* Neutral border — also masked so the outline breaks at the crack */}
        <g mask={crack ? `url(#${maskId})` : undefined}>
          <g transform="translate(8,0)">
            <Shape size={size} fill="transparent" stroke="white" strokeWidth={2} />
          </g>
        </g>

      </svg>

      {/* Category icons centered inside the shape */}
      <CategoryIcons categories={nodeCategories} size={size} />

      {/* Label below */}
      <div
        style={{
          position: "absolute",
          top: size + 2,
          left: "50%",
          transform: "translateX(-50%)",
          textAlign: "center",
          fontSize: 10,
          color: "#52525b",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          maxWidth: 200,
          lineHeight: "14px",
        }}
      >
        {label.length > 30 ? label.slice(0, 29) + "…" : label}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Typed node components
// ---------------------------------------------------------------------------

type RFNodeProps = { data: NodeData; selected?: boolean };

const SourceNode = memo(({ data, selected }: RFNodeProps) => <CascadeNodeBase data={data} Shape={Diamond} selected={selected} />);
SourceNode.displayName = "SourceNode";

const InfrastructureNode = memo(({ data, selected }: RFNodeProps) => <CascadeNodeBase data={data} Shape={Octagon} selected={selected} />);
InfrastructureNode.displayName = "InfrastructureNode";

const ServiceNode = memo(({ data, selected }: RFNodeProps) => <CascadeNodeBase data={data} Shape={Circle} selected={selected} />);
ServiceNode.displayName = "ServiceNode";

const PersonnelNode = memo(({ data, selected }: RFNodeProps) => <CascadeNodeBase data={data} Shape={RoundedSquare} selected={selected} />);
PersonnelNode.displayName = "PersonnelNode";

export const nodeTypes: NodeTypes = {
  source: SourceNode as NodeTypes[string],
  infrastructure: InfrastructureNode as NodeTypes[string],
  service: ServiceNode as NodeTypes[string],
  personnel: PersonnelNode as NodeTypes[string],
};

// ---------------------------------------------------------------------------
// Custom edge
// ---------------------------------------------------------------------------

function CascadeEdge({
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
  data?: { functionality: number; isInterCanvas: boolean; targetCanvasLabel?: string };
  selected?: boolean;
  markerEnd?: string;  // provided by React Flow from the edge definition's markerEnd field
}) {
  const n = useConfigStore(selectN);
  const functionalityColorEdge = useConfigStore(selectLevelColor(data?.functionality ?? n));
  const heatmapOverride = useAnalysisStore((s) => s.heatmapActive && id ? (s.heatmapColors[id] ?? null) : null);
  const levelColor = heatmapOverride ?? functionalityColorEdge;

  const [edgePath] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  });

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      style={{
        stroke: selected ? "#3b82f6" : levelColor,
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

function CanvasLegend() {
  const scaleLevels = useConfigStore(useShallow((s) => s.config.functionality_scale));
  const [open, setOpen] = useState(true);

  const NODE_TYPES = [
    { type: "source", label: "Source" },
    { type: "infrastructure", label: "Infrastructure" },
    { type: "service", label: "Service" },
    { type: "personnel", label: "Personnel" },
  ];

  return (
    <div className="absolute bottom-3 right-3 z-10 max-w-[180px]">
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
                    <LegendShape type={type} size={13} fill="#94a3b8" />
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

// ---------------------------------------------------------------------------
// Main FlowCanvas component
// ---------------------------------------------------------------------------

export function FlowCanvas() {
  const activeCanvas = useCanvasStore(selectActiveCanvas);
  const allNodes = useCanvasStore((s) => s.nodes);
  const allEdges = useCanvasStore((s) => s.edges);
  const allCanvases = useCanvasStore((s) => s.canvases) as Record<string, import("@/lib/schemas/network").Canvas>;
  const updateNode = useCanvasStore((s) => s.updateNode);
  const upsertNode = useCanvasStore((s) => s.upsertNode);
  const upsertEdge = useCanvasStore((s) => s.upsertEdge);
  const removeNode = useCanvasStore((s) => s.removeNode);
  const removeEdge = useCanvasStore((s) => s.removeEdge);
  const addNodeToCanvas = useCanvasStore((s) => s.addNodeToCanvas);
  const addEdgeToCanvas = useCanvasStore((s) => s.addEdgeToCanvas);
  const toGraphSnapshot = useCanvasStore((s) => s.toGraphSnapshot);

  const selectedNodeIds = useNetworkStore((s) => s.selectedNodeIds);
  const selectedEdgeIds = useNetworkStore((s) => s.selectedEdgeIds);
  const selectNode = useNetworkStore((s) => s.selectNode);
  const selectEdge = useNetworkStore((s) => s.selectEdge);
  const toggleNode = useNetworkStore((s) => s.toggleNode);
  const toggleEdge = useNetworkStore((s) => s.toggleEdge);
  const selectAll = useNetworkStore((s) => s.selectAll);
  const clearSelection = useNetworkStore((s) => s.clearSelection);

  const clipboard = useClipboardStore((s) => s.contents);
  const copyToClipboard = useClipboardStore((s) => s.copy);

  const { screenToFlowPosition, getNodes, fitView } = useReactFlow();

  // Auto-frame the Canvas's content when switching Canvas. fitView's `fitView`
  // prop only fires on first mount, and FlowCanvas is not remounted per Canvas,
  // so we re-fit whenever the active Canvas changes. rAF lets React Flow commit
  // the new Canvas's nodes before we measure their bounds.
  const activeCanvasId = activeCanvas?.id;
  useEffect(() => {
    if (!activeCanvasId) return;
    const raf = requestAnimationFrame(() => {
      if (getNodes().length > 0) fitView({ duration: 300 });
    });
    return () => cancelAnimationFrame(raf);
  }, [activeCanvasId, fitView, getNodes]);

  // Register a capture function in ui-store so the Scorecard dialog can call it
  // from outside the ReactFlow context. Captures whatever is currently rendered
  // on screen — the user is responsible for being on the view they want to record.
  // Uses html-to-image (handles CSS transforms and SVG edges correctly).
  useEffect(() => {
    async function capture(): Promise<string | undefined> {
      try {
        const { toPng } = await import("html-to-image");
        const nodes = getNodes();
        if (nodes.length === 0) return undefined;

        // Georeferenced canvas: capture the full container (map + nodes) at its
        // natural screen size so the map tiles appear in the exported image.
        const storeState = (await import("@/store/canvas-store")).useCanvasStore.getState();
        const activeId = storeState.activeCanvasId;
        const isGeoref = activeId ? (storeState.canvases[activeId]?.georeferenced ?? false) : false;

        if (isGeoref && containerRef.current) {
          const el = containerRef.current;
          return await toPng(el, {
            width: el.offsetWidth,
            height: el.offsetHeight,
          });
        }

        const viewport =
          containerRef.current?.querySelector<HTMLElement>(".react-flow__viewport") ??
          document.querySelector<HTMLElement>(".react-flow__viewport");
        if (!viewport) return undefined;

        const rawBounds = getNodesBounds(nodes);
        // Expand by OVERFLOW in flow-space so labels/badges that extend beyond
        // the node's own bounding box are never clipped in the output image.
        const OVERFLOW = 40;
        const bounds = {
          x: rawBounds.x - OVERFLOW,
          y: rawBounds.y - OVERFLOW,
          width: rawBounds.width + 2 * OVERFLOW,
          height: rawBounds.height + 2 * OVERFLOW,
        };
        const PADDING = 48;
        const TARGET_MAX = 1600;

        // Zoom to fit the content within TARGET_MAX on its longest axis.
        const zoom = Math.min(2, Math.max(0.15,
          Math.min(TARGET_MAX / bounds.width, TARGET_MAX / bounds.height),
        ));

        // Desired output dimensions: tight crop around content.
        const cropW = Math.round(bounds.width * zoom + 2 * PADDING);
        const cropH = Math.round(bounds.height * zoom + 2 * PADDING);

        // With transformOrigin "0 0", translate(tx, ty) scale(zoom) maps a node
        // at flow position (bounds.x, bounds.y) to screen (PADDING, PADDING).
        const tx = PADDING - bounds.x * zoom;
        const ty = PADDING - bounds.y * zoom;

        // The capture canvas must be wide/tall enough to contain ALL nodes at
        // their original (untransformed) positions so nothing is clipped by
        // the element's own overflow box before the transform is applied.
        const captureW = Math.max(Math.ceil(Math.max(0, bounds.x) + bounds.width) + PADDING, cropW);
        const captureH = Math.max(Math.ceil(Math.max(0, bounds.y) + bounds.height) + PADDING, cropH);

        const dataUrl = await toPng(viewport, {
          backgroundColor: "#f4f4f5",
          width: captureW,
          height: captureH,
          style: {
            width: `${captureW}px`,
            height: `${captureH}px`,
            transform: `translate(${tx}px, ${ty}px) scale(${zoom})`,
            transformOrigin: "0 0",
          },
        });

        // If the capture canvas was larger than the desired output, crop it.
        if (cropW < captureW || cropH < captureH) {
          const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = reject;
            image.src = dataUrl;
          });
          const canvas = document.createElement("canvas");
          canvas.width = cropW;
          canvas.height = cropH;
          const ctx = canvas.getContext("2d");
          if (!ctx) return dataUrl;
          ctx.drawImage(img, 0, 0, cropW, cropH, 0, 0, cropW, cropH);
          return canvas.toDataURL("image/png");
        }

        return dataUrl;
      } catch {
        return undefined;
      }
    }

    useUiStore.getState().registerCaptureCanvas(capture);
    return () => useUiStore.getState().registerCaptureCanvas(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // register once — capture() reads live DOM state on every call

  // When the lasso fires onSelect, React Flow also fires an onSelectionChange
  // with an empty array (it sees the drag-end as a pane interaction and thinks
  // everything was deselected). This ref prevents that spurious empty-deselect
  // from wiping the selection the lasso just committed.
  const containerRef = useRef<HTMLDivElement>(null);
  const lassoActiveRef = useRef(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const activeTool = useUiStore((s) => s.activeTool);
  const setInspectorOpen = useUiStore((s) => s.setInspectorOpen);
  const pushToast = useUiStore((s) => s.pushToast);
  const selectedNodeTemplate = useUiStore((s) => s.selectedNodeTemplate);

  const n = useConfigStore(selectN);
  const scaleLevels = useConfigStore(useShallow((s) => s.config.functionality_scale));
  const graphTypes = useConfigStore((s) => s.config.graph_types);
  const nodeDefaults = useConfigStore(useShallow((s) => s.config.node_defaults ?? {}));

  // Build React Flow nodes/edges from store.
  // selectedNodeIds IS included in deps so that attribute updates (which change
  // allNodes) don't reset selection: the memo always stamps each node with its
  // current `selected` state, preventing RF from losing the selection on re-render.
  // The loop risk (store→rfNodes→onSelectionChange→store) is broken by the
  // idempotency guard inside onSelectionChange.
  const rfNodes = useMemo<RFNode[]>(() => {
    if (!activeCanvas) return [];
    return activeCanvas.graph.node_ids.flatMap((id) => {
      const node = allNodes[id];
      if (!node) return [];
      return [toRFNode(node, selectedNodeIds.has(id))];
    });
  }, [activeCanvas, allNodes, selectedNodeIds]);

  const rfEdges = useMemo<RFEdge[]>(() => {
    if (!activeCanvas) return [];
    const activeNodeIds = new Set(activeCanvas.graph.node_ids);

    // Collect edges from every canvas that has at least one endpoint in the
    // active canvas — this makes inter-canvas edges visible from both sides.
    const edgeIdsSeen = new Set<string>();
    const allCanvasEdgeIds = Object.values(allCanvases).flatMap((c) => c.graph.edge_ids);

    return allCanvasEdgeIds.flatMap((id) => {
      if (edgeIdsSeen.has(id)) return [];
      edgeIdsSeen.add(id);
      const edge = allEdges[id];
      if (!edge) return [];
      const tailInActive = activeNodeIds.has(edge.source);
      const headInActive = activeNodeIds.has(edge.target);
      if (!tailInActive && !headInActive) return [];
      const isInterCanvas = !tailInActive || !headInActive;
      const otherNodeId = isInterCanvas ? (tailInActive ? edge.target : edge.source) : null;
      const targetCanvas = otherNodeId
        ? Object.values(allCanvases).find(
            (c) => c.id !== activeCanvas.id && c.graph.node_ids.includes(otherNodeId),
          )
        : undefined;
      const edgeColor = scaleLevels.find((l) => l.level === edge.functionality)?.color ?? "#94a3b8";
      return [{
        ...toRFEdge(edge, isInterCanvas, targetCanvas?.label),
        selected: selectedEdgeIds.has(id),
        markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor, width: 14, height: 10 },
      }];
    });
  }, [activeCanvas, allEdges, allCanvases, scaleLevels, selectedEdgeIds]);

  // ── Node drag end → update position + push undoable history entry ──
  const onNodeDragStop = useCallback((_: React.MouseEvent, rfNode: RFNode) => {
    const before = toGraphSnapshot();
    const geoAnchor = activeCanvas?.geo_anchor ?? null;
    const nodePatch: Partial<CascadeNode> = { position: rfNode.position };
    if (geoAnchor) {
      nodePatch.geo = anchorFlowToGeo(rfNode.position, geoAnchor);
    }
    updateNode(rfNode.id, nodePatch);
    useHistoryStore.getState().pushUpdateEntry({
      id: nanoid(),
      timestamp: new Date().toISOString(),
      update_type: "graph_update",
      label: "Move node",
      canvas_id: activeCanvas?.id,
      before,
      after: toGraphSnapshot(),
    });
  }, [updateNode, toGraphSnapshot, activeCanvas]);

  // ── Click → select ──
  // Ctrl/Meta+click: XOR-toggle into a homogeneous selection (nodes only OR edges only).
  // Plain click: single selection as before.
  // Ctrl/Meta+click: XOR-toggle. Plain click: single select.
  // setRfNodes is no longer needed here — the rfNodes memo re-stamps `selected`
  // from the store on every render, so the visual highlight follows automatically.
  const onNodeClick: NodeMouseHandler = useCallback((e, rfNode) => {
    if (e.ctrlKey || e.metaKey) {
      toggleNode(rfNode.id);
    } else {
      selectNode(rfNode.id);
    }
    setInspectorOpen(true);
  }, [selectNode, toggleNode, setInspectorOpen]);

  const onEdgeClick = useCallback((e: React.MouseEvent, rfEdge: RFEdge) => {
    if (e.ctrlKey || e.metaKey) {
      toggleEdge(rfEdge.id);
    } else {
      selectEdge(rfEdge.id);
    }
    setInspectorOpen(true);
  }, [selectEdge, toggleEdge, setInspectorOpen]);

  const onPaneClick = useCallback(() => {
    setContextMenu(null);
    if (lassoActiveRef.current) {
      lassoActiveRef.current = false;
      return;
    }
    clearSelection();
    setInspectorOpen(false);
  }, [clearSelection, setInspectorOpen]);

  // ── Rectangle / box select ──
  // Two guards here prevent looping:
  //
  // 1. Lasso guard: RF fires onSelectionChange({nodes:[], edges:[]}) when it
  //    processes the drag-end as a pane interaction. Skip that while
  //    lassoActiveRef is true.
  //
  // 2. Idempotency guard: since rfNodes/rfEdges now stamp `selected` from the
  //    store, every store update causes the memo to recompute, which makes RF
  //    fire onSelectionChange with the same set of IDs already in the store.
  //    We detect that case and skip the redundant selectAll to stop the loop.
  const onSelectionChange: OnSelectionChangeFunc = useCallback(({ nodes, edges }) => {
    if (lassoActiveRef.current) {
      if (nodes.length === 0 && edges.length === 0) {
        // Spurious empty deselect from RF drag-end — consume it.
        // Do NOT reset lassoActiveRef here: onPaneClick may fire after this and
        // must still see the guard so it doesn't wipe the lasso result.
        return;
      }
      // Non-empty: let fall through; keep ref raised.
    }
    const newNodeIds = nodes.map((n) => n.id);
    const newEdgeIds = edges.map((e) => e.id);
    const { selectedNodeIds: curN, selectedEdgeIds: curE } = useNetworkStore.getState();
    if (
      newNodeIds.length === curN.size &&
      newEdgeIds.length === curE.size &&
      newNodeIds.every((id) => curN.has(id)) &&
      newEdgeIds.every((id) => curE.has(id))
    ) return;
    useNetworkStore.getState().selectAll(newNodeIds, newEdgeIds);
    if (newNodeIds.length > 0 || newEdgeIds.length > 0) setInspectorOpen(true);
  }, [setInspectorOpen]);

  // ── Add edge on connect ──
  // When the user drags from an explicit handle dot, RF provides sourceHandle /
  // targetHandle. When they use connectOnClick (clicking anywhere on a node),
  // handles are null — we fall back to the position-based heuristic that picks
  // the handle whose hexagon sector faces the other node.
  const onConnect = useCallback((connection: {
    source: string | null;
    target: string | null;
    sourceHandle: string | null;
    targetHandle: string | null;
  }) => {
    if (!connection.source || !connection.target || !activeCanvas) return;
    const before = toGraphSnapshot();

    let sourceHandle = connection.sourceHandle ?? undefined;
    let targetHandle = connection.targetHandle ?? undefined;

    if (!sourceHandle || !targetHandle) {
      const srcNode = allNodes[connection.source];
      const tgtNode = allNodes[connection.target];
      if (srcNode && tgtNode) {
        const picked = pickHandles(
          { position: srcNode.position ?? { x: 0, y: 0 } },
          { position: tgtNode.position ?? { x: 0, y: 0 } },
        );
        sourceHandle = sourceHandle ?? picked.sourceHandle;
        targetHandle = targetHandle ?? picked.targetHandle;
      }
    }

    const edge: CascadeEdge = {
      id: `edge-${nanoid(8)}`,
      source: connection.source,
      target: connection.target,
      sourceHandle,
      targetHandle,
      functionality: n,
    };
    upsertEdge(edge);
    addEdgeToCanvas(edge.id, activeCanvas.id);
    useHistoryStore.getState().pushUpdateEntry({
      id: nanoid(),
      timestamp: new Date().toISOString(),
      update_type: "graph_update",
      label: "Add edge",
      canvas_id: activeCanvas.id,
      before,
      after: toGraphSnapshot(),
    });
  }, [activeCanvas, n, upsertEdge, addEdgeToCanvas, toGraphSnapshot]);

  // ── Delete selected ──
  const deleteSelected = useCallback(() => {
    const nodeCount = selectedNodeIds.size;
    const edgeCount = selectedEdgeIds.size;
    const total = nodeCount + edgeCount;
    if (total === 0) return;
    if (total > 3) {
      const ok = window.confirm(`Delete ${total} selected elements?`);
      if (!ok) return;
    }
    const before = toGraphSnapshot();
    selectedNodeIds.forEach((id) => removeNode(id));
    selectedEdgeIds.forEach((id) => removeEdge(id));
    clearSelection();
    if (!activeCanvas) return;
    useHistoryStore.getState().pushUpdateEntry({
      id: nanoid(),
      timestamp: new Date().toISOString(),
      update_type: "graph_update",
      label: `Delete ${total} element${total > 1 ? "s" : ""}`,
      canvas_id: activeCanvas.id,
      before,
      after: toGraphSnapshot(),
    });
  }, [selectedNodeIds, selectedEdgeIds, removeNode, removeEdge, clearSelection, toGraphSnapshot, activeCanvas]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      // Delete / Backspace
      if (e.key === "Delete" || e.key === "Backspace") {
        deleteSelected();
        return;
      }

      // Ctrl+A — select all
      if (e.key === "a" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (!activeCanvas) return;
        selectAll(activeCanvas.graph.node_ids, activeCanvas.graph.edge_ids);
        setInspectorOpen(true);
        return;
      }

      // Ctrl+C — copy
      if (e.key === "c" && (e.ctrlKey || e.metaKey)) {
        if (!activeCanvas || selectedNodeIds.size === 0) return;
        const nodes = [...selectedNodeIds].flatMap((id) => allNodes[id] ? [allNodes[id]] : []);
        const edges = [...selectedEdgeIds].flatMap((id) => allEdges[id] ? [allEdges[id]] : []);
        copyToClipboard(nodes, edges, activeCanvas.id);
        return;
      }

      // Ctrl+V — paste
      if (e.key === "v" && (e.ctrlKey || e.metaKey)) {
        if (!clipboard || !activeCanvas) return;
        const before = toGraphSnapshot();
        const idMap: Record<string, string> = {};
        const newNodeIds: string[] = [];

        clipboard.nodes.forEach((node) => {
          const newId = `node-${nanoid(8)}`;
          idMap[node.id] = newId;
          const newNode: CascadeNode = {
            ...node,
            id: newId,
            position: { x: (node.position?.x ?? 0) + 40, y: (node.position?.y ?? 0) + 40 },
          };
          upsertNode(newNode);
          addNodeToCanvas(newId, activeCanvas.id);
          newNodeIds.push(newId);
        });

        clipboard.edges.forEach((edge) => {
          const newId = `edge-${nanoid(8)}`;
          const newEdge: CascadeEdge = {
            ...edge,
            id: newId,
            source: idMap[edge.source] ?? edge.source,
            target: idMap[edge.target] ?? edge.target,
          };
          upsertEdge(newEdge);
          addEdgeToCanvas(newId, activeCanvas.id);
        });

        useHistoryStore.getState().pushUpdateEntry({
          id: nanoid(),
          timestamp: new Date().toISOString(),
          update_type: "graph_update",
          label: `Paste ${clipboard.nodes.length} node${clipboard.nodes.length > 1 ? "s" : ""}`,
          canvas_id: activeCanvas.id,
          before,
          after: toGraphSnapshot(),
        });
        return;
      }

      // Ctrl+Z — undo
      if (e.key === "z" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        const undone = useCanvasStore.getState().undo();
        if (!undone) pushToast({ message: "Nothing more to undo", variant: "info", durationMs: 2000 });
        return;
      }

      // Ctrl+Y / Ctrl+Shift+Z — redo
      if ((e.key === "y" && (e.ctrlKey || e.metaKey)) ||
          (e.key === "z" && (e.ctrlKey || e.metaKey) && e.shiftKey)) {
        e.preventDefault();
        const redone = useCanvasStore.getState().redo();
        if (!redone) pushToast({ message: "Nothing more to redo", variant: "info", durationMs: 2000 });
        return;
      }

      // Ctrl+R — clear most recent event (surgical field-by-field revert via mutation_reversal).
      // Escape excluded: conflicts with modal/dialog close handlers.
      if (e.key === "r" && (e.ctrlKey || e.metaKey)) {
        const cleared = useCanvasStore.getState().clearEvent();
        if (!cleared) pushToast({ message: "No event to clear", variant: "info", durationMs: 2000 });
        return;
      }

      // Tool shortcuts
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const toolMap: Record<string, () => void> = {
          v: () => useUiStore.getState().setActiveTool("select"),
          V: () => useUiStore.getState().setActiveTool("select"),
          n: () => useUiStore.getState().setActiveTool("add-node"),
          N: () => useUiStore.getState().setActiveTool("add-node"),
          e: () => useUiStore.getState().setActiveTool("add-edge"),
          E: () => useUiStore.getState().setActiveTool("add-edge"),
          h: () => useUiStore.getState().setActiveTool("pan"),
          H: () => useUiStore.getState().setActiveTool("pan"),
        };
        toolMap[e.key]?.();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    deleteSelected, activeCanvas, selectAll, setInspectorOpen,
    selectedNodeIds, selectedEdgeIds, allNodes, allEdges,
    copyToClipboard, clipboard, upsertNode, upsertEdge,
    addNodeToCanvas, addEdgeToCanvas,
    toGraphSnapshot, pushToast,
  ]);

  // ── Double-click on pane → add node (when add-node tool active) ──
  const onPaneDoubleClick = useCallback((e: React.MouseEvent) => {
    if (activeTool !== "add-node" || !activeCanvas) return;
    e.preventDefault();
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const before = toGraphSnapshot();
    const tpl = selectedNodeTemplate ? (nodeDefaults[selectedNodeTemplate] ?? {}) : {};
    const node: CascadeNode = {
      ...tpl,
      id: `node-${nanoid(8)}`,
      label: tpl.label ?? selectedNodeTemplate ?? "New Node",
      node_type: tpl.node_type ?? "Service",
      functionality: n,
      position,
    };
    upsertNode(node);
    addNodeToCanvas(node.id, activeCanvas.id);
    useHistoryStore.getState().pushUpdateEntry({
      id: nanoid(),
      timestamp: new Date().toISOString(),
      update_type: "graph_update",
      label: "Add node",
      canvas_id: activeCanvas.id,
      before,
      after: toGraphSnapshot(),
    });
    selectNode(node.id);
    setInspectorOpen(true);
  }, [activeTool, activeCanvas, n, selectedNodeTemplate, nodeDefaults, screenToFlowPosition, upsertNode, addNodeToCanvas, toGraphSnapshot, selectNode, setInspectorOpen]);

  // ── Right-click on pane → context menu ──
  const onPaneContextMenu = useCallback((e: MouseEvent | React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  // ── Right-click on node → select it ──
  const onNodeContextMenu = useCallback((_: React.MouseEvent, rfNode: RFNode) => {
    selectNode(rfNode.id);
  }, [selectNode]);

  const panMode = activeTool === "pan";

  if (!activeCanvas) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-400">
        No canvas selected.
      </div>
    );
  }

  const canvasColor = activeCanvas.color;

  return (
    <div ref={containerRef} className="relative h-full w-full">
      {/* Map background — always behind React Flow when canvas is georeferenced.
          Keyed by canvas id so switching Canvas remounts with a fresh MapLibre
          instance (correct saved center/zoom/anchor and freshly-measured dims),
          rather than reusing the previous Canvas's stale map. */}
      {activeCanvas.georeferenced && (
        <GeoMapBackground key={activeCanvas.id} canvasId={activeCanvas.id} />
      )}

      {/* Canvas colour tint — subtle hue overlay, works in both light and dark mode */}
      {canvasColor && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: canvasColor,
            opacity: 0.05,
            pointerEvents: "none",
            zIndex: 0,
          }}
        />
      )}

      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        onConnect={onConnect}
        onSelectionChange={onSelectionChange}
        onNodeContextMenu={onNodeContextMenu}
        onPaneContextMenu={onPaneContextMenu}
        onDoubleClick={onPaneDoubleClick}
        panOnDrag={panMode ? true : [1]}
        panOnScroll={false}
        selectionOnDrag={false}
        zoomOnDoubleClick={false}
        connectionMode={ConnectionMode.Loose}
        connectOnClick={activeTool === "add-edge"}
        onlyRenderVisibleElements
        fitView
        minZoom={0.25}
        maxZoom={4}
        proOptions={{ hideAttribution: true }}
      >
        {!activeCanvas.georeferenced && (
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#d1d5db" />
        )}
        <NodeSearch />
        <ZoomSlider />
        {/* Freehand lasso — active in select tool, replaces rect-select */}
        <Lasso
          active={activeTool === "select"}
          partial
          onSelect={(nodeIds) => {
            // Always raise the guard — even on zero hits — so that RF's spurious
            // empty onSelectionChange and the subsequent onPaneClick don't wipe
            // an existing selection when the user draws a lasso over empty space.
            lassoActiveRef.current = true;
            selectAll(nodeIds, []);
            if (nodeIds.length > 0) setInspectorOpen(true);
          }}
        />
      </ReactFlow>

      {/* Legend overlay — bottom right, outside ReactFlow so it never pans/zooms */}
      <CanvasLegend />

      {/* Pane context menu */}
      {contextMenu && (
        <CanvasContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          nodeIds={activeCanvas?.graph.node_ids ?? []}
          edgeIds={activeCanvas?.graph.edge_ids ?? []}
          filename={activeCanvas?.label ?? "canvas"}
          onClose={() => setContextMenu(null)}
          containerRef={containerRef}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Re-export a wrapper that provides the ReactFlowProvider context
// ---------------------------------------------------------------------------

import { ReactFlowProvider } from "@xyflow/react";

export function FlowCanvasWithProvider() {
  return (
    <ReactFlowProvider>
      <FlowCanvas />
    </ReactFlowProvider>
  );
}
