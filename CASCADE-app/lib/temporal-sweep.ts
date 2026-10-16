/**
 * temporal-sweep.ts — a Parameter Sweep (ADR-0019, revised 2026-10-12): one
 * Temporal Simulation run once per value of one of its Parameters, beside the
 * Simulations ticked as they are. Pure: values parsed from text, and the list
 * of runs Compare makes.
 */

import type { StoredTemporalSimulation, Timeline } from "@/lib/schemas/temporal-simulation";
import { withDecimalPoint } from "@/lib/decimal-comma";

/** The most values one sweep runs: each is a whole run. */
export const MAX_SWEEP_VALUES = 50;

/** One run Compare makes: a saved Simulation, with its swept Parameter's value when it is one value of a sweep. */
export interface CompareRequest {
  simulationId: string;
  name: string;
  sweep?: { parameter: string; value: number };
}

export interface SweepSpec {
  simulationId: string;
  parameter: string;
  values: number[];
}

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

/** The runs: each ticked Simulation as it is, then one run per value of the sweep. */
export function compareRequests(simulations: readonly StoredTemporalSimulation[], ticked: readonly string[], sweep?: SweepSpec): CompareRequest[] {
  const name = (s: StoredTemporalSimulation) => s.timeline.name || s.id;
  const out: CompareRequest[] = simulations.filter((s) => ticked.includes(s.id)).map((s) => ({ simulationId: s.id, name: name(s) }));
  const swept = sweep && simulations.find((s) => s.id === sweep.simulationId);
  if (sweep && swept) {
    for (const value of sweep.values) {
      out.push({ simulationId: swept.id, name: `${name(swept)} · ${sweep.parameter} = ${value}`, sweep: { parameter: sweep.parameter, value } });
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
