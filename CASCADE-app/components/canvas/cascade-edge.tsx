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

import { useEffect, useRef } from "react";
import { BaseEdge, type ConnectionLineComponentProps, type EdgeTypes, type Edge as RFEdge } from "@xyflow/react";
import { useConfigStore, selectN, selectLevelColor } from "@/store/config-store";
import { useAnalysisStore } from "@/store/analysis-store";
import { useElementHeatmapColor } from "./snapshot-colors";
import type { Edge as CascadeEdge } from "@/lib/schemas/network";
import { brandColor } from "@/lib/brand";
import { borderPoint } from "@/lib/node-outline";
import { outlineOf, useFloatingPath } from "@/hooks/useFloatingPath";
import { usePlayback, isDimmed, DIMMED_OPACITY } from "./playback-paint";

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
  // The Propagation animation's frame, when one is playing (ADR-0027).
  const playback = usePlayback();
  // The pulse wears the level arriving: the target's colour in this frame.
  const arrivingColor = useElementHeatmapColor(target, null);
  if (!floating) return null;

  const flowCategory = playback?.frame.flowEdges[id];
  const pulsing = playback?.frame.pulse.includes(id) ?? false;

  return (
    <>
      <BaseEdge
        id={id}
        path={floating.path}
        style={{
          stroke: selected ? brandColor("accent", 500) : levelColor,
          strokeWidth: selected ? 2.5 : 1.5,
          strokeDasharray: data?.isInterCanvas ? "5,4" : undefined,
          // Not a target of this playback screen: fade (the balls and pulses on top do not).
          opacity: isDimmed(playback, id) ? DIMMED_OPACITY : 1,
          transition: "opacity 0.3s",
        }}
        markerEnd={markerEnd}
      />
      {/* Flow: balls travelling towards the demand, sized by what the edge carries. */}
      {flowCategory && playback && (
        <FlowBalls
          path={floating.path}
          length={floating.length}
          color={playback.categoryColor[flowCategory]}
          share={(playback.flowAmount[id] ?? 0) / (playback.maxFlow[flowCategory] || 1)}
          // The front reaches this edge when it reaches its source.
          startAfter={(playback.frame.arrival[source] ?? 0) * playback.hopSeconds}
          crossSeconds={playback.hopSeconds}
          restartKey={playback.frameIndex}
        />
      )}
      {/* A change arriving along this edge. Keyed by frame so the pulse restarts each time. */}
      {pulsing && (
        <path
          key={playback?.frame.applied}
          d={floating.path}
          className="cascade-pulse"
          pathLength={100}
          style={{ animationDuration: `${playback?.pulseSeconds ?? 1.4}s` }}
          fill="none"
          stroke={arrivingColor ?? levelColor}
          strokeWidth={3.5}
          strokeLinecap="round"
        />
      )}
    </>
  );
}

/** Ball radius for the smallest amount, and for the largest its Category carries. */
const BALL_MIN_R = 2.5;
const BALL_MAX_R = 7;
/** Space between balls along an edge, in px: a longer edge carries more of them. */
const BALL_SPACING = 46;

/**
 * The flow on one edge (ADR-0027): balls in the Category's colour travelling
 * from source to target, each crossing the edge in one hop-time
 * (`crossSeconds`) — the pace of the flow front, so a ball reaches the target
 * just as the front does, and a short consumer changes as it lands. A longer
 * edge carries more balls. A ball's AREA is proportional to the amount (radius
 * ∝ √share), which is how the eye compares discs.
 *
 * The first ball leaves `startAfter` seconds into the screen — when the flow
 * front reaches this edge's source — and the others follow, evenly spaced.
 * SVG's own `animateMotion` moves them; its clock counts from page load, so
 * they are started by `beginElementAt`, which counts from now, each time the
 * screen changes (`restartKey`). A ball is hidden until it leaves. With
 * reduced motion the balls stand still, evenly spaced.
 */
function FlowBalls({ path, length, color, share, startAfter, crossSeconds, restartKey }: {
  path: string; length: number; color: string; share: number; startAfter: number; crossSeconds: number; restartKey: number;
}) {
  const ref = useRef<SVGGElement>(null);
  const r = BALL_MIN_R + (BALL_MAX_R - BALL_MIN_R) * Math.sqrt(Math.max(0, Math.min(1, share)));
  const count = Math.max(1, Math.round(length / BALL_SPACING));
  const dur = crossSeconds;
  const still = prefersReducedMotion();

  useEffect(() => {
    if (still) return;
    ref.current?.querySelectorAll<SVGAnimationElement>("[data-after]").forEach((anim) => {
      try {
        anim.endElement();
        anim.beginElementAt(Number(anim.dataset.after));
      } catch {
        /* an animation the browser has not started yet: begin is enough */
        anim.beginElementAt(Number(anim.dataset.after));
      }
    });
  }, [restartKey, startAfter, dur, still]);

  return (
    <g ref={ref} pointerEvents="none">
      {Array.from({ length: count }, (_, i) => {
        const after = startAfter + (dur * i) / count;
        return still ? (
          <circle key={i} r={r} fill={color} stroke="white" strokeWidth={1}>
            <animateMotion path={path} dur="1s" keyPoints={`${(i + 0.5) / count};${(i + 0.5) / count}`} keyTimes="0;1" calcMode="linear" fill="freeze" />
          </circle>
        ) : (
          <circle key={i} r={r} fill={color} stroke="white" strokeWidth={1} visibility="hidden">
            <set attributeName="visibility" to="visible" begin="indefinite" fill="freeze" data-after={after} />
            <animateMotion path={path} dur={`${dur}s`} begin="indefinite" repeatCount="indefinite" data-after={after} />
          </circle>
        );
      })}
    </g>
  );
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
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

