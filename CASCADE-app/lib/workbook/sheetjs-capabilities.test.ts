/**
 * What SheetJS CE does with the cells a Workbook needs (ADR-0023 §5), in
 * both formats. Kept as a record: an upgrade that changes any of this fails
 * here first, and the codec's workarounds are named next to each gap.
 */

import { describe, expect, it } from "vitest";
import * as X from "xlsx";

type Book = "xlsx" | "ods";
const BOOKS: Book[] = ["xlsx", "ods"];

function roundTrip(type: Book, cells: Record<string, X.CellObject>, opts: { hidden?: boolean } = {}): X.WorkBook {
  const ws: X.WorkSheet = { ...cells, "!ref": "A1:Z50" };
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, { A1: { t: "s", v: "visible" }, "!ref": "A1" }, "Visible");
  X.utils.book_append_sheet(wb, ws, "Data");
  if (opts.hidden) wb.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 1 }] };
  const bytes = X.write(wb, { type: "array", bookType: type }) as ArrayBuffer;
  return X.read(bytes, { type: "array", cellFormula: true, cellText: true, cellNF: true, cellDates: false });
}

const TEXTS = ["2023-01", "007", "TRUE", "=1+1", "a\u0001b", "tab\there", " lead", "trail ", "😀 astral", "line\nbreak", "a;b", "json:x"];

describe.each(BOOKS)("SheetJS CE, %s", (type) => {
  it("keeps text cells as typed, with the text format", () => {
    const cells = Object.fromEntries(TEXTS.map((v, i) => [`A${i + 1}`, { t: "s", v, z: "@" } as X.CellObject]));
    const s = roundTrip(type, cells).Sheets.Data;
    expect(TEXTS.map((_, i) => s[`A${i + 1}`]?.v)).toEqual(TEXTS);
    expect(s.A1.t).toBe("s");
  });

  it("decodes _xHHHH_ in text, so the codec escapes it (json: form)", () => {
    expect(roundTrip(type, { A1: { t: "s", v: "_x0041_" } }).Sheets.Data.A1.v).toBe("A");
  });

  it("keeps booleans and the full range of doubles; -0 reads as 0 (JSON has no -0 either)", () => {
    const s = roundTrip(type, {
      A1: { t: "b", v: true }, A2: { t: "b", v: false },
      A3: { t: "n", v: 1e-300 }, A4: { t: "n", v: 2 ** 53 }, A5: { t: "n", v: 0.1 + 0.2 }, A6: { t: "n", v: -0 },
    }).Sheets.Data;
    expect([s.A1.v, s.A2.v, s.A3.v, s.A4.v, s.A5.v]).toEqual([true, false, 1e-300, 2 ** 53, 0.1 + 0.2]);
    expect(Object.is(s.A6.v, 0)).toBe(true);
  });

  it("keeps a 32,000-character cell; xlsx refuses one over 32,767 (the codec chunks into _cascade)", () => {
    const long = "x".repeat(32000);
    expect(roundTrip(type, { A1: { t: "s", v: long } }).Sheets.Data.A1.v).toBe(long);
    if (type === "xlsx") expect(() => roundTrip(type, { A1: { t: "s", v: "x".repeat(32768) } })).toThrow(/32767/);
  });

  it("keeps a same-sheet formula with its stored value, and comments", () => {
    const s = roundTrip(type, {
      A1: { t: "n", v: 1 }, A2: { t: "n", v: 2 }, A3: { t: "n", v: 3, f: "A1+A2" },
      B1: { t: "s", v: "noted", c: [{ a: "cascade", t: "a note" }] as X.Comments },
    }).Sheets.Data;
    expect([s.A3.v, s.A3.f]).toEqual([3, "A1+A2"]);
    expect(s.B1.c?.[0]?.t).toBe("a note");
  });

  it(type === "xlsx" ? "keeps a sheet hidden" : "loses a hidden sheet's state (the codec marks it in content.xml)", () => {
    const hidden = roundTrip(type, {}, { hidden: true }).Workbook?.Sheets?.[1]?.Hidden;
    expect(hidden ?? 0).toBe(type === "xlsx" ? 1 : 0);
  });
});

describe("SheetJS CE gaps the codec works around", () => {
  it("xlsx: a formula without a stored value is written as an error cell, which spreadsheet apps then compute", () => {
    const s = roundTrip("xlsx", { A1: { t: "n", f: "1+1" } as X.CellObject }).Sheets.Data;
    expect([s.A1.t, s.A1.f]).toEqual(["e", "1+1"]);
  });

  it("ods: a cross-sheet range is converted wrongly in both directions (the codec writes and reads table:formula itself)", () => {
    const f = "VLOOKUP(A2,Nodes!$A$2:$B$2,2,0)*2";
    const s = roundTrip("ods", { A1: { t: "n", v: 1, f } }).Sheets.Data;
    expect(s.A1.f).not.toBe(f);
  });
});
