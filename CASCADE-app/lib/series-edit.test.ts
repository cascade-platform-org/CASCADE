import { describe, expect, it } from "vitest";
import { orphanRows, parseBlock, renameSeriesIn, seriesGaps, seriesReaders, withoutRows, writeBlock } from "./series-edit";
import type { Series } from "./schemas/series";
import type { StoredTemporalSimulation } from "./schemas/temporal-simulation";

const s: Series = { name: "worked_h", rows: { a: { "2024-01": 1 }, "*": { "2024-01": 0, "2024-02": 0 } } };

describe("a pasted block", () => {
  it("reads rows and tab-separated cells, keeps an empty cell, takes a decimal comma", () => {
    expect(parseBlock("1\t2,5\n\t4\n")).toEqual({ cells: [[1, 2.5], [null, 4]] });
    expect(parseBlock("1\tx")).toEqual({ error: 'row 1, column 2: "x" is not a number' });
  });

  it("is written from a row and a period on, an empty cell emptying it, beyond the rows and labels dropped", () => {
    const next = writeBlock(s, ["a", "*"], ["2024-01", "2024-02"], [[7, 8, 99], [null], [5]]);
    expect(next.rows).toEqual({ a: { "2024-01": 7, "2024-02": 8 }, "*": { "2024-02": 0 } });
    expect(s.rows.a).toEqual({ "2024-01": 1 }); // the input is untouched
  });
});

describe("gaps, orphans and readers", () => {
  it("lists the periods each row lacks, rows whose Element is gone, and what reads a Series", () => {
    expect(seriesGaps(s, ["2024-01", "2024-02"])).toEqual(new Map([["a", ["2024-02"]]]));
    expect(orphanRows({ ...s, rows: { ...s.rows, gone: {} } }, (id) => id === "a")).toEqual(["gone"]);
    expect(withoutRows(s, ["a"]).rows).toEqual({ "*": s.rows["*"] });
    const sim = { id: "x", timeline: { name: "Art. 8", steps: [] }, profile: { "2024-01": [{ element: "a", path: ["p"], op: "add", value: 1, series: "worked_h" }] } } as unknown as StoredTemporalSimulation;
    expect(seriesReaders("worked_h", [sim], [{ id: "e", label: "Pay", type: "restorative", frequency_per_10y: 0, attribute_operations: [{ element: "a", path: ["p"], op: "add", value: 1, series: "worked_h" }] }])).toEqual({
      simulations: [["Art. 8", 1]],
      events: [["Pay", 1]],
    });
    expect(renameSeriesIn([sim], "worked_h", "hours")[0].profile["2024-01"][0].series).toBe("hours");
  });
});
