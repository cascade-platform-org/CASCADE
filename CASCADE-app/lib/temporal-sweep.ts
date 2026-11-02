/**
 * temporal-sweep.ts — a Parameter Sweep (ADR-0019, revised 2026-10-12 and
 * 2026-11-02): one Temporal Simulation run once per combination of the values
 * of one or more of its Parameters (a grid), beside the Simulations ticked as
 * they are. Pure: values parsed from text, and the list of runs Compare makes.
 */

import type { StoredTemporalSimulation, Timeline } from "@/lib/schemas/temporal-simulation";
import { withDecimalPoint } from "@/lib/decimal-comma";

/** The most values one swept Parameter takes. */
export const MAX_SWEEP_VALUES = 50;
/** The most runs one sweep makes (the product of its Parameters' value counts): each is a whole run. */
export const MAX_SWEEP_RUNS = 500;

/** One grid point of a sweep: each swept Parameter with its value, in the sweep's order. */
export type SweepPoint = { parameter: string; value: number }[];

/** One run Compare makes: a saved Simulation, with its grid point when it is one run of a sweep. */
export interface CompareRequest {
  simulationId: string;
  name: string;
  sweep?: SweepPoint;
}

/** One swept Parameter and its values. */
export interface SweepAxis {
  parameter: string;
  values: number[];
}

export interface SweepSpec {
  simulationId: string;
  /** Distinct Parameters; the runs are every combination of their values. */
  axes: SweepAxis[];
}

/** How many runs the axes make: the product of their value counts (0 with no axis). */
export const sweepSize = (axes: readonly SweepAxis[]): number => (axes.length === 0 ? 0 : axes.reduce((n, a) => n * a.values.length, 1));

/** Every combination of the axes' values, the first axis varying slowest. */
export function sweepPoints(axes: readonly SweepAxis[]): SweepPoint[] {
  return axes.reduce<SweepPoint[]>(
    (points, axis) => points.flatMap((point) => axis.values.map((value) => [...point, { parameter: axis.parameter, value }])),
    [[]],
  );
}

/** A grid point in words: `share = 0.4, months = 6`. */
export const pointLabel = (point: SweepPoint): string => point.map((p) => `${p.parameter} = ${p.value}`).join(", ");

const round = (x: number) => Number(x.toFixed(10));
const number = (t: string) => Number(withDecimalPoint(t));

/**
 * "0.1, 0.2; 0.3" (a list: commas, semicolons or spaces; "0,5 0,7" reads
 * decimal commas when the text has no decimal point) or "0.1 to 0.3 step 0.05"
 * (a range, both ends included).
 */
export function parseSweepValues(text: string): { values: number[] } | { error: string } {
  const range = /^\s*(\S+)\s+to\s+(\S+)\s+step\s+(\S+)\s*$/i.exec(text);
  let values: number[];
  if (range) {
    const [from, to, step] = range.slice(1).map(number);
    if (![from, to, step].every(Number.isFinite) || step <= 0 || to < from) return { error: "a range is “from to to step s”, with s > 0 and to ≥ from" };
    values = [];
    for (let k = 0; from + k * step <= to + step * 1e-9; k++) {
      if (k >= MAX_SWEEP_VALUES) return { error: `at most ${MAX_SWEEP_VALUES} values` };
      values.push(round(from + k * step));
    }
  } else {
    // A comma separates values unless it is a decimal comma: with a decimal point in the text, it never is.
    const separators = text.includes(".") ? /[;,\s]+/ : /;|\s+|,(?=\s)|,(?!\d)/;
    const parts = text.split(separators).map((p) => p.trim()).filter(Boolean);
    values = parts.map(number);
    const bad = parts.find((_, i) => !Number.isFinite(values[i]));
    if (bad !== undefined) return { error: `"${bad}" is not a number` };
  }
  values = [...new Set(values.map(round))];
  if (values.length === 0) return { error: "give at least one value" };
  if (values.length > MAX_SWEEP_VALUES) return { error: `at most ${MAX_SWEEP_VALUES} values` };
  return { values };
}

/**
 * The runs: each ticked Simulation as it is, then one run per grid point of the
 * sweep. A sweep over more than MAX_SWEEP_RUNS points, or naming a Parameter
 * twice, adds no run (the Compare tab says why).
 */
export function compareRequests(simulations: readonly StoredTemporalSimulation[], ticked: readonly string[], sweep?: SweepSpec): CompareRequest[] {
  const name = (s: StoredTemporalSimulation) => s.timeline.name || s.id;
  const out: CompareRequest[] = simulations.filter((s) => ticked.includes(s.id)).map((s) => ({ simulationId: s.id, name: name(s) }));
  const swept = sweep && simulations.find((s) => s.id === sweep.simulationId);
  const distinct = sweep && new Set(sweep.axes.map((a) => a.parameter)).size === sweep.axes.length;
  if (sweep && swept && distinct && sweepSize(sweep.axes) <= MAX_SWEEP_RUNS) {
    for (const point of sweepPoints(sweep.axes)) {
      out.push({ simulationId: swept.id, name: `${name(swept)} · ${pointLabel(point)}`, sweep: point });
    }
  }
  return out;
}

/**
 * How many operations of a Simulation's run read a Parameter: its profile's (`profile`, saved
 * operations or the draft's rows), and those of the Events its Phases fire.
 */
export function parameterReads(profile: readonly { parameter?: string }[], steps: Timeline["steps"], parameter: string, eventOps: (id: string) => readonly { parameter?: string }[]): number {
  const own = profile.filter((op) => op.parameter === parameter).length;
  const fired = new Set(steps.flatMap((s) => s.phases.flatMap((p) => p.events.map((e) => e.event))));
  const events = [...fired].reduce((n, id) => n + eventOps(id).filter((op) => op.parameter === parameter).length, 0);
  return own + events;
}
