/**
 * graph-diff — the round-trip property is the whole test surface.
 *
 * Every case below asserts the same thing in the end: applying a diff forwards
 * to `before` reproduces `after`, and backwards from `after` reproduces
 * `before`. A differ that loses a field passes no test here, which is the point
 * — ADR-0017's failure mode is a value silently left behind, never a throw.
 */

import { describe, it, expect } from "vitest";

import {
  diffGraph,
  applyGraphDiff,
  isEmptyDiff,
  deepEqual,
  materialiseBefore,
} from "@/lib/graph-diff";
import { DIFF_ABSENT } from "@/lib/schemas/network";
import type { GraphSnapshot, Node } from "@/lib/schemas/network";

function node(id: string, extra: Partial<Node> = {}): Node {
  return { id, label: id, functionality: 3, ...extra };
}

function snap(nodes: Node[], canvases?: GraphSnapshot["canvases"]): GraphSnapshot {
  return {
    nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
    edges: {},
    canvases: canvases ?? [
      { id: "c1", label: "C1", graph: { graph_type: "g", node_ids: nodes.map((n) => n.id), edge_ids: [] } },
    ],
  };
}

/** The invariant every case checks. */
function roundTrips(before: GraphSnapshot, after: GraphSnapshot) {
  const diff = diffGraph(before, after);
  expect(applyGraphDiff(before, diff, "forward")).toEqual(after);
  expect(applyGraphDiff(after, diff, "backward")).toEqual(before);
  return diff;
}

describe("diffGraph / applyGraphDiff", () => {
  it("records nothing when nothing changed", () => {
    const s = snap([node("n1"), node("n2")]);
    const diff = diffGraph(s, { ...s, nodes: { ...s.nodes } });
    expect(isEmptyDiff(diff)).toBe(true);
    expect(applyGraphDiff(s, diff, "backward")).toBe(s); // identity, not a copy
  });

  it("round-trips a changed field", () => {
    const diff = roundTrips(snap([node("n1")]), snap([node("n1", { functionality: 1 })]));
    expect(diff.nodes).toEqual([
      { id: "n1", op: "update", fields: [{ field: "functionality", before: 3, after: 1 }] },
    ]);
  });

  it("round-trips a field that did not exist, via the ABSENT sentinel", () => {
    const before = snap([node("n1")]);
    const after = snap([node("n1", { direct_damage: true })]);
    const diff = roundTrips(before, after);
    expect(diff.nodes[0].fields[0]).toEqual({
      field: "direct_damage",
      before: DIFF_ABSENT,
      after: true,
    });
    // The point of the sentinel: undo DELETES the key rather than writing null,
    // which an optional-but-not-nullable Zod field would reject.
    const undone = applyGraphDiff(after, diff, "backward");
    expect("direct_damage" in undone.nodes.n1).toBe(false);
  });

  it("distinguishes a field set to null from a field that is absent", () => {
    const absent = snap([node("n1")]);
    const nulled = snap([{ ...node("n1"), label: null } as unknown as Node]);
    const diff = roundTrips(absent, nulled);
    expect(diff.nodes[0].fields).toEqual([
      { field: "label", before: "n1", after: null },
    ]);
  });

  it("diffs properties one level deep, not as a whole object", () => {
    const before = snap([node("n1", { properties: { inp_id: "J1", kind: "junction" } })]);
    const after = snap([
      node("n1", { properties: { inp_id: "J1", kind: "junction", damaged_by: "quake" } }),
    ]);
    const diff = roundTrips(before, after);
    // One entry for the one key that moved — NOT the whole 3-key object twice.
    // This is the ADR-0015 case: a Rule merging one custom key onto an Element.
    expect(diff.nodes[0].fields).toEqual([
      { field: "properties", key: "damaged_by", before: DIFF_ABSENT, after: "quake" },
    ]);
  });

  it("round-trips removing the last property key", () => {
    const before = snap([node("n1", { properties: { only: 1 } })]);
    const after = snap([node("n1", { properties: {} })]);
    roundTrips(before, after);
  });

  it("round-trips an added and a removed Element", () => {
    const before = snap([node("n1")]);
    const after = snap([node("n1"), node("n2")]);
    const addDiff = roundTrips(before, after);
    expect(addDiff.nodes.find((d) => d.id === "n2")?.op).toBe("add");
    roundTrips(after, before); // the mirror
  });

  it("round-trips an attribute a Rule could invent tomorrow", () => {
    // The schema-agnostic guarantee. No field name in graph-diff.ts refers to
    // this; if the differ ever grew a field list, this is the test that fails.
    const before = snap([node("n1")]);
    const after = snap([
      { ...node("n1"), some_future_attribute: { nested: [1, 2, 3] } } as unknown as Node,
    ]);
    roundTrips(before, after);
  });

  it("round-trips a Canvas edit, an added Canvas and a reorder", () => {
    const c = (id: string, label: string) => ({
      id,
      label,
      graph: { graph_type: "g", node_ids: [], edge_ids: [] },
    });
    roundTrips(snap([], [c("a", "A")]), snap([], [c("a", "A2")]));
    roundTrips(snap([], [c("a", "A")]), snap([], [c("a", "A"), c("b", "B")]));
    const diff = roundTrips(snap([], [c("a", "A"), c("b", "B")]), snap([], [c("b", "B"), c("a", "A")]));
    expect(diff.canvas_order).toEqual(["b", "a"]);
    expect(diff.canvas_order_before).toEqual(["a", "b"]);
  });

  it("ignores key order, so a no-op rewrite records nothing", () => {
    // immer and the spread copies throughout the stores reorder keys freely.
    // Recording that as a change is what produced the 99 KB-for-nothing entry
    // ADR-0017 measured in Palmanova_Complete.json.
    const before = snap([{ id: "n1", label: "a", functionality: 3 }]);
    const after = snap([{ functionality: 3, label: "a", id: "n1" }]);
    expect(isEmptyDiff(diffGraph(before, after))).toBe(true);
  });

  it("skips an Element deleted after the diff was recorded", () => {
    const diff = diffGraph(snap([node("n1"), node("n2")]), snap([node("n1", { functionality: 1 }), node("n2")]));
    const live = snap([node("n2")]); // n1 has since been deleted
    expect(() => applyGraphDiff(live, diff, "backward")).not.toThrow();
    expect(applyGraphDiff(live, diff, "backward").nodes.n1).toBeUndefined();
  });
});

describe("deepEqual", () => {
  it("compares structurally and ignores key order", () => {
    expect(deepEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(true); // absent === undefined
    expect(deepEqual([1, 2], [2, 1])).toBe(false); // arrays are ordered
    expect(deepEqual(NaN, NaN)).toBe(true); // not an un-undoable edit
  });
});

describe("materialiseBefore", () => {
  it("walks the live graph back through newest-first entries", () => {
    const s0 = snap([node("n1", { functionality: 3 })]);
    const s1 = snap([node("n1", { functionality: 2 })]);
    const s2 = snap([node("n1", { functionality: 1 })]);
    const entries = [
      { diff: diffGraph(s1, s2) }, // newest
      { diff: diffGraph(s0, s1) },
    ];
    expect(materialiseBefore(s2, entries)).toEqual(s0);
    expect(materialiseBefore(s2, entries.slice(0, 1))).toEqual(s1);
  });

  it("stops at a legacy entry and returns its own snapshot", () => {
    const legacy = snap([node("n1", { functionality: 3 })]);
    const live = snap([node("n1", { functionality: 1 })]);
    expect(materialiseBefore(live, [{ before: legacy }])).toEqual(legacy);
  });
});
