import { describe, it, expect } from "vitest";
import { captureOutcome, rebuildSnapshot, scoreOutcome } from "./operativity-basis";
import { computeOperativityScore } from "./scorecard-utils";
import type { GraphSnapshot, Node } from "@/lib/schemas/network";

const N = 5;

function node(id: string, functionality: number, extra: Partial<Node> = {}): Node {
  return {
    id,
    label: id,
    node_type: "service",
    canvas_id: "c1",
    functionality,
    position: { x: 0, y: 0 },
    ...extra,
  } as Node;
}

function snap(nodes: Node[]): GraphSnapshot {
  return {
    nodes: Object.fromEntries(nodes.map((nd) => [nd.id, nd])),
    edges: {},
    canvases: [],
  } as GraphSnapshot;
}

describe("captureOutcome", () => {
  it("records only the nodes whose Functionality moved", () => {
    const baseline = snap([node("a", 5), node("b", 5), node("c", 5)]);
    const after = snap([node("a", 5), node("b", 2), node("c", 5)]);
    expect(captureOutcome(baseline, after)).toEqual({ changed: { b: 2 }, removed: [] });
  });

  it("records a node missing from the propagated Scenario as removed", () => {
    const baseline = snap([node("a", 5), node("b", 5)]);
    const after = snap([node("b", 3)]);
    expect(captureOutcome(baseline, after)).toEqual({ changed: { b: 3 }, removed: ["a"] });
  });

  it("is empty when the cascade changed nothing", () => {
    const baseline = snap([node("a", 5), node("b", 5)]);
    expect(captureOutcome(baseline, baseline)).toEqual({ changed: {}, removed: [] });
  });
});

describe("rebuildSnapshot", () => {
  it("shares untouched node objects with the baseline rather than cloning", () => {
    const baseline = snap([node("a", 5), node("b", 5)]);
    const out = rebuildSnapshot(baseline, { changed: { b: 1 }, removed: [] });
    expect(out.nodes.a).toBe(baseline.nodes.a);
    expect(out.nodes.b).not.toBe(baseline.nodes.b);
    expect(out.nodes.b.functionality).toBe(1);
  });

  it("never mutates the baseline", () => {
    const baseline = snap([node("a", 5)]);
    rebuildSnapshot(baseline, { changed: { a: 1 }, removed: [] });
    expect(baseline.nodes.a.functionality).toBe(5);
  });

  it("drops removed nodes", () => {
    const baseline = snap([node("a", 5), node("b", 5)]);
    const out = rebuildSnapshot(baseline, { changed: {}, removed: ["a"] });
    expect(Object.keys(out.nodes)).toEqual(["b"]);
  });
});

describe("scoreOutcome", () => {
  it("reproduces the score the full propagated Scenario would have given", () => {
    const baseline = snap([node("a", 5), node("b", 5), node("c", 5)]);
    const after = snap([node("a", 5), node("b", 1), node("c", 3)]);
    expect(scoreOutcome(baseline, captureOutcome(baseline, after), N, "constant")).toBeCloseTo(
      computeOperativityScore(after, N, "constant"),
      10,
    );
  });

  it("reproduces it under a weighted attribute too — the whole point", () => {
    const baseline = snap([
      node("a", 5, { importance: 1 } as Partial<Node>),
      node("b", 5, { importance: 9 } as Partial<Node>),
    ]);
    const after = snap([
      node("a", 5, { importance: 1 } as Partial<Node>),
      node("b", 1, { importance: 9 } as Partial<Node>),
    ]);
    const outcome = captureOutcome(baseline, after);
    expect(scoreOutcome(baseline, outcome, N, "importance")).toBeCloseTo(
      computeOperativityScore(after, N, "importance"),
      10,
    );
  });

  it("re-scores one captured outcome under several weightings — no re-propagation", () => {
    const baseline = snap([
      node("a", 5, { importance: 1 } as Partial<Node>),
      node("b", 5, { importance: 9 } as Partial<Node>),
    ]);
    // b, the heavily weighted node, is the one that failed.
    const outcome = { changed: { b: 1 }, removed: [] };

    const uniform = scoreOutcome(baseline, outcome, N, "constant");
    const weighted = scoreOutcome(baseline, outcome, N, "importance");

    // Weighting by importance must punish b's failure harder than the mean does.
    expect(weighted).toBeLessThan(uniform);
    // And the captured outcome is reusable — scoring it again is stable.
    expect(scoreOutcome(baseline, outcome, N, "constant")).toBe(uniform);
  });

  it("scores a removed Element's Scenario over the surviving nodes only", () => {
    const baseline = snap([node("a", 5), node("b", 5)]);
    const out = scoreOutcome(baseline, { changed: {}, removed: ["a"] }, N, "constant");
    expect(out).toBe(100);
  });
});
