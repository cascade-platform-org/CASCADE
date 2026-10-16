/**
 * formula.ts — a custom sheet's formula between Excel's A1 syntax (how the
 * project keeps it) and OpenFormula (how an `.ods` file holds it). SheetJS
 * gets references to other sheets wrong in both directions, so the `.ods`
 * adapter uses this instead (ADR-0023 §5).
 *
 *   Excel   SUM('S·worked h'!B2:C2)+IF(A2>1,1,0)
 *   ODS     of:=SUM([$'S·worked h'.B2:.C2])+IF([.A2]>1;1;0)
 *
 * Text in quotes is copied as it is. Only references and the argument and
 * array separators change; function names stay (an `.ods` reader that does
 * not know one shows #NAME?, as it would for the same name typed in it).
 */

const CELL = String.raw`\$?[A-Z]{1,3}\$?\d+`;
const COL = String.raw`\$?[A-Z]{1,3}`;
const ROW = String.raw`\$?\d+`;
const EXCEL_SHEET = String.raw`(?:'(?:[^']|'')+'|[A-Za-z_À-￿][\w.À-￿]*)!`;
const EXCEL_REF = new RegExp(
  String.raw`(?<![\w.$'!])(${EXCEL_SHEET})?(${CELL}(?::${CELL})?|${COL}:${COL}|${ROW}:${ROW})(?![\w(!])`,
  "g",
);

/** Split a formula into quoted texts (kept) and the rest (translated). */
function segments(f: string): { text: string; quoted: boolean }[] {
  const out: { text: string; quoted: boolean }[] = [];
  let i = 0;
  while (i < f.length) {
    const q = f.indexOf('"', i);
    if (q < 0) { out.push({ text: f.slice(i), quoted: false }); break; }
    if (q > i) out.push({ text: f.slice(i, q), quoted: false });
    let j = q + 1;
    while (j < f.length && !(f[j] === '"' && f[j + 1] !== '"')) j += f[j] === '"' ? 2 : 1;
    out.push({ text: f.slice(q, j + 1), quoted: true });
    i = j + 1;
  }
  return out;
}

const unquoteExcel = (s: string) => (s.startsWith("'") ? s.slice(1, -1).replace(/''/g, "'") : s);
const quoteOds = (name: string) => (/^[A-Za-z_][\w]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`);
const quoteExcel = (name: string) => (/^[A-Za-z_][\w.]*$/.test(name) && !/^[A-Z]{1,3}\d+$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`);

/** An Excel A1 formula (no leading "=") as an `.ods` `table:formula` value. */
export function excelToOds(f: string): string {
  const body = segments(f).map(({ text, quoted }) => {
    if (quoted) return text;
    const refs = text.replace(EXCEL_REF, (_m, sheet: string | undefined, ref: string) => {
      const [a, b] = ref.split(":");
      const where = sheet ? `$${quoteOds(unquoteExcel(sheet.slice(0, -1)))}` : "";
      return `[${where}.${a}${b !== undefined ? `:.${b}` : ""}]`;
    });
    return refs.replace(/;/g, "|").replace(/,/g, ";");
  }).join("");
  return `of:=${body}`;
}

const ODS_REF = /\[(\$?(?:'(?:[^']|'')+'|[^.[\]']*))?\.([^\]:]+)(?::(\$?(?:'(?:[^']|'')+'|[^.[\]':]*))?\.([^\]]+))?\]/g;

/** An `.ods` `table:formula` value as an Excel A1 formula (no leading "="). */
export function odsToExcel(f: string): string {
  let body = f.startsWith("of:") ? f.slice(3) : f;
  body = body.replace(/^==?/, "");
  return segments(body).map(({ text, quoted }) => {
    if (quoted) return text;
    const refs = text.replace(ODS_REF, (_m, sheet: string | undefined, a: string, _sheet2: string | undefined, b: string | undefined) => {
      const name = sheet ? sheet.replace(/^\$/, "") : "";
      const prefix = name ? `${quoteExcel(name.startsWith("'") ? name.slice(1, -1).replace(/''/g, "'") : name)}!` : "";
      return `${prefix}${a}${b !== undefined ? `:${b}` : ""}`;
    });
    return refs.replace(/COM\.MICROSOFT\./g, "").replace(/;/g, ",").replace(/\|/g, ";");
  }).join("");
}
