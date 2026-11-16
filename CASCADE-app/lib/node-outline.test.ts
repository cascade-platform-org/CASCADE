import { describe, it, expect } from "vitest";
import { borderPoint, nodeOutline, nodeSize, SHAPE_INSET_X, type Outline } from "./node-outline";
import { floatingPath } from "./floating-edge";

const at = (shape: Outline["shape"], w = 40, h = w): Outline => ({ shape, cx: 0, cy: 0, w, h });

describe("nodeOutline", () => {
  it("places a CASCADE node's shape at its inset, sized by importance", () => {
    const o = nodeOutline({ type: "service", position: { x: 100, y: 50 }, data: { importance: 1 } });
    expect(o).toEqual({ shape: "circle", cx: 100 + SHAPE_INSET_X + 28, cy: 50 + 28, w: 56, h: 56 });
    expect(nodeSize(undefined)).toBe(40);
  });

  it("maps each Node Type to its drawn shape", () => {
    const shape = (type: string) => nodeOutline({ type, position: { x: 0, y: 0 } }).shape;
    expect(["source", "infrastructure", "service", "personnel"].map(shape))
      .toEqual(["diamond", "octagon", "circle", "square"]);
  });

  it("falls back to the measured box for any other node", () => {
    const o = nodeOutline({ type: "canvasCluster", position: { x: 10, y: 20 }, measured: { width: 100, height: 40 } });
    expect(o).toEqual({ shape: "rect", cx: 60, cy: 40, w: 100, h: 40 });
  });
});

describe("borderPoint", () => {
  it("lands on the circle at its radius in any direction", () => {
    const p = borderPoint(at("circle"), { x: 30, y: 40 });
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(20);
  });

  it("lands on the square's side, and on its corner along the diagonal", () => {
    expect(borderPoint(at("square"), { x: 100, y: 10 })).toEqual({ x: 20, y: 2 });
    expect(borderPoint(at("square"), { x: -5, y: -5 })).toEqual({ x: -20, y: -20 });
  });

  it("lands on the diamond's tip straight across and on its edge diagonally", () => {
    expect(borderPoint(at("diamond"), { x: 0, y: 100 })).toEqual({ x: 0, y: 20 });
    expect(borderPoint(at("diamond"), { x: 1, y: 1 })).toEqual({ x: 10, y: 10 });
  });

  it("lands on the octagon's flat side straight across and on its cut corner diagonally", () => {
    expect(borderPoint(at("octagon"), { x: 100, y: 0 })).toEqual({ x: 20, y: 0 });
    // Cut-corner line |x| + |y| = 0.8 · 40 = 32 → (16, 16) on the diagonal.
    const p = borderPoint(at("octagon"), { x: 1, y: 1 });
    expect(p.x).toBeCloseTo(16);
    expect(p.y).toBeCloseTo(16);
  });

  it("lands on a wide rect's long side or short side", () => {
    expect(borderPoint(at("rect", 100, 40), { x: 0, y: -50 })).toEqual({ x: 0, y: -20 });
    expect(borderPoint(at("rect", 100, 40), { x: 200, y: 0 })).toEqual({ x: 50, y: 0 });
  });

  it("returns the centre when there is no direction", () => {
    expect(borderPoint(at("circle"), { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });
});

describe("floatingPath", () => {
  const a: Outline = { shape: "circle", cx: 0, cy: 0, w: 40, h: 40 };
  const b: Outline = { shape: "circle", cx: 200, cy: 0, w: 40, h: 40 };

  it("runs straight from border to border when unbowed", () => {
    expect(floatingPath(a, b, false).path).toBe("M 20 0 Q 100 0 180 0");
  });

  it("bows the two edges of an opposite pair to opposite sides, with distinct ends", () => {
    const ab = floatingPath(a, b, true);
    const ba = floatingPath(b, a, true);
    expect(ab.mid.y).toBeGreaterThan(0);  // A→B travels right; its right is down (y-down)
    expect(ba.mid.y).toBeLessThan(0);
    expect(ab.path).not.toBe(ba.path);
  });
});
