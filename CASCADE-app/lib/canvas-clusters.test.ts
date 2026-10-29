import { describe, expect, it } from "vitest";
import type { Canvas, Edge, Node } from "@/lib/schemas/network";
import { clusterNodeId, clusterSummary, drawnEdges, homeCanvases } from "./canvas-clusters";

const node = (id: string, functionality = 4): Node => ({ id, label: id, functionality } as Node);
const edge = (id: string, source: string, target: string, functionality = 4): Edge =>
  ({ id, source, target, functionality } as Edge);
const canvas = (id: string, node_ids: string[], edge_ids: string[]): Canvas =>
  ({ id, label: id, graph: { graph_type: "generic", node_ids, edge_ids } } as Canvas);

// A: a1 -> a2.  B: b1 -> b2.  Crossing: a2 -> b1, a2 -> b2 (listed on both canvases).
const nodes = Object.fromEntries(["a1", "a2", "b1", "b2"].map((id) => [id, node(id)]));
const edges = {
  ea: edge("ea", "a1", "a2"),
  eb: edge("eb", "b1", "b2"),
  x1: edge("x1", "a2", "b1", 3),
  x2: edge("x2", "a2", "b2", 2),
};
const canvases = [canvas("A", ["a1", "a2"], ["ea", "x1", "x2"]), canvas("B", ["b1", "b2"], ["eb", "x1", "x2"])];
const home = homeCanvases(canvases, nodes);

describe("canvas clusters", () => {
  it("draws every edge once when nothing is collapsed", () => {
    const drawn = drawnEdges(canvases, edges, home, new Set());
    expect(drawn.map((e) => e.id).sort()).toEqual(["ea", "eb", "x1", "x2"]);
    expect(drawn.find((e) => e.id === "x1")?.isInterCanvas).toBe(true);
    expect(drawn.find((e) => e.id === "ea")?.isInterCanvas).toBe(false);
  });

  it("hides a collapsed canvas's own edges and bundles the crossing ones at their worst level", () => {
    const drawn = drawnEdges(canvases, edges, home, new Set(["B"]));
    expect(drawn.map((e) => [e.source, e.target, e.members.length, e.functionality])).toEqual([
      ["a1", "a2", 1, 4],
      ["a2", clusterNodeId("B"), 2, 2],
    ]);
  });

  it("joins two collapsed canvases with one bundle", () => {
    const drawn = drawnEdges(canvases, edges, home, new Set(["A", "B"]));
    expect(drawn).toHaveLength(1);
    expect(drawn[0]).toMatchObject({ source: clusterNodeId("A"), target: clusterNodeId("B"), functionality: 2 });
  });

  it("gives a node shared by two canvases the first one as its home", () => {
    const shared = homeCanvases([canvas("A", ["a1"], []), canvas("B", ["a1", "b1"], [])], nodes);
    expect(shared.get("a1")).toBe("A");
    expect(shared.get("b1")).toBe("B");
  });

  it("summarises a canvas by the Operativity of its nodes", () => {
    const mixed = { ...nodes, b2: node("b2", 2) };
    expect(clusterSummary(canvases[1], mixed, 4, "constant")).toEqual({ operativity: 75, count: 2 });
  });
});
