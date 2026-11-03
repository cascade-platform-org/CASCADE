import { describe, expect, it } from "vitest";
import { compareRuns, comparisonCsv, sweepMap, sweptParameters, sweptValues } from "./temporal-comparison";
import type { RunTable } from "./temporal-metrics";

const table = (columns: string[], rows: (number | null)[][]): RunTable => ({
  columns: columns.map((label) => ({ key: label, label })),
  rows: rows.map((values, i) => ({ label: `p${i + 1}`, values })),
});

describe("compareRuns", () => {
  const comparison = compareRuns([
    { id: "a", name: "Baseline", warnings: [], table: table(["Owed", "Settled"], [[-10, 0], [-20, 5], [-15, null]]) },
    { id: "b", name: "Threshold", warnings: [], table: table(["Settled", "Only here"], [[2, 1], [3, 1]]) },
    { id: "c", name: "Broken", warnings: [], table: null, error: "the engine refused it" },
  ]);

  it("lines the tables up by column name, in the order first met", () => {
    expect(comparison.columns).toEqual(["Owed", "Settled", "Only here"]);
    expect(comparison.rows[1].stats.Owed).toBeUndefined();
  });

  it("keeps each run's series and its end, mean, min, max and total", () => {
    expect(comparison.rows[0].values.Settled).toEqual([0, 5, null]);
    expect(comparison.rows[0].stats.Owed).toEqual({ end: -15, mean: -15, min: -20, max: -10, total: -45 });
    expect(comparison.rows[0].stats.Settled).toEqual({ end: null, mean: 2.5, min: 0, max: 5, total: 5 });
    expect(comparison.rows[2]).toMatchObject({ name: "Broken", error: "the engine refused it", periods: [] });
  });

  it("writes one CSV line per Simulation and column", () => {
    expect(comparisonCsv(comparison).split("\n")).toEqual([
      "simulation,metric,end,mean,min,max,total",
      "Baseline,Owed,-15,-15,-20,-10,-45",
      "Baseline,Settled,,2.5,0,5,5",
      "Threshold,Settled,3,2.5,2,3,5",
      "Threshold,Only here,1,1,1,1,2",
    ]);
  });
});

describe("a Parameter Sweep in the comparison", () => {
  it("gives each swept Parameter a CSV column, empty for the runs that do not sweep it", () => {
    const c = compareRuns([
      { id: "a", name: "A", warnings: [], table: table(["X"], [[2]]) },
      { id: "a", name: "A · share = 0.4, months = 6", warnings: [], table: table(["X"], [[1]]),
        sweep: [{ parameter: "share", value: 0.4 }, { parameter: "months", value: 6 }] },
    ]);
    expect(c.rows[1].sweep).toEqual([{ parameter: "share", value: 0.4 }, { parameter: "months", value: 6 }]);
    expect(comparisonCsv(c).split("\n")).toEqual([
      "simulation,share,months,metric,end,mean,min,max,total",
      "A,,,X,2,2,2,2,2",
      '"A · share = 0.4, months = 6",0.4,6,X,1,1,1,1,1',
    ]);
  });
});

describe("sweepMap", () => {
  // A 2 × 2 grid over share and months, at two values of a third Parameter, level.
  const run = (share: number, months: number, level: number, x: number) => ({
    id: "a", name: `A · share = ${share}, months = ${months}, level = ${level}`, warnings: [],
    table: table(["X"], [[x], [x + 1]]),
    sweep: [{ parameter: "share", value: share }, { parameter: "months", value: months }, { parameter: "level", value: level }],
  });
  const c = compareRuns([
    { id: "b", name: "Not swept", warnings: [], table: table(["X"], [[100]]) },
    run(0.1, 6, 1, 1), run(0.2, 6, 1, 2), run(0.1, 12, 1, 3), run(0.2, 12, 1, 4),
    run(0.1, 6, 2, 10), run(0.2, 6, 2, 20), run(0.1, 12, 2, 30),
  ]);

  it("lists the swept Parameters in the order first met, and each one's values in order", () => {
    expect(sweptParameters(c)).toEqual(["share", "months", "level"]);
    expect(sweptValues(c, "months")).toEqual([6, 12]);
  });

  it("lays one statistic out over two Parameters, the others held at the chosen values", () => {
    const m = sweepMap(c, "X", "end", "share", "months", { level: 1 });
    expect(m.xs).toEqual([0.1, 0.2]);
    expect(m.ys).toEqual([6, 12]);
    expect(m.cells).toEqual([[2, 3], [4, 5]]);
    expect([m.lo, m.hi]).toEqual([2, 5]);
  });

  it("leaves a cell empty where the grid has no run, and ignores runs outside the sweep", () => {
    const m = sweepMap(c, "X", "mean", "share", "months", { level: 2 });
    expect(m.cells).toEqual([[10.5, 20.5], [30.5, null]]);
    expect([m.lo, m.hi]).toEqual([10.5, 30.5]);
  });
});
