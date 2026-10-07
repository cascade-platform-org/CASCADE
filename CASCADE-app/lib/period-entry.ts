/**
 * period-entry.ts — a Temporal Simulation period saved to the Scorecard
 * (ADR-0019 §4). Pure.
 *
 * The run is not saved, so the entry holds what it shows: the period's end
 * state (from which the Scorecard derives Operativity as for any entry), the
 * run table's values at that period, and each Stock's Level Mode value with the
 * reference used, so the entry repaints in Level Mode later.
 */

import { stockValues, type LevelReading } from "@/lib/level-mode";
import { periodState, walkPeriods, type RunRecord } from "@/lib/step-operator";
import type { RunTable } from "@/lib/temporal-metrics";
import type { TemporalSimulationScorecardEntry } from "@/lib/schemas/network";

export function buildPeriodEntry(input: {
  record: RunRecord;
  /** 1-based period. */
  number: number;
  table: RunTable;
  timelineName: string;
  reading: LevelReading;
  id: string;
  image?: string;
  now?: () => Date;
}): TemporalSimulationScorecardEntry {
  const { record, number, table, reading, now = () => new Date() } = input;
  const snapshot = periodState(record, number);
  const before = walkPeriods(record, snapshot, number, number - 1);
  const period = record.periods[number - 1];
  return {
    type: "temporal_simulation",
    id: input.id,
    label: `${input.timelineName} — ${period.label}`,
    created_at: now().toISOString(),
    timeline_name: input.timelineName,
    period_label: period.label,
    snapshot,
    metrics: Object.fromEntries(table.columns.map((c, i) => [c.label, table.rows[number - 1]?.values[i] ?? null])),
    level_reading: reading,
    stock_values: stockValues(snapshot, before, reading),
    ...(input.image ? { image_png: input.image } : {}),
  };
}
