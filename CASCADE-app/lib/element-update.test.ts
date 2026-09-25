/**
 * element-update — the single place that applies an engine ElementUpdate.
 *
 * It had no test at all, and it is on the path every Propagation result takes:
 * `assignElementUpdate` is what canvas-store writes into an immer draft, and
 * `mergeUpdatesIntoSnapshot` is what the Analysis and Shapley paths merge onto
 * a plain snapshot (`lib/ephemeral-propagation.ts`).
 *
 * Two properties are worth pinning. The module's own docstring promises that
 * "a new engine output field only has to be handled in assignElementUpdate" —
 * true only while the snapshot path routes through it, so a test that proves
 * both paths agree is what keeps that sentence honest. And the copy-on-write
 * discipline is load-bearing rather than an optimisation: the Scorecard and the
 * memoised Analysis views compare snapshots by reference, so an untouched
 * Element that silently changes identity makes unrelated work look dirty.
 */

import { describe, it, expect } from "vitest";

import { assignElementUpdate, mergeUpdatesIntoSnapshot } from "@/lib/element-update";
import type { Node, Edge, GraphSnapshot } from "@/lib/schemas/network";
import type { ElementUpdate } from "@/lib/schemas/propagation";

const node = (id: string, extra: Partial<Node> = {}): Node =>
  ({ id, label: id, functionality: 5, ...extra });
const edge = (id: string, source: string, target: string, extra: Partial<Edge> = {}): Edge =>
  ({ id, source, target, functionality: 5, ...extra });

function snapshot(nodes: Node[], edges: Edge[] = []): GraphSnapshot {
  return {
    nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
    edges: Object.fromEntries(edges.map((e) => [e.id, e])),
    canvases: [],
  } as unknown as GraphSnapshot;
}

describe("assignElementUpdate", () => {
  it("writes functionality unconditionally", () => {
    const n = node("a");
    assignElementUpdate(n, { id: "a", functionality: 2 });
    expect(n.functionality).toBe(2);
  });

  it("leaves a field the update does not carry", () => {
    // `undefined` means "the engine said nothing about this", never "clear it".
    const n = node("a", { functionality_time: 6, direct_damage: true });
    assignElementUpdate(n, { id: "a", functionality: 3 });
    expect(n.functionality_time).toBe(6);
    expect(n.direct_damage).toBe(true);
  });

  it("writes the falsy values that a field CAN legitimately take", () => {
    // The guard is `!== undefined`, not truthiness: 0 hours and false are
    // meaningful answers, and a truthiness check would drop both.
    const n = node("a", { functionality_time: 9, direct_damage: true });
    assignElementUpdate(n, {
      id: "a",
      functionality: 5,
      functionality_time: 0,
      direct_damage: false,
    });
    expect(n.functionality_time).toBe(0);
    expect(n.direct_damage).toBe(false);
  });

  it("MERGES properties rather than replacing them", () => {
    // ADR-0015: a Rule may write an arbitrary custom key. Replacing would drop
    // the importer's own inp_id/kind, which is model data nobody asked to lose.
    const n = node("a", { properties: { inp_id: "J-12", kind: "junction" } });
    assignElementUpdate(n, { id: "a", functionality: 1, properties: { damaged_by: "quake" } });
    expect(n.properties).toEqual({ inp_id: "J-12", kind: "junction", damaged_by: "quake" });
  });

  it("merges properties onto an element that had none", () => {
    const n = node("a");
    assignElementUpdate(n, { id: "a", functionality: 1, properties: { damaged_by: "quake" } });
    expect(n.properties).toEqual({ damaged_by: "quake" });
  });
});

describe("mergeUpdatesIntoSnapshot", () => {
  it("returns the SAME object when there is nothing to apply", () => {
    const s = snapshot([node("a")]);
    expect(mergeUpdatesIntoSnapshot(s, [])).toBe(s);
  });

  it("returns the same object when every update names an element it does not have", () => {
    // A local-scope Propagation answers about the Canvas it was sent; ids from
    // elsewhere are not an error, they are simply not ours.
    const s = snapshot([node("a")]);
    expect(mergeUpdatesIntoSnapshot(s, [{ id: "ghost", functionality: 1 }])).toBe(s);
  });

  it("does not mutate the input snapshot", () => {
    const s = snapshot([node("a")]);
    const before = s.nodes.a.functionality;
    mergeUpdatesIntoSnapshot(s, [{ id: "a", functionality: 1 }]);
    expect(s.nodes.a.functionality).toBe(before);
  });

  it("keeps the identity of every element it did not touch", () => {
    const s = snapshot([node("a"), node("b")], [edge("e", "a", "b")]);
    const out = mergeUpdatesIntoSnapshot(s, [{ id: "a", functionality: 1 }]);
    expect(out.nodes.a).not.toBe(s.nodes.a);
    expect(out.nodes.b).toBe(s.nodes.b);
    expect(out.edges).toBe(s.edges); // untouched registry is not even cloned
  });

  it("applies to edges as well as nodes", () => {
    const s = snapshot([node("a"), node("b")], [edge("e", "a", "b")]);
    const out = mergeUpdatesIntoSnapshot(s, [{ id: "e", functionality: 2 }]);
    expect(out.edges.e.functionality).toBe(2);
    expect(out.nodes).toBe(s.nodes);
  });

  it("applies several updates across both registries in one pass", () => {
    const s = snapshot([node("a"), node("b")], [edge("e", "a", "b")]);
    const out = mergeUpdatesIntoSnapshot(s, [
      { id: "a", functionality: 1 },
      { id: "e", functionality: 2 },
      { id: "b", functionality: 3 },
    ]);
    expect([out.nodes.a.functionality, out.nodes.b.functionality, out.edges.e.functionality])
      .toEqual([1, 3, 2]);
  });

  it("lets a later update win over an earlier one for the same element", () => {
    const s = snapshot([node("a")]);
    const out = mergeUpdatesIntoSnapshot(s, [
      { id: "a", functionality: 3 },
      { id: "a", functionality: 1 },
    ]);
    expect(out.nodes.a.functionality).toBe(1);
  });

  it("agrees field-for-field with the in-place path", () => {
    // The docstring's promise: a new engine output field handled once in
    // assignElementUpdate reaches BOTH consumers. If the snapshot path ever
    // stops routing through it, this diverges.
    const update: ElementUpdate = {
      id: "a",
      functionality: 2,
      functionality_time: 4,
      direct_damage: true,
      expected_repair_time: 12,
      responsibility_share: { b: 1 },
      properties: { damaged_by: "quake" },
    };
    const inPlace = node("a", { properties: { inp_id: "J-12" } });
    assignElementUpdate(inPlace, update);

    const merged = mergeUpdatesIntoSnapshot(
      snapshot([node("a", { properties: { inp_id: "J-12" } })]),
      [update],
    ).nodes.a;

    expect(merged).toEqual(inPlace);
  });
});
