/**
 * temporal-metrics.ts — a Temporal Simulation run's table: periods × Metrics
 * (ADR-0019 §4).
 *
 * Metrics are view definitions evaluated at read time over the run record; a
 * Metric at period t reads period t and earlier only. Three standard Metrics
 * come first: the Operativity Score, as the Scorecard computes it, at each
 * period's end; coverage per Category, delivered ÷ demand over its consumers at
 * the period's last propagating Phase; and stock level per Category, the signed
 * sum of its Stocks' levels at the period's end. Then the project's own Metrics.
 * Presentation arithmetic over recorded state, so no Rule and no engine call
 * (CLAUDE.md §7). Pure; the Run table and the CSV export both read `runTable`.
 */

import { readPath } from "@/lib/attribute-operations";
import { applyGraphDiff } from "@/lib/graph-diff";
import { canvasesById, matchElements } from "@/lib/element-filter";
import { computeOperativityScore } from "@/lib/scorecard-utils";
import { demandOf } from "@/lib/stock-integration";
import { stocksIn } from "@/lib/stock-math";
import type { RunRecord } from "@/lib/step-operator";
import type { GraphSnapshot } from "@/lib/schemas/network";
import { STANDARD_METRICS, type Metric, type StandardMetric } from "@/lib/schemas/temporal-simulation";

interface RunColumn {
  key: string;
  label: string;
}

export interface RunTable {
  columns: RunColumn[];
  /** One row per period, values aligned with `columns`; null = no value (an empty selection, say). */
  rows: { label: string; values: (number | null)[] }[];
}

/** The standard Metrics' names (ADR-0019 §4); after a run, coverage and stock level get a column per Category. */
export const STANDARD_COLUMNS: Record<StandardMetric, string> = { operativity: "Operativity %", coverage: "Coverage", stock_level: "Stock level" };

/** A table value as the Run table and a saved period show it; null is no value. */
export const formatMetric = (v: number | null): string =>
  v === null ? "—" : Number.isInteger(v) ? String(v) : Math.abs(v) < 10 ? v.toFixed(3) : v.toFixed(1);

/** The states of one period: its start, then after each Phase. */
function phaseStates(record: RunRecord, number: number, start: GraphSnapshot): GraphSnapshot[] {
  const states = [start];
  for (const diff of record.periods[number - 1].diffs) states.push(applyGraphDiff(states[states.length - 1], diff, "forward"));
  return states;
}

function numberAt(record: object | undefined, path: readonly string[]): number | undefined {
  const read = record === undefined ? undefined : readPath(record as Record<string, unknown>, path);
  return read && "value" in read && typeof read.value === "number" ? read.value : undefined;
}

const passes = (value: number, f: NonNullable<Metric["value_filter"]>): boolean => {
  switch (f.cmp) {
    case "<": return value < f.value;
    case "<=": return value <= f.value;
    case ">": return value > f.value;
    case ">=": return value >= f.value;
    case "==": return value === f.value;
    case "!=": return value !== f.value;
  }
};

/** Linear-interpolated percentile p (0–100) of ascending values. */
function percentile(sorted: number[], p: number): number {
  const at = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(at);
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (at - lo);
}

/** One Metric over one period, given that period's states (start, then after each Phase). */
export function evaluateMetric(metric: Metric, states: GraphSnapshot[]): number | null {
  const end = states[states.length - 1];
  const model = { nodes: end.nodes, edges: end.edges, canvases: canvasesById(end.canvases) };
  const element = (s: GraphSnapshot, id: string) => s.nodes[id] ?? s.edges[id];
  const [before, after] =
    metric.phase !== undefined ? [states[metric.phase - 1], states[Math.min(metric.phase, states.length - 1)]] : [states[0], end];

  const values: number[] = [];
  for (const id of matchElements(metric.target, model)) {
    if (metric.read === "state") {
      const v = numberAt(element(end, id), metric.path);
      if (v !== undefined) values.push(v);
    } else {
      const a = numberAt(element(after, id), metric.path);
      const b = numberAt(element(before, id), metric.path);
      if (a !== undefined && b !== undefined) values.push(a - b);
    }
  }

  // No matched Element holds the field: no value, which the table shows as "—" (a sum of nothing is not 0).
  if (values.length === 0) return null;
  const filter = metric.value_filter;
  if (metric.aggregate === "share_where") {
    return filter ? values.filter((v) => passes(v, filter)).length / values.length : 1;
  }
  const kept = filter ? values.filter((v) => passes(v, filter)) : values;
  switch (metric.aggregate) {
    case "sum": return kept.reduce((a, b) => a + b, 0);
    case "count": return kept.length;
    case "mean": return kept.length ? kept.reduce((a, b) => a + b, 0) / kept.length : null;
    case "min": return kept.length ? Math.min(...kept) : null;
    case "max": return kept.length ? Math.max(...kept) : null;
    case "percentile": return kept.length ? percentile([...kept].sort((a, b) => a - b), metric.percentile ?? 50) : null;
  }
}

/** Each Category's summed Stock level: node Stocks by key, an edge Stock by its source's one supplied Category. */
function stockLevels(s: GraphSnapshot): Map<string, number> {
  const levels = new Map<string, number>();
  for (const { element, category, stock } of stocksIn(s)) {
    const supplied = category === undefined ? Object.keys(s.nodes[s.edges[element].source]?.supply_capacity ?? {}) : [category];
    if (supplied.length === 1) levels.set(supplied[0], (levels.get(supplied[0]) ?? 0) + stock.level);
  }
  return levels;
}

/**
 * The run's table. `n` is the top Functionality level; `metrics` are the
 * project's own, in order; `standard` the standard Metrics shown.
 */
export function runTable(record: RunRecord, metrics: readonly Metric[], n: number, standard: readonly StandardMetric[] = STANDARD_METRICS): RunTable {
  const shown = (m: StandardMetric) => standard.includes(m);
  const coverageCats = shown("coverage") ? [...new Set(record.periods.flatMap((p) => Object.values(p.served).flatMap((r) => Object.keys(r))))].sort() : [];
  const stockCats = shown("stock_level") ? [...stockLevels(record.start).keys()].sort() : [];
  const operativity = shown("operativity");
  const columns: RunColumn[] = [
    ...(operativity ? [{ key: "operativity", label: STANDARD_COLUMNS.operativity }] : []),
    ...coverageCats.map((c) => ({ key: `coverage:${c}`, label: `${STANDARD_COLUMNS.coverage} · ${c}` })),
    ...stockCats.map((c) => ({ key: `stock:${c}`, label: `${STANDARD_COLUMNS.stock_level} · ${c}` })),
    ...metrics.map((m, i) => ({ key: `metric:${i}`, label: m.name || `Metric ${i + 1}` })),
  ];

  const rows: RunTable["rows"] = [];
  let start = record.start;
  record.periods.forEach((period, i) => {
    const states = phaseStates(record, i + 1, start);
    const end = states[states.length - 1];
    const coverage = (category: string): number | null => {
      let delivered = 0;
      let demand = 0;
      for (const [id, ratios] of Object.entries(period.served)) {
        if (ratios[category] === undefined) continue;
        const d = demandOf(end.nodes[id], category);
        delivered += ratios[category] * d;
        demand += d;
      }
      return demand > 0 ? delivered / demand : null;
    };
    const levels = stockCats.length > 0 ? stockLevels(end) : new Map<string, number>();
    const stockLevel = (category: string) => levels.get(category) ?? 0;
    rows.push({
      label: period.label,
      values: [
        ...(operativity ? [computeOperativityScore(end, n)] : []),
        ...coverageCats.map(coverage),
        ...stockCats.map(stockLevel),
        ...metrics.map((m) => evaluateMetric(m, states)),
      ],
    });
    start = end;
  });
  return { columns, rows };
}

/** One column across the run: its values in period order (null = no value), and their min, mean and max. */
export interface ColumnSummary {
  values: (number | null)[];
  min: number | null;
  mean: number | null;
  max: number | null;
}

/** Each column's values over the run's periods, with the minimum, mean and maximum of those that have a value. */
export function columnSummaries(table: RunTable): ColumnSummary[] {
  return table.columns.map((_, i) => {
    const values = table.rows.map((r) => r.values[i]);
    const present = values.filter((v): v is number => v !== null);
    if (present.length === 0) return { values, min: null, mean: null, max: null };
    return { values, min: Math.min(...present), mean: present.reduce((a, b) => a + b, 0) / present.length, max: Math.max(...present) };
  });
}

/** The table as CSV: a `period` column, then one per Metric. Empty cells for no value. */
export function runTableCsv(table: RunTable): string {
  const cell = (v: string | number | null) => {
    if (v === null) return "";
    // 12 significant digits: drops binary-fraction noise (19345.199999999997 → 19345.2), keeps every real digit.
    const text = typeof v === "number" ? String(Number(v.toPrecision(12))) : v;
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [["period", ...table.columns.map((c) => c.label)], ...table.rows.map((r) => [r.label, ...r.values])]
    .map((row) => row.map(cell).join(","))
    .join("\n");
}

