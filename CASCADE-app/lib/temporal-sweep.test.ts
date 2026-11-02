import { describe, expect, it } from "vitest";
import { MAX_SWEEP_RUNS, MAX_SWEEP_VALUES, compareRequests, parameterReads, parseSweepValues, sweepPoints, sweepSize } from "./temporal-sweep";
import type { StoredTemporalSimulation } from "./schemas/temporal-simulation";

describe("sweep values", () => {
  it("read a list, a range with both ends, and decimal commas when there is no decimal point", () => {
    expect(parseSweepValues("0.10, 0.15; 0.2")).toEqual({ values: [0.1, 0.15, 0.2] });
    expect(parseSweepValues("0.1 to 0.3 step 0.05")).toEqual({ values: [0.1, 0.15, 0.2, 0.25, 0.3] });
    expect(parseSweepValues("0,5 0,7")).toEqual({ values: [0.5, 0.7] });
    expect(parseSweepValues("1, 1, 2")).toEqual({ values: [1, 2] });
  });

  it("refuse what is not a list or a range, and more than the limit", () => {
    expect(parseSweepValues("0.1, x")).toEqual({ error: '"x" is not a number' });
    expect(parseSweepValues("1 to 0 step 1")).toMatchObject({ error: expect.stringMatching(/range/) });
    expect(parseSweepValues("")).toEqual({ error: "give at least one value" });
    expect(parseSweepValues(`0 to ${MAX_SWEEP_VALUES} step 1`)).toEqual({ error: `at most ${MAX_SWEEP_VALUES} values` });
  });
});

const sim = (id: string, name: string, over: Partial<StoredTemporalSimulation> = {}) =>
  ({ id, format: "cascade.temporal-simulation/v1", timeline: { name, steps: [] }, profile: {}, metrics: [], standard_metrics: [], scope: "global", parameters: [{ name: "share", value: 0.5 }], ...over }) as StoredTemporalSimulation;

describe("the runs Compare makes", () => {
  it("are the ticked Simulations, then one per swept value with its override", () => {
    const sims = [sim("a", "Art. 8"), sim("b", "Twice")];
    expect(compareRequests(sims, ["b"], { simulationId: "a", axes: [{ parameter: "share", values: [0.4, 0.6] }] })).toEqual([
      { simulationId: "b", name: "Twice" },
      { simulationId: "a", name: "Art. 8 · share = 0.4", sweep: [{ parameter: "share", value: 0.4 }] },
      { simulationId: "a", name: "Art. 8 · share = 0.6", sweep: [{ parameter: "share", value: 0.6 }] },
    ]);
  });

  it("sweep a grid: every combination of the Parameters' values, the first varying slowest", () => {
    const axes = [{ parameter: "share", values: [0.4, 0.6] }, { parameter: "months", values: [3, 6, 9] }];
    expect(sweepSize(axes)).toBe(6);
    expect(sweepPoints(axes).map((p) => p.map((q) => q.value))).toEqual([[0.4, 3], [0.4, 6], [0.4, 9], [0.6, 3], [0.6, 6], [0.6, 9]]);
    const runs = compareRequests([sim("a", "A")], [], { simulationId: "a", axes });
    expect(runs).toHaveLength(6);
    expect(runs[1]).toEqual({ simulationId: "a", name: "A · share = 0.4, months = 6", sweep: [{ parameter: "share", value: 0.4 }, { parameter: "months", value: 6 }] });
  });

  it("add no run for a grid over the limit, or one naming a Parameter twice", () => {
    const big = [{ parameter: "share", values: Array.from({ length: 50 }, (_, i) => i) }, { parameter: "months", values: Array.from({ length: 11 }, (_, i) => i) }];
    expect(sweepSize(big)).toBeGreaterThan(MAX_SWEEP_RUNS);
    expect(compareRequests([sim("a", "A")], [], { simulationId: "a", axes: big })).toEqual([]);
    const twice = [{ parameter: "share", values: [1] }, { parameter: "share", values: [2] }];
    expect(compareRequests([sim("a", "A")], [], { simulationId: "a", axes: twice })).toEqual([]);
  });

  it("count what reads the Parameter: profile operations and the operations of the Events its Phases fire", () => {
    const op = { element: "x", path: ["p"], op: "add" as const, value: 1, parameter: "share" };
    const s = sim("a", "A", {
      profile: { "2024-01": [op, { ...op, parameter: undefined }] },
      timeline: { name: "A", steps: [{ label: "2024-01", unit: "month", repeat: 1, phases: [{ events: [{ event: "pay", every: 1 }], propagate: false }] }] },
    });
    expect(parameterReads(Object.values(s.profile).flat(), s.timeline.steps, "share", (id) => (id === "pay" ? [op, op] : []))).toBe(3);
    expect(parameterReads(Object.values(s.profile).flat(), s.timeline.steps, "other", () => [])).toBe(0);
  });
});
