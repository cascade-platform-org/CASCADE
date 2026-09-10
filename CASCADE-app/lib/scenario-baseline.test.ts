/**
 * scenario-baseline — the Reset/Clear Event decision table from ADR-0016.
 *
 * The interesting cases are all about WHO wrote a field, not what the field is:
 * a Propagation writing `capacity` is reverted, a hand edit writing `capacity`
 * is not, and both write through the same store action.
 */

import { describe, it, expect } from "vitest";

import {
  deriveBaseline,
  resetPlan,
  clearEventPlan,
  applyBaselineEntries,
  forceOperational,
  baselineKey,
  sourceOf,
  SCENARIO_FIELDS,
  type BaselineEntry,
} from "@/lib/scenario-baseline";
import { diffGraph } from "@/lib/graph-diff";
import { DIFF_ABSENT } from "@/lib/schemas/network";
import type { AnyUpdateEntry, GraphSnapshot, Node } from "@/lib/schemas/network";

function node(id: string, extra: Partial<Node> = {}): Node {
  return { id, label: id, functionality: 3, ...extra };
}
function snap(nodes: Node[]): GraphSnapshot {
  return {
    nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
    edges: {},
    canvases: [{ id: "c1", label: "C1", graph: { graph_type: "g", node_ids: nodes.map((n) => n.id), edge_ids: [] } }],
  };
}

let seq = 0;
/** A history entry for the transition before → after. History is newest-first. */
function entry(
  update_type: AnyUpdateEntry["update_type"],
  before: GraphSnapshot,
  after: GraphSnapshot,
  extra: Partial<AnyUpdateEntry> = {},
): AnyUpdateEntry {
  return {
    id: `e${seq++}`,
    timestamp: new Date().toISOString(),
    update_type,
    label: update_type,
    diff: diffGraph(before, after),
    ...extra,
  };
}

describe("sourceOf", () => {
  it("tags by the kind of Update, and treats everything else as manual", () => {
    expect(sourceOf({ update_type: "event_applied", event_id: "quake" })).toBe("event:quake");
    expect(sourceOf({ update_type: "propagation" })).toBe("propagation");
    expect(sourceOf({ update_type: "manual_functionality_update" })).toBe("manual");
    expect(sourceOf({ update_type: "graph_update" })).toBe("manual");
  });
});

describe("deriveBaseline", () => {
  it("keeps the value from before the scenario, not before the last overwrite", () => {
    // 3 → (Event) 2 → (Propagation) 1. The Baseline must hold 3.
    const s0 = snap([node("n1", { functionality: 3 })]);
    const s1 = snap([node("n1", { functionality: 2 })]);
    const s2 = snap([node("n1", { functionality: 1 })]);
    const history = [
      entry("propagation", s1, s2),
      entry("event_applied", s0, s1, { event_id: "quake" }),
    ];
    const b = deriveBaseline(history);
    const held = b.get(baselineKey("n1", "functionality"));
    expect(held?.value).toBe(3);
    expect(held?.source).toBe("event:quake"); // the FIRST writer of the field
  });

  it("stops at the newest scenario_reset — older Updates are a dead session", () => {
    const s0 = snap([node("n1", { functionality: 3 })]);
    const s1 = snap([node("n1", { functionality: 1 })]);
    const s2 = snap([node("n1", { functionality: 2 })]);
    const history = [
      entry("event_applied", s1, s2, { event_id: "flood" }),
      entry("scenario_reset", s1, s1),
      entry("event_applied", s0, s1, { event_id: "quake" }), // dead session
    ];
    expect(deriveBaseline(history).get(baselineKey("n1", "functionality"))?.value).toBe(1);
  });

  it("folds retired entries first, so an evicted Update still wins", () => {
    const s1 = snap([node("n1", { functionality: 2 })]);
    const s2 = snap([node("n1", { functionality: 1 })]);
    const retired: BaselineEntry[] = [
      { id: "n1", field: "functionality", value: 3, source: "event:quake" },
    ];
    const b = deriveBaseline([entry("propagation", s1, s2)], retired);
    expect(b.get(baselineKey("n1", "functionality"))?.value).toBe(3);
  });

  it("ignores an Update that UNDOES work, so Reset cannot restore into a cleared cascade", () => {
    // Regression. An event_cleared entry's `before` side is the cascaded state.
    // Folding it recorded functionality 1 as "the pre-scenario value", so
    // pressing Reset after Ctrl+R put the cascade back on.
    const pre = snap([node("n1", { functionality: 3 })]);
    const cascaded = snap([node("n1", { functionality: 1 })]);
    const history = [
      entry("event_cleared", cascaded, pre, { event_id: "quake" }),
      entry("propagation", pre, cascaded),
    ];
    const b = deriveBaseline(history);
    expect(b.get(baselineKey("n1", "functionality"))?.value).toBe(3); // never 1
    expect(applyBaselineEntries(pre, resetPlan(b)).nodes.n1.functionality).toBe(3);
  });

  it("ignores a legacy entry that carries no diff", () => {
    const legacy: AnyUpdateEntry = {
      id: "old", timestamp: "", update_type: "event_applied", label: "legacy",
      before: snap([node("n1")]), after: snap([node("n1", { functionality: 1 })]),
    };
    expect(deriveBaseline([legacy]).size).toBe(0);
  });

  it("records a field that did not exist as ABSENT", () => {
    const before = snap([node("n1")]);
    const after = snap([node("n1", { direct_damage: true, expected_repair_time: 12 })]);
    const b = deriveBaseline([entry("event_applied", before, after, { event_id: "quake" })]);
    expect(b.get(baselineKey("n1", "direct_damage"))?.value).toBe(DIFF_ABSENT);
    expect(b.get(baselineKey("n1", "expected_repair_time"))?.value).toBe(DIFF_ABSENT);
  });
});

describe("resetPlan — the ADR-0016 decision table", () => {
  const s0 = snap([node("n1", { functionality: 3, properties: { inp_id: "J1" } })]);

  it("reverts a Propagation's write to any MODEL field", () => {
    // The ADR-0015 case: a Specific Rule assigning a custom properties key and a
    // first-class model field during the cascade. Neither is named anywhere in
    // scenario-baseline.ts — provenance is what catches them.
    const s1 = snap([
      node("n1", { functionality: 1, capacity: 40, properties: { inp_id: "J1", damaged_by: "quake" } } as Partial<Node>),
    ]);
    const plan = resetPlan(deriveBaseline([entry("propagation", s0, s1)]));
    const fields = plan.map((e) => e.key ?? e.field).sort();
    // `functionality` is in there too — the plan carries every machine write —
    // but the model attributes are the ones ONLY the Baseline could undo.
    expect(fields).toEqual(["capacity", "damaged_by", "functionality"]);
  });

  it("leaves a hand-edited Scenario Field to forceOperational, not the Baseline", () => {
    // Scenario Fields are swept to an operational state outright, so the plan
    // does not carry them — that independence is what keeps Reset working when
    // the Baseline is incomplete.
    const s1 = snap([node("n1", { functionality: 1, properties: { inp_id: "J1" } })]);
    expect(resetPlan(deriveBaseline([entry("manual_functionality_update", s0, s1)]))).toEqual([]);
    expect(forceOperational(s1, 3).nodes.n1.functionality).toBe(3);
  });

  it("leaves a hand-edited model field alone", () => {
    const s1 = snap([
      node("n1", { functionality: 3, label: "Renamed", properties: { inp_id: "J1", note: "mine" } }),
    ]);
    expect(resetPlan(deriveBaseline([entry("graph_update", s0, s1)]))).toEqual([]);
  });

  it("reverts a hand edit made on top of a machine write, with that machine write", () => {
    // Documented in ADR-0016: the Baseline records a FIELD's pre-scenario value,
    // not a log of writes. A correction to a number the cascade invented goes
    // back with the cascade.
    const s1 = snap([node("n1", { functionality: 1, capacity: 40, properties: { inp_id: "J1" } } as Partial<Node>)]);
    const s2 = snap([node("n1", { functionality: 1, capacity: 45, properties: { inp_id: "J1" } } as Partial<Node>)]);
    const history = [entry("graph_update", s1, s2), entry("propagation", s0, s1)];
    const plan = resetPlan(deriveBaseline(history));
    const cap = plan.find((e) => e.field === "capacity");
    expect(cap?.value).toBe(DIFF_ABSENT); // back to "no capacity", not to 40 or 45
  });

  it("covers every Scenario Field", () => {
    expect(SCENARIO_FIELDS).toEqual([
      "functionality", "functionality_time", "direct_damage",
      "expected_repair_time", "responsibility_share",
    ]);
  });
});

describe("clearEventPlan", () => {
  it("takes the Event's own writes and every Propagation write, and nothing else", () => {
    const s0 = snap([node("n1"), node("n2"), node("n3")]);
    const s1 = snap([node("n1", { functionality: 1 }), node("n2"), node("n3")]);          // quake
    const s2 = snap([node("n1", { functionality: 1 }), node("n2", { functionality: 2 }), node("n3")]); // cascade
    const s3 = snap([node("n1", { functionality: 1 }), node("n2", { functionality: 2 }), node("n3", { label: "renamed" })]); // hand
    const history = [
      entry("graph_update", s2, s3),
      entry("propagation", s1, s2),
      entry("event_applied", s0, s1, { event_id: "quake" }),
    ];
    const plan = clearEventPlan(deriveBaseline(history), "quake");
    expect(plan.map((e) => e.id).sort()).toEqual(["n1", "n2"]);
  });

  it("leaves another Event's writes standing", () => {
    const s0 = snap([node("n1"), node("n2")]);
    const s1 = snap([node("n1", { functionality: 1 }), node("n2")]);
    const s2 = snap([node("n1", { functionality: 1 }), node("n2", { functionality: 1 })]);
    const history = [
      entry("event_applied", s1, s2, { event_id: "flood" }),
      entry("event_applied", s0, s1, { event_id: "quake" }),
    ];
    expect(clearEventPlan(deriveBaseline(history), "flood").map((e) => e.id)).toEqual(["n2"]);
  });
});

describe("applyBaselineEntries", () => {
  it("writes values back, deletes ABSENT keys, and skips missing Elements", () => {
    const live = snap([node("n1", { functionality: 1, direct_damage: true, properties: { d: "quake" } })]);
    const out = applyBaselineEntries(live, [
      { id: "n1", field: "functionality", value: 3, source: "event:quake" },
      { id: "n1", field: "direct_damage", value: DIFF_ABSENT, source: "event:quake" },
      { id: "n1", field: "properties", key: "d", value: DIFF_ABSENT, source: "propagation" },
      { id: "gone", field: "functionality", value: 3, source: "manual" },
    ]);
    expect(out.nodes.n1.functionality).toBe(3);
    expect("direct_damage" in out.nodes.n1).toBe(false);
    expect(out.nodes.n1.properties).toEqual({});
    expect(out.nodes.n1).not.toBe(live.nodes.n1); // copy-on-write
  });

  it("returns the input untouched when there is nothing to revert", () => {
    const live = snap([node("n1")]);
    expect(applyBaselineEntries(live, [])).toBe(live);
  });
});

describe("forceOperational", () => {
  it("repairs every Element regardless of what the Baseline knows", () => {
    const damaged = snap([
      node("n1", {
        functionality: 1,
        functionality_time: 6,
        direct_damage: true,
        expected_repair_time: 12,
        responsibility_share: { quake: 1 },
      }),
    ]);
    const out = forceOperational(damaged, 3);
    expect(out.nodes.n1.functionality).toBe(3);
    expect(out.nodes.n1.functionality_time).toBe(0);
    expect("direct_damage" in out.nodes.n1).toBe(false);
    expect("expected_repair_time" in out.nodes.n1).toBe(false);
    expect("responsibility_share" in out.nodes.n1).toBe(false);
  });

  it("leaves the model alone", () => {
    const out = forceOperational(
      snap([node("n1", { functionality: 1, label: "Pump A", properties: { inp_id: "J1" } })]),
      3,
    );
    expect(out.nodes.n1.label).toBe("Pump A");
    expect(out.nodes.n1.properties).toEqual({ inp_id: "J1" });
  });

  it("returns the input untouched when everything is already operational", () => {
    const healthy = snap([node("n1", { functionality: 3, functionality_time: 0 })]);
    expect(forceOperational(healthy, 3)).toBe(healthy);
  });
});
