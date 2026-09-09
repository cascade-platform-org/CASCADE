/**
 * Tests for the Event-application module.
 *
 * These deliberately skip the obvious ("a Hazard lowers Functionality") and
 * cover the contracts that are load-bearing and easy to break:
 *
 *  - the ABSENT round-trip, which keeps a reversed Scenario byte-identical to
 *    the original rather than sprinkling `null` into optional fields;
 *  - per-Element reference identity, which the affected-count toast reads;
 *  - phase ordering, so a field two phases both write ends at the later phase's
 *    value while still reversing to the pre-Event one;
 *  - the asymmetry between the Functionality phase (worsen-only) and the
 *    `direct_damage` phase (every affected Element, regardless);
 *  - the Responsibility Share on Temporal Jump expiry — the exact divergence
 *    between the two implementations this module replaced.
 */

import { describe, it, expect } from "vitest";

import {
  ABSENT,
  applyEventToSnapshot,
  reverseMutations,
  temporalJumpEvent,
} from "@/lib/event-application";
import type { Node, Edge, GraphSnapshot } from "@/lib/schemas/network";
import type { EventDefinition } from "@/lib/schemas/config";

const N = 3;

function node(id: string, over: Partial<Node> = {}): Node {
  return { id, label: id, functionality: N, ...over };
}
function edge(id: string, over: Partial<Edge> = {}): Edge {
  return { id, source: "a", target: "b", functionality: N, ...over };
}
function snap(nodes: Node[], edges: Edge[] = []): GraphSnapshot {
  return {
    nodes: Object.fromEntries(nodes.map((el) => [el.id, el])),
    edges: Object.fromEntries(edges.map((el) => [el.id, el])),
    canvases: [],
  };
}
function hazard(over: Partial<EventDefinition> = {}): EventDefinition {
  return { id: "quake", label: "Quake", type: "hazard", frequency_per_10y: 0, ...over };
}

describe("reversal restores the exact pre-Event shape", () => {
  it("deletes fields that did not exist rather than writing null back", () => {
    // `direct_damage` and `expected_repair_time` are absent here. A Hazard adds
    // them; reversing must remove the keys entirely. Writing `null` would pass
    // TypeScript and fail Zod (optional-but-not-nullable), and would change the
    // Scorecard dedup hash for a Scenario that is semantically unchanged.
    const before = snap([node("n1", { vulnerability_levels: { quake: 2 } })]);

    const { snapshot: after, reversal } = applyEventToSnapshot(before, hazard(), N);
    expect(after.nodes.n1.direct_damage).toBe(true);
    expect(reversal["n1.direct_damage"]).toBe(ABSENT);

    const reverted = reverseMutations(after, reversal);
    expect("direct_damage" in reverted.nodes.n1).toBe(false);
    expect("expected_repair_time" in reverted.nodes.n1).toBe(false);
    expect("responsibility_share" in reverted.nodes.n1).toBe(false);
    expect(reverted.nodes.n1).toEqual(before.nodes.n1);
  });

  it("restores a falsy prior value instead of deleting it", () => {
    // The sentinel exists to tell "was absent" from "was explicitly false".
    // Deleting a field that really was `false` would be the same bug inverted.
    const before = snap([
      node("n1", { vulnerability_levels: { quake: 2 }, direct_damage: false }),
    ]);

    const { snapshot: after, reversal } = applyEventToSnapshot(before, hazard(), N);
    expect(reversal["n1.direct_damage"]).toBe(false);

    const reverted = reverseMutations(after, reversal);
    expect("direct_damage" in reverted.nodes.n1).toBe(true);
    expect(reverted.nodes.n1.direct_damage).toBe(false);
  });

  it("reverses a field two phases both wrote to its pre-Event value", () => {
    // vulnerability_levels imposes 1, then attribute_mutations overwrites it
    // with 2 — mutations run last and win. The reversal must hold the original
    // 3, not the 1 the earlier phase proposed.
    //
    // Note this does NOT pin the first-capture-wins guard in `capture`: because
    // every phase reads the original Element, both captures record 3 either way.
    // See that guard's comment for why it is kept regardless.
    const before = snap([node("n1", { functionality: 3, vulnerability_levels: { quake: 2 } })]);
    const event = hazard({ attribute_mutations: { "n1.functionality": 2 } });

    const { snapshot: after, reversal } = applyEventToSnapshot(before, event, N);
    expect(after.nodes.n1.functionality).toBe(2); // mutations run last and win
    expect(reversal["n1.functionality"]).toBe(3);

    expect(reverseMutations(after, reversal).nodes.n1.functionality).toBe(3);
  });

  it("skips reversal keys naming an Element that no longer exists", () => {
    const before = snap([node("n1", { vulnerability_levels: { quake: 1 } })]);
    const { reversal } = applyEventToSnapshot(before, hazard(), N);

    // The Element is deleted after the Event was applied.
    const withoutN1 = snap([node("n2")]);
    expect(() => reverseMutations(withoutN1, reversal)).not.toThrow();
    expect(reverseMutations(withoutN1, reversal).nodes.n2).toBe(withoutN1.nodes.n2);
  });
});

describe("reference identity is part of the interface", () => {
  it("returns untouched Elements by reference, and the snapshot itself when nothing changed", () => {
    // countChangedElements (action-bar) counts affected Elements by identity.
    // A wholesale clone would report every Element as affected.
    const before = snap(
      [node("hit", { vulnerability_levels: { quake: 2 } }), node("miss")],
      [edge("e1")],
    );

    const { snapshot: after } = applyEventToSnapshot(before, hazard(), N);
    expect(after.nodes.hit).not.toBe(before.nodes.hit);
    expect(after.nodes.miss).toBe(before.nodes.miss);
    expect(after.edges.e1).toBe(before.edges.e1);

    // An Event nothing is vulnerable to is a genuine no-op.
    const inert = applyEventToSnapshot(before, hazard({ id: "flood" }), N);
    expect(inert.snapshot).toBe(before);
    expect(inert.reversal).toEqual({});
  });
});

describe("Functionality phase worsens only; direct_damage does not", () => {
  it("flags an already-critical Element as damaged even though its level cannot worsen", () => {
    // The two phases answer different questions. Phase 1 asks "does this drop
    // it?" — no, it is already at 1. Phase 2 asks "did the Hazard hit it?" —
    // yes, and that is what puts it on the repair list (requirements §10).
    const before = snap([node("n1", { functionality: 1, vulnerability_levels: { quake: 1 } })]);

    const { snapshot: after, reversal } = applyEventToSnapshot(before, hazard(), N);
    expect(after.nodes.n1.functionality).toBe(1);
    expect(after.nodes.n1.direct_damage).toBe(true);
    // No Functionality change, so no re-attribution of blame either.
    expect("n1.functionality" in reversal).toBe(false);
    expect(after.nodes.n1.responsibility_share).toBeUndefined();
  });

  it("leaves a Disservice undamaged and clamps the imposed level at 1", () => {
    const before = snap([
      node("n1", { vulnerability_levels: { outage: 2 } }),
      node("n2", { vulnerability_levels: { outage: 99 } }), // level > N−1
    ]);
    const disservice: EventDefinition = {
      id: "outage",
      label: "Outage",
      type: "disservice",
      frequency_per_10y: 0,
    };

    const { snapshot: after } = applyEventToSnapshot(before, disservice, N);
    expect(after.nodes.n1.functionality).toBe(1); // N − 2
    expect(after.nodes.n2.functionality).toBe(1); // clamped, not negative
    expect(after.nodes.n1.direct_damage).toBeUndefined();
  });
});

describe("repair time precedence", () => {
  it("prefers the per-Element override over the Event default, and omits both when unset", () => {
    const before = snap([
      node("override", { vulnerability_levels: { quake: 1 } }),
      node("fallback", { vulnerability_levels: { quake: 1 } }),
    ]);
    const withDefault = hazard({
      default_repair_time: 6,
      direct_damage_effects: { override: { expected_repair_time: 48 } },
    });

    const after = applyEventToSnapshot(before, withDefault, N).snapshot;
    expect(after.nodes.override.expected_repair_time).toBe(48);
    expect(after.nodes.fallback.expected_repair_time).toBe(6);

    // With neither set, the field is left exactly as it was.
    const bare = applyEventToSnapshot(before, hazard(), N).snapshot;
    expect("expected_repair_time" in bare.nodes.fallback).toBe(false);
  });
});

describe("attribute_mutations key parsing", () => {
  it("splits on the last dot, so a dotted Element id survives", () => {
    // EPANET imports carry raw labels like "J.12.A" as ids. Splitting on the
    // first dot would address Element "J" and field "12.A".
    const before = snap([node("J.12.A", { properties: {} })]);
    const event = hazard({ attribute_mutations: { "J.12.A.functionality": 2 } });

    const { snapshot: after, reversal } = applyEventToSnapshot(before, event, N);
    expect(after.nodes["J.12.A"].functionality).toBe(2);
    expect(reversal["J.12.A.functionality"]).toBe(N);
  });

  it("ignores a key with no field and one naming an unknown Element", () => {
    const before = snap([node("n1")]);
    const event = hazard({ attribute_mutations: { nofield: 1, "ghost.functionality": 1 } });

    const { snapshot: after, reversal } = applyEventToSnapshot(before, event, N);
    expect(after).toBe(before);
    expect(reversal).toEqual({});
  });
});

describe("Temporal Jump", () => {
  it("attributes an expiry to the Event — the divergence this module removed", () => {
    // The Save dialog's old private copy of this transform wrote Functionality 1
    // on expiry but left the previous Propagation's Responsibility Share in
    // place, so the Inspector kept naming a stale cause.
    const before = snap([
      node("expiring", {
        functionality: N,
        functionality_time: 4,
        responsibility_share: { "some-upstream": 1 },
      }),
    ]);
    const jump = temporalJumpEvent(6);

    const after = applyEventToSnapshot(before, jump, N).snapshot;
    expect(after.nodes.expiring.functionality).toBe(1);
    expect(after.nodes.expiring.functionality_time).toBe(0);
    expect(after.nodes.expiring.responsibility_share).toEqual({ [jump.id]: 1 });
  });

  it("clamps an overshoot to zero and leaves Elements not on backup alone", () => {
    const before = snap(
      [
        node("holding", { functionality_time: 10 }),
        node("idle", { functionality_time: 0 }),
        node("noField"),
      ],
      [edge("e1", { functionality_time: 2 })],
    );

    const after = applyEventToSnapshot(before, temporalJumpEvent(4), N).snapshot;
    expect(after.nodes.holding.functionality_time).toBe(6);
    expect(after.nodes.holding.functionality).toBe(N); // not yet expired
    expect(after.nodes.idle).toBe(before.nodes.idle); // untouched, by reference
    expect(after.nodes.noField).toBe(before.nodes.noField);
    expect(after.edges.e1.functionality_time).toBe(0); // edges expire too
    expect(after.edges.e1.functionality).toBe(1);
  });

  it("round-trips an expiry back to a still-holding Element", () => {
    const before = snap([node("n1", { functionality: 2, functionality_time: 3 })]);
    const { snapshot: after, reversal } = applyEventToSnapshot(before, temporalJumpEvent(5), N);

    const reverted = reverseMutations(after, reversal);
    expect(reverted.nodes.n1).toEqual(before.nodes.n1);
    expect("responsibility_share" in reverted.nodes.n1).toBe(false);
  });
});
