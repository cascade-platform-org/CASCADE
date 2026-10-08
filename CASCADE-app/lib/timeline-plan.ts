/**
 * timeline-plan.ts — unroll a Temporal Simulation Timeline into the ordered
 * list of periods a run would execute (ADR-0019 §1–§2).
 *
 * Pure: no store access, no engine call. A plan is what a run *would* do, so the
 * UI can show the sequence, the period labels and the Engine Evaluation cost
 * before anything runs.
 */

import type { CalendarUnit, Timeline } from "@/lib/schemas/temporal-simulation";

interface PlannedPhase {
  index: number;
  /** Ids of the Phase's Events that fire in this period (an `every: N` Event fires on N, 2N…). */
  events: string[];
  propagate: boolean;
  /** Hours that pass at the Phase's start, before its Events (0: none). */
  advanceHours: number;
  /** True for the period's last propagating Phase — integration follows it. */
  integratesAfter: boolean;
}

export interface PlannedPeriod {
  /** 1-based position in the run. */
  number: number;
  label: string;
  stepIndex: number;
  /** 0-based repetition inside its Step. */
  repetition: number;
  phases: PlannedPhase[];
}

export interface TimelinePlan {
  periods: PlannedPeriod[];
  /** One Engine Evaluation per propagating Phase (ADR-0008). */
  engineCalls: number;
  /** Block a run: a period without a valid label, or two periods the profile cannot tell apart. */
  errors: string[];
  /** Reported only: a Step with no Phase, an Event whose `every` exceeds its Step. */
  warnings: string[];
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** Monday (UTC) of ISO week `week` in ISO year `year`. */
function isoWeekMonday(year: number, week: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const mondayWeek1 = new Date(jan4);
  mondayWeek1.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
  const result = new Date(mondayWeek1);
  result.setUTCDate(mondayWeek1.getUTCDate() + (week - 1) * 7);
  return result;
}

function isoWeekLabel(date: Date): string {
  // ISO year/week of a date: the Thursday of its week decides the year.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${pad(week)}`;
}

/**
 * The label of repetition `k` (0-based) of a Step whose first label is
 * `label`. Returns null when `label` does not parse for `unit`.
 */
export function advanceLabel(label: string, unit: CalendarUnit, k: number): string | null {
  let m: RegExpMatchArray | null;
  switch (unit) {
    case "none":
      return k === 0 ? label : `${label}#${k + 1}`;
    case "year":
      m = label.match(/^(\d{4})$/);
      return m ? String(Number(m[1]) + k) : null;
    case "quarter": {
      m = label.match(/^(\d{4})-Q([1-4])$/);
      if (!m) return null;
      const q = Number(m[1]) * 4 + (Number(m[2]) - 1) + k;
      return `${Math.floor(q / 4)}-Q${(q % 4) + 1}`;
    }
    case "month": {
      m = label.match(/^(\d{4})-(\d{2})$/);
      if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
      const idx = Number(m[1]) * 12 + (Number(m[2]) - 1) + k;
      return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
    }
    case "week": {
      m = label.match(/^(\d{4})-W(\d{2})$/);
      if (!m || Number(m[2]) < 1 || Number(m[2]) > 53) return null;
      const monday = isoWeekMonday(Number(m[1]), Number(m[2]));
      if (isoWeekLabel(monday) !== label) return null; // week 53 of a 52-week year
      monday.setUTCDate(monday.getUTCDate() + 7 * k);
      return isoWeekLabel(monday);
    }
    case "hour": {
      m = label.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})$/);
      if (!m || Number(m[4]) > 23) return null;
      const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4])));
      if (d.getUTCMonth() !== Number(m[2]) - 1) return null;
      d.setUTCHours(d.getUTCHours() + k);
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}`;
    }
    case "day": {
      m = label.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return null;
      const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
      if (d.getUTCMonth() !== Number(m[2]) - 1) return null;
      d.setUTCDate(d.getUTCDate() + k);
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    }
  }
}

/** A valid first label for each unit, for a new Step when the previous label does not parse. */
export const EXAMPLE_LABEL: Record<CalendarUnit, string> = {
  hour: "2023-01-01T00",
  day: "2023-01-01",
  week: "2023-W01",
  month: "2023-01",
  quarter: "2023-Q1",
  year: "2023",
  none: "P1",
};

/**
 * "Every N periods": the N-th, 2N-th, 3N-th… of a run of periods, counted from
 * 1. `position` is 0-based. One rule for Phase Events and for profile values.
 */
export const firesEvery = (position: number, every: number): boolean => (position + 1) % every === 0;

/** Index of the last propagating Phase — Stocks integrate after it (ADR-0019 §2); -1 if none. */
const lastPropagatingIndex = (phases: { propagate: boolean }[]): number =>
  phases.map((p) => p.propagate).lastIndexOf(true);

/** Unroll Steps × repeat, resolve each Event's `every`, and count engine calls. */
export function planTimeline(timeline: Timeline): TimelinePlan {
  const periods: PlannedPeriod[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  timeline.steps.forEach((step, stepIndex) => {
    if (step.phases.length === 0) {
      warnings.push(`Step ${stepIndex + 1} ("${step.label}") has no Phase, so its periods apply only their profile operations.`);
    }
    step.phases.forEach((ph, pi) =>
      ph.events.forEach((e) => {
        if (e.every > step.repeat) {
          warnings.push(`Step ${stepIndex + 1}, Phase ${pi + 1}: "${e.event}" every ${e.every} periods never fires in a Step of ${step.repeat}.`);
        }
      }),
    );
    const lastPropagating = lastPropagatingIndex(step.phases);
    for (let r = 0; r < step.repeat; r++) {
      const label = advanceLabel(step.label, step.unit, r);
      if (label === null) {
        errors.push(`Step ${stepIndex + 1}: "${step.label}" is not a valid ${step.unit} label.`);
        return;
      }
      periods.push({
        number: periods.length + 1,
        label,
        stepIndex,
        repetition: r,
        phases: step.phases.map((phase, index) => ({
          index,
          events: phase.events.filter((e) => firesEvery(r, e.every)).map((e) => e.event),
          propagate: phase.propagate,
          advanceHours: phase.advance_hours ?? 0,
          integratesAfter: index === lastPropagating,
        })),
      });
    }
  });

  const seen = new Set<string>();
  for (const p of periods) {
    if (seen.has(p.label)) errors.push(`Label "${p.label}" appears twice; the profile cannot tell those periods apart.`);
    seen.add(p.label);
  }
  const engineCalls = periods.reduce((n, p) => n + p.phases.filter((ph) => ph.propagate).length, 0);
  return { periods, engineCalls, errors, warnings };
}
