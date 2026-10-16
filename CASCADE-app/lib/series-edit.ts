/**
 * series-edit.ts — what the Series tab does to a Series (ADR-0019, revised
 * 2026-10-12): write a pasted block of cells, find the gaps a run would refuse,
 * the rows whose Element is gone, and the operations that read a Series by
 * name. Pure; the store applies the results.
 */

import { ALL_ELEMENTS, type Series } from "@/lib/schemas/series";
import type { StoredTemporalSimulation } from "@/lib/schemas/temporal-simulation";
import type { EventDefinition } from "@/lib/schemas/config";
import type { AttributeOperation } from "@/lib/schemas/attribute-operation";
import { withDecimalPoint } from "@/lib/decimal-comma";

/**
 * A block pasted from a spreadsheet: rows on newlines, cells on tabs (or `;`).
 * An empty cell is kept (it empties that cell). "1,5" (a decimal comma) reads
 * as 1.5; anything that is not a number is reported with its place.
 */
export function parseBlock(text: string): { cells: (number | null)[][] } | { error: string } {
  const lines = text.replace(/\r?\n$/, "").split(/\r?\n/);
  const cells: (number | null)[][] = [];
  for (const [r, line] of lines.entries()) {
    const row: (number | null)[] = [];
    for (const [c, raw] of line.split(/\t|;/).entries()) {
      const t = withDecimalPoint(raw);
      if (t === "") { row.push(null); continue; }
      const n = Number(t);
      if (!Number.isFinite(n)) return { error: `row ${r + 1}, column ${c + 1}: "${raw.trim()}" is not a number` };
      row.push(n);
    }
    cells.push(row);
  }
  return { cells };
}

/** The Series with a block written from row `rowKeys[0]` and label `labels[0]` on; null empties a cell. */
export function writeBlock(series: Series, rowKeys: readonly string[], labels: readonly string[], cells: (number | null)[][]): Series {
  const rows: Series["rows"] = Object.fromEntries(Object.entries(series.rows).map(([k, r]) => [k, { ...r }]));
  cells.forEach((line, i) => {
    const key = rowKeys[i];
    if (key === undefined) return;
    const row = (rows[key] ??= {});
    line.forEach((value, j) => {
      const label = labels[j];
      if (label === undefined) return;
      if (value === null) delete row[label];
      else row[label] = value;
    });
  });
  return { ...series, rows };
}

/** Every period label the Series holds a value for, in first-seen order. */
export const seriesLabels = (series: { rows: Record<string, Record<string, unknown>> }): string[] => [...new Set(Object.values(series.rows).flatMap((r) => Object.keys(r)))];

/** For each row, the labels of `labels` it has no value for: what a run reading it would refuse. */
export function seriesGaps(series: Series, labels: readonly string[]): Map<string, string[]> {
  const gaps = new Map<string, string[]>();
  for (const [key, row] of Object.entries(series.rows)) {
    const missing = labels.filter((l) => !Object.hasOwn(row, l));
    if (missing.length > 0) gaps.set(key, missing);
  }
  return gaps;
}

/** Row keys whose Element no longer exists (the `*` row is never one). */
export function orphanRows(series: Series, exists: (id: string) => boolean): string[] {
  return Object.keys(series.rows).filter((k) => k !== ALL_ELEMENTS && !exists(k));
}

/** The Series without the given rows. */
export const withoutRows = (series: Series, keys: readonly string[]): Series => ({
  ...series,
  rows: Object.fromEntries(Object.entries(series.rows).filter(([k]) => !keys.includes(k))),
});

const reads = (name: string) => (op: AttributeOperation) => op.series === name;

/** Where a Series is read: per Temporal Simulation and per Event, how many operations. */
export function seriesReaders(name: string, simulations: readonly StoredTemporalSimulation[], events: readonly EventDefinition[]): { simulations: [string, number][]; events: [string, number][] } {
  return {
    simulations: simulations
      .map((s): [string, number] => [s.timeline.name || s.id, Object.values(s.profile).flat().filter(reads(name)).length])
      .filter(([, n]) => n > 0),
    events: events.map((e): [string, number] => [e.label, (e.attribute_operations ?? []).filter(reads(name)).length]).filter(([, n]) => n > 0),
  };
}

/** Temporal Simulations with every profile operation reading `from` reading `to` instead. */
export function renameSeriesIn(simulations: readonly StoredTemporalSimulation[], from: string, to: string): StoredTemporalSimulation[] {
  return simulations.map((s) => ({
    ...s,
    profile: Object.fromEntries(Object.entries(s.profile).map(([label, ops]) => [label, ops.map((op) => (op.series === from ? { ...op, series: to } : op))])),
  }));
}
