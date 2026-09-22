/**
 * coalition — applying a Coalition to a Scenario, and naming its Elements.
 *
 * Both were written out by hand at every call site before this module existed,
 * so neither had ever been tested directly.
 */

import { describe, it, expect } from "vitest";

import { applyCoalition, elementLabel } from "@/lib/coalition";
import type { GraphSnapshot } from "@/lib/schemas/network";

const snapshot = (): GraphSnapshot => ({
  nodes: {
    n1: { id: "n1", label: "Pump", functionality: 4 },
    n2: { id: "n2", functionality: 4 },
  },
  edges: {
    e1: { id: "e1", source: "n1", target: "n2", functionality: 4 },
  },
  canvases: [{ id: "c1", label: "C1", graph: { graph_type: "g", node_ids: ["n1", "n2"], edge_ids: ["e1"] } }],
});

describe("applyCoalition", () => {
  it("drives every named Element to the worst Functionality", () => {
    const after = applyCoalition(snapshot(), ["n1", "e1"]);
    expect(after.nodes.n1.functionality).toBe(1);
    expect(after.edges.e1.functionality).toBe(1);
  });

  it("leaves Elements outside the coalition untouched, by reference", () => {
    const before = snapshot();
    const after = applyCoalition(before, ["n1"]);
    // Reference identity is what countChangedElements and the Scorecard's
    // affected-count both rely on.
    expect(after.nodes.n2).toBe(before.nodes.n2);
    expect(after.edges.e1).toBe(before.edges.e1);
  });

  it("does not mutate the Scenario it was given", () => {
    const before = snapshot();
    applyCoalition(before, ["n1"]);
    expect(before.nodes.n1.functionality).toBe(4);
  });

  it("skips an id naming nothing — a coalition can outlive a deleted Element", () => {
    expect(() => applyCoalition(snapshot(), ["ghost"])).not.toThrow();
  });

  it("is a no-op for an empty coalition", () => {
    const before = snapshot();
    const after = applyCoalition(before, []);
    expect(after.nodes.n1).toBe(before.nodes.n1);
    // The Scenario object itself, not just its Elements: the empty coalition is
    // the Shapley baseline, evaluated once per permutation.
    expect(after).toBe(before);
  });

  it("returns the same Scenario when every id names nothing", () => {
    const before = snapshot();
    expect(applyCoalition(before, ["ghost", "phantom"])).toBe(before);
  });
});

describe("elementLabel", () => {
  it("uses a node's own label", () => {
    expect(elementLabel(snapshot(), "n1")).toBe("Pump");
  });

  it("falls back to the id for an unlabelled node", () => {
    expect(elementLabel(snapshot(), "n2")).toBe("n2");
  });

  it("names an edge by its endpoints, falling back per endpoint", () => {
    expect(elementLabel(snapshot(), "e1")).toBe("Pump→n2");
  });

  it("takes a separator, because the Shapley Export's form is a contract", () => {
    // The export joins bare (parsed by scripts/paper_shapley_vs_centrality.py);
    // the on-screen panels space it out.
    expect(elementLabel(snapshot(), "e1", " → ")).toBe("Pump → n2");
  });

  it("falls back to the id for something that is neither", () => {
    expect(elementLabel(snapshot(), "ghost")).toBe("ghost");
  });
});
