import { describe, expect, it } from "vitest";
import { EXAMPLE_DOC, checkDoc, docToDraft, docWarnings, draftToDoc, extractJson, llmContext, parseDocText, serializeDoc } from "./temporal-simulation-text";
import { STANDARD_METRICS, TEMPORAL_SIMULATION_FORMAT, type TemporalSimulation } from "@/lib/schemas/temporal-simulation";
import type { FilterableModel } from "./element-filter";
import type { Node } from "./schemas/network";

const doc: TemporalSimulation = {
  format: TEMPORAL_SIMULATION_FORMAT,
  standard_metrics: [...STANDARD_METRICS],
  scope: "global",
  timeline: {
    name: "t",
    steps: [{ label: "2023-01", unit: "month", repeat: 2, phases: [{ events: [{ event: "settle", every: 1 }, { event: "audit", every: 2 }], propagate: true }] }],
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
    const parsed = parseDocText(serializeDoc(draftToDoc(draft)));
    expect(parsed.ok && parsed.doc).toEqual(doc);
  });
});

describe("profile rows", () => {
  const ids = () => { let n = 0; return () => `r${n++}`; };
  const pool = (op: "set" | "add", value: number) => ({ element: "pool", path: ["supply_capacity", "hours", "rate"], op, value });
  const water = (value: number) => ({ element: "pool", path: ["supply_capacity", "water"], op: "set" as const, value });

  it("one operation over several periods is one row with a value per period", () => {
    const rows = docToDraft({ ...doc, profile: { "2023-01": [pool("set", 160)], "2023-02": [pool("set", 120)] } }, ids()).profile;
    expect(rows).toHaveLength(1);
    expect(rows[0].values).toEqual({ "2023-01": 160, "2023-02": 120 });
  });

  it("keeps each period's order when grouping would swap it", () => {
    const d: TemporalSimulation = { ...doc, profile: { "2023-01": [pool("add", 1), water(2)], "2023-02": [water(3), pool("add", 4)] } };
    const draft = docToDraft(d, ids());
    expect(draft.profile).toHaveLength(3);
    expect(draftToDoc(draft).profile).toEqual(d.profile);
  });

  it("writes periods in Timeline order", () => {
    const rows = docToDraft({ ...doc, profile: { "2023-02": [pool("set", 1)], "2023-01": [pool("set", 2)] } }, ids()).profile;
    expect(Object.keys(draftToDoc({ timeline: doc.timeline, profile: rows, metrics: [], standardMetrics: [...STANDARD_METRICS], scope: "global" }).profile)).toEqual(["2023-01", "2023-02"]);
  });
});

describe("standard_metrics", () => {
  it("reads as all three in a document saved before the field existed", () => {
    const { standard_metrics: _absent, ...older } = doc;
    expect(docToDraft(older as TemporalSimulation, () => "id").standardMetrics).toEqual(["operativity", "coverage", "stock_level"]);
  });

  it("is written only when one is hidden, and absent reads as all three", () => {
    expect(serializeDoc(doc)).not.toContain("standard_metrics");
    const hidden = serializeDoc({ ...doc, standard_metrics: ["coverage"] });
    expect(hidden).toContain(`"standard_metrics"`);
    const r = parseDocText(hidden);
    expect(r.ok && r.doc.standard_metrics).toEqual(["coverage"]);
    const all = parseDocText(serializeDoc(doc));
    expect(all.ok && all.doc.standard_metrics).toEqual(["operativity", "coverage", "stock_level"]);
  });
});

describe("Phase Events", () => {
  it("are written as a bare id when they fire every period, and read back either way", () => {
    const text = serializeDoc(doc);
    expect(text).toContain(`"settle"`);
    expect(text).toContain(`"every": 2`);
    const r = parseDocText(text);
    expect(r.ok && r.doc.timeline.steps[0].phases[0].events).toEqual([{ event: "settle", every: 1 }, { event: "audit", every: 2 }]);
  });
});

describe("parseDocText", () => {
  it("reads the JSON block out of a whole LLM reply", () => {
    const reply = `Here is the updated definition:\n\n\`\`\`json\n${serializeDoc(doc)}\n\`\`\`\nLet me know.`;
    expect(parseDocText(reply).ok).toBe(true);
    expect(extractJson(`text {"a": 1} more`)).toBe(`{"a": 1}`);
    expect(extractJson("```js\nx()\n```\nand\n```json\n{\"a\": 1}\n```").trim()).toBe(`{"a": 1}`);
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

describe("checkDoc", () => {
  it("checks a draft the way Apply checks text, and normalises bare Event ids", () => {
    const ok = checkDoc({ ...doc, timeline: { name: "t", steps: [{ label: "a", unit: "day", phases: [{ events: ["quake"] }] }] } });
    expect(ok.ok && ok.doc.timeline.steps[0].phases[0]).toEqual({ events: [{ event: "quake", every: 1 }], propagate: true });
    const bad = checkDoc({ ...doc, profile: { "2023-01": [{ element: "pool", path: [], op: "add", value: "x" }] } });
    expect(!bad.ok && bad.errors.join("\n")).toMatch(/profile\.2023-01\.0/);
  });
});

describe("docWarnings", () => {
  it("flags unknown Events, unused labels, missing Elements and empty filters", () => {
    const d: TemporalSimulation = {
      ...doc,
      profile: {
        ...doc.profile,
        "2024-12": [{ element: "ghost", path: ["x"], op: "set", value: 1 }],
        "2023-02": [{ where: { kind: "node", node_type: "Source" }, path: ["x"], op: "set", value: 1 }],
      },
    };
    const w = docWarnings(d, [], model).join("\n");
    expect(w).toMatch(/Unknown Event ids: settle, audit/);
    expect(w).toMatch(/"2024-12" is not a period/);
    expect(w).toMatch(/no Element "ghost"/);
    expect(w).toMatch(/matches no Element/);
  });
});

describe("LLM context", () => {
  it("ships a worked example that the schema accepts", () => {
    const r = parseDocText(serializeDoc(EXAMPLE_DOC));
    expect(r.ok ? r.doc : r.errors).toEqual(EXAMPLE_DOC);
  });
  it("is self-contained: primer, format, example, this project and the current definition", () => {
    const text = llmContext(doc, { events: [], categories: [{ name: "hours", category_type: "SourceToDemands" }], functionality_scale: [{ level: 1, label: "critical", color: "x" }, { level: 2, label: "ok", color: "x" }] }, model);
    for (const part of ["What CASCADE models", "What a \"path\" can reach", "## Format", "Worked example", "Functionality scale (N = 2)", "hours (SourceToDemands)", "## Current definition"]) {
      expect(text).toContain(part);
    }
    // The last fenced block is the current definition, and it parses.
    const last = text.slice(text.lastIndexOf("```json"));
    expect(parseDocText(last).ok).toBe(true);
  });
});
