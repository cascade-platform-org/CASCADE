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
import type { SweepPoint } from "@/lib/temporal-sweep";

export const STATISTICS = ["end", "mean", "min", "max", "total"] as const;
export type Statistic = (typeof STATISTICS)[number];

/** One Simulation's run, or why it has none. */
export interface ComparedRun {
  id: string;
  name: string;
  table: RunTable | null;
  error?: string;
  warnings: string[];
  /** For one run of a Parameter Sweep: its grid point. */
  sweep?: SweepPoint;
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
  sweep?: SweepPoint;
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
 * statistics; a column per swept Parameter holds each sweep run's value. Empty
 * cells for no value.
 */
export function comparisonCsv(c: Comparison): string {
  const swept = sweptParameters(c);
  const lines: (string | number | null)[][] = [["simulation", ...swept, "metric", ...STATISTICS]];
  for (const row of c.rows) {
    const at = (parameter: string) => row.sweep?.find((p) => p.parameter === parameter)?.value ?? null;
    for (const column of c.columns) {
      const stats = row.stats[column];
      if (stats) lines.push([row.name, ...swept.map(at), column, ...STATISTICS.map((s) => stats[s])]);
    }
  }
  return lines.map((l) => l.map(csvCell).join(",")).join("\n");
}

/** The Parameters a comparison's runs sweep, in the order first met. */
export function sweptParameters(c: Comparison): string[] {
  return [...new Set(c.rows.flatMap((r) => (r.sweep ?? []).map((p) => p.parameter)))];
}

/** The values a comparison's runs give one swept Parameter, ascending. */
export function sweptValues(c: Comparison, parameter: string): number[] {
  const values = c.rows.flatMap((r) => r.sweep?.filter((p) => p.parameter === parameter).map((p) => p.value) ?? []);
  return [...new Set(values)].sort((a, b) => a - b);
}

/** One statistic of one Metric over two swept Parameters: `cells[i][j]` is the run at ys[i], xs[j]. */
export interface SweepMap {
  xs: number[];
  ys: number[];
  cells: (number | null)[][];
  /** The range of the cells' values; null when every cell is empty. */
  lo: number | null;
  hi: number | null;
}

/**
 * A statistic of one Metric laid out over two swept Parameters, every other
 * swept Parameter held at its value in `fixed`. A cell is empty where the grid
 * has no run, or the run has no value; runs outside the sweep are ignored.
 */
export function sweepMap(c: Comparison, metric: string, statistic: Statistic, x: string, y: string, fixed: Readonly<Record<string, number>>): SweepMap {
  const xs = sweptValues(c, x);
  const ys = sweptValues(c, y);
  const cells: (number | null)[][] = ys.map(() => xs.map(() => null));
  for (const row of c.rows) {
    if (!row.sweep) continue;
    const at = (parameter: string) => row.sweep?.find((p) => p.parameter === parameter)?.value;
    const held = Object.entries(fixed).every(([p, v]) => p === x || p === y || at(p) === v);
    const i = ys.indexOf(at(y) ?? NaN);
    const j = xs.indexOf(at(x) ?? NaN);
    if (held && i >= 0 && j >= 0) cells[i][j] = row.stats[metric]?.[statistic] ?? null;
  }
  const present = cells.flat().filter((v): v is number => v !== null);
  return { xs, ys, cells, lo: present.length ? Math.min(...present) : null, hi: present.length ? Math.max(...present) : null };
}
