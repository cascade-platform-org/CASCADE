import { describe, expect, it } from "vitest";
import { docToDraft, docWarnings, draftToDoc, extractJson, parseDocText, serializeDoc } from "./temporal-simulation-text";
import { TEMPORAL_SIMULATION_FORMAT, type TemporalSimulationDoc } from "./temporal-simulation-schema";
import type { FilterableModel } from "./element-filter";
import type { Node } from "./schemas/network";

const doc: TemporalSimulationDoc = {
  format: TEMPORAL_SIMULATION_FORMAT,
  timeline: {
    name: "t",
    steps: [{ label: "2023-01", unit: "month", repeat: 2, phases: [{ events: ["settle"], propagate: true }] }],
    every: [],
  },
  profile: {
    "2023-01": [
      { where: { kind: "node", node_type: "Service" }, path: ["supply_capacity", "hours", "rate"], op: "mul", value: 1.1 },
      { element: "pool", path: ["supply_capacity", "hours", "rate"], op: "set", value: 160 },
    ],
    "2023-02": [{ element: "pool", path: ["supply_capacity", "hours", "rate"], op: "add", value: 5 }],
  },
  metrics: [],
};

const model: FilterableModel = {
  nodes: { pool: { id: "pool", functionality: 4, node_type: "Personnel" } as Node, a: { id: "a", functionality: 4, node_type: "Service" } as Node },
  edges: {},
  canvases: {},
};

describe("text round-trip", () => {
  it("draft → doc → text → doc → draft keeps every operation in order", () => {
    let n = 0;
    const draft = docToDraft(doc, () => `id${n++}`);
    expect(draft.profile.map((e) => e.label)).toEqual(["2023-01", "2023-01", "2023-02"]);
    const parsed = parseDocText(serializeDoc(draftToDoc(draft)));
    expect(parsed.ok && parsed.doc).toEqual(doc);
  });
});

describe("parseDocText", () => {
  it("reads the JSON block out of a whole LLM reply", () => {
    const reply = `Here is the updated definition:\n\n\`\`\`json\n${serializeDoc(doc)}\n\`\`\`\nLet me know.`;
    expect(parseDocText(reply).ok).toBe(true);
    expect(extractJson(`text {"a": 1} more`)).toBe(`{"a": 1}`);
  });
  it("reports a misspelt key, a bad enum and an operation with both targets, by path", () => {
    const bad = JSON.parse(serializeDoc(doc));
    bad.timeline.steps[0].unit = "months";
    bad.timeline.steps[0].repat = 3;
    bad.profile["2023-01"][1].where = { kind: "node" };
    const r = parseDocText(JSON.stringify(bad));
    expect(r.ok).toBe(false);
    const msg = r.ok ? "" : r.errors.join("\n");
    expect(msg).toMatch(/timeline\.steps\.0\.unit/);
    expect(msg).toMatch(/repat/);
    expect(msg).toMatch(/exactly one of `element`/);
  });
  it("rejects arithmetic on a non-number value", () => {
    const bad = JSON.parse(serializeDoc(doc));
    bad.profile["2023-02"][0].value = "5";
    const r = parseDocText(JSON.stringify(bad));
    expect(r.ok ? "" : r.errors.join()).toMatch(/need a number/);
  });
  it("explains invalid JSON", () => {
    const r = parseDocText("{ not json");
    expect(r.ok ? "" : r.errors[0]).toMatch(/Not valid JSON/);
  });
});

describe("docWarnings", () => {
  it("flags unknown Events, unused labels, missing Elements and empty filters", () => {
    const d: TemporalSimulationDoc = {
      ...doc,
      profile: {
        ...doc.profile,
        "2024-12": [{ element: "ghost", path: ["x"], op: "set", value: 1 }],
        "2023-02": [{ where: { kind: "node", node_type: "Source" }, path: ["x"], op: "set", value: 1 }],
      },
    };
    const w = docWarnings(d, [], model).join("\n");
    expect(w).toMatch(/Unknown Event ids: settle/);
    expect(w).toMatch(/"2024-12" is not a period/);
    expect(w).toMatch(/no Element "ghost"/);
    expect(w).toMatch(/matches no Element/);
  });
});
