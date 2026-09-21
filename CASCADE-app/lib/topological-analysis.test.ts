/**
 * topological-analysis — the client-side Analysis Metrics.
 *
 * The largest module in the frontend and, until now, the least covered: every
 * export is a pure function over an AnalysisGraph, which makes it the easiest
 * thing here to test. The fixtures are deliberately tiny graphs whose answers
 * can be worked out by hand, so a failure names the metric that broke rather
 * than reporting that some number moved.
 */

import { describe, it, expect } from "vitest";

import {
  computeArticulationPoints,
  computeBridgeEdges,
  computeCommunities,
  computeDegree,
  computeDownstreamReachability,
  computeDownstreamReachabilityAll,
  computeInDegree,
  computeKCore,
  computeNofNMetrics,
  computeOutDegree,
  computePercolationCurve,
  computeUpstreamReachability,
  computeUpstreamReachabilityAll,
  detectAttributes,
  scoresToResult,
  type AnalysisGraph,
} from "@/lib/topological-analysis";
import type { Canvas, Edge, Node } from "@/lib/schemas/network";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const node = (id: string, extra: Partial<Node> = {}): Node =>
  ({ id, label: id, functionality: 5, ...extra });
const edge = (id: string, source: string, target: string, extra: Partial<Edge> = {}): Edge =>
  ({ id, source, target, functionality: 5, ...extra });

function graph(nodes: Node[], edges: Edge[], canvases?: Canvas[]): AnalysisGraph {
  return {
    nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
    edges: Object.fromEntries(edges.map((e) => [e.id, e])),
    canvases: canvases ?? [
      {
        id: "c1",
        label: "C1",
        graph: { graph_type: "g", node_ids: nodes.map((n) => n.id), edge_ids: edges.map((e) => e.id) },
      },
    ],
  };
}

/** A → B → C, a bare chain: B is the articulation point, both edges bridges. */
const chain = () =>
  graph([node("a"), node("b"), node("c")], [edge("ab", "a", "b"), edge("bc", "b", "c")]);

/** A triangle: no articulation point, no bridge, everything reaches everything. */
const triangle = () =>
  graph(
    [node("a"), node("b"), node("c")],
    [edge("ab", "a", "b"), edge("bc", "b", "c"), edge("ca", "c", "a")],
  );

// ---------------------------------------------------------------------------

describe("scoresToResult", () => {
  it("ranks descending and reports min/max/avg", () => {
    const r = scoresToResult("m", { a: 1, b: 5, c: 3 }, () => "node");
    expect(r.ranked.map((e) => e.id)).toEqual(["b", "c", "a"]);
    expect(r.ranked.map((e) => e.rank)).toEqual([1, 2, 3]);
    expect([r.min, r.max, r.avg]).toEqual([1, 5, 3]);
  });

  it("resolves each id's kind, so nodes and edges can share one score map", () => {
    const r = scoresToResult("m", { n1: 1, e1: 2 }, (id) => (id.startsWith("e") ? "edge" : "node"));
    expect(r.ranked.find((e) => e.id === "e1")?.kind).toBe("edge");
    expect(r.ranked.find((e) => e.id === "n1")?.kind).toBe("node");
  });

  it("zeroes an empty score map rather than returning Infinity", () => {
    // Math.min() of nothing is Infinity, which the legend then renders.
    expect(scoresToResult("m", {}, () => "node")).toEqual({
      metric: "m", scores: {}, ranked: [], min: 0, max: 0, avg: 0,
    });
  });
});

describe("degree metrics", () => {
  it("counts total, incoming and outgoing edges separately", () => {
    const g = chain();
    expect(computeDegree(g).scores).toEqual({ a: 1, b: 2, c: 1 });
    expect(computeInDegree(g).scores).toEqual({ a: 0, b: 1, c: 1 });
    expect(computeOutDegree(g).scores).toEqual({ a: 1, b: 1, c: 0 });
  });

  it("scores an isolated node zero rather than omitting it", () => {
    const g = graph([node("a"), node("lonely")], [edge("aa", "a", "a")]);
    expect(computeDegree(g).scores.lonely).toBe(0);
  });
});

describe("structural metrics", () => {
  it("finds the cut vertex of a chain and none in a cycle", () => {
    expect(computeArticulationPoints(chain()).scores).toEqual({ a: 0, b: 1, c: 0 });
    expect(computeArticulationPoints(triangle()).scores).toEqual({ a: 0, b: 0, c: 0 });
  });

  it("marks every edge of a chain a bridge and none of a cycle", () => {
    expect(computeBridgeEdges(chain()).scores).toEqual({ ab: 1, bc: 1 });
    expect(computeBridgeEdges(triangle()).scores).toEqual({ ab: 0, bc: 0, ca: 0 });
  });

  it("gives a triangle k-core 2 and a chain's ends k-core 1", () => {
    expect(computeKCore(triangle()).scores).toEqual({ a: 2, b: 2, c: 2 });
    expect(computeKCore(chain()).scores.a).toBe(1);
  });

  it("puts two disconnected clusters in different communities", () => {
    const g = graph(
      [node("a"), node("b"), node("x"), node("y")],
      [edge("ab", "a", "b"), edge("xy", "x", "y")],
    );
    const s = computeCommunities(g).scores;
    expect(s.a).toBe(s.b);
    expect(s.x).toBe(s.y);
    expect(s.a).not.toBe(s.x);
  });
});

describe("reachability", () => {
  it("scores the cone source 2, everything it reaches 1, the rest 0", () => {
    // The three levels are what the categorical colour map paints.
    expect(computeDownstreamReachability(chain(), "a").scores).toEqual({ a: 2, b: 1, c: 1 });
  });

  it("follows edges backwards for the upstream cone", () => {
    expect(computeUpstreamReachability(chain(), "c").scores).toEqual({ a: 1, b: 1, c: 2 });
  });

  it("returns an all-zero cone for a source that is not in the graph", () => {
    expect(computeDownstreamReachability(chain(), "ghost").scores).toEqual({ a: 0, b: 0, c: 0 });
  });

  it("counts reachable Elements excluding the node itself", () => {
    expect(computeDownstreamReachabilityAll(chain()).scores).toEqual({ a: 2, b: 1, c: 0 });
    expect(computeUpstreamReachabilityAll(chain()).scores).toEqual({ a: 0, b: 1, c: 2 });
  });
});

describe("computePercolationCurve", () => {
  it("starts intact and ends empty", () => {
    const curve = computePercolationCurve(triangle(), ["a", "b", "c"]);
    expect(curve[0]).toEqual({ fractionRemoved: 0, giantComponentFraction: 1 });
    expect(curve[curve.length - 1].fractionRemoved).toBe(1);
    expect(curve[curve.length - 1].giantComponentFraction).toBe(0);
  });

  it("shows a chain shattering when its middle goes first", () => {
    const curve = computePercolationCurve(chain(), ["b", "a", "c"]);
    // The fraction is of the SURVIVING nodes, not of the original graph: with b
    // removed, a and c are two singletons, so the largest is 1 of the 2 left.
    expect(curve[1].giantComponentFraction).toBeCloseTo(0.5);
  });
});

describe("computeNofNMetrics", () => {
  const twoCanvas = () =>
    graph(
      [node("a"), node("b"), node("x"), node("y")],
      [edge("ab", "a", "b"), edge("bx", "b", "x"), edge("xy", "x", "y")],
      [
        { id: "c1", label: "Water", graph: { graph_type: "g", node_ids: ["a", "b"], edge_ids: ["ab"] } },
        { id: "c2", label: "Power", graph: { graph_type: "g", node_ids: ["x", "y"], edge_ids: ["xy"] } },
      ],
    );

  it("measures Coupling Strength over both Canvases' incident edges", () => {
    // Pooled and two-sided, NOT "crossing edges ÷ all edges": the crossing edge
    // bx is counted once for each Canvas it touches (2), over the edges incident
    // to either Canvas (c1: ab, bx; c2: bx, xy — 4). Each Canvas individually
    // has half its edges crossing, and 2/4 is what that pools to.
    const { couplingStrength } = computeNofNMetrics(twoCanvas());
    expect(Object.values(couplingStrength)[0]).toBeCloseTo(0.5);
  });

  it("measures the Interdependency Ratio per Canvas", () => {
    // One node of each Canvas's two has a crossing edge.
    const { interdependencyRatio } = computeNofNMetrics(twoCanvas());
    expect(interdependencyRatio.c1).toBeCloseTo(0.5);
    expect(interdependencyRatio.c2).toBeCloseTo(0.5);
  });

  it("keeps Coupling Strength off Canvases whose id merely occurs in the pair key", () => {
    // "imp-c1" is the shape mergeImportedProject mints, and it contains "c1".
    // The only crossing edge is yp, between c2 and imp-c1 — c1 is not part of
    // that pair and its own edge must stay out of the pair's denominator.
    // inter = 2 (yp counted once per endpoint Canvas); total = c2's incident
    // edges (xy, yp) + imp-c1's (pq, yp) = 4; so 2/4. Counting c1's edge ab
    // as well would give 2/5 and understate the coupling.
    //
    // c1 is listed LAST deliberately. The pair key only exists once a Canvas
    // touching the crossing edge has been walked, so a Canvas whose id collides
    // corrupts the count only when it is walked afterwards — the defect was
    // invisible at any other Canvas ordering, which is how it survived.
    const g = graph(
      [node("a"), node("b"), node("x"), node("y"), node("p"), node("q")],
      [edge("ab", "a", "b"), edge("xy", "x", "y"), edge("pq", "p", "q"), edge("yp", "y", "p")],
      [
        { id: "c2", label: "Power", graph: { graph_type: "g", node_ids: ["x", "y"], edge_ids: ["xy"] } },
        { id: "imp-c1", label: "Imported", graph: { graph_type: "g", node_ids: ["p", "q"], edge_ids: ["pq"] } },
        { id: "c1", label: "Water", graph: { graph_type: "g", node_ids: ["a", "b"], edge_ids: ["ab"] } },
      ],
    );
    const { couplingStrength } = computeNofNMetrics(g);
    expect(couplingStrength["c2|imp-c1"]).toBeCloseTo(0.5);
  });
});

describe("detectAttributes", () => {
  it("reports which weight attributes the graph actually carries", () => {
    const ctx = detectAttributes(
      graph([node("a", { importance: 3 })], [edge("aa", "a", "a", { capacity: 7 })]),
    );
    expect(ctx.nodeAttrs).toContain("importance");
    expect(ctx.edgeAttrs).toContain("capacity");
  });
});
