/**
 * Tests for the Analysis Heatmap legend.
 *
 * The legend is the only thing standing between a coloured canvas and a user
 * guessing. What is worth pinning is not "a gradient metric returns a gradient"
 * but the derivations that read the scores: the community list that truncates,
 * the k-core range that reports the real maximum, and the rule that decides
 * which metrics get named swatches at all.
 */

import { describe, it, expect } from "vitest";

import {
  GRADIENT_HIGH,
  GRADIENT_LOW,
  buildHeatmapLegend,
  buildLegend,
  formatScore,
} from "@/lib/analysis-legend";
import { CATEGORY_COLORS, buildColorMap, scoreToColor } from "@/lib/topological-analysis";
import type { AnalysisResult } from "@/lib/topological-analysis";

/** Mirrors `toResult` in topological-analysis.ts: min/max over the scores only. */
function result(metric: string, scores: Record<string, number>): AnalysisResult {
  const values = Object.values(scores);
  if (values.length === 0) return { metric, scores, ranked: [], min: 0, max: 0, avg: 0 };
  return {
    metric,
    scores,
    ranked: [],
    min: Math.min(...values),
    max: Math.max(...values),
    avg: values.reduce((a, b) => a + b, 0) / values.length,
  };
}

const communities = (n: number) =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`n${i}`, i]));

describe("community detection", () => {
  it("names one swatch per community, in the palette order the canvas paints", () => {
    const legend = buildLegend(result("community", communities(3)));
    expect(legend.type).toBe("swatches");
    if (legend.type !== "swatches") return;
    expect(legend.items.map((i) => i.label)).toEqual([
      "Community 1",
      "Community 2",
      "Community 3",
    ]);
    // Distinct colours, or two communities are indistinguishable on the canvas.
    expect(new Set(legend.items.map((i) => i.color)).size).toBe(3);
  });

  it("stops listing at ten and counts the rest", () => {
    // A 40-community network would otherwise produce a legend taller than the
    // canvas overlay it lives in.
    const legend = buildLegend(result("community", communities(14)));
    if (legend.type !== "swatches") throw new Error("expected swatches");
    expect(legend.items).toHaveLength(11);
    // Not "+4 more" with a colour of its own: buildColorMap wraps the palette,
    // so those four are painted like communities 1-4.
    expect(legend.items[10].label).toBe("+4 more (colours repeat)");
    expect(legend.items[10].color).toBe(legend.items[0].color);
  });

  it("counts distinct community ids, not nodes", () => {
    // Ten nodes, two communities. Listing ten swatches would be wrong even
    // though it would not truncate.
    const legend = buildLegend(
      result("community", Object.fromEntries(
        Array.from({ length: 10 }, (_, i) => [`n${i}`, i % 2]),
      )),
    );
    if (legend.type !== "swatches") throw new Error("expected swatches");
    expect(legend.items).toHaveLength(2);
  });
});

describe("k-core", () => {
  it("labels the real maximum shell, and survives an all-zero graph", () => {
    const legend = buildLegend(result("k_core", { a: 0, b: 3, c: 7 }));
    if (legend.type !== "swatches") throw new Error("expected swatches");
    expect(legend.items[1].label).toBe("k=7 (core)");
    expect(legend.items[0].color).toBe(GRADIENT_LOW);
    expect(legend.items[1].color).toBe(GRADIENT_HIGH);

    // Math.max of an empty spread is -Infinity; the floor of 1 keeps the label
    // readable on a graph where nothing is embedded.
    const empty = buildLegend(result("k_core", {}));
    if (empty.type !== "swatches") throw new Error("expected swatches");
    expect(empty.items[1].label).toBe("k=1 (core)");
  });
});

describe("gradient ends name the real scores", () => {
  it("labels the ramp with this result's min and max", () => {
    // buildColorMap normalises by (score - min) / (max - min), so these two
    // numbers are precisely what the two colours stand for. "Low"/"High" told
    // the reader nothing the gradient had not already shown.
    const legend = buildLegend(result("betweenness", { a: 0.0043, b: 0.0686, c: 0.02 }));
    if (legend.type !== "gradient") throw new Error("expected gradient");
    expect(legend.minLabel).toBe("0.0043");
    expect(legend.maxLabel).toBe("0.069");
  });

  it("collapses a flat result to one swatch instead of inventing a range", () => {
    // Every Element scores the same, so every Element is painted the ramp's low
    // end — buildColorMap's `max - min || 1` guard makes the normalised score 0
    // for all of them. A gradient here would show a spread that does not exist.
    const scores = { a: 4, b: 4, c: 4 };
    const legend = buildLegend(result("degree", scores));
    if (legend.type !== "swatches") throw new Error("expected swatches");
    expect(legend.items).toEqual([{ color: GRADIENT_LOW, label: "All 4" }]);
    expect(buildColorMap(result("degree", scores)).a).toBe(GRADIENT_LOW);
  });
});

describe("formatScore", () => {
  it("follows the magnitude, because Analysis Metrics do not share one", () => {
    expect(formatScore(0)).toBe("0");
    expect(formatScore(39)).toBe("39");            // reach count
    expect(formatScore(0.0171)).toBe("0.017");     // Shapley Value
    expect(formatScore(0.0686)).toBe("0.069");     // betweenness
    expect(formatScore(1.5)).toBe("1.5");
    expect(formatScore(2.75)).toBe("2.75");
    // Two significant digits, not two decimal places: these would both collapse
    // to "0.00" under toFixed(2) and the legend would show no range at all.
    expect(formatScore(0.0012)).toBe("0.0012");
    expect(formatScore(0.00004)).toBe("4.0e-5");
    expect(formatScore(NaN)).toBe("—");
  });
});

describe("which metrics get swatches", () => {
  it("gives categorical and boolean metrics a key, and magnitudes a gradient", () => {
    for (const metric of [
      "articulation_points",
      "bridge_edges",
      "downstream_reachability",
      "upstream_reachability",
      "community",
      "k_core",
    ]) {
      expect(buildLegend(result(metric, { a: 1 })).type).toBe("swatches");
    }
    // Two distinct scores: a magnitude metric whose scores are all equal is a
    // flat result, which collapses to a single swatch (covered above).
    for (const metric of ["betweenness", "eigenvector", "shapley", "vitality"]) {
      expect(buildLegend(result(metric, { a: 0.5, b: 0.1 })).type).toBe("gradient");
    }
  });
});

describe("the legend agrees with the colours actually painted", () => {
  // The point of the whole module: a key that names a colour the canvas does
  // not draw is worse than no key. These compare against buildColorMap, which
  // is what cascade-node/cascade-edge actually render.
  it("uses the same swatch a community node is painted with", () => {
    const scores = communities(4);
    const colors = buildColorMap(result("community", scores));
    const legend = buildLegend(result("community", scores));
    if (legend.type !== "swatches") throw new Error("expected swatches");

    for (let i = 0; i < 4; i++) {
      expect(legend.items[i].color).toBe(colors[`n${i}`]);
    }
    expect(legend.items[0].color).toBe(CATEGORY_COLORS[0]);
  });

  it("uses the ramp's real endpoints, not a hand-copied pair", () => {
    expect(GRADIENT_LOW).toBe(scoreToColor(0));
    expect(GRADIENT_HIGH).toBe(scoreToColor(1));

    // k-core paints score/maxK through the same ramp, so the two named
    // swatches are exactly the ends a k=0 and a k=max node receive.
    const scores = { a: 0, b: 4 };
    const colors = buildColorMap(result("k_core", scores));
    const legend = buildLegend(result("k_core", scores));
    if (legend.type !== "swatches") throw new Error("expected swatches");
    expect(legend.items[0].color).toBe(colors.a);
    expect(legend.items[1].color).toBe(colors.b);
  });

  it("names the same two colours an articulation-point map assigns", () => {
    const scores = { crit: 1, plain: 0 };
    const colors = buildColorMap(result("articulation_points", scores));
    const legend = buildLegend(result("articulation_points", scores));
    if (legend.type !== "swatches") throw new Error("expected swatches");
    expect(legend.items[0].color).toBe(colors.crit);
    expect(legend.items[1].color).toBe(colors.plain);
  });

  it("names the three tiers a reachability cone assigns", () => {
    const scores = { src: 2, inCone: 1, outside: 0 };
    const colors = buildColorMap(result("downstream_reachability", scores));
    const legend = buildLegend(result("downstream_reachability", scores));
    if (legend.type !== "swatches") throw new Error("expected swatches");
    expect(legend.items.map((i) => i.color)).toEqual([
      colors.src, colors.inCone, colors.outside,
    ]);
  });
});

describe("assembling the applied legend", () => {
  it("omits the half that was not scored, so the canvas labels nothing it lacks", () => {
    const nodesOnly = buildHeatmapLegend({
      title: "Shapley Values",
      result: result("shapley", { a: 0.2, b: 0.05 }),
    });
    expect(nodesOnly.title).toBe("Shapley Values");
    expect(nodesOnly.nodes).toBeDefined();
    expect("edges" in nodesOnly).toBe(false);

    const both = buildHeatmapLegend({
      title: "Betweenness · Bridge Edges",
      result: result("betweenness", { a: 0.2, b: 0.05 }),
      edgeResult: result("bridge_edges", { e: 1, f: 0 }),
    });
    expect(both.nodes?.type).toBe("gradient");
    expect(both.edges?.type).toBe("swatches");
  });
});
