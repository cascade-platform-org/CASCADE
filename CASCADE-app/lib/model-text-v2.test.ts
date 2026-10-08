/**
 * model-text-v2 — Bulk operations as plain changes (ADR-0022). Each case
 * states the outcome: the stored values after the change, what was refused or
 * skipped and why, and how the preview groups it. fast-check throws random
 * plain changes at the whole path: refused with reasons, or a bundle the
 * schemas accept, with the starting bundle untouched.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { DEFAULT_CONFIG } from "@/store/config-store";
import { ModelConfigurationSchema } from "./schemas/config";
import { ProjectSchema } from "./schemas/network";
import { checkChange, parseJsonText } from "./model-text";
import { PLAIN_FORMAT, asChangeSet, compilePlain, fieldCensus, groupPreview, parsePlainValue, repairContext, starterPlain } from "./model-text-v2";
import type { ProjectBundle } from "./file-io";

const N = DEFAULT_CONFIG.functionality_scale.length;

function bundle(): ProjectBundle {
  return {
    project: {
      version: "2.0",
      meta: { name: "p" },
      nodes: {
        s1: { id: "s1", label: "Well", functionality: N, node_type: "Source", supply_capacity: { water: 10 } },
        s2: { id: "s2", label: "Tank", functionality: N, node_type: "Source", supply_capacity: { water: { rate: 4, level: 20, retention: 1, efficiency: 1 } } },
        c: { id: "c", label: "City", functionality: N, node_type: "Service", category_dependency_profiles: { water: { dependency_level: 1, demand: 5 } } },
        h: { id: "h", label: "Hospital", functionality: N, node_type: "Service", vulnerability_levels: { q: 1 } },
      },
      edges: {
        e1: { id: "e1", source: "s1", target: "c", functionality: N },
        e2: { id: "e2", source: "s2", target: "c", functionality: N, capacity: 8 },
        e3: { id: "e3", source: "c", target: "h", functionality: N },
      },
      canvases: [{ id: "main", label: "Main", graph: { graph_type: "generic", node_ids: ["s1", "s2", "c", "h"], edge_ids: ["e1", "e2", "e3"] } }],
      update_history: [],
      scorecard: [],
    },
    config: structuredClone({ ...DEFAULT_CONFIG, events: [{ id: "q", label: "Quake", type: "hazard" as const, frequency_per_10y: 1 }] }),
  };
}

/** Parse, compile and check plain changes; the outcome or every error. */
function run(b: ProjectBundle, changes: unknown[], notes?: string) {
  const parsed = parsePlainValue({ format: PLAIN_FORMAT, ...(notes ? { notes } : {}), changes });
  if (!parsed.ok) return { errors: parsed.errors };
  const compiled = compilePlain(b, parsed.set);
  if (!compiled.ok) return { errors: compiled.errors };
  const checked = checkChange(b, asChangeSet(compiled.patch));
  if (!checked.ok) return { errors: checked.errors };
  return { after: checked.after, groups: groupPreview(checked.preview, compiled.groups), compiled };
}

const supply = (b: ProjectBundle, id: string) => b.project.nodes[id].supply_capacity?.water;

describe("changing values by field name", () => {
  it("halves every Source's supply in one change, a plain number and a Stock's rate alike", () => {
    const r = run(bundle(), [{ scale: "supply", by: 0.5, where: { kind: "node", node_type: "Source" } }]);
    expect(r.errors).toBeUndefined();
    expect(supply(r.after!, "s1")).toBe(5);
    expect(supply(r.after!, "s2")).toMatchObject({ rate: 2, level: 20 });
    expect(r.groups![0].title).toBe("scale supply × 0.5 — 2 changed of 2 matched");
  });

  it("sets a field an Element does not have yet, and reaches profiles and vulnerabilities by name", () => {
    const r = run(bundle(), [
      { set: "importance", to: 2, where: { kind: "node", node_type: "Service" } },
      { increase: "demand", by: 2, id: "c", category: "water" },
      { set: "vulnerability", event: "q", to: 2, id: "c" },
      { set: "capacity", to: 6, id: "e1" },
    ]);
    expect(r.errors).toBeUndefined();
    const { nodes, edges } = r.after!.project;
    expect([nodes.c.importance, nodes.h.importance]).toEqual([2, 2]);
    expect(nodes.c.category_dependency_profiles?.water.demand).toBe(7);
    expect(nodes.c.vulnerability_levels).toEqual({ q: 2 });
    expect(edges.e1.capacity).toBe(6);
  });

  it("refuses a change that does not fit a match, naming it; skip_unfit leaves it out and says so", () => {
    const refused = run(bundle(), [{ scale: "demand", by: 2, where: { kind: "node", node_type: "Service" } }]);
    expect(refused.errors?.join("\n")).toMatch(/changes\[0\] on h: has no category_dependency_profiles .*skip_unfit/);
    const skipped = run(bundle(), [{ scale: "demand", by: 2, where: { kind: "node", node_type: "Service" }, skip_unfit: true }]);
    expect(skipped.after!.project.nodes.c.category_dependency_profiles?.water.demand).toBe(10);
    expect(skipped.groups![0].skipped).toEqual([{ id: "h", reason: "has no category_dependency_profiles" }]);
    expect(skipped.groups![0].title).toMatch(/1 changed, 1 skipped of 2 matched/);
  });

  it("refuses what the schema would: a level on a plain supply, a Functionality above the scale", () => {
    expect(run(bundle(), [{ set: "level", to: 3, id: "s1" }]).errors?.join()).toMatch(/not a Stock/);
    expect(run(bundle(), [{ set: "functionality", to: N + 1, id: "c" }]).errors?.join()).toMatch(/above the top Functionality level/);
  });
});

describe("things by id", () => {
  it("adds a node on the only Canvas, then changes it in a later change", () => {
    const r = run(bundle(), [
      { add: "node", value: { id: "g", label: "Generator", node_type: "Source", supply_capacity: { electric: 4 } } },
      { set: "importance", to: 3, id: "g" },
      { connect: { from: "g", to: "c", capacity: 4 } },
    ]);
    expect(r.errors).toBeUndefined();
    const { nodes, edges, canvases } = r.after!.project;
    expect(nodes.g).toMatchObject({ functionality: N, importance: 3 });
    expect(edges["edge-g-c"]).toMatchObject({ source: "g", target: "c", capacity: 4, functionality: N });
    expect(canvases[0].graph.node_ids).toContain("g");
    expect(canvases[0].graph.edge_ids).toContain("edge-g-c");
  });

  it("updates by merging, removes a field with null, and refuses a changed id or a duplicate", () => {
    const r = run(bundle(), [{ update: "event", id: "q", value: { label: "Earthquake", icon: "Zap" } }, { update: "node", id: "h", value: { vulnerability_levels: null } }]);
    expect(r.after!.config.events[0]).toMatchObject({ id: "q", label: "Earthquake", icon: "Zap", type: "hazard" });
    expect(r.after!.project.nodes.h).not.toHaveProperty("vulnerability_levels");
    expect(run(bundle(), [{ update: "node", id: "c", value: { id: "x" } }]).errors?.join()).toMatch(/cannot change/);
    expect(run(bundle(), [{ add: "event", value: { id: "q", label: "Again", type: "hazard" } }]).errors?.join()).toMatch(/already exists; use "update"/);
  });

  it("deletes by filter with everything that refers to it, and an Event with its vulnerability levels", () => {
    const r = run(bundle(), [{ delete: "node", where: { label_contains: "hosp" } }, { delete: "event", id: "q" }]);
    expect(r.errors).toBeUndefined();
    const { nodes, edges, canvases } = r.after!.project;
    expect(Object.keys(nodes)).toEqual(["s1", "s2", "c"]);
    expect(Object.keys(edges)).toEqual(["e1", "e2"]);
    expect(canvases[0].graph).toMatchObject({ node_ids: ["s1", "s2", "c"], edge_ids: ["e1", "e2"] });
    expect(r.after!.config.events).toEqual([]);
    expect(r.groups!.map((g) => g.title)).toEqual(['delete 1 node', 'delete event "q"']);
    expect(r.groups![0].lines.map((l) => `${l.kind} ${l.where}`)).toEqual(expect.arrayContaining(['remove Node "Hospital" (h)', "remove Edge e3"]));
  });

  it("disconnects, and refuses an edge that is not there", () => {
    expect(Object.keys(run(bundle(), [{ disconnect: { from: "c", to: "h" } }]).after!.project.edges)).toEqual(["e1", "e2"]);
    expect(run(bundle(), [{ disconnect: { from: "h", to: "c" } }]).errors?.join()).toMatch(/no edge from "h" to "c"/);
  });
});

describe("reading the text", () => {
  it("names the shape that was meant when a change is malformed", () => {
    const errors = (changes: unknown[]) => run(bundle(), changes).errors?.join("\n");
    expect(errors([{ halve: "supply", id: "s1" }])).toMatch(/no verb/);
    expect(errors([{ scale: "supply", id: "s1" }])).toMatch(/needs "by"/);
    expect(errors([{ set: "importance", to: 1, id: "c", where: { kind: "node" } }])).toMatch(/exactly one of "id"/);
    expect(errors([{ set: "vulnerability", to: 1, id: "c" }])).toMatch(/needs "event"/);
    expect(errors([{ set: "supplies", to: 1, id: "c" }])).toMatch(/changes\[0\]\.set/);
  });

  it("shows each change as a group of the preview, the notes kept", () => {
    const r = run(bundle(), [{ scale: "supply", by: 2, id: "s1" }, { set: "label", to: "Big city", id: "c", why: "renamed" }], "two edits");
    expect(r.compiled?.ok && r.compiled.notes).toBe("two edits");
    expect(r.groups!.map((g) => [g.title, g.why, g.lines.length])).toEqual([
      ["scale supply × 2 — 1 changed of 1 matched", undefined, 1],
      ['set label → "Big city" — 1 changed of 1 matched', "renamed", 1],
    ]);
  });
});

describe("what the LLM is given", () => {
  it("a census of shapes and ranges, and the values a filter can use", () => {
    const census = fieldCensus(bundle());
    expect(census).toMatch(/Source \(2 nodes\)\n {2}- supply\.water: number ×1 \(10\), Stock ×1 \(rate 4\)/);
    expect(census).toMatch(/demand\.water: number ×1 \(5\); absent on 1/);
    expect(census).toMatch(/node_type: Source, Service/);
  });

  it("a worked example on this model that passes the check", () => {
    const b = bundle();
    const value = parseJsonText(starterPlain(b));
    expect(value.ok).toBe(true);
    const parsed = parsePlainValue(value.ok ? value.value : null);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const compiled = compilePlain(b, parsed.set);
    expect(compiled.ok && checkChange(b, asChangeSet(compiled.patch)).ok).toBe(true);
  });

  it("after a refusal: the errors, the change set and the stored JSON of each Element they name", () => {
    const text = JSON.stringify({ format: PLAIN_FORMAT, changes: [{ scale: "demand", by: 2, where: { kind: "node", node_type: "Service" } }] });
    const errors = run(bundle(), JSON.parse(text).changes).errors!;
    const context = repairContext(bundle(), text, errors);
    expect(context).toMatch(/on h: has no category_dependency_profiles/);
    expect(context).toMatch(/"h": \{\n {2}"id": "h"/);
    expect(context).not.toMatch(/"s1": \{/);
    // A whole reply, prose and fence included, is shown as its JSON alone.
    expect(repairContext(bundle(), `Here:\n\`\`\`json\n${text}\n\`\`\``, errors)).not.toMatch(/Here:/);
  });
});

describe("any plain change", () => {
  const field = fc.constantFrom("supply", "level", "demand", "importance", "functionality", "capacity", "label", "priority");
  const target = fc.oneof(
    fc.record({ id: fc.constantFrom("s1", "s2", "c", "h", "e1", "ghost") }),
    fc.record({ where: fc.record({ kind: fc.constantFrom("node", "edge"), node_type: fc.constantFrom("Source", "Service") }) }),
  );
  const value = fc.oneof(fc.integer({ min: -2, max: 8 }), fc.double({ min: -5, max: 50, noNaN: true }), fc.string({ maxLength: 3 }));
  const valueChange = fc.tuple(fc.constantFrom("set", "scale", "increase", "cap", "floor"), field, target, value, fc.boolean()).map(([verb, f, t, v, skip]) => ({
    [verb]: f, ...(verb === "scale" || verb === "increase" ? { by: typeof v === "number" ? v : 1 } : { to: v }), ...t, ...(skip ? { skip_unfit: true } : {}),
  }));
  const thingChange = fc.oneof(
    fc.record({ delete: fc.constantFrom("node", "edge", "event"), id: fc.constantFrom("s1", "c", "h", "e2", "q", "zz") }),
    fc.record({ connect: fc.record({ from: fc.constantFrom("s1", "c", "zz"), to: fc.constantFrom("h", "s2") }) }),
    fc.record({ update: fc.constantFrom("node", "event"), id: fc.constantFrom("c", "q"), value: fc.dictionary(fc.constantFrom("label", "importance", "icon"), value) }),
  );

  it("is refused with reasons, or yields a bundle the schemas accept; the model it started from never changes", () => {
    fc.assert(
      fc.property(fc.array(fc.oneof(valueChange, thingChange), { minLength: 1, maxLength: 4 }), (changes) => {
        const b = bundle();
        const frozen = structuredClone(b);
        const r = run(b, changes);
        if (r.errors) expect(r.errors.length).toBeGreaterThan(0);
        else {
          expect(ProjectSchema.safeParse(r.after!.project).success).toBe(true);
          expect(ModelConfigurationSchema.safeParse(r.after!.config).success).toBe(true);
        }
        expect(b).toEqual(frozen);
      }),
      { numRuns: 300 },
    );
  });
});
