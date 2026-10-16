import { describe, expect, it } from "vitest";
import { excelToOds, odsToExcel } from "./formula";

// Pairs as LibreOffice 24.2 writes them (converted from the same .xlsx).
const PAIRS: [string, string][] = [
  ["SUM('S·worked h'!B2:C2)+IF(A2>1,1,0)", "of:=SUM([$'S·worked h'.B2:.C2])+IF([.A2]>1;1;0)"],
  ['XLOOKUP("act-pul",Nodes!A:A,Nodes!B:B)*2', 'of:=XLOOKUP("act-pul";[$Nodes.A:.A];[$Nodes.B:.B])*2'],
  ["VLOOKUP(A2,Nodes!$A$2:$B$2,2,0)*2", "of:=VLOOKUP([.A2];[$Nodes.$A$2:.$B$2];2;0)*2"],
  ['CONCAT("a,b; [.x]",B1)', 'of:=CONCAT("a,b; [.x]";[.B1])'],
  ["LOG10(A1)+SUM(1:1)", "of:=LOG10([.A1])+SUM([.1:.1])"],
];

describe("formulas between Excel and OpenFormula", () => {
  it.each(PAIRS)("%s ↔ %s", (excel, ods) => {
    expect(excelToOds(excel)).toBe(ods);
    expect(odsToExcel(ods)).toBe(excel);
  });

  it("reads LibreOffice's COM.MICROSOFT. prefix and a doubled =", () => {
    expect(odsToExcel("of:==COM.MICROSOFT.XLOOKUP([.A1];[$Nodes.A:.A];[$Nodes.B:.B])")).toBe("XLOOKUP(A1,Nodes!A:A,Nodes!B:B)");
  });
});
