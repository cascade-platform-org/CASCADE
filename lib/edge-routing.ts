/**
 * edge-routing.ts — position-based handle picker for CASCADE edges.
 *
 * Each node exposes 6 connection handles laid out like the vertices of a
 * flattened hexagon:
 *
 *       tl   tr
 *     ml       mr
 *       bl   br
 *
 * The surrounding plane is divided into 6 equal 60° sectors, one per handle.
 * Given two node positions, we compute the angle from source-center to
 * target-center (y-down screen coordinates), map it to the nearest sector,
 * and return the corresponding handle ID for both endpoints.
 *
 *   angle  →  source handle (departure side)
 *  [-30, 30)  → mr   (right)
 *  [ 30, 90)  → br   (bottom-right)
 *  [ 90,150)  → bl   (bottom-left)
 *  [150,180] ∪ [-180,-150) → ml (left)
 *  [-150,-90) → tl   (top-left)
 *  [ -90,-30) → tr   (top-right)
 *
 * The target handle uses the same map on the reversed angle (angle + 180°),
 * i.e. "the side facing the source".
 */

export type HandleId = "tl" | "tr" | "ml" | "mr" | "bl" | "br";

export interface NodeBounds {
  position: { x: number; y: number };
  measured?: { width?: number; height?: number };
}

/** Center of a node in flow coordinates. */
function center(node: NodeBounds): { x: number; y: number } {
  const w = node.measured?.width  ?? 72;
  const h = node.measured?.height ?? 72;
  return { x: node.position.x + w / 2, y: node.position.y + h / 2 };
}

/** Map an angle (degrees, y-down) to the nearest handle ID. */
function angleToHandle(deg: number): HandleId {
  // Normalize to (-180, 180]
  const a = ((deg + 180) % 360 + 360) % 360 - 180;
  if (a >= -30  && a <  30)  return "mr";
  if (a >=  30  && a <  90)  return "br";
  if (a >=  90  && a < 150)  return "bl";
  if (a >=  150 || a < -150) return "ml";
  if (a >= -150 && a <  -90) return "tl";
  return "tr"; // [-90, -30)
}

/**
 * Return the optimal (sourceHandle, targetHandle) pair for an edge between
 * two nodes, based purely on their positions.
 *
 * Use this when the user has not explicitly dragged from a specific handle dot
 * (i.e. when RF provides null handles), and always for programmatically
 * created edges (inter-canvas dialog, paste, etc.).
 */
export function pickHandles(
  source: NodeBounds,
  target: NodeBounds,
): { sourceHandle: HandleId; targetHandle: HandleId } {
  const sc = center(source);
  const tc = center(target);
  const dx = tc.x - sc.x;
  const dy = tc.y - sc.y;

  // Degenerate case: nodes are exactly on top of each other
  if (dx === 0 && dy === 0) return { sourceHandle: "mr", targetHandle: "ml" };

  const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);
  return {
    sourceHandle: angleToHandle(angleDeg),
    targetHandle: angleToHandle(angleDeg + 180),
  };
}
