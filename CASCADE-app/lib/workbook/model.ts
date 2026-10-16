/**
 * model.ts — a Workbook as plain data, independent of any file library
 * (ADR-0023 §5): sheets of rows of cells. The codec reads and writes this
 * model; `sheetjs-adapter.ts` alone turns it into `.xlsx` / `.ods` bytes.
 */

type CellValue = string | number | boolean;

export interface Cell {
  /** The value; null for an empty cell (a formula without a stored result is one). */
  v: CellValue | null;
  /** A formula, in A1 syntax without the leading "=". */
  f?: string;
  /** The text the spreadsheet showed (a read cell's formatted value), when known. */
  w?: string;
  /** Read only: the spreadsheet stored a date (v is its serial number). */
  date?: boolean;
  /** Read only: an error value (#N/A, #REF!…), named by `w`. */
  error?: boolean;
  /** Write only: format the cell as text, so the spreadsheet keeps what is typed in it as typed. */
  text?: boolean;
}

export interface SheetModel {
  name: string;
  rows: (Cell | null)[][];
  hidden?: boolean;
}

export interface WorkbookModel {
  sheets: SheetModel[];
}

/** Where a value came from or goes: a sheet's cell, 0-based row and column. */
export interface CellRef {
  sheet: string;
  row: number;
  col: number;
}

/** "Nodes!F7": what a person reads; rows and columns 1-based, columns as letters. */
export function a1(ref: CellRef): string {
  let c = ref.col + 1;
  let letters = "";
  while (c > 0) {
    const m = (c - 1) % 26;
    letters = String.fromCharCode(65 + m) + letters;
    c = Math.floor((c - 1) / 26);
  }
  return `${ref.sheet}!${letters}${ref.row + 1}`;
}

export interface Problem {
  severity: "error" | "warning" | "note";
  at?: CellRef;
  message: string;
}

export const textCell = (v: string): Cell => ({ v, text: true });
