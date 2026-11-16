/**
 * node-outline.ts — where a node's drawn shape is, and where a line from its
 * centre crosses its border.
 *
 * Edges are "floating": they carry no attachment point. Each time an edge is
 * drawn, it aims from one node's centre at the other's and is cut where it
 * meets each outline (lib/floating-edge.ts). This file holds the shape side of
 * that: the node's size and shape, and the border point in a given direction.
 *
 * Coordinates are React Flow flow coordinates, y pointing down.
 */

export interface Point { x: number; y: number }

/** The drawn outline of a node: its shape and its full width/height around a centre. */
export interface Outline {
  shape: "circle" | "square" | "diamond" | "octagon" | "rect";
  cx: number;
  cy: number;
  w: number;
  h: number;
}

const MIN_SIZE = 24;
const MAX_SIZE = 56;

/** Side of a node's shape in px: proportional to importance (default 0.5). */
export function nodeSize(importance: number | undefined): number {
  const imp = importance ?? 0.5;
  return Math.round(MIN_SIZE + (MAX_SIZE - MIN_SIZE) * Math.min(1, Math.max(0, imp)));
}

/** The shape sits this far right of the node box's left edge (cascade-node.tsx draws it at x = 8). */
export const SHAPE_INSET_X = 8;

/** The octagon's corners are cut this fraction of its side in from each corner. */
export const OCTAGON_CUT = 0.2;

const SHAPE_BY_NODE_TYPE: Record<string, Outline["shape"]> = {
  source: "diamond",
  infrastructure: "octagon",
  service: "circle",
  personnel: "square",
};

/** What `nodeOutline` reads off a React Flow internal node. */
export interface OutlineInput {
  type?: string;
  /** Absolute top-left of the node box. */
  position: Point;
  data?: unknown;
  measured?: { width?: number; height?: number };
}

/**
 * The outline of a node as drawn. A CASCADE node (the four Node Types) is its
 * shape at the size its importance gives; any other node (the All view's
 * collapsed Canvas cluster) is its measured box.
 */
export function nodeOutline(node: OutlineInput): Outline {
  const shape = node.type ? SHAPE_BY_NODE_TYPE[node.type] : undefined;
  if (shape) {
    const importance = (node.data as { importance?: number } | undefined)?.importance;
    const size = nodeSize(importance);
    return {
      shape,
      cx: node.position.x + SHAPE_INSET_X + size / 2,
      cy: node.position.y + size / 2,
      w: size,
      h: size,
    };
  }
  const w = node.measured?.width ?? 0;
  const h = node.measured?.height ?? 0;
  return { shape: "rect", cx: node.position.x + w / 2, cy: node.position.y + h / 2, w, h };
}

/**
 * The point where the ray from the outline's centre towards `toward` crosses
 * its border. When `toward` is the centre itself there is no direction, so the
 * centre is returned.
 *
 * Each shape is written as "how far along the ray until the border": for a
 * unit step (dx, dy) the border is reached after t steps, with
 *   circle   t = r / |d|
 *   square   t = h / max(|dx|, |dy|)          (|x| ≤ h and |y| ≤ h)
 *   diamond  t = h / (|dx| + |dy|)            (|x| + |y| ≤ h)
 *   octagon  the smaller of square and the cut-corner line |x| + |y| ≤ (1 − cut)·side
 *   rect     t = min(w/2 / |dx|, h/2 / |dy|)
 */
export function borderPoint(o: Outline, toward: Point): Point {
  const dx = toward.x - o.cx;
  const dy = toward.y - o.cy;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax === 0 && ay === 0) return { x: o.cx, y: o.cy };

  const half = o.w / 2;
  let t: number;
  switch (o.shape) {
    case "circle":
      t = half / Math.hypot(dx, dy);
      break;
    case "square":
      t = half / Math.max(ax, ay);
      break;
    case "diamond":
      t = half / (ax + ay);
      break;
    case "octagon":
      t = Math.min(half / Math.max(ax, ay), ((1 - OCTAGON_CUT) * o.w) / (ax + ay));
      break;
    case "rect":
      t = Math.min(ax > 0 ? half / ax : Infinity, ay > 0 ? o.h / 2 / ay : Infinity);
      break;
  }
  return { x: o.cx + dx * t, y: o.cy + dy * t };
}
