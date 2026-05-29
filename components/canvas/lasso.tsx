"use client";

/**
 * Lasso — freehand polygon selection for the React Flow canvas.
 *
 * Must be rendered as a direct child of <ReactFlow> (needs the ReactFlowProvider
 * context for useReactFlow). Active only when the "select" tool is chosen.
 *
 * How it works:
 *  1. Attaches a mousedown listener to the `.react-flow__pane` element (the canvas
 *     background). Clicks on nodes/edges target different elements, so the pane
 *     listener fires only when the user starts drawing on empty space.
 *  2. Tracks the freehand path in screen coordinates while the button is held.
 *  3. On mouseup, converts the screen polygon to flow coordinates via
 *     screenToFlowPosition, then tests each node's bounding box against it with a
 *     ray-casting point-in-polygon check.
 *  4. Calls setNodes to mark the matched nodes as selected inside React Flow's
 *     internal state. The parent's onSelectionChange handler will sync the result
 *     into the network-store automatically.
 *
 * Conflict avoidance:
 *  - selectionOnDrag should be false on the <ReactFlow> component so the built-in
 *    rectangle-select doesn't compete.
 *  - panOnDrag={[1, 2]} (middle/right-click only) ensures left-drag is free.
 *  - Browsers suppress the click event after a drag, so onPaneClick (clear
 *    selection) will NOT fire after a lasso gesture — only after a real click.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useReactFlow } from "@xyflow/react";

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

interface Pt { x: number; y: number }

/** Ray-casting point-in-polygon test. */
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

/**
 * Returns true when the axis-aligned rectangle [rx,ry,rw,rh] (in flow coords)
 * overlaps the polygon. Partial mode: any corner inside. Full mode: all corners.
 */
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
// Lasso component
// ---------------------------------------------------------------------------

export interface LassoProps {
  /** Only active in "select" tool mode. */
  active: boolean;
  /**
   * Partial mode (default): a node is selected if any of its four corners is
   * inside the polygon — good for quick lasso.
   * Full mode: every corner must be inside.
   */
  partial?: boolean;
}

export function Lasso({ active, partial = true }: LassoProps) {
  const { screenToFlowPosition, getNodes, setNodes } = useReactFlow();

  // Screen-coordinate path used for drawing the SVG polygon.
  const [screenPath, setScreenPath] = useState<Pt[]>([]);
  const [drawing, setDrawing] = useState(false);

  // Ref-based path avoids stale closures in the native event handlers.
  const pathRef = useRef<Pt[]>([]);
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) {
      setDrawing(false);
      setScreenPath([]);
      return;
    }

    // Find the ReactFlow pane element relative to our anchor node.
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rfRoot = anchor.closest(".react-flow");
    const pane = rfRoot?.querySelector(".react-flow__pane") as HTMLElement | null;
    if (!pane) return;

    let dragging = false;

    function onMouseDown(e: MouseEvent) {
      if (e.button !== 0) return;
      dragging = true;
      pathRef.current = [{ x: e.clientX, y: e.clientY }];
      setScreenPath([{ x: e.clientX, y: e.clientY }]);
      setDrawing(true);
    }

    function onMouseMove(e: MouseEvent) {
      if (!dragging) return;
      pathRef.current = [...pathRef.current, { x: e.clientX, y: e.clientY }];
      // Throttle React state updates for performance (every 3 points).
      if (pathRef.current.length % 3 === 0) {
        setScreenPath([...pathRef.current]);
      }
    }

    function onMouseUp() {
      if (!dragging) return;
      dragging = false;
      setDrawing(false);
      setScreenPath([]);

      const screenPts = pathRef.current;
      pathRef.current = [];

      // Minimum gesture size: ignore tiny accidental drags.
      if (screenPts.length < 4) return;

      // Convert screen polygon → flow coordinate space.
      const flowPoly = screenPts.map((p) => screenToFlowPosition({ x: p.x, y: p.y }));

      // Test each node's axis-aligned bounding box.
      const rfNodes = getNodes();
      const hitIds = new Set<string>();

      for (const node of rfNodes) {
        const nx = node.position.x;
        const ny = node.position.y;
        // Use measured dimensions when available (set by React Flow after first render).
        const nw = (node.measured as { width?: number } | undefined)?.width ?? 80;
        const nh = (node.measured as { height?: number } | undefined)?.height ?? 80;

        if (rectIntersectsPoly(nx, ny, nw, nh, flowPoly, partial)) {
          hitIds.add(node.id);
        }
      }

      // Update React Flow's internal selection; parent's onSelectionChange syncs
      // the result into the network-store.
      setNodes((nodes) =>
        nodes.map((n) => ({ ...n, selected: hitIds.has(n.id) })),
      );
    }

    pane.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      pane.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [active, partial, screenToFlowPosition, getNodes, setNodes]);

  return (
    <>
      {/* Invisible anchor node rendered inside ReactFlow — used to find the
          .react-flow root so we can locate the pane element. */}
      <div ref={anchorRef} style={{ display: "none" }} />

      {/* Lasso polygon overlay.
          IMPORTANT: React Flow's .react-flow__viewport carries a CSS transform
          for pan/zoom. Any descendant with `position:fixed` is positioned
          relative to that transformed ancestor, NOT the real viewport — it
          becomes invisible or offset. We escape the transform context by
          portalling the SVG directly into document.body. */}
      {drawing && screenPath.length > 1 &&
        createPortal(
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
        )}
    </>
  );
}
