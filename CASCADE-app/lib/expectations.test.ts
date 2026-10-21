import { describe, expect, it } from "vitest";
import { compare, resultsText, runExpectation, runExpectations, type ExpectationEnv } from "./expectations";
import { ExpectationSchema, type Expectation } from "./schemas/expectation";
import { DEFAULT_CONFIG } from "@/store/config-store";
import type { Propagated } from "./step-operator";
import type { EventDefinition, ModelConfiguration } from "./schemas/config";
import type { GraphSnapshot, Node } from "./schemas/network";
import type { StoredTemporalSimulation } from "./schemas/temporal-simulation";

const config: ModelConfiguration = {
  ...DEFAULT_CONFIG,
  events: [
    { id: "cut", label: "Grid cut", type: "disservice", frequency_per_10y: 1 } as EventDefinition,
    { id: "repair", label: "Repair", type: "restorative", frequency_per_10y: 0, attribute_operations: [{ element: "grid", path: ["functionality"], op: "set", value: 3 }] } as EventDefinition,
  ],
};
const N = config.functionality_scale.length;

const node = (id: string, over: Partial<Node> = {}): Node => ({ id, label: id.toUpperCase(), functionality: N, ...over });

/** The grid feeds a clinic directly and a hospital that holds on a generator. */
const start: GraphSnapshot = {
  nodes: {
    grid: node("grid", { vulnerability_levels: { cut: N - 1 } }),
    clinic: node("clinic"),
    hospital: node("hospital", { properties: { generator: true } }),
  },
  edges: {},
  canvases: [],
};

/** A fake engine: with the grid down the clinic follows it; the hospital first holds 8 h, then stays down once that has run out. */
function engine(s: GraphSnapshot): GraphSnapshot {
  const grid = s.nodes.grid.functionality;
  if (grid >= N) return s;
  const clinic = { ...s.nodes.clinic, functionality: Math.min(s.nodes.clinic.functionality, grid), responsibility_share: { grid: 1 } };
  const h = s.nodes.hospital;
  const hospital = h.functionality_time === undefined && h.functionality === N ? { ...h, functionality_time: 8 } : h;
  return { ...s, nodes: { ...s.nodes, clinic, hospital } };
}

let calls = 0;
const env = (over: Partial<ExpectationEnv> = {}): ExpectationEnv => ({
  start,
  config,
  series: [],
  simulations: [],
  propagate: async (snapshot): Promise<Propagated> => {
    calls++;
    return { snapshot: engine(snapshot), flow: { served_ratio: {}, stored: {} } };
  },
  ...over,
});

const expectation = (raw: unknown): Expectation => ExpectationSchema.parse(raw);

describe("compare", () => {
  it("reads == and != within the tolerance, and the rest strictly", () => {
    expect(compare(0.49, "==", 0.5, 0.02)).toBe(true);
    expect(compare(0.45, "==", 0.5, 0.02)).toBe(false);
    expect(compare(0.45, "!=", 0.5, 0.02)).toBe(true);
    expect(compare(2, ">=", 2)).toBe(true);
    expect(compare(true, "==", true)).toBe(true);
    expect(compare(true, "<", 1)).toBe(false);
  });
});

describe("a scenario check", () => {
  it("passes when the Propagated model agrees, a level written as its label", async () => {
    const r = await runExpectation(expectation({
      id: "e1", statement: "With the grid down the clinic is critical",
      check: { kind: "scenario", events: ["cut"], assertions: [{ element: "clinic", cmp: "==", value: "critical" }] },
    }), env());
    expect(r.status).toBe("pass");
    expect(r.engineCalls).toBe(1);
    expect(r.lines[0]).toContain("CLINIC: functionality 1 (critical), expected = 1 (critical); cause: GRID 100%");
  });

  it("fails with the actual value and its cause when the model disagrees", async () => {
    const r = await runExpectation(expectation({
      id: "e2", statement: "The clinic copes with a grid cut",
      check: { kind: "scenario", events: ["cut"], assertions: [{ element: "clinic", cmp: ">=", value: 2 }] },
    }), env());
    expect(r.status).toBe("fail");
    expect(r.lines[0]).toMatch(/^✗ CLINIC: functionality 1 \(critical\), expected ≥ 2/);
  });

  it("lets hours pass and propagates again: a backup holds, then runs out", async () => {
    const holds = await runExpectation(expectation({
      id: "e3", statement: "The hospital holds 8 h",
      check: { kind: "scenario", events: ["cut"], assertions: [{ element: "hospital", path: ["functionality_time"], cmp: "==", value: 8 }, { element: "hospital", cmp: "==", value: N }] },
    }), env());
    expect(holds.status).toBe("pass");

    calls = 0;
    const after = await runExpectation(expectation({
      id: "e4", statement: "After 8 h the hospital is critical",
      check: { kind: "scenario", events: ["cut"], advance_hours: 8, assertions: [{ element: "hospital", cmp: "==", value: "critical" }] },
    }), env());
    expect(after.status).toBe("pass");
    expect(after.engineCalls).toBe(2);
    expect(calls).toBe(2);
  });

  it("reads an unstored field as the app does, and checks every or any match of a filter", async () => {
    const r = await runExpectation(expectation({
      id: "e5", statement: "Nothing is physically damaged by a cut, and something stays up",
      check: {
        kind: "scenario", events: ["cut"], assertions: [
          { where: { kind: "node" }, path: ["direct_damage"], cmp: "==", value: false },
          { where: { kind: "node" }, quantifier: "any", cmp: "==", value: N },
        ],
      },
    }), env());
    expect(r.status).toBe("pass");
  });

  it("is an error, never a pass, when it names what the model does not have", async () => {
    const bad = [
      { events: ["flood"], assertions: [{ element: "clinic", cmp: "==", value: 1 }] },
      { events: ["cut"], assertions: [{ element: "school", cmp: "==", value: 1 }] },
      { events: ["cut"], assertions: [{ element: "clinic", cmp: "==", value: "broken" }] },
      { events: ["cut"], assertions: [{ where: { label_contains: "nowhere" }, cmp: "==", value: 1 }] },
    ];
    for (const check of bad) {
      const r = await runExpectation(expectation({ id: "x", statement: "x", check: { kind: "scenario", ...check } }), env());
      expect(r.status).toBe("error");
    }
  });

  it("turns an engine error into the result's error", async () => {
    const r = await runExpectation(expectation({
      id: "e6", statement: "s", check: { kind: "scenario", events: ["cut"], assertions: [{ element: "clinic", cmp: "==", value: 1 }] },
    }), env({ propagate: async () => { throw new Error("429 budget"); } }));
    expect(r).toMatchObject({ status: "error", lines: ["429 budget"] });
  });
});

describe("a simulation check", () => {
  const simulation: StoredTemporalSimulation = {
    id: "sim", format: "cascade.temporal-simulation/v1",
    timeline: {
      name: "Three days",
      steps: [
        { label: "d1", unit: "none", repeat: 1, phases: [{ events: [{ event: "cut", every: 1 }], propagate: true, advance_hours: 0 }] },
        { label: "d2", unit: "none", repeat: 1, phases: [{ events: [{ event: "repair", every: 1 }], propagate: true, advance_hours: 0 }] },
      ],
    },
    profile: {}, metrics: [], standard_metrics: ["operativity"], scope: "global", parameters: [],
  };
  const sim = (check: Record<string, unknown>) =>
    expectation({ id: "s", statement: "s", check: { kind: "simulation", simulation: "sim", column: "Operativity %", ...check } });

  it("compares a column at a period and as a statistic of the run", async () => {
    const e = env({ simulations: [simulation] });
    expect((await runExpectation(sim({ period: "d1", cmp: "<", value: 100 }), e)).status).toBe("pass");
    expect((await runExpectation(sim({ period: "d2", cmp: "==", value: 100 }), e)).status).toBe("pass");
    const max = await runExpectation(sim({ statistic: "max", cmp: "<", value: 100 }), e);
    expect(max.status).toBe("fail");
    expect(max.lines.at(-1)).toMatch(/^✗ Operativity % max over the run: 100, expected < 100$/);
    expect(max.engineCalls).toBe(2);
  });

  it("names the columns it has when asked for one it does not", async () => {
    const r = await runExpectation(sim({ column: "Payout", period: "d1", cmp: "==", value: 1 }), env({ simulations: [simulation] }));
    expect(r.status).toBe("error");
    expect(r.lines[0]).toContain("Operativity %");
  });

  it("is an error for a Simulation the project does not have", async () => {
    expect((await runExpectation(sim({ period: "d1", cmp: "==", value: 1 }), env())).status).toBe("error");
  });
});

describe("the schema", () => {
  it("refuses an assertion with two targets or none, and a check reading period and statistic", () => {
    const scenario = (assertion: unknown) => ExpectationSchema.safeParse({ id: "a", statement: "a", check: { kind: "scenario", assertions: [assertion] } }).success;
    expect(scenario({ element: "x", cmp: "==", value: 1 })).toBe(true);
    expect(scenario({ cmp: "==", value: 1 })).toBe(false);
    expect(scenario({ element: "x", where: {}, cmp: "==", value: 1 })).toBe(false);
    expect(ExpectationSchema.safeParse({ id: "a", statement: "a", check: { kind: "simulation", simulation: "s", column: "c", period: "p", statistic: "end", cmp: "==", value: 1 } }).success).toBe(false);
    expect(ExpectationSchema.safeParse({ id: "a", statement: "a", check: { kind: "scenario", scope: "local", assertions: [{ element: "x", cmp: "==", value: 1 }] } }).success).toBe(false);
  });
});

describe("resultsText", () => {
  it("summarises, and marks an LLM's Expectation not yet confirmed", async () => {
    const list = [
      expectation({ id: "ok", statement: "Clinic fails", check: { kind: "scenario", events: ["cut"], assertions: [{ element: "clinic", cmp: "==", value: 1 }] } }),
      expectation({ id: "no", statement: "Clinic copes", provenance: { origin: "agent", confirmed: false }, check: { kind: "scenario", events: ["cut"], assertions: [{ element: "clinic", cmp: "==", value: N }] } }),
    ];
    const text = resultsText(list, await runExpectations(list, env()));
    expect(text).toMatch(/^1 of 2 Expectations pass\./);
    expect(text).toContain("[FAIL] no (unconfirmed): Clinic copes");
  });
});
