import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { deepEqual } from "@/lib/graph-diff";
import { parseBundle, type ProjectBundle } from "@/lib/file-io";
import { encodeWorkbook, SHEETS } from "./codec";
import { composeImport, readImport, type ReadImport } from "./import-changes";
import { a1, cellText, textCell, type Cell, type SheetModel, type WorkbookModel } from "./model";
import { writeBytes, readBytes } from "./sheetjs-adapter";

const sample = parseBundle(JSON.parse(readFileSync("samples/public/IJDRR_example.json", "utf8")))!;
const json = (b: unknown) => JSON.parse(JSON.stringify(b));

const sheet = (m: WorkbookModel, name: string) => m.sheets.find((s) => s.name === name)!;
const col = (s: SheetModel, key: string) => s.rows[0].findIndex((c) => cellText(c) === key);
const rowOf = (s: SheetModel, id: string) => s.rows.findIndex((r, i) => i > 0 && cellText(r[col(s, "id")]) === id);
const set = (s: SheetModel, row: number, key: string, c: Cell | null) => { s.rows[row][col(s, key)] = c; };

/** The sample as an untouched Workbook model. */
const workbook = (b: ProjectBundle = sample) => encodeWorkbook(b);
const ok = (r: ReadImport) => {
  if (!r.ok) throw new Error(r.problems.map((p) => p.message).join("\n"));
  return r;
};
let k = 0;
const suffix = () => `t${k++}`;

describe("Import changes", () => {
  it("an untouched workbook changes nothing", () => {
    const read = ok(readImport(sample, workbook(), "same.xlsx"));
    const c = composeImport(read);
    expect(c.checked.ok && c.checked.preview.lines).toEqual([]);
    expect(c.groups).toEqual([]);
  });

  it("an edited cell is one change, its subject's", () => {
    const m = workbook();
    const nodes = sheet(m, SHEETS.nodes);
    const id = Object.keys(sample.project.nodes)[0];
    set(nodes, rowOf(nodes, id), "label", textCell("Renamed"));
    const c = composeImport(ok(readImport(sample, m, "edit.xlsx")));
    expect(c.groups.map((g) => g.subjects)).toEqual([[`node:${id}`]]);
    expect(c.checked.ok && c.checked.after.project.nodes[id].label).toBe("Renamed");
    // Left out, nothing changes.
    const out = composeImport(ok(readImport(sample, m, "edit.xlsx")), new Set([0]));
    expect(out.checked.ok && out.checked.preview.lines).toEqual([]);
    expect(out.groups[0].left_out).toBe(true);
  });

  it("a missing row deletes its record; a reference left to it is refused at its cell", () => {
    const m = workbook();
    const edges = sheet(m, SHEETS.edges);
    const edge = Object.values(sample.project.edges)[0];
    edges.rows.splice(rowOf(edges, edge.id), 1);
    const c = composeImport(ok(readImport(sample, m, "x.xlsx")));
    expect(c.checked.ok && Object.hasOwn(c.checked.after.project.edges, edge.id)).toBe(false);
    expect(c.checked.ok && c.checked.after.project.canvases.some((cv) => cv.graph.edge_ids.includes(edge.id))).toBe(false);

    // A node's row gone while its edges stay: the edges' references are refused, each at its row.
    const m2 = workbook();
    const nodes = sheet(m2, SHEETS.nodes);
    nodes.rows.splice(rowOf(nodes, edge.source), 1);
    const refused = composeImport(ok(readImport(sample, m2, "x.xlsx")));
    expect(refused.checked.ok).toBe(false);
    expect(refused.problems.some((p) => p.at?.sheet === SHEETS.edges && /source/.test(p.message))).toBe(true);
  });

  it("a missing sheet changes nothing", () => {
    const m = workbook();
    m.sheets = m.sheets.filter((s) => s.name !== SHEETS.events && s.name !== SHEETS.operations && s.name !== SHEETS.canvases);
    const c = composeImport(ok(readImport(sample, m, "x.xlsx")));
    expect(c.checked.ok && c.checked.preview.lines).toEqual([]);
  });

  it("a new row becomes a record: an id, Functionality N, the only Canvas, a place; marked from its row, unconfirmed", () => {
    const b = { ...sample, project: { ...sample.project, canvases: sample.project.canvases.slice(0, 1) } };
    const one = parseBundle(json({ ...b, project: { ...b.project, nodes: Object.fromEntries(Object.entries(b.project.nodes).filter(([id]) => b.project.canvases[0].graph.node_ids.includes(id))), edges: Object.fromEntries(Object.entries(b.project.edges).filter(([id]) => b.project.canvases[0].graph.edge_ids.includes(id))) } }))!;
    const m = workbook(one);
    const nodes = sheet(m, SHEETS.nodes);
    const row: (Cell | null)[] = nodes.rows[0].map(() => null);
    row[col(nodes, "label")] = textCell("New pump");
    nodes.rows.push(row);
    const read = ok(readImport(one, m, "Coop.xlsx", suffix));
    const c = composeImport(read);
    expect(c.checked.ok).toBe(true);
    if (!c.checked.ok) return;
    const added = Object.values(c.checked.after.project.nodes).find((n) => n.label === "New pump")!;
    expect(added.id).toMatch(/^n-new-pump-t\d+$/);
    // Read again, the same file gives the same id: Apply reads it again before writing.
    const again = composeImport(ok(readImport(one, m, "Coop.xlsx")));
    const twice = composeImport(ok(readImport(one, m, "Coop.xlsx")));
    expect(again.groups.map((g) => g.title)).toEqual(twice.groups.map((g) => g.title));
    expect(added.functionality).toBe(one.config.functionality_scale.length);
    expect(added.position).toBeDefined();
    expect(c.checked.after.project.canvases[0].graph.node_ids).toContain(added.id);
    expect(added.provenance).toEqual({ origin: "spreadsheet", confirmed: false, source: { file: "Coop.xlsx", sheet: SHEETS.nodes, row: nodes.rows.length } });
    expect(read.problems.some((p) => p.severity === "note" && p.message.includes(added.id))).toBe(true);
  });

  it("every subset left out is either refused with reasons or valid, and the open project never changes", () => {
    const m = workbook();
    const nodes = sheet(m, SHEETS.nodes);
    const edges = sheet(m, SHEETS.edges);
    const [n1, n2] = Object.keys(sample.project.nodes);
    set(nodes, rowOf(nodes, n1), "label", textCell("A"));
    set(nodes, rowOf(nodes, n2), "label", textCell("B"));
    edges.rows.splice(1, 1);
    const frozen = json(sample);
    const read = ok(readImport(sample, m, "x.xlsx"));
    const n = composeImport(read).groups.length;
    for (let mask = 0; mask < 1 << n; mask++) {
      const out = new Set([...Array(n).keys()].filter((i) => mask & (1 << i)));
      const c = composeImport(read, out);
      if (!c.checked.ok) expect(c.problems.length).toBeGreaterThan(0);
      if (mask === (1 << n) - 1) expect(c.checked.ok && c.checked.preview.lines).toEqual([]);
    }
    expect(deepEqual(json(sample), frozen)).toBe(true);
  });

  it("deleting most Elements asks for an extra tick", () => {
    const m = workbook();
    sheet(m, SHEETS.edges).rows.splice(1);
    const c = composeImport(ok(readImport(sample, m, "x.xlsx")));
    expect(c.massDeletion?.removed).toBe(Object.keys(sample.project.edges).length);
  });

  it("a custom sheet writes its values into the sheet it names; two sheets disagreeing are refused at both cells", () => {
    const id = Object.keys(sample.project.nodes)[0];
    const sheets = [
      { name: "Mine", writes: "Nodes", rows: [[{ v: "id" }, { v: "label" }], [{ v: id }, { v: "From my sheet", f: "\"From my sheet\"" }]] },
    ];
    const b = parseBundle(json({ ...sample, project: { ...sample.project, sheets } }))!;
    // A formula is written without its value: the spreadsheet app computes it on opening.
    const computed = workbook(b);
    sheet(computed, "Mine").rows[1][1] = { v: "From my sheet", f: "\"From my sheet\"" };
    const unopened = readImport(b, workbook(b), "x.xlsx");
    expect(unopened.ok === false && unopened.problems.map((p) => p.at && a1(p.at))).toEqual(["Mine!B2"]);
    const c = composeImport(ok(readImport(b, computed, "x.xlsx")));
    expect(c.checked.ok && c.checked.after.project.nodes[id].label).toBe("From my sheet");

    const two = parseBundle(json({ ...sample, project: { ...sample.project, sheets: [...sheets, { name: "Other", writes: "Nodes", rows: [[{ v: "id" }, { v: "label" }], [{ v: id }, { v: "Else" }]] }] } }))!;
    const both = workbook(two);
    sheet(both, "Mine").rows[1][1] = { v: "From my sheet", f: "\"From my sheet\"" };
    const r = readImport(two, both, "x.xlsx");
    expect(r.ok).toBe(false);
    const at = r.problems.filter((p) => p.severity === "error").map((p) => p.at && a1(p.at));
    expect(at.sort()).toEqual(["Mine!B2", "Other!B2"]);
  });

  it("a file written before the project changed gives back the project where its cells were not edited", () => {
    const old = workbook();
    // Since the export, a Canvas's members were reordered (an order no cell shows).
    const now = json(sample) as ProjectBundle;
    now.project.canvases[0].graph.node_ids.reverse();
    const c = composeImport(ok(readImport(now, old, "old.xlsx")));
    expect(c.checked.ok && c.checked.preview.lines).toEqual([]);
  });

  it("a number a spreadsheet rounded to 15 significant digits is no change", () => {
    const b = json(sample) as ProjectBundle;
    const id = Object.keys(b.project.nodes)[0];
    b.project.nodes[id].position = { x: 399.0595011899433, y: 316.29488771584465 };
    // LibreOffice rounds at a 5 either way: …079705 comes back …07971.
    b.project.nodes[Object.keys(b.project.nodes)[1]].position = { x: 508.8922317079705, y: 1 };
    const m = workbook(b);
    const nodes = sheet(m, SHEETS.nodes);
    set(nodes, rowOf(nodes, id), "position.x", { v: 399.059501189943 });
    set(nodes, rowOf(nodes, id), "position.y", { v: 316.294887715845 });
    set(nodes, rowOf(nodes, Object.keys(b.project.nodes)[1]), "position.x", { v: 508.892231707971 });
    const c = composeImport(ok(readImport(b, m, "x.xlsx")));
    expect(c.checked.ok && c.checked.preview.lines).toEqual([]);
  });

  it("works on a real file", async () => {
    const m = workbook();
    const nodes = sheet(m, SHEETS.nodes);
    const id = Object.keys(sample.project.nodes)[1];
    set(nodes, rowOf(nodes, id), "label", textCell("Through a file"));
    const back = await readBytes(await writeBytes(m, "ods"));
    const c = composeImport(ok(readImport(sample, back, "x.ods")));
    expect(c.groups.map((g) => g.title)).toEqual([`Change Node "Through a file" (${id})`]);
  });
});
