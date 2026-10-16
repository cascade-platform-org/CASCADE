/**
 * custom-sheet.ts — a person's own Workbook sheet, kept in the project with its
 * values and formulas (ADR-0023 §4a). The spreadsheet app computes it; CASCADE
 * never evaluates a formula. One that declares the model sheet it `writes`
 * sends its values to the model through Import changes. Mirrors
 * `schemas/custom_sheet.py`.
 */

import { z } from "zod";

/** A spreadsheet's limits on a sheet name: 1–31 characters, none of []:*?/\, no apostrophe at either end. */
export const SHEET_NAME_PATTERN = /^[^[\]:*?/\\']([^[\]:*?/\\]*[^[\]:*?/\\'])?$/;

export const SheetCellSchema = z
  .object({
    /** The value (the formula's last result); null = empty. */
    v: z.union([z.number(), z.boolean(), z.string()]).nullable().default(null),
    /** The formula, in A1 syntax without the leading "=". */
    f: z.string().min(1).optional(),
  })
  .strict();
export type SheetCell = z.infer<typeof SheetCellSchema>;

export const CustomSheetSchema = z
  .object({
    name: z.string().min(1).max(31).regex(SHEET_NAME_PATTERN, "a sheet name of at most 31 characters, none of []:*?/\\, no apostrophe at either end"),
    /** The model sheet whose columns this sheet uses and whose records it writes; absent = analysis only. */
    writes: z.string().min(1).optional(),
    /** When the spreadsheet app last computed it (ISO 8601), if known. */
    computed_at: z.string().optional(),
    /** Row by row from A1; null = an empty cell. */
    rows: z.array(z.array(SheetCellSchema.nullable())).default([]),
  })
  .strict();
export type CustomSheet = z.infer<typeof CustomSheetSchema>;
