import { readFileSync, readdirSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseBundle } from "@/lib/file-io";
import { decodeWorkbook, encodeWorkbook, parseDecoded } from "./codec";
import { readCascadeSheet, CASCADE_SHEET, type ResidualEntry } from "./residual";
import { jsonEqual } from "./paths";

const dirs = ["samples/public", "samples/private"].filter(existsSync);
const samples = dirs.flatMap((d) => readdirSync(d).filter((f) => f.endsWith(".json") && f !== "manifest.json" && !f.startsWith("cascade-recovery")).map((f) => `${d}/${f}`));

describe.each(samples)("the sample %s as a Workbook", (file) => {
  it("comes back exactly, through the model, with a residual of orders and empty containers only", () => {
    const bundle = parseBundle(JSON.parse(readFileSync(file, "utf8")));
    if (!bundle) return; // a project-only sample: not a bundle
    const model = encodeWorkbook(bundle);
    const decoded = decodeWorkbook(model);
    const parsed = parseDecoded(decoded, model);
    expect(parsed.problems.filter((p) => p.severity === "error")).toEqual([]);
    expect(jsonEqual(JSON.parse(JSON.stringify(parsed.bundle)), JSON.parse(JSON.stringify(bundle)))).toBe(true);
    const entries = JSON.parse(readCascadeSheet(model.sheets.find((s) => s.name === CASCADE_SHEET)).get("residual") ?? "[]") as ResidualEntry[];
    for (const e of entries) {
      const v = e.v;
      const emptyOrOrder = e.d === true || (Array.isArray(v) && (v.length === 0 || e.p.at(-1) === "node_ids" || e.p.at(-1) === "edge_ids")) || (typeof v === "object" && v !== null && Object.keys(v).length === 0) || e.p.includes("profile");
      expect(emptyOrOrder, `residual at ${e.p.join(" › ")}: ${String(JSON.stringify(v)).slice(0, 160)}`).toBe(true);
    }
  });
});
