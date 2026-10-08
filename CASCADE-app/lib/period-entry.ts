/**
 * period-entry.ts — a Temporal Simulation run saved to the Scorecard
 * (ADR-0019 §4). Pure.
 *
 * The run is not saved, so the entry holds what it shows, packed together: the
 * run's start state once, and per ticked period its end state as a Graph Diff
 * from that start, the run table's row and each Stock's change over the period
 * with the reference used (its level is read off the end state); plus each
 * column's minimum and mean across the whole run.
 */

import { applyGraphDiff, diffGraph } from "@/lib/graph-diff";
import { stockValues } from "@/lib/level-mode";
import { walkPeriods, type RunRecord } from "@/lib/step-operator";
import type { RunTable } from "@/lib/temporal-metrics";
import type { GraphSnapshot, SimulationPeriod, TemporalSimulationScorecardEntry } from "@/lib/schemas/network";

type Summary = Record<string, number | null>;

/** Each column's minimum and mean over the run's periods that have a value. */
function runSummary(table: RunTable): { min: Summary; mean: Summary } {
  const min: Summary = {};
  const mean: Summary = {};
  table.columns.forEach((c, i) => {
    const values = table.rows.map((r) => r.values[i]).filter((v): v is number => v !== null);
    min[c.label] = values.length ? Math.min(...values) : null;
    mean[c.label] = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  });
  return { min, mean };
}

export function buildRunEntry(input: {
  record: RunRecord;
  /** 1-based periods to save; at least one. */
  numbers: readonly number[];
  table: RunTable;
  timelineName: string;
  id: string;
  /** A picture of the canvas, for the period it shows. */
  image?: { number: number; png: string };
  now?: () => Date;
}): TemporalSimulationScorecardEntry {
  const { record, table, now = () => new Date() } = input;
  const { min, mean } = runSummary(table);
  const numbers = [...input.numbers].sort((a, b) => a - b);
  const periods: SimulationPeriod[] = [];
  let state = record.start;
  let at = 0;
  for (const number of numbers) {
    state = walkPeriods(record, state, at, number);
    at = number;
    const before = walkPeriods(record, state, number, number - 1);
    periods.push({
      label: record.periods[number - 1].label,
      diff: diffGraph(record.start, state),
      metrics: Object.fromEntries(table.columns.map((c, i) => [c.label, table.rows[number - 1]?.values[i] ?? null])),
      stock_values: stockValues(state, before, "change"),
      ...(input.image?.number === number ? { image_png: input.image.png } : {}),
    });
  }
  const span = periods.length === 1 ? periods[0].label : `${periods[0].label} – ${periods[periods.length - 1].label} (${periods.length} periods)`;
  return {
    type: "temporal_simulation",
    id: input.id,
    label: `${input.timelineName} — ${span}`,
    created_at: now().toISOString(),
    timeline_name: input.timelineName,
    start: record.start,
    periods,
    metric_min: min,
    metric_mean: mean,
  };
}

/** The end state of one saved period: the entry's start with the period's diff applied. */
export const periodEndState = (entry: TemporalSimulationScorecardEntry, period: SimulationPeriod): GraphSnapshot =>
  applyGraphDiff(entry.start, period.diff, "forward");
