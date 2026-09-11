/**
 * window-geometry — the pure maths behind a draggable, resizable panel.
 *
 * Kept out of the React component deliberately: dragging and resizing is
 * arithmetic on four numbers, and arithmetic is worth testing directly. The
 * component keeps the pointer plumbing; this file decides where the window
 * lands. Nothing here touches the DOM — the viewport is passed in.
 */

export interface Geometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Size {
  w: number;
  h: number;
}

/** A resize grab zone. A letter present means that edge moves. */
export type ResizeDir = "n" | "s" | "w" | "e" | "nw" | "ne" | "sw" | "se";

/** How much of the window must stay on screen to remain grabbable. */
export const KEEP_VISIBLE = 120;

/**
 * Pull a window back inside the viewport. The window may hang off the right or
 * the bottom, but never so far that less than KEEP_VISIBLE px of its title bar
 * is reachable, and never above the top edge (where the title bar would be
 * unreachable entirely).
 */
export function clampToViewport(g: Geometry, vw: number, vh: number, headerH: number): Geometry {
  const w = Math.min(g.w, vw);
  const h = Math.min(g.h, vh);
  return {
    w,
    h,
    x: Math.min(Math.max(g.x, KEEP_VISIBLE - w), Math.max(0, vw - KEEP_VISIBLE)),
    y: Math.min(Math.max(g.y, 0), Math.max(0, vh - headerH)),
  };
}

/**
 * Apply a pointer delta to one grab zone. Dragging a north or west edge moves
 * the origin as well as the size, and the minimum size pins the edge rather
 * than letting the window invert.
 */
export function resizeGeometry(start: Geometry, dir: ResizeDir, dx: number, dy: number, min: Size): Geometry {
  let { x, y, w, h } = start;
  if (dir.includes("e")) w = Math.max(min.w, start.w + dx);
  if (dir.includes("s")) h = Math.max(min.h, start.h + dy);
  if (dir.includes("w")) {
    w = Math.max(min.w, start.w - dx);
    x = start.x + (start.w - w);
  }
  if (dir.includes("n")) {
    h = Math.max(min.h, start.h - dy);
    y = start.y + (start.h - h);
  }
  return { x, y, w, h };
}

/** Centre a window of the given size, never larger than the viewport allows. */
export function centredGeometry(size: Size, vw: number, vh: number, margin = 32): Geometry {
  const w = Math.min(size.w, vw - margin);
  const h = Math.min(size.h, vh - margin);
  return { w, h, x: Math.round((vw - w) / 2), y: Math.round((vh - h) / 2) };
}
