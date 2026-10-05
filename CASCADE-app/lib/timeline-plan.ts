/**
 * timeline-plan.ts — unroll a Temporal Simulation Timeline into the ordered
 * list of periods a run would execute (ADR-0019 §1–§2).
 *
 * PROTOTYPE. The Timeline types below are local while the Temporal Simulation
 * is a UI prototype: no Pydantic model exists yet. When the feature is built,
 * the types move schema-first (Pydantic → JSON Schema → Zod, CLAUDE.md §6) and
 * these declarations are replaced by `z.infer<>` re-exports.
 *
 * Pure: no store access, no engine call. A plan is what a run *would* do, so the
 * UI can show the sequence, the period labels and the Engine Evaluation cost
 * before anything runs.
 */

export type CalendarUnit = "day" | "week" | "month" | "quarter" | "year" | "none";

export interface TimelinePhase {
  /** EventDefinition ids, applied in order. */
  events: string[];
  /** Run one Propagation after the Events. */
  propagate: boolean;
}

export interface TimelineStep {
  label: string;
  unit: CalendarUnit;
  repeat: number;
  phases: TimelinePhase[];
}

interface TimelinePeriodic {
  /** Every N-th period, counted 1-based from the run's start (N, 2N, …). */
  every: number;
  /** Index of the Phase the Events join. */
  phase: number;
  events: string[];
}

export interface Timeline {
  name: string;
  steps: TimelineStep[];
  every: TimelinePeriodic[];
}

interface PlannedPhase {
  index: number;
  /** The Phase's own Events, then any Periodic Events joining it. */
  events: string[];
  periodicEvents: string[];
  propagate: boolean;
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
      monday.setUTCDate(monday.getUTCDate() + 7 * k);
      return isoWeekLabel(monday);
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

/** Unroll Steps × repeat, attach Periodic Events, and count engine calls. */
export function planTimeline(timeline: Timeline): TimelinePlan {
  const periods: PlannedPeriod[] = [];
  const warnings: string[] = [];

  timeline.steps.forEach((step, stepIndex) => {
    const repeat = Math.max(1, Math.floor(step.repeat || 1));
    if (step.phases.length === 0) {
      warnings.push(`Step ${stepIndex + 1} ("${step.label}") has no Phase, so its periods apply only their profile operations.`);
    }
    for (let r = 0; r < repeat; r++) {
      const label = advanceLabel(step.label, step.unit, r);
      if (label === null) {
        warnings.push(`Step ${stepIndex + 1}: "${step.label}" is not a valid ${step.unit} label.`);
        return;
      }
      const number = periods.length + 1;
      const lastPropagating = step.phases.map((p) => p.propagate).lastIndexOf(true);
      periods.push({
        number,
        label,
        stepIndex,
        repetition: r,
        phases: step.phases.map((phase, index) => {
          const periodicEvents = timeline.every
            .filter((p) => p.every >= 1 && number % p.every === 0 && p.phase === index)
            .flatMap((p) => p.events);
          return {
            index,
            events: [...phase.events, ...periodicEvents],
            periodicEvents,
            propagate: phase.propagate,
            integratesAfter: index === lastPropagating,
          };
        }),
      });
    }
  });

  const seen = new Set<string>();
  for (const p of periods) {
    if (seen.has(p.label)) warnings.push(`Label "${p.label}" appears twice; the profile cannot tell those periods apart.`);
    seen.add(p.label);
  }
  timeline.every.forEach((p, i) => {
    if (p.every < 1) warnings.push(`Periodic rule ${i + 1}: "every" must be at least 1.`);
    const reachable = timeline.steps.some((s) => p.phase < s.phases.length);
    if (!reachable) warnings.push(`Periodic rule ${i + 1}: no Step has a Phase ${p.phase + 1}, so it never fires.`);
  });

  const engineCalls = periods.reduce((n, p) => n + p.phases.filter((ph) => ph.propagate).length, 0);
  return { periods, engineCalls, warnings };
}
