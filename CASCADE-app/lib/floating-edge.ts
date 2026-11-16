/**
 * floating-edge.ts — the path of an edge between two node outlines.
 *
 * An edge stores no attachment point: it is drawn from the source's border to
 * the target's border, along the line between their centres. A pair of edges
 * in opposite directions (A→B and B→A) would then lie on top of each other, so
 * each one of such a pair bows out to its own right, and both ends aim at the
 * bow's control point. That keeps the ends on the outlines and apart, so the
 * arrowhead of one never lands on the tail of the other.
 */

import { borderPoint, type Outline, type Point } from "./node-outline";

/** How far the control point of a bowed edge sits from the straight line, in px. */
const BOW = 18;

export interface FloatingPath {
  /** SVG path data: a quadratic bezier from the source border to the target border. */
  path: string;
  /** The point halfway along the curve, where a label goes. */
  mid: Point;
  /** Length of the curve, in px: start → control → end, which a gentle bow barely exceeds. */
  length: number;
}

export function floatingPath(source: Outline, target: Outline, bowed: boolean): FloatingPath {
  const dx = target.cx - source.cx;
  const dy = target.cy - source.cy;
  const len = Math.hypot(dx, dy) || 1;
  // Right of the direction of travel (y-down), so the two edges of a pair split.
  const bow = bowed ? BOW : 0;
  const c = {
    x: (source.cx + target.cx) / 2 + (-dy / len) * bow,
    y: (source.cy + target.cy) / 2 + (dx / len) * bow,
  };
  const s = borderPoint(source, c);
  const t = borderPoint(target, c);
  // A quadratic bezier at its halfway point: ¼·start + ½·control + ¼·end.
  const mid = { x: (s.x + 2 * c.x + t.x) / 4, y: (s.y + 2 * c.y + t.y) / 4 };
  const length = bowed ? Math.hypot(c.x - s.x, c.y - s.y) + Math.hypot(t.x - c.x, t.y - c.y) : Math.hypot(t.x - s.x, t.y - s.y);
  return { path: `M ${s.x} ${s.y} Q ${c.x} ${c.y} ${t.x} ${t.y}`, mid, length };
}
