"use client";

/**
 * cascade-node.tsx — the CASCADE node renderer for React Flow.
 *
 * Custom SVG node shapes per Node Type:
 *   Source         → diamond
 *   Infrastructure → octagon
 *   Service        → circle
 *   Personnel      → rounded-square
 *
 * Node size ∝ importance; fill = Functionality level colour from config.
 * functionality_time > 0 → pulsing amber ring; direct_damage → crack overlay.
 * Exports `nodeTypes` (the React Flow registry) and `toRFNode` (the
 * CASCADE-node → RF-node adapter) shared by every canvas variant
 * (flow, merged view, global view, scorecard snapshots).
 */

import { Handle, Position, type NodeTypes, type Node as RFNode } from "@xyflow/react";
import { memo, useEffect, useReducer } from "react";
import { categoryToIcon, subscribeIconsReady } from "@/lib/category-icons";
import { useConfigStore, selectLevelColor } from "@/store/config-store";
import { useAnalysisStore } from "@/store/analysis-store";
import { useUiStore } from "@/store/ui-store";
import type { Node as CascadeNode } from "@/lib/schemas/network";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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


      {/* Animated ping for backup state */}
      {hasTimeWarning && (
        <div
          className="animate-ping absolute rounded-full opacity-60"
          style={{
            top: 0, left: 4,
            width: size + 8, height: size + 8,
            border: "2px solid #facc15",
            borderRadius: "50%",
            pointerEvents: "none",
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

        {/* Border — amber + thick when backup active (time_warning), white otherwise */}
        <g mask={crack ? `url(#${maskId})` : undefined}>
          <g transform="translate(8,0)">
            <Shape
              size={size}
              fill="transparent"
              stroke={hasTimeWarning ? "#fbbf24" : "white"}
              strokeWidth={hasTimeWarning ? 5 : 2}
            />
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

