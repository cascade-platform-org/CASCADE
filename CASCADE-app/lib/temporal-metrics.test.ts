import { describe, expect, it } from "vitest";
import { evaluateMetric, runTable, runTableCsv } from "./temporal-metrics";
import { runTimeline } from "./step-operator";
import { planTimeline } from "./timeline-plan";
import type { GraphSnapshot, Node, Stock } from "./schemas/network";
import type { Metric } from "./schemas/temporal-simulation";

const N = 3;
const stock = (over: Partial<Stock>): Stock => ({ rate: 0, level: 0, retention: 1, efficiency: 1, ...over });
const worker = (id: string, owed: number, func = N): Node => ({ id, label: id, node_type: "Personnel", functionality: func, properties: { owed } });
const snap = (nodes: Node[]): GraphSnapshot => ({ nodes: Object.fromEntries(nodes.map((x) => [x.id, x])), edges: {}, canvases: [] });
const metric = (over: Partial<Metric>): Metric => ({
  name: "m", target: { kind: "node", node_type: "Personnel" }, path: ["properties", "owed"], read: "state", aggregate: "sum", ...over,
});

describe("evaluateMetric", () => {
  const before = snap([worker("a", 10), worker("b", -4), worker("c", 0)]);
  const after = snap([worker("a", 6), worker("b", -9), worker("c", 0)]);
  it("aggregates a state over the target", () => {
    expect(evaluateMetric(metric({}), [before, after])).toBe(-3);
    expect(evaluateMetric(metric({ aggregate: "mean" }), [before, after])).toBe(-1);
    expect(evaluateMetric(metric({ aggregate: "max" }), [before, after])).toBe(6);
    expect(evaluateMetric(metric({ aggregate: "percentile", percentile: 50 }), [before, after])).toBe(0);
  });
  it("filters values, and reads share_where as the share passing", () => {
    expect(evaluateMetric(metric({ aggregate: "count", value_filter: { cmp: "<", value: 0 } }), [before, after])).toBe(1);
    expect(evaluateMetric(metric({ aggregate: "share_where", value_filter: { cmp: "<=", value: 0 } }), [before, after])).toBeCloseTo(2 / 3);
  });
  it("reads a change over the period, or over one Phase", () => {
    expect(evaluateMetric(metric({ read: "change" }), [before, after])).toBe(-9);
    const mid = snap([worker("a", 8), worker("b", -4), worker("c", 0)]);
    expect(evaluateMetric(metric({ read: "change", phase: 2 }), [before, mid, after])).toBe(-7);
  });
  it("has no mean of nothing", () => {
    expect(evaluateMetric(metric({ aggregate: "mean", target: { kind: "node", node_type: "Source" } }), [before, after])).toBeNull();
  });
});

describe("runTable", () => {
  it("puts Operativity, coverage and stock level before the custom Metrics, period by period, and exports CSV", async () => {
    const start: GraphSnapshot = {
      nodes: {
        pool: { id: "pool", functionality: N, supply_capacity: { water: stock({ rate: 40, level: 0, min: -100 }) } },
        town: { id: "town", functionality: N, category_dependency_profiles: { water: { dependency_level: N, demand: 50 } } },
      },
      edges: {},
      canvases: [],
    };
    const plan = planTimeline({ name: "t", steps: [{ label: "P1", unit: "none", repeat: 2, phases: [{ events: [], propagate: true }] }] });
    const record = await runTimeline({
      start, plan, profile: {}, events: [], n: N,
      propagate: async (s) => ({ snapshot: s, flow: { served_ratio: { town: { water: 0.8 } }, stored: {} } }),
    });
    const table = runTable(record, [metric({ name: "pool level", target: { kind: "node" }, path: ["supply_capacity", "water", "level"], aggregate: "min" })], N);
    expect(table.columns.map((c) => c.label)).toEqual(["Operativity %", "Coverage · water", "Stock level · water", "pool level"]);
    // 0.8 × 50 = 40 delivered against 40 credited: the level stays at 0.
    expect(table.rows).toEqual([
      { label: "P1", values: [100, 0.8, 0, 0] },
      { label: "P1#2", values: [100, 0.8, 0, 0] },
    ]);
    expect(runTableCsv(table).split("\n")[0]).toBe("period,Operativity %,Coverage · water,Stock level · water,pool level");
    // A hidden standard Metric leaves the columns and every row.
    const trimmed = runTable(record, [], N, ["coverage"]);
    expect(trimmed.columns.map((c) => c.label)).toEqual(["Coverage · water"]);
    expect(trimmed.rows[0].values).toEqual([0.8]);
  });
});

describe("buildPeriodEntries", () => {
  it("saves each period as a diff from the run's start, with its row, the run's min and mean, and each Stock's change", async () => {
    const { buildPeriodEntries, entryEndState } = await import("./period-entry");
    const { periodState } = await import("./step-operator");
    const start: GraphSnapshot = { nodes: { pool: { id: "pool", functionality: N, supply_capacity: { hours: stock({ rate: 10, level: 5, min: -20 }) } } }, edges: {}, canvases: [] };
    const plan = planTimeline({ name: "t", steps: [{ label: "2023-01", unit: "month", repeat: 2, phases: [{ events: [], propagate: true }] }] });
    const record = await runTimeline({ start, plan, profile: {}, events: [], n: N, propagate: async (s) => ({ snapshot: s, flow: { served_ratio: {}, stored: {} } }) });
    const table = runTable(record, [], N);
    let id = 0;
    const entries = buildPeriodEntries({ record, numbers: [1, 2], table, timelineName: "Year", baseId: "b", newId: () => `e${id++}`, now: () => new Date(0) });
    expect(entries.map((e) => e.id)).toEqual(["e0", "e1"]);
    expect(entries[1]).toMatchObject({
      type: "temporal_simulation",
      label: "Year — 2023-02",
      period_label: "2023-02",
      base_id: "b",
      metrics: { "Operativity %": 100, "Stock level · hours": 25 },
      metric_min: { "Stock level · hours": 15 },
      metric_mean: { "Stock level · hours": 20 },
      level_reading: "change",
      stock_values: [{ element: "pool", category: "hours", value: 10, reference: 20 }],
    });
    expect(entries[1]).not.toHaveProperty("snapshot");
    expect(entryEndState(entries[1], { b: record.start })).toEqual(periodState(record, 2));
    expect(entryEndState(entries[1], {})).toBeNull();
  });
});
