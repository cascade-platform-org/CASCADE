import { deepEqual } from "@/lib/graph-diff";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { DEFAULT_CONFIG } from "@/store/config-store";
import { parseBundle, type ProjectBundle } from "@/lib/file-io";
import { decodeWorkbook, describeProblem, encodeWorkbook, parseDecoded, SHEETS } from "./codec";
import { readValue, writeValue, Blobs } from "./cells";
import { formatKey, parseKey, type Json } from "./paths";
import type { WorkbookModel } from "./model";

const hostile = fc.oneof(
  fc.string(),
  fc.constantFrom("007", "2023-01", "TRUE", "=1+1", "json:x", "@cascade:y", "_x0041_", "a.b", "a;b", " lead", "trail ", "", "1,5", "\u0001", "😀", "line\nbreak", "x".repeat(40000)),
);
const number = fc.oneof(fc.double({ noNaN: true, noDefaultInfinity: true }).filter((x) => !Object.is(x, -0)), fc.constantFrom(1e-300, 2 ** 53, 0.1 + 0.2));
const json: fc.Arbitrary<Json> = fc.letrec((tie) => ({
  value: fc.oneof({ depthSize: "small" }, hostile, number, fc.boolean(), fc.constant(null), fc.array(tie("value"), { maxLength: 3 }), fc.dictionary(hostile, tie("value"), { maxKeys: 3 })),
})).value as fc.Arbitrary<Json>;
const safeKey = fc.oneof(hostile, fc.constantFrom("valueOf", "toString", "hasOwnProperty")).filter((k) => !["__proto__", "constructor", "prototype"].includes(k));

function bundle(over: { label: string; properties: Record<string, Json>; ids: string[]; demand: number; rules: string[] }): ProjectBundle {
  const ids = [...new Set(over.ids.filter((x) => x !== "" && !["__proto__", "constructor", "prototype", "*"].includes(x)))];
  const nodes = Object.fromEntries(ids.map((id, i) => [id, {
    id, label: over.label, functionality: 3, properties: over.properties, rules: over.rules,
    category_dependency_profiles: { water: { dependency_level: 2, demand: Math.abs(over.demand) } },
    ...(i === 0 ? { supply_capacity: { water: { rate: 4, level: over.demand, retention: 1, efficiency: 1 } } } : { supply_capacity: { water: 7 } }),
  }]));
  const raw = {
    project: {
      version: "2.0", meta: { name: over.label, created_at: "2024-01-01T00:00:00.000Z" }, nodes, edges: {},
      canvases: [{ id: "c", label: over.label, graph: { graph_type: "generic", node_ids: [...ids].reverse(), edge_ids: [] } }],
      update_history: [], scorecard: [],
      series: [{ name: "s", rows: { "*": { [over.label || "2024-01"]: 1 } } }],
      sheets: [{ name: "Mine", rows: [[{ v: over.label }, null, { v: 3, f: "A1*2" }], []] }],
    },
    config: { ...structuredClone(DEFAULT_CONFIG), categories: [{ name: "water", category_type: "SourceToDemands" }] },
  };
  return parseBundle(raw)!;
}

describe("a generated project with hostile values", () => {
  it("comes back exactly through the Workbook model", () => {
    fc.assert(
      fc.property(hostile, fc.dictionary(safeKey, json, { maxKeys: 4 }), fc.array(safeKey, { minLength: 1, maxLength: 4 }), number, fc.array(hostile, { maxLength: 3 }), (label, properties, ids, demand, rules) => {
        const b = bundle({ label, properties, ids, demand, rules });
        fc.pre(b !== null);
        const model = encodeWorkbook(b);
        const parsed = parseDecoded(decodeWorkbook(model), model);
        expect(parsed.problems.filter((p) => p.severity === "error").map(describeProblem)).toEqual([]);
        expect(deepEqual(JSON.parse(JSON.stringify(parsed.bundle)), JSON.parse(JSON.stringify(b)))).toBe(true);
      }),
      { numRuns: 150 },
    );
  });
});

describe("cells and keys", () => {
  it("write any JSON value and read it back, in a list column too", () => {
    fc.assert(fc.property(json, fc.boolean(), (v, list) => {
      const blobs = new Blobs();
      const read = readValue(writeValue(v, blobs, list), blobs.texts, list);
      if (Array.isArray(v) || !list) expect("value" in read && deepEqual(read.value, v)).toBe(true);
    }), { numRuns: 300 });
  });

  it("format a path as a column key and parse it back", () => {
    fc.assert(fc.property(fc.array(safeKey, { minLength: 1, maxLength: 4 }), (path) => {
      expect(parseKey(formatKey(path))).toEqual(path);
    }), { numRuns: 300 });
    expect(formatKey(["supply_capacity", "water", "rate"])).toBe("supply_capacity.water.rate");
    expect(formatKey(["properties", "a.b"])).toBe('properties."a.b"');
  });
});

/** The bundle's model with one cell changed, as a person would in a spreadsheet. */
function edited(b: ProjectBundle, sheet: string, find: (header: string) => boolean, row: number, cell: WorkbookModel["sheets"][number]["rows"][number][number]): WorkbookModel {
  const model = encodeWorkbook(b);
  const s = model.sheets.find((x) => x.name === sheet)!;
  const col = s.rows[0].findIndex((c) => typeof c?.v === "string" && find(c.v));
  s.rows[row][col] = cell;
  return model;
}

describe("what a spreadsheet does to values", () => {
  const b = bundle({ label: "Pump", properties: { workers: 3 }, ids: ["007", "p2"], demand: 5, rules: [] });

  it("reads a number where text belongs as text, with a warning on its cell", () => {
    const model = edited(b, SHEETS.nodes, (h) => h === "label", 1, { v: 12, w: "12" });
    const parsed = parseDecoded(decodeWorkbook(model), model);
    expect(parsed.bundle?.project.nodes["007"].label).toBe("12");
    expect(parsed.problems.map(describeProblem)).toEqual(['Nodes!B2 — read the number as the text "12"; if it had leading zeros, type it as text (\'007)']);
  });

  it("reads a decimal comma and TRUE typed as text, and refuses a formula without a stored value", () => {
    let model = edited(b, SHEETS.nodes, (h) => h === "category_dependency_profiles.water.demand", 1, { v: "2,5", text: true });
    let parsed = parseDecoded(decodeWorkbook(model), model);
    expect(parsed.bundle?.project.nodes["007"].category_dependency_profiles?.water.demand).toBe(2.5);
    model = edited(b, SHEETS.nodes, (h) => h === "label", 1, { v: null, f: "B3" });
    parsed = parseDecoded(decodeWorkbook(model), model);
    expect(parsed.bundle).toBeNull();
    expect(parsed.problems.map(describeProblem)).toContain("Nodes!B2 — a formula without a stored value: open and save the file in a spreadsheet app, or type the value");
  });

  it("names the cell of a value the schema refuses", () => {
    const model = edited(b, SHEETS.nodes, (h) => h === "functionality", 1, { v: "high", text: true });
    const parsed = parseDecoded(decodeWorkbook(model), model);
    expect(parsed.bundle).toBeNull();
    expect(parsed.problems.map(describeProblem).join("\n")).toMatch(/^Nodes!\w+2 — nodes › 007 › functionality: /m);
  });

  it("lets an edit win over what _cascade remembers about that place", () => {
    const model = edited(b, SHEETS.nodes, (h) => h === "label", 1, { v: "Renamed", text: true });
    const decoded = decodeWorkbook(model);
    expect(parseDecoded(decoded, model).bundle?.project.nodes["007"].label).toBe("Renamed");
  });
});
