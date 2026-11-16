"use client";

/**
 * cascade-node.tsx — the CASCADE node renderer for React Flow.
 *
 * Custom SVG node shapes per Node Type:
 *   Source         → diamond
 *   Infrastructure → octagon
 *   Service        → circle
 *   Personnel      → square
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
import { useElementHeatmapColor } from "./snapshot-colors";
import { useUiStore } from "@/store/ui-store";
import type { Node as CascadeNode } from "@/lib/schemas/network";
import { brandColor } from "@/lib/brand";
import { nodeSize, SHAPE_INSET_X, OCTAGON_CUT } from "@/lib/node-outline";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How far the backup pulse sits outside the shape, on every side. Small: the
 *  ring reads as part of the node rather than as a halo around it. */
const PING_PAD = 3;

// The node name renders centered below the shape (see "Label below") with this
// max width, so it overflows the node's measured box by up to LABEL_MAX_WIDTH/2
// on each side and a little below. getNodesBounds only covers the node boxes, so
// image/SVG exports must expand the capture region by this much or long names
// get clipped — the single source of truth for that expansion is
// expandBoundsForLabels below, used by every canvas export path.
const LABEL_MAX_WIDTH = 200;

export function expandBoundsForLabels<T extends { x: number; y: number; width: number; height: number }>(
  b: T,
): { x: number; y: number; width: number; height: number } {
  const h = LABEL_MAX_WIDTH / 2 + 16; // centered label reaches ~half its width past the node, plus margin
  const v = 44;                        // label sits just below the shape; modest vertical pad
  return { x: b.x - h, y: b.y - v, width: b.width + 2 * h, height: b.height + 2 * v };
}

// ---------------------------------------------------------------------------
// Helpers — convert CASCADE nodes/edges → React Flow format
// ---------------------------------------------------------------------------

export function toRFNode(node: CascadeNode, selected: boolean): RFNode {
  // The views pass nodes rebuilt from the store, so React Flow's measurements
  // never land on them; the MiniMap draws only nodes that carry a size, and
  // initialWidth/Height give it one without touching the measured layout.
  const size = nodeSize(node.importance);
  return {
    id: node.id,
    type: (node.node_type?.toLowerCase() ?? "service") as string,
    position: node.position ?? { x: 0, y: 0 },
    data: node,
    selected,
    initialWidth: size,
    initialHeight: size,
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

function Diamond({ size, fill, stroke = brandColor("neutral", 200), strokeWidth = 2.5, strokeDasharray, strokeDashoffset }: ShapeProps) {
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

function Octagon({ size, fill, stroke = brandColor("neutral", 200), strokeWidth = 2.5, strokeDasharray, strokeDashoffset }: ShapeProps) {
  const o = size * OCTAGON_CUT;
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

function Circle({ size, fill, stroke = brandColor("neutral", 200), strokeWidth = 2.5, strokeDasharray, strokeDashoffset }: ShapeProps) {
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

function Square({ size, fill, stroke = brandColor("neutral", 200), strokeWidth = 2.5, strokeDasharray, strokeDashoffset }: ShapeProps) {
  return (
    <rect
      x={1} y={1}
      width={size - 2} height={size - 2}
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

type ShapeType = typeof Diamond | typeof Octagon | typeof Circle | typeof Square;

/** The shape's name, for the connection area's CSS class (its clip-path). */
function shapeName(Shape: ShapeType): "diamond" | "octagon" | "circle" | "square" {
  if (Shape === Diamond) return "diamond";
  if (Shape === Octagon) return "octagon";
  if (Shape === Circle) return "circle";
  return "square";
}

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
  // Only categories that resolve to an icon take a slot; the rest show nothing.
  const visible = categories
    .map(({ name, icon }) => ({ name, Icon: categoryToIcon(name, icon) }))
    .filter((c): c is { name: string; Icon: NonNullable<typeof c.Icon> } => c.Icon !== null)
    .slice(0, 3);
  if (visible.length === 0) return null;

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
      {visible.map(({ name, Icon }, i) => {
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
  const liveHeatmap = useAnalysisStore((s) => s.heatmapActive ? (s.heatmapColors[data.id] ?? null) : null);
  const heatmapOverride = useElementHeatmapColor(data.id, liveHeatmap);
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
  const canConnect = activeTool === "add-edge";

  // One connection area covering the whole shape. Edges float (lib/floating-edge.ts),
  // so where on the node an edge is drawn from or to carries no meaning: the
  // whole shape is the place to start or finish one. It only takes the pointer
  // with the Add Edge tool, so the rest of the time the node drags and selects
  // as usual. Type "source" + ConnectionMode.Loose lets it be an edge's target
  // too. Its look (hover and drop-target ring) is .cascade-connect in globals.css.
  const connectArea: React.CSSProperties = {
    left: SHAPE_INSET_X, top: 0, width: size, height: size,
    transform: "none",
    pointerEvents: canConnect ? "all" : "none",
    zIndex: 1,  // above the shape's SVG, or the pointer would land on the SVG instead
  };

  return (
    <div style={{ position: "relative", width: size + 16, height: size + 24 }}>
      <Handle
        type="source"
        position={Position.Top}
        className={`cascade-connect cascade-connect-${shapeName(Shape)}`}
        style={connectArea}
      />

      {/* Animated ping for backup state. The shape is drawn at x=8..8+size,
          y=0..size inside the SVG, so the ring is inset by PING_PAD on all four
          sides of *that* box — an equal margin on left and top is what centres
          it, and getting the vertical one wrong pushed the pulse below the
          node. */}
      {hasTimeWarning && (
        <div
          className="animate-ping absolute rounded-full opacity-60"
          style={{
            top: -PING_PAD, left: 8 - PING_PAD,
            width: size + 2 * PING_PAD, height: size + 2 * PING_PAD,
            border: `1.5px solid ${brandColor("warning", 400)}`,
            // Tailwind's ping beats once a second, which on a canvas full of
            // backed-up elements reads as flicker. Slow enough to be a pulse.
            animationDuration: "2.6s",
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
            stroke={brandColor("accent", 500)}
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
              stroke={hasTimeWarning ? brandColor("warning", 400) : "white"}
              strokeWidth={hasTimeWarning ? 3 : 2}
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
          fontSize: 13,
          color: brandColor("neutral", 600),
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          maxWidth: LABEL_MAX_WIDTH,
          lineHeight: "17px",
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

const PersonnelNode = memo(({ data, selected }: RFNodeProps) => <CascadeNodeBase data={data} Shape={Square} selected={selected} />);
PersonnelNode.displayName = "PersonnelNode";

export const nodeTypes: NodeTypes = {
  source: SourceNode as NodeTypes[string],
  infrastructure: InfrastructureNode as NodeTypes[string],
  service: ServiceNode as NodeTypes[string],
  personnel: PersonnelNode as NodeTypes[string],
};

