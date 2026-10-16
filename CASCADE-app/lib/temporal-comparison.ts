/**
 * temporal-comparison.ts — several Temporal Simulations' runs side by side
 * (ADR-0019 §4, revised 2026-10-09). Pure.
 *
 * Each run gives its Run table; a comparison lines the tables up by column
 * name, so a Metric two Simulations both define is one column, and one only
 * some define is empty for the others. Per run and column it keeps the series
 * and five statistics: the last period's value, the mean, minimum and maximum
 * over periods with a value, and their total (what a per-period flow, such as
 * "settled this month", adds up to over the run).
 */

import { columnSummaries, csvCell, type RunTable } from "@/lib/temporal-metrics";

export const STATISTICS = ["end", "mean", "min", "max", "total"] as const;
export type Statistic = (typeof STATISTICS)[number];

/** One Simulation's run, or why it has none. */
export interface ComparedRun {
  id: string;
  name: string;
  table: RunTable | null;
  error?: string;
  warnings: string[];
  /** For one value of a Parameter Sweep: the Parameter and its value. */
  sweep?: { parameter: string; value: number };
}

interface ComparisonRow {
  id: string;
  name: string;
  error?: string;
  warnings: string[];
  /** Period labels of this run. */
  periods: string[];
  /** Column name → the column's values in period order; absent when this run has no such column. */
  values: Record<string, (number | null)[]>;
  sweep?: { parameter: string; value: number };
  /** Column name → statistic → value; null when the run has no value for it. */
  stats: Record<string, Record<Statistic, number | null>>;
}

export interface Comparison {
  /** Every column name, in the order first met. */
  columns: string[];
  rows: ComparisonRow[];
}

export function compareRuns(runs: readonly ComparedRun[]): Comparison {
  const columns: string[] = [];
  const rows = runs.map((run): ComparisonRow => {
    const row: ComparisonRow = {
      id: run.id, name: run.name, warnings: run.warnings, periods: [], values: {}, stats: {}, error: run.error, sweep: run.sweep,
    };
    if (!run.table) return row;
    row.periods = run.table.rows.map((r) => r.label);
    const summaries = columnSummaries(run.table);
    run.table.columns.forEach((c, i) => {
      if (!columns.includes(c.label)) columns.push(c.label);
      const s = summaries[i];
      const present = s.values.filter((v): v is number => v !== null);
      row.values[c.label] = s.values;
      row.stats[c.label] = {
        end: s.values[s.values.length - 1] ?? null,
        mean: s.mean,
        min: s.min,
        max: s.max,
        total: present.length ? present.reduce((a, b) => a + b, 0) : null,
      };
    });
    return row;
  });
  return { columns, rows };
}

/**
 * The comparison as CSV: one line per run and column, with the five
 * statistics; a sweep's run names its Parameter and value. Empty cells for no value.
 */
export function comparisonCsv(c: Comparison): string {
  const lines: (string | number | null)[][] = [["simulation", "parameter", "value", "metric", ...STATISTICS]];
  for (const row of c.rows) {
    for (const column of c.columns) {
      const stats = row.stats[column];
      if (stats) lines.push([row.name, row.sweep?.parameter ?? null, row.sweep?.value ?? null, column, ...STATISTICS.map((s) => stats[s])]);
    }
  }
  return lines.map((l) => l.map(csvCell).join(",")).join("\n");
}
