/**
 * Tests for the Analysis Scorecard entry builder.
 *
 * The regression these exist for: the entry used to be stamped with the
 * analysis store's `activeMetric`, which `section-topological.tsx` never
 * writes. A Closeness run saved as "betweenness", and — if the user had been in
 * the Reachability section first — as "upstream_cone". The label is shown on
 * the Scorecard card and persisted in the project file, so the record was wrong
 * permanently and silently.
 */

import { describe, it, expect } from "vitest";

import { buildAnalysisEntry } from "@/lib/analysis-entry";
import type { AnalysisResult } from "@/lib/topological-analysis";
import type { GraphSnapshot } from "@/lib/schemas/network";

const snapshot: GraphSnapshot = { nodes: {}, edges: {}, canvases: [] };

function analysis(metric: string, scores: Record<string, number>): AnalysisResult {
  const values = Object.values(scores);
  return {
    metric,
    scores,
    ranked: [],
    min: values.length ? Math.min(...values) : 0,
    max: values.length ? Math.max(...values) : 0,
    avg: values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0,
  };
}

const base = {
  label: "  Baseline centrality  ",
  scope: "global" as const,
  activeCanvasId: "c1",
  snapshot,
  id: "entry-1",
  now: () => new Date("2026-09-10T09:00:00.000Z"),
};

describe("the metric comes from the run", () => {
  it("records what was computed, whatever any selector says", () => {
    // The only input carrying a metric is the Result. There is deliberately no
    // parameter through which a stale selection could reach the entry.
    const entry = buildAnalysisEntry({
      ...base,
      result: analysis("closeness", { a: 0.4, b: 0.1 }),
    });
    expect(entry.metric).toBe("closeness");
    expect(entry.scores).toEqual({ a: 0.4, b: 0.1 });
  });

  it("keeps metric and scores from the same run", () => {
    // A mismatched pair is the shape of the old bug: the right numbers under
    // the wrong name. Both fields read from one object, so they cannot diverge.
    const result = analysis("k_core", { a: 3 });
    const entry = buildAnalysisEntry({ ...base, result });
    expect(entry.metric).toBe(result.metric);
    expect(entry.scores).toBe(result.scores);
  });
});

describe("scope decides whether a Canvas is named", () => {
  it("omits canvas_id for a global run even though a Canvas is active", () => {
    // A global Analysis covers the whole Element registry. Naming the Canvas
    // that happened to be open would imply a scope the scores do not have.
    const entry = buildAnalysisEntry({
      ...base,
      scope: "global",
      activeCanvasId: "c1",
      result: analysis("betweenness", { a: 1 }),
    });
    expect("canvas_id" in entry).toBe(false);
  });

  it("records the Canvas for a local run, and omits the key when there is none", () => {
    const local = buildAnalysisEntry({
      ...base,
      scope: "local",
      result: analysis("betweenness", { a: 1 }),
    });
    expect(local.canvas_id).toBe("c1");

    // `undefined` would serialise to a null through the Zod boundary; the key
    // is left out instead.
    const noCanvas = buildAnalysisEntry({
      ...base,
      scope: "local",
      activeCanvasId: null,
      result: analysis("betweenness", { a: 1 }),
    });
    expect("canvas_id" in noCanvas).toBe(false);
  });
});

describe("entry housekeeping", () => {
  it("trims the label and stamps the injected clock", () => {
    const entry = buildAnalysisEntry({ ...base, result: analysis("degree", { a: 2 }) });
    expect(entry.label).toBe("Baseline centrality");
    expect(entry.created_at).toBe("2026-09-10T09:00:00.000Z");
    expect(entry.type).toBe("analysis");
    expect(entry.id).toBe("entry-1");
  });
});
