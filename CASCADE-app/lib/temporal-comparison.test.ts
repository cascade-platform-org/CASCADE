import { describe, expect, it } from "vitest";
import { compareRuns, comparisonCsv } from "./temporal-comparison";
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
    expect(comparison.rows[0].series.Settled).toEqual([0, 5, null]);
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
