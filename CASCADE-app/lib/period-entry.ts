/**
 * period-entry.ts — Temporal Simulation periods saved to the Scorecard
 * (ADR-0019 §4). Pure.
 *
 * The run is not saved, so each entry holds what it shows: the period's end
 * state, the run table's values at that period and each column's minimum and
 * mean across the run, and each Stock's change over the period with the
 * reference used, so the entry repaints in Level Mode later (its level is read
 * off the end state).
 *
 * The end state is a Graph Diff from the run's start, which the Scorecard keeps
 * once for every period saved from the run (`Project.scorecard_bases`).
 */

import { applyGraphDiff, diffGraph } from "@/lib/graph-diff";
import { stockValues } from "@/lib/level-mode";
import { walkPeriods, type RunRecord } from "@/lib/step-operator";
import type { RunTable } from "@/lib/temporal-metrics";
import type { GraphSnapshot, TemporalSimulationScorecardEntry } from "@/lib/schemas/network";

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

export function buildPeriodEntries(input: {
  record: RunRecord;
  /** 1-based periods to save, ascending. */
  numbers: readonly number[];
  table: RunTable;
  timelineName: string;
  /** Key of the run's start state in `Project.scorecard_bases`. */
  baseId: string;
  newId: () => string;
  /** A picture of the canvas, for the period it shows. */
  image?: { number: number; png: string };
  now?: () => Date;
}): TemporalSimulationScorecardEntry[] {
  const { record, table, now = () => new Date() } = input;
  const { min, mean } = runSummary(table);
  const created = now().toISOString();
  const entries: TemporalSimulationScorecardEntry[] = [];
  let state = record.start;
  let at = 0;
  for (const number of input.numbers) {
    state = walkPeriods(record, state, at, number);
    at = number;
    const before = walkPeriods(record, state, number, number - 1);
    const period = record.periods[number - 1];
    entries.push({
      type: "temporal_simulation",
      id: input.newId(),
      label: `${input.timelineName} — ${period.label}`,
      created_at: created,
      timeline_name: input.timelineName,
      period_label: period.label,
      base_id: input.baseId,
      diff: diffGraph(record.start, state),
      metrics: Object.fromEntries(table.columns.map((c, i) => [c.label, table.rows[number - 1]?.values[i] ?? null])),
      metric_min: min,
      metric_mean: mean,
      level_reading: "change",
      stock_values: stockValues(state, before, "change"),
      ...(input.image?.number === number ? { image_png: input.image.png } : {}),
    });
  }
  return entries;
}

/** A saved period's end state: its own snapshot, or its base with its diff; null when the base is gone. */
export function entryEndState(entry: TemporalSimulationScorecardEntry, bases: Readonly<Record<string, GraphSnapshot>>): GraphSnapshot | null {
  if (entry.snapshot) return entry.snapshot;
  const base = entry.base_id !== undefined ? bases[entry.base_id] : undefined;
  return base && entry.diff ? applyGraphDiff(base, entry.diff, "forward") : null;
}
