/**
 * decimal-comma.ts — a number typed or pasted from a decimal-comma spreadsheet
 * ("1,5") read as the number it means. One rule for every place that reads
 * typed numbers: Profile cells, Series paste, sweep values, workbook cells.
 */

/** The text trimmed, with a decimal comma ("1,5", "-0,25") made a decimal point; other text as it is. */
export const withDecimalPoint = (text: string): string => text.trim().replace(/^([+-]?\d+),(\d+)$/, "$1.$2");
