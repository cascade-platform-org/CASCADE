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

import { applyGraphDiff } from "@/lib/graph-diff";
import { matchElements } from "@/lib/element-filter";
import { computeOperativityScore } from "@/lib/scorecard-utils";
import type { RunRecord } from "@/lib/step-operator";
import type { GraphSnapshot, Node, Stock } from "@/lib/schemas/network";
import type { Metric } from "@/lib/schemas/temporal-simulation";

interface RunColumn {
  key: string;
  label: string;
}

export interface RunTable {
  columns: RunColumn[];
  /** One row per period, values aligned with `columns`; null = no value (an empty selection, say). */
  rows: { label: string; values: (number | null)[] }[];
}

/** The states of one period: its start, then after each Phase. */
function phaseStates(record: RunRecord, number: number, start: GraphSnapshot): GraphSnapshot[] {
  const states = [start];
  for (const diff of record.periods[number - 1].diffs) states.push(applyGraphDiff(states[states.length - 1], diff, "forward"));
  return states;
}

function numberAt(record: unknown, path: readonly string[]): number | undefined {
  let current = record;
  for (const key of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "number" ? current : undefined;
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
  const model = { nodes: end.nodes, edges: end.edges, canvases: Object.fromEntries(end.canvases.map((c) => [c.id, c])) };
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

  const filter = metric.value_filter;
  if (metric.aggregate === "share_where") {
    if (values.length === 0) return null;
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

const demandOf = (node: Node | undefined, category: string) => node?.category_dependency_profiles?.[category]?.demand ?? 0;

/** Each Category's Stocks, as (Category, Stock): node Stocks by key, an edge Stock by its source's one supplied Category. */
function stocksByCategory(s: GraphSnapshot): [string, Stock][] {
  const out: [string, Stock][] = [];
  for (const node of Object.values(s.nodes)) {
    for (const [category, v] of Object.entries(node.supply_capacity ?? {})) if (typeof v !== "number") out.push([category, v]);
  }
  for (const edge of Object.values(s.edges)) {
    const supplied = Object.keys(s.nodes[edge.source]?.supply_capacity ?? {});
    if (edge.capacity !== undefined && typeof edge.capacity !== "number" && supplied.length === 1) out.push([supplied[0], edge.capacity]);
  }
  return out;
}

/** The run's table. `n` is the top Functionality level; `metrics` are the project's own, in order. */
export function runTable(record: RunRecord, metrics: readonly Metric[], n: number): RunTable {
  const coverageCats = [...new Set(record.periods.flatMap((p) => Object.values(p.served).flatMap((r) => Object.keys(r))))].sort();
  const stockCats = [...new Set(stocksByCategory(record.start).map(([c]) => c))].sort();
  const columns: RunColumn[] = [
    { key: "operativity", label: "Operativity %" },
    ...coverageCats.map((c) => ({ key: `coverage:${c}`, label: `Coverage · ${c}` })),
    ...stockCats.map((c) => ({ key: `stock:${c}`, label: `Stock level · ${c}` })),
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
    const stockLevel = (category: string) =>
      stocksByCategory(end).filter(([c]) => c === category).reduce((sum, [, s]) => sum + s.level, 0);
    rows.push({
      label: period.label,
      values: [
        computeOperativityScore(end, n),
        ...coverageCats.map(coverage),
        ...stockCats.map(stockLevel),
        ...metrics.map((m) => evaluateMetric(m, states)),
      ],
    });
    start = end;
  });
  return { columns, rows };
}

/** The table as CSV: a `period` column, then one per Metric. Empty cells for no value. */
export function runTableCsv(table: RunTable): string {
  const cell = (v: string | number | null) => {
    if (v === null) return "";
    const text = String(v);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [["period", ...table.columns.map((c) => c.label)], ...table.rows.map((r) => [r.label, ...r.values])]
    .map((row) => row.map(cell).join(","))
    .join("\n");
}

