import { deepEqual } from "@/lib/graph-diff";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseBundle } from "@/lib/file-io";
import { decodeWorkbook, describeProblem, encodeWorkbook, parseDecoded } from "./codec";
import { readBytes, writeBytes, type WorkbookKind } from "./sheetjs-adapter";

const dirs = ["samples/public", "samples/private"].filter(existsSync);
const samples = dirs.flatMap((d) => readdirSync(d).filter((f) => f.endsWith(".json") && f !== "manifest.json" && !f.startsWith("cascade-recovery")).map((f) => `${d}/${f}`));

describe.each(["xlsx", "ods"] as WorkbookKind[])("a %s file", (kind) => {
  it.each(samples)("holds %s exactly", async (file) => {
    const bundle = parseBundle(JSON.parse(readFileSync(file, "utf8")));
    if (!bundle) return;
    const model = await readBytes(await writeBytes(encodeWorkbook(bundle), kind));
    const parsed = parseDecoded(decodeWorkbook(model), model);
    expect(parsed.problems.filter((p) => p.severity === "error").map(describeProblem)).toEqual([]);
    expect(deepEqual(JSON.parse(JSON.stringify(parsed.bundle)), JSON.parse(JSON.stringify(bundle)))).toBe(true);
  }, 120000);
});

describe("a custom sheet in a file", () => {
  const raw = (sheets: unknown) => parseBundle({
    project: { version: "2.0", meta: { name: "p" }, nodes: { a: { id: "a", functionality: 3, properties: { workers: 4 } } }, edges: {}, canvases: [], update_history: [], scorecard: [], sheets },
    config: JSON.parse(readFileSync("samples/public/IJDRR_example.json", "utf8")).config,
  })!;

  it.each(["xlsx", "ods"] as WorkbookKind[])("keeps its formulas, and the last values until the app recomputes them (%s)", async (kind) => {
    const b = raw([{ name: "Mine", writes: "Nodes", rows: [[{ v: "id" }, { v: "properties.double" }], [{ v: "a" }, { v: 8, f: "VLOOKUP(A2,Nodes!A:C,3,0)*2" }]] }]);
    const model = await readBytes(await writeBytes(encodeWorkbook(b), kind));
    const mine = model.sheets.find((x) => x.name === "Mine")!;
    expect(mine.rows[1][1]).toEqual({ v: null, f: "VLOOKUP(A2,Nodes!A:C,3,0)*2" });
    const parsed = parseDecoded(decodeWorkbook(model), model);
    expect(parsed.bundle?.project.sheets?.[0].rows[1][1]).toEqual({ v: 8, f: "VLOOKUP(A2,Nodes!A:C,3,0)*2" });
  });
});

describe("the hidden _cascade sheet in a file", () => {
  it.each(["xlsx", "ods"] as WorkbookKind[])("keeps texts a spreadsheet would change (%s)", async (kind) => {
    const sample = JSON.parse(readFileSync("samples/public/IJDRR_Extended_example.json", "utf8"));
    const history = [{ ...sample.project.update_history[0], label: "x_x0042_y" }];
    // A long text goes to _cascade as a blob; history is JSON there. Both hold _xHHHH_, which files decode.
    const long = `${"a_x0041_b\u0001".repeat(5000)}`;
    const b = parseBundle({
      project: { version: "2.0", meta: { name: "p" }, nodes: { a: { id: "a", functionality: 3, properties: { note: long } } }, edges: {}, canvases: [], update_history: history, scorecard: [] },
      config: sample.config,
    })!;
    expect(b).not.toBeNull();
    const model = await readBytes(await writeBytes(encodeWorkbook(b), kind));
    const parsed = parseDecoded(decodeWorkbook(model), model);
    expect(parsed.problems.filter((p) => p.severity === "error").map(describeProblem)).toEqual([]);
    expect(deepEqual(JSON.parse(JSON.stringify(parsed.bundle)), JSON.parse(JSON.stringify(b)))).toBe(true);
  }, 60000);
});
