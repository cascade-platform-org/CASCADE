"use client";

/**
 * Lasso — freehand polygon selection for the React Flow canvas.
 *
 * Rendered as a child of <ReactFlow>. Active only in "select" tool mode.
 *
 * Design:
 *  - Listens on `window` for mousedown/mousemove/mouseup.
 *  - `isCanvasBackground()` filters: only start a lasso when the click lands on
 *    empty canvas space (not on a node, edge, handle, or panel).
 *  - On mouseup the screen polygon is converted to flow coordinates via
 *    `screenToFlowPosition`, each node's bounding box is tested with a
 *    ray-casting point-in-polygon check, and `onSelect(hitIds)` is called.
 *  - The parent (FlowCanvas) owns both the `network-store` update and the
 *    React Flow `setNodes` sync — the Lasso is pure detection only.
 *
 * Rendering:
 *  - The freehand polygon is portalled into `document.body` so it is NOT
 *    subject to React Flow's viewport `transform`, which would otherwise make
 *    `position:fixed` children invisible or misplaced.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useReactFlow } from "@xyflow/react";

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

interface Pt { x: number; y: number }

function raycast(pt: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    if ((yi > pt.y) !== (yj > pt.y) &&
        pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function rectIntersectsPoly(rx: number, ry: number, rw: number, rh: number, poly: Pt[], partial: boolean): boolean {
  const corners: Pt[] = [
    { x: rx,      y: ry },
    { x: rx + rw, y: ry },
    { x: rx + rw, y: ry + rh },
    { x: rx,      y: ry + rh },
  ];
  const hits = corners.map((c) => raycast(c, poly));
  return partial ? hits.some(Boolean) : hits.every(Boolean);
}

// ---------------------------------------------------------------------------
// Helper: decide whether a click started on empty canvas space
// ---------------------------------------------------------------------------

function isCanvasBackground(target: Element): boolean {
  // Must be inside a ReactFlow instance
  if (!target.closest(".react-flow")) return false;
  // Must NOT land on a node, edge, handle, panel, or any overlay component
  return !(
    target.closest(".react-flow__node") ||
    target.closest(".react-flow__edge") ||
    target.closest(".react-flow__handle") ||
    target.closest(".react-flow__panel") ||
    target.closest(".react-flow__controls") ||
    target.closest(".react-flow__minimap")
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface LassoProps {
  active: boolean;
  partial?: boolean;
  /** Called with the ids of nodes whose bounding boxes overlap the polygon. */
  onSelect: (nodeIds: string[]) => void;
}

export function Lasso({ active, partial = true, onSelect }: LassoProps) {
  const { screenToFlowPosition, getNodes } = useReactFlow();

  const [screenPath, setScreenPath] = useState<Pt[]>([]);
  const [drawing, setDrawing] = useState(false);
  const pathRef = useRef<Pt[]>([]);
  // Keep stable ref to onSelect so the effect doesn't re-run when the
  // callback identity changes between renders.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!active) {
      setDrawing(false);
      setScreenPath([]);
      return;
    }

    let dragging = false;

    function onMouseDown(e: MouseEvent) {
      if (e.button !== 0) return;
      if (!isCanvasBackground(e.target as Element)) return;
      dragging = true;
      const pt = { x: e.clientX, y: e.clientY };
      pathRef.current = [pt];
      setDrawing(true);
      setScreenPath([pt]);
    }

    function onMouseMove(e: MouseEvent) {
      if (!dragging) return;
      pathRef.current = [...pathRef.current, { x: e.clientX, y: e.clientY }];
      // Throttle React state updates (every 2 points is enough for smooth drawing).
      if (pathRef.current.length % 2 === 0) {
        setScreenPath([...pathRef.current]);
      }
    }

    function onMouseUp(e: MouseEvent) {
      if (!dragging) return;
      dragging = false;
      setDrawing(false);
      setScreenPath([]);

      const screenPts = pathRef.current;
      pathRef.current = [];

      // Need at least a triangle to be meaningful.
      if (screenPts.length < 3) return;

      // Convert screen polygon → flow coordinate space.
      const flowPoly = screenPts.map((p) =>
        screenToFlowPosition({ x: p.x, y: p.y }),
      );

      // Test each node's axis-aligned bounding box against the polygon.
      const rfNodes = getNodes();
      const hitIds: string[] = [];

      for (const node of rfNodes) {
        const nx = node.position.x;
        const ny = node.position.y;
        // React Flow populates `measured` after first render via ResizeObserver.
        const nw = (node.measured as { width?: number } | undefined)?.width  ?? 72;
        const nh = (node.measured as { height?: number } | undefined)?.height ?? 72;

        if (rectIntersectsPoly(nx, ny, nw, nh, flowPoly, partial)) {
          hitIds.push(node.id);
        }
      }

      onSelectRef.current(hitIds);
    }

    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup",   onMouseUp);

    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup",   onMouseUp);
    };
  }, [active, partial, screenToFlowPosition, getNodes]);
  // Note: `onSelect` is excluded from deps deliberately — we use `onSelectRef` instead
  // to avoid re-attaching all listeners whenever the parent re-renders.

  // Portal the SVG into document.body to escape React Flow's viewport transform.
  return drawing && screenPath.length >= 3
    ? createPortal(
        <svg
          style={{
            position: "fixed",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            zIndex: 9999,
          }}
        >
          <polygon
            points={screenPath.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="rgba(59, 130, 246, 0.08)"
            stroke="#3b82f6"
            strokeWidth={1.5}
            strokeDasharray="5 3"
            strokeLinejoin="round"
          />
        </svg>,
        document.body,
      )
    : null;
}
