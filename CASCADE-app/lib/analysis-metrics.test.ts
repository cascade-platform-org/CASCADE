/**
 * analysis-metrics — the registry every Analysis Metric is defined in.
 *
 * These are the checks that were not possible while a metric was spread across
 * an id union, a component's METRICS array, a dispatch switch and a legend
 * switch: nothing could compare the five, so a metric half-added simply failed
 * at runtime. Now the definition is one object and the set of them is data.
 */

import { describe, it, expect } from "vitest";

import {
  ANALYSIS_METRICS,
  canRun,
  effectiveScope,
  metricById,
  metricsForSection,
  scoredMetricsFor,
} from "@/lib/analysis-metrics";
import { buildColorMap, buildLegend } from "@/lib/analysis-legend";
import type { AnalysisGraph } from "@/lib/topological-analysis";
import type { Canvas, Edge, Node } from "@/lib/schemas/network";

const node = (id: string): Node => ({ id, label: id, functionality: 5 });
const edge = (id: string, source: string, target: string): Edge =>
  ({ id, source, target, functionality: 5, capacity: 2 });

/**
 * Two Canvases with crossing edges, so even Network-of-Networks has work.
 *
 * Deliberately CYCLIC: eigenvector centrality scores every node zero on an
 * acyclic graph (see the test below), and a fixture that made one metric return
 * nothing would weaken the "every metric produces a result" check for all of them.
 */
const fixture = (): AnalysisGraph => ({
  nodes: Object.fromEntries([node("a"), node("b"), node("x")].map((n) => [n.id, n])),
  edges: Object.fromEntries(
    [edge("ab", "a", "b"), edge("bx", "b", "x"), edge("xa", "x", "a")].map((e) => [e.id, e]),
  ),
  canvases: [
    { id: "c1", label: "C1", graph: { graph_type: "g", node_ids: ["a", "b"], edge_ids: ["ab"] } },
    { id: "c2", label: "C2", graph: { graph_type: "g", node_ids: ["x"], edge_ids: ["xa"] } },
  ] as Canvas[],
});

const ctx = () => ({ graph: fixture(), weightExpr: "capacity", n: 5, sourceId: "a" });

describe("the registry", () => {
  it("defines every metric exactly once", () => {
    const ids = ANALYSIS_METRICS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every metric a label and a description for the selector", () => {
    for (const m of ANALYSIS_METRICS) {
      expect(m.label, m.id).toBeTruthy();
      expect(m.description, m.id).toBeTruthy();
    }
  });

  it("looks a metric up by id, and reports nothing for an id it does not define", () => {
    expect(metricById("betweenness")?.label).toBe("Betweenness");
    expect(metricById("not_a_metric")).toBeUndefined();
  });

  it("splits cleanly across the three panels", () => {
    const sections = (["topological", "reachability", "structural"] as const)
      .flatMap((s) => metricsForSection(s));
    expect(sections).toHaveLength(ANALYSIS_METRICS.length);
  });

  it("offers node and edge selectors from the same list", () => {
    expect(scoredMetricsFor("topological", "node").map((m) => m.id)).toContain("betweenness");
    expect(scoredMetricsFor("topological", "edge").map((m) => m.id)).toContain("bridge_edges");
    // A node metric must never appear in the edge selector.
    expect(scoredMetricsFor("topological", "edge").map((m) => m.id)).not.toContain("degree");
  });
});

describe("running a metric", () => {
  // The check the dispatch switches could not give: EVERY definition runs, so a
  // metric can no longer be listed in the UI with no way to compute it.
  it.each(ANALYSIS_METRICS.map((m) => [m.id, m] as const))(
    "%s produces a result",
    (_id, metric) => {
      const out = metric.run(ctx());
      expect(out).toBeDefined();
      if (metric.kind === "scored") {
        expect(out).toHaveProperty("ranked");
        // The metric it reports itself as is what the legend switches on.
        expect(typeof (out as { metric: string }).metric).toBe("string");
      }
    },
  );

  it("colours and explains every scored metric's result", () => {
    for (const metric of ANALYSIS_METRICS) {
      if (metric.kind !== "scored") continue;
      const result = metric.run(ctx());
      expect(Object.keys(buildColorMap(result)).length, metric.id).toBeGreaterThan(0);
      expect(buildLegend(result).type, metric.id).toMatch(/gradient|swatches/);
    }
  });
});

describe("effectiveScope", () => {
  it("lets Network-of-Networks override the user's scope toggle", () => {
    // It compares inter-canvas edges, so one Canvas cannot answer it.
    expect(effectiveScope(metricById("nofn"), "local")).toBe("global");
  });

  it("follows the selected scope for every other metric", () => {
    expect(effectiveScope(metricById("betweenness"), "local")).toBe("local");
    expect(effectiveScope(metricById("betweenness"), "global")).toBe("global");
  });
});

describe("canRun", () => {
  it("holds a cone metric back until an Element is picked", () => {
    expect(canRun(metricById("downstream_cone"), null)).toBe(false);
    expect(canRun(metricById("downstream_cone"), "a")).toBe(true);
  });

  it("lets every other metric run straight away", () => {
    expect(canRun(metricById("k_core"), null)).toBe(true);
    expect(canRun(metricById("nofn"), null)).toBe(true);
  });

  it("refuses an id nothing defines", () => {
    expect(canRun(metricById("not_a_metric"), "a")).toBe(false);
  });
});

describe("known limits", () => {
  it("scores nothing for eigenvector on an acyclic graph", () => {
    // Power iteration over an acyclic adjacency matrix converges to zero, so
    // this metric has no answer on a pure source → infrastructure → service
    // chain — a shape CASCADE networks take routinely. The Analysis page shows
    // an empty results list with no explanation. Pinned here rather than worked
    // around: changing it means picking a different estimator (Katz, or a
    // damping factor), which is a modelling decision, not a refactor.
    const dag: AnalysisGraph = {
      nodes: Object.fromEntries([node("a"), node("b")].map((n) => [n.id, n])),
      edges: { ab: edge("ab", "a", "b") },
      canvases: [],
    };
    const metric = metricById("eigenvector");
    expect(metric?.kind === "scored" && metric.run({ ...ctx(), graph: dag }).ranked).toEqual([]);
  });
});
