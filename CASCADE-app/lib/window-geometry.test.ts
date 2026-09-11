import { describe, it, expect } from "vitest";
import {
  clampToViewport,
  resizeGeometry,
  centredGeometry,
  KEEP_VISIBLE,
  type Geometry,
} from "./window-geometry";

const HEADER = 40;
const MIN = { w: 400, h: 300 };

describe("clampToViewport", () => {
  const g: Geometry = { x: 100, y: 100, w: 800, h: 600 };

  it("leaves a window that already fits alone", () => {
    expect(clampToViewport(g, 1400, 900, HEADER)).toEqual(g);
  });

  it("never lets the title bar go above the top edge", () => {
    expect(clampToViewport({ ...g, y: -250 }, 1400, 900, HEADER).y).toBe(0);
  });

  it("keeps a grabbable strip on screen when dragged off the right", () => {
    const out = clampToViewport({ ...g, x: 5000 }, 1400, 900, HEADER);
    expect(out.x).toBe(1400 - KEEP_VISIBLE);
  });

  it("keeps a grabbable strip on screen when dragged off the left", () => {
    const out = clampToViewport({ ...g, x: -5000 }, 1400, 900, HEADER);
    expect(out.x).toBe(KEEP_VISIBLE - g.w);
    // The right edge of the window is still KEEP_VISIBLE px into the viewport.
    expect(out.x + out.w).toBe(KEEP_VISIBLE);
  });

  it("keeps the title bar reachable when dragged off the bottom", () => {
    expect(clampToViewport({ ...g, y: 5000 }, 1400, 900, HEADER).y).toBe(900 - HEADER);
  });

  it("shrinks a window larger than the viewport", () => {
    const out = clampToViewport({ x: 0, y: 0, w: 3000, h: 2000 }, 1400, 900, HEADER);
    expect(out.w).toBe(1400);
    expect(out.h).toBe(900);
  });

  it("survives a viewport smaller than the grabbable strip", () => {
    const out = clampToViewport(g, 60, 30, HEADER);
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
  });
});

describe("resizeGeometry", () => {
  const start: Geometry = { x: 100, y: 100, w: 800, h: 600 };

  it("grows from the south-east corner without moving the origin", () => {
    expect(resizeGeometry(start, "se", 50, 40, MIN)).toEqual({ x: 100, y: 100, w: 850, h: 640 });
  });

  it("moves the origin when the west edge is dragged", () => {
    // Pulling the left edge 50px left widens by 50 and shifts x back by 50.
    expect(resizeGeometry(start, "w", -50, 0, MIN)).toEqual({ x: 50, y: 100, w: 850, h: 600 });
  });

  it("moves the origin when the north edge is dragged", () => {
    expect(resizeGeometry(start, "n", 0, -50, MIN)).toEqual({ x: 100, y: 50, w: 800, h: 650 });
  });

  it("only touches the axis its edge belongs to", () => {
    const out = resizeGeometry(start, "e", 30, 999, MIN);
    expect(out.h).toBe(start.h);
    expect(out.y).toBe(start.y);
  });

  it("pins a north-west drag at the minimum size instead of inverting", () => {
    const out = resizeGeometry(start, "nw", 5000, 5000, MIN);
    expect(out.w).toBe(MIN.w);
    expect(out.h).toBe(MIN.h);
    // The south-east corner stays put — that is what "pinned" means here.
    expect(out.x + out.w).toBe(start.x + start.w);
    expect(out.y + out.h).toBe(start.y + start.h);
  });

  it("pins a south-east drag at the minimum size", () => {
    const out = resizeGeometry(start, "se", -5000, -5000, MIN);
    expect(out).toEqual({ x: 100, y: 100, w: MIN.w, h: MIN.h });
  });
});

describe("centredGeometry", () => {
  it("centres a window that fits", () => {
    expect(centredGeometry({ w: 800, h: 600 }, 1400, 900)).toEqual({ x: 300, y: 150, w: 800, h: 600 });
  });

  it("caps at the viewport minus the margin", () => {
    const out = centredGeometry({ w: 3000, h: 2000 }, 1000, 700, 40);
    expect(out).toEqual({ x: 20, y: 20, w: 960, h: 660 });
  });
});
