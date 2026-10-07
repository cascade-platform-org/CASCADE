/**
 * step-operator.ts — run a Temporal Simulation (ADR-0019 §2–§3).
 *
 * Pure apart from the engine call, which the caller passes in (`propagate`), so
 * a run is testable without a server and the operator never reads a store. It
 * computes on the snapshot it is given — the caller's Reset copy of the model —
 * and returns a run record: the start state and one Graph Diff per Phase. It
 * writes nothing anywhere; the Run View reconstructs any period from the record.
 *
 * Per period: the profile's operations, then per Phase its Events, then (if the
 * Phase propagates) one Propagation. The profile rides in the first Phase, so
 * its writes land in that Phase's diff (§3).
 *
 * THE IMPOSED LAYER (§2a). Propagation only worsens Functionality, so before
 * every Propagation each Element's Functionality and Responsibility Share return
 * to what Events (and the profile) last imposed in this run, or the post-Reset
 * value. Shortage is then recomputed from the current supply each time, while
 * Event damage stands. The Phase's Events are resolved against that imposed
 * state, not against the last Propagation's output: a vulnerability applies only
 * where it worsens, and an Element a shortage had already pushed below the
 * Event's level would otherwise keep no record of the Event — its damage would
 * vanish the moment supply returned.
 *
 * STOCKS (ADR-0020). Each Propagation sends every Stock as its supply number
 * (`buildPropagationPayload`); right after a period's last propagating Phase,
 * every Stock integrates once (`lib/stock-integration.ts`) from that
 * Propagation's `served_ratio` and `stored`, and the new levels land in that
 * Phase's diff. A later non-propagating Phase (a settlement) reads the period's
 * closing balance.
 */

import { applyEventToSnapshot } from "@/lib/event-application";
import { deepEqual, diffGraph, applyGraphDiff } from "@/lib/graph-diff";
import type { TimelinePlan } from "@/lib/timeline-plan";
import { integrateStocks, type StockOutcome } from "@/lib/stock-integration";
import type { PropagationResult } from "@/lib/schemas/propagation";
import type { AttributeOperation } from "@/lib/schemas/attribute-operation";
import type { EventDefinition } from "@/lib/schemas/config";
import type { Edge, GraphDiff, GraphSnapshot, Node } from "@/lib/schemas/network";

/** What one Propagation returns to the step operator. */
export interface Propagated {
  snapshot: GraphSnapshot;
  flow: Pick<PropagationResult, "served_ratio" | "stored">;
}

interface RunPeriod {
  label: string;
  /** One Graph Diff per Phase, in order (one even for a period whose Step has no Phase). */
  diffs: GraphDiff[];
  /** The last propagating Phase's delivery ratios, per consumer and Category (ADR-0019 §3). */
  served: PropagationResult["served_ratio"];
  /** Each Stock's integration this period, with what its clamps removed. */
  stocks: StockOutcome[];
}

export interface RunRecord {
  /** The Reset copy the run started from. */
  start: GraphSnapshot;
  periods: RunPeriod[];
  /** Operations refused for an Element, and Events the configuration no longer has. */
  warnings: string[];
}

export interface RunInput {
  /** The run's own copy of the model, already Reset (both halves). */
  start: GraphSnapshot;
  plan: TimelinePlan;
  profile: Record<string, AttributeOperation[]>;
  events: readonly EventDefinition[];
  /** Top of the Functionality scale. */
  n: number;
  /** One engine call: the snapshot after a Propagation, and what it delivered. */
  propagate: (snapshot: GraphSnapshot) => Promise<Propagated>;
  signal?: AbortSignal;
  /** After each Propagation: how many of `plan.engineCalls` are done. */
  onProgress?: (done: number, label: string) => void;
}

/** A run that stopped: cancelled, refused or failed, with the period it stopped in. */
export class RunStopped extends Error {
  constructor(readonly period: string, readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
  }
}

type Imposed = { functionality: number; share: Node["responsibility_share"] };
type Layer = Map<string, Imposed>;

function layerOf(snapshot: GraphSnapshot): Layer {
  const layer: Layer = new Map();
  for (const el of [...Object.values(snapshot.nodes), ...Object.values(snapshot.edges)]) {
    layer.set(el.id, { functionality: el.functionality, share: el.responsibility_share });
  }
  return layer;
}

/** The snapshot with every Element's Functionality and Responsibility Share back at the layer. */
function withLayer(snapshot: GraphSnapshot, layer: Layer): GraphSnapshot {
  let changed = false;
  const restore = <T extends Node | Edge>(registry: Record<string, T>): Record<string, T> => {
    const out: Record<string, T> = {};
    for (const [id, el] of Object.entries(registry)) {
      const imposed = layer.get(id);
      if (!imposed || (el.functionality === imposed.functionality && deepEqual(el.responsibility_share, imposed.share))) {
        out[id] = el;
        continue;
      }
      const copy = { ...el, functionality: imposed.functionality };
      if (imposed.share === undefined) delete copy.responsibility_share;
      else copy.responsibility_share = imposed.share;
      out[id] = copy;
      changed = true;
    }
    return out;
  };
  const nodes = restore(snapshot.nodes);
  const edges = restore(snapshot.edges);
  return changed ? { ...snapshot, nodes, edges } : snapshot;
}

/** A period's profile as an Event, so it applies through the one Event path (ADR-0019 §1). */
function profileEvent(label: string, operations: AttributeOperation[]): EventDefinition {
  return { id: `profile:${label}`, label: `Profile ${label}`, type: "disservice", frequency_per_10y: 0, attribute_operations: operations };
}

export async function runTimeline(input: RunInput): Promise<RunRecord> {
  const { start, plan, profile, n, propagate, signal, onProgress } = input;
  const byId = new Map(input.events.map((e) => [e.id, e]));
  const warnings: string[] = [];
  const periods: RunPeriod[] = [];
  let state = start;
  let layer = layerOf(start);
  let done = 0;
  let label = "";

  const applyAll = (snapshot: GraphSnapshot, events: EventDefinition[], report: boolean): GraphSnapshot =>
    events.reduce((s, event) => {
      const applied = applyEventToSnapshot(s, event, n);
      if (report) warnings.push(...applied.warnings.map((w) => `${label}: ${w}`));
      return applied.snapshot;
    }, snapshot);

  for (const period of plan.periods) {
    label = period.label;
    // A Step with no Phase still applies its profile: one Phase that does not propagate.
    const phases = period.phases.length > 0 ? period.phases : [{ events: [], propagate: false, integratesAfter: false }];
    const diffs: GraphDiff[] = [];
    let served: RunPeriod["served"] = {};
    let stocks: StockOutcome[] = [];

    for (const [k, phase] of phases.entries()) {
      if (signal?.aborted) throw new RunStopped(label, new Error("Cancelled"));
      const events: EventDefinition[] = [];
      const ops = k === 0 ? profile[label] ?? [] : [];
      if (ops.length > 0) events.push(profileEvent(label, ops));
      for (const id of phase.events) {
        const event = byId.get(id);
        if (event) events.push(event);
        else warnings.push(`${label}: Event "${id}" is not in the configuration and was skipped.`);
      }

      // Events resolve against the imposed state; what they leave there is the new layer.
      const imposed = applyAll(withLayer(state, layer), events, true);
      layer = layerOf(imposed);

      let next: GraphSnapshot;
      if (phase.propagate) {
        let propagated: Propagated;
        try {
          propagated = await propagate(imposed);
        } catch (e) {
          throw new RunStopped(label, e);
        }
        onProgress?.(++done, label);
        next = propagated.snapshot;
        if (phase.integratesAfter) {
          const integration = integrateStocks(next, propagated.flow, n);
          next = integration.snapshot;
          served = propagated.flow.served_ratio;
          stocks = integration.outcomes;
          warnings.push(...integration.warnings.map((w) => `${label}: ${w}`));
        }
      } else {
        // No Propagation: the period keeps its shortage, and the Events land on top of it.
        next = applyAll(state, events, false);
      }
      diffs.push(diffGraph(state, next));
      state = next;
    }
    periods.push({ label, diffs, served, stocks });
  }
  return { start, periods, warnings };
}

/**
 * The state at the end of period `to` (1-based; 0 is the start), walked from a
 * known one: `state` at the end of period `from`. Diffs carry both directions,
 * so the walk goes forwards or backwards and costs only the periods between.
 */
export function walkPeriods(record: RunRecord, known: GraphSnapshot, from: number, to: number): GraphSnapshot {
  let state = known;
  for (let k = from; k < to; k++) {
    for (const diff of record.periods[k].diffs) state = applyGraphDiff(state, diff, "forward");
  }
  for (let k = from; k > to; k--) {
    const diffs = record.periods[k - 1].diffs;
    for (let i = diffs.length - 1; i >= 0; i--) state = applyGraphDiff(state, diffs[i], "backward");
  }
  return state;
}

/** The state at the end of period `number` (1-based), walked forward from the start. */
export const periodState = (record: RunRecord, number: number): GraphSnapshot => walkPeriods(record, record.start, 0, number);
