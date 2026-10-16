/**
 * sheetjs-adapter.ts — the Workbook model as `.xlsx` / `.ods` bytes, and back
 * (ADR-0023 §5). The only module that imports SheetJS, loaded on demand so the
 * app's first load does not carry it.
 *
 * What SheetJS does not do right is done here (measured in
 * sheetjs-capabilities.test.ts and with LibreOffice):
 * - a formula is written without a stored value, so the spreadsheet app
 *   computes it when the file is opened (a stored value is never recomputed);
 * - in `.ods`, formulas are written and read as OpenFormula by `formula.ts`
 *   (SheetJS converts references to other sheets wrongly), through a
 *   placeholder it writes and this replaces in `content.xml`;
 * - in `.ods`, a hidden sheet is marked hidden in `content.xml`.
 */

import type { CellObject, WorkBook, WorkSheet } from "xlsx";
import type { Cell, SheetModel, WorkbookModel } from "./model";
import { excelToOds, odsToExcel } from "./formula";

export type WorkbookKind = "xlsx" | "ods";

const ODS_MIME = "application/vnd.oasis.opendocument.spreadsheet";
const PLACEHOLDER = (k: number) => `CASCADEF(${k})`;

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const unescapeXml = (s: string) =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|quot|apos|lt|gt|amp);/g, (_m, e: string) =>
    e === "quot" ? '"' : e === "apos" ? "'" : e === "lt" ? "<" : e === "gt" ? ">" : e === "amp" ? "&" : String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)));

/** The model as file bytes. */
export async function writeBytes(model: WorkbookModel, kind: WorkbookKind): Promise<Uint8Array> {
  const X = await import("xlsx");
  const wb: WorkBook = X.utils.book_new();
  const formulas: string[] = [];
  for (const sheet of model.sheets) {
    const ws: WorkSheet = {};
    let maxR = 0;
    let maxC = 0;
    sheet.rows.forEach((row, r) => row.forEach((c, col) => {
      if (!c || (c.v === null && c.f === undefined)) return;
      maxR = Math.max(maxR, r);
      maxC = Math.max(maxC, col);
      ws[X.utils.encode_cell({ r, c: col })] = toSheetJs(c, kind, formulas);
    }));
    ws["!ref"] = X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
    X.utils.book_append_sheet(wb, ws, sheet.name);
  }
  wb.Workbook = { Sheets: model.sheets.map((s) => ({ Hidden: s.hidden ? 1 : 0 })) };
  // An .ods is re-zipped by patchOds, which compresses it then.
  const bytes = new Uint8Array(X.write(wb, { type: "array", bookType: kind, compression: kind === "xlsx" }) as ArrayBuffer);
  return kind === "ods" ? patchOds(bytes, formulas, model.sheets.filter((s) => s.hidden).map((s) => s.name)) : bytes;
}

function toSheetJs(c: Cell, kind: WorkbookKind, formulas: string[]): CellObject {
  if (c.f !== undefined) {
    // No stored value: the app computes it on opening. In .ods, a placeholder replaced in content.xml.
    if (kind === "xlsx") return { t: "n", f: c.f };
    formulas.push(excelToOds(c.f));
    return { t: "s", v: "", f: PLACEHOLDER(formulas.length - 1) };
  }
  if (typeof c.v === "boolean") return { t: "b", v: c.v };
  if (typeof c.v === "number") return { t: "n", v: c.v };
  return { t: "s", v: c.v ?? "", ...(c.text ? { z: "@" } : {}) };
}

/** Replace the formula placeholders and mark hidden sheets, in the `.ods` content.xml. */
async function patchOds(bytes: Uint8Array, formulas: readonly string[], hidden: readonly string[]): Promise<Uint8Array> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(bytes);
  let xml = await zip.file("content.xml")!.async("string");
  // A placeholder cell: its formula becomes the real one, and its empty stored value goes.
  xml = xml.replace(/table:formula="of:=CASCADEF\((\d+)\)"([^>]*)>/g, (_m, k: string, rest: string) => {
    const cleaned = rest.replace(/\s(office:value-type|office:string-value|calcext:value-type)="[^"]*"/g, "");
    return `table:formula="${escapeXml(formulas[Number(k)])}"${cleaned}>`;
  });
  if (hidden.length > 0) {
    xml = xml.replace("</office:automatic-styles>", '<style:style style:name="cascade_hidden" style:family="table" style:master-page-name="mp1"><style:table-properties table:display="false" style:writing-mode="lr-tb"/></style:style></office:automatic-styles>');
    for (const name of hidden) {
      xml = xml.replace(new RegExp(`(<table:table table:name="${escapeXml(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" table:style-name=")[^"]*"`), "$1cascade_hidden\"");
    }
  }
  zip.file("content.xml", xml);
  zip.file("mimetype", ODS_MIME, { compression: "STORE" });
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", mimeType: ODS_MIME });
}

/** File bytes as the model; an `.ods` file's formulas are read from its content.xml as OpenFormula. */
export async function readBytes(bytes: Uint8Array): Promise<WorkbookModel> {
  const X = await import("xlsx");
  const wb = X.read(bytes, { type: "array", cellFormula: true, cellText: true, cellNF: true, cellDates: false });
  // SheetJS names the format it read: only an .ods is opened a second time, for what SheetJS reads wrong in it.
  const ods = wb.bookType === "ods" ? await readOdsCells(bytes) : null;
  const sheets: SheetModel[] = wb.SheetNames.map((name, i) => {
    const ws = wb.Sheets[name];
    const odsSheet = ods?.get(name);
    const rows: (Cell | null)[][] = [];
    const range = ws["!ref"] ? X.utils.decode_range(ws["!ref"]) : null;
    for (let r = 0; range && r <= range.e.r; r++) {
      const row: (Cell | null)[] = [];
      for (let c = 0; c <= range.e.c; c++) {
        const cellObj = ws[X.utils.encode_cell({ r, c })] as CellObject | undefined;
        const extra = odsSheet?.get(`${r},${c}`);
        row.push(cellObj ? fromSheetJs(cellObj, extra, X.SSF.is_date) : extra?.formula ? { v: null, f: odsToExcel(extra.formula) } : null);
      }
      while (row.length > 0 && row[row.length - 1] === null) row.pop();
      rows.push(row);
    }
    while (rows.length > 0 && rows[rows.length - 1].length === 0) rows.pop();
    return { name, rows, ...(wb.Workbook?.Sheets?.[i]?.Hidden ? { hidden: true } : {}) };
  });
  return { sheets };
}

function fromSheetJs(o: CellObject, ods: OdsCell | undefined, isDate: (fmt: string) => boolean): Cell | null {
  const f = ods?.formula !== undefined ? odsToExcel(ods.formula) : o.f;
  // SheetJS reads an .ods true/false as 1/0: the file says it is a boolean.
  if (ods?.boolean !== undefined && f === undefined) return { v: ods.boolean };
  const w = o.w;
  // A formula the app never computed: SheetJS reads it as an error with no value.
  if (o.t === "e" && o.v === undefined) return f !== undefined ? { v: null, f } : null;
  if (o.t === "e") return { v: null, error: true, ...(w !== undefined ? { w } : {}), ...(f !== undefined ? { f } : {}) };
  if (o.t === "z" || o.v === undefined || (f !== undefined && o.v === "")) return f !== undefined ? { v: null, f } : null;
  const v = o.v instanceof Date ? o.v.getTime() : (o.v as string | number | boolean);
  const date = o.t === "n" && typeof o.z === "string" && isDate(o.z);
  return { v, ...(f !== undefined ? { f } : {}), ...(w !== undefined ? { w } : {}), ...(date ? { date: true } : {}) };
}

interface OdsCell {
  formula?: string;
  boolean?: boolean;
}

const ATTRIBUTES = new Map<string, RegExp>();
/** An XML attribute's raw value in a tag's attribute text. */
function attr(attrs: string, name: string): string | undefined {
  let re = ATTRIBUTES.get(name);
  if (!re) ATTRIBUTES.set(name, (re = new RegExp(`\\s${name}="([^"]*)"`)));
  return re.exec(attrs)?.[1];
}

/** An `.ods` file's formulas and true/false cells by sheet and "row,col", as its content.xml has them. */
async function readOdsCells(bytes: Uint8Array): Promise<Map<string, Map<string, OdsCell>> | null> {
  const { default: JSZip } = await import("jszip");
  let zip;
  try { zip = await JSZip.loadAsync(bytes); } catch { return null; }
  const xml = (await zip.file("content.xml")?.async("string")) ?? "";
  const out = new Map<string, Map<string, OdsCell>>();
  const TAG = /<table:table-row\b([^>]*?)(\/?)>|<\/table:table-row>|<table:(?:covered-)?table-cell\b([^>]*?)(\/?)>|<table:table(?=[\s>])([^>]*)>|<\/table:table>/g;
  let sheet: Map<string, OdsCell> | null = null;
  let r = 0;
  let c = 0;
  let rowRepeat = 1;
  for (const m of xml.matchAll(TAG)) {
    const [tag, rowAttrs, rowSelf, cellAttrs, , tableAttrs] = m;
    if (tableAttrs !== undefined) {
      sheet = new Map();
      out.set(unescapeXml(attr(tableAttrs ?? "", "table:name") ?? ""), sheet);
      r = 0;
    } else if (tag === "</table:table>") {
      sheet = null;
    } else if (rowAttrs !== undefined) {
      rowRepeat = Number(attr(rowAttrs, "table:number-rows-repeated") ?? 1);
      c = 0;
      if (rowSelf) r += rowRepeat;
    } else if (tag === "</table:table-row>") {
      r += rowRepeat;
    } else if (cellAttrs !== undefined && sheet) {
      const repeat = Number(attr(cellAttrs, "table:number-columns-repeated") ?? 1);
      const formula = attr(cellAttrs, "table:formula");
      const boolean = attr(cellAttrs, "office:value-type") === "boolean" ? attr(cellAttrs, "office:boolean-value") === "true" : undefined;
      if (formula !== undefined || boolean !== undefined) {
        const extra: OdsCell = { ...(formula !== undefined ? { formula: unescapeXml(formula) } : {}), ...(boolean !== undefined ? { boolean } : {}) };
        for (let k = 0; k < repeat; k++) sheet.set(`${r},${c + k}`, extra);
      }
      c += repeat;
    }
  }
  return out;
}
