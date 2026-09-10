/**
 * scenario-baseline.ts — what the scenario changed, and what puts it back (ADR-0016).
 *
 * The **Scenario Baseline** holds each touched field's value from before the
 * current scenario touched it, tagged with who wrote it. **Reset** and **Clear
 * Event** are two different reads of that one map; Undo is unrelated and stays
 * positional over the update history.
 *
 * IT IS DERIVED, NOT ACCUMULATED. Every write already pushes an Any Graph Update
 * carrying a Graph Diff of exactly what it changed (ADR-0017), so a second
 * running copy would be the same information maintained twice — and every rewind
 * (Undo, Redo, Clear Event) a chance for the two to disagree with nothing
 * failing. `deriveSituation` took this decision first and for the same reason:
 * "there is no separate mutable copy to keep in sync".
 *
 * The one thing derivation cannot see is an Update the capped history has already
 * evicted, which is why `history-store` folds an entry into its RETIRED map on
 * the way out. A scenario easily outlives twenty Updates, and losing the ability
 * to Reset because the user nudged twenty node positions is the bug that map
 * exists to prevent.
 */

import { reverseMutations } from "@/lib/event-application";
import { writeFieldValue } from "@/lib/graph-diff";
import type { AnyUpdateEntry, GraphDiff, GraphSnapshot } from "@/lib/schemas/network";

// ---------------------------------------------------------------------------
// Scenario Fields
// ---------------------------------------------------------------------------

/**
 * The five fields describing an Element's CONDITION rather than its design.
 * Everything else an Element carries — label, position, Node Type, Categories,
 * capacity, `vulnerability_levels`, `properties` — is model.
 *
 * **Reset forces every one of these to an operational state outright**, on every
 * Element, without consulting the Scenario Baseline — see `forceOperational`.
 * The Baseline is what reverts everything else: a *model* attribute an Event or
 * a Propagation wrote (ADR-0015 lets a Rule assign any attribute at all), found
 * by provenance rather than by name, so this list never has to grow when a Rule
 * learns a new attribute.
 *
 * `functionality_time` is in the set deliberately: it is the countdown a backup
 * has left IN THIS SCENARIO, the history entry for editing it is literally
 * `manual_functionality_update` ("Functionality or Functionality Time"), and a
 * 6-hour reserve typed in as a what-if is not a property of the asset.
 */
export const SCENARIO_FIELDS: readonly string[] = [
  "functionality",
  "functionality_time",
  "direct_damage",
  "expected_repair_time",
  "responsibility_share",
];

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

/**
 * Who wrote a field. A tag, not a causal graph: it names the operation that
 * performed the write, never the Event that ultimately caused it. Attributing a
 * Propagation's writes to individual Events is not something the client can do —
 * see ADR-0016's rejected options.
 */
export type BaselineSource = "manual" | "propagation" | `event:${string}`;

export interface BaselineEntry {
  /** Element or Canvas id. */
  id: string;
  field: string;
  /** Set only for `field: "properties"`, matching a Graph Diff's FieldChange. */
  key?: string;
  /** The value from before the scenario touched this field, or DIFF_ABSENT. */
  value: unknown;
  source: BaselineSource;
}

/** Keyed so one field is held once. Insertion order is oldest-write-first. */
export type ScenarioBaseline = Map<string, BaselineEntry>;

/**
 * Structured, not dot-joined. `"<elementId>.<field>"` would have to split on the
 * last dot, which EPANET ids break (`J.12.A`), and a `properties` sub-key needs
 * a third component anyway. JSON is used purely as a collision-free encoder —
 * nothing parses this back, because the parts are carried on the entry.
 */
export function baselineKey(id: string, field: string, key?: string): string {
  return JSON.stringify([id, field, key ?? null]);
}

// ---------------------------------------------------------------------------
// Deriving
// ---------------------------------------------------------------------------

/**
 * Updates that UNDO earlier work rather than doing new work.
 *
 * These must never be folded into a Baseline. Their diff's `before` side is a
 * mid-scenario state — the cascade that was just discarded — so folding one
 * would record a degraded value as "what this field looked like before the
 * scenario", and Reset would then restore the graph INTO the cascade it was
 * asked to remove.
 *
 * Nothing is lost by skipping them. If the Update they reverted is still in
 * history, it already contributes the correct pre-scenario value; if it was
 * removed (Clear Event drops the `event_applied` entry), its writes are no
 * longer in the graph and there is nothing left to revert.
 */
const REVERTING_UPDATES = new Set<AnyUpdateEntry["update_type"]>([
  "event_cleared",
  "temporal_jump_revert",
]);

/** The source tag an Update's writes carry, from the kind of Update it was. */
export function sourceOf(entry: Pick<AnyUpdateEntry, "update_type" | "event_id">): BaselineSource {
  if (entry.update_type === "event_applied" && entry.event_id) return `event:${entry.event_id}`;
  if (entry.update_type === "propagation") return "propagation";
  return "manual";
}

/**
 * Fold one Update's Graph Diff into a Baseline. FIRST WRITE WINS, so callers
 * must fold OLDEST-FIRST — the value kept is then the one from before the
 * scenario began, not from before the most recent overwrite.
 *
 * A record the Update added did not exist beforehand, so every one of its fields
 * is recorded ABSENT: reverting deletes the whole Element, which is what "put
 * the scenario back" means for an Element a cascade created.
 */
export function foldDiff(baseline: ScenarioBaseline, diff: GraphDiff, source: BaselineSource): void {
  for (const group of [diff.nodes, diff.edges, diff.canvases]) {
    for (const record of group) {
      if (record.op === "update") {
        for (const change of record.fields) {
          const k = baselineKey(record.id, change.field, change.key);
          if (baseline.has(k)) continue;
          baseline.set(k, {
            id: record.id,
            field: change.field,
            ...(change.key !== undefined ? { key: change.key } : {}),
            value: change.before,
            source,
          });
        }
      }
      // add/remove of a whole record is a model operation (a node created or
      // deleted). Reset does not resurrect or destroy Elements — see ADR-0016 —
      // so nothing is recorded for it.
    }
  }
}

/**
 * Build the Baseline for the current scenario.
 *
 * `retired` holds entries whose Update has already been evicted from the capped
 * history; they are older than anything still in `history`, so they fold first
 * and win under first-write-wins.
 *
 * `history` is newest-first as stored, and is walked **oldest-first** back to
 * the newest `scenario_reset` — a Reset ends the scenario, so nothing older
 * belongs to it. A legacy entry with no diff contributes nothing: it predates
 * ADR-0017 and there is no field-level record of what it changed.
 */
export function deriveBaseline(
  history: readonly AnyUpdateEntry[],
  retired: readonly BaselineEntry[] = [],
): ScenarioBaseline {
  const baseline: ScenarioBaseline = new Map();
  for (const entry of retired) {
    if (!baseline.has(baselineKey(entry.id, entry.field, entry.key))) {
      baseline.set(baselineKey(entry.id, entry.field, entry.key), entry);
    }
  }

  const resetAt = history.findIndex((e) => e.update_type === "scenario_reset");
  const inScenario = resetAt === -1 ? history : history.slice(0, resetAt);

  for (let i = inScenario.length - 1; i >= 0; i--) {
    const entry = inScenario[i];
    if (!entry.diff) continue; // legacy: no field-level record of what it changed
    if (REVERTING_UPDATES.has(entry.update_type)) continue;
    foldDiff(baseline, entry.diff, sourceOf(entry));
  }
  return baseline;
}

// ---------------------------------------------------------------------------
// Reading the Baseline: Reset and Clear Event
// ---------------------------------------------------------------------------

/**
 * What **Reset** reverts out of the Baseline: every write an Event or a
 * Propagation made, to any field.
 *
 * Scenario Fields are deliberately NOT the Baseline's job any more —
 * `forceOperational` sets those outright, whoever wrote them, so a Reset that
 * runs against an incomplete Baseline still leaves a working network. What only
 * the Baseline can undo is a *model* attribute a machine wrote: a `capacity` a
 * Rule assigned, a custom `properties` key a cascade merged (ADR-0015).
 *
 * A hand edit to a model field is left alone: a label fixed, a node moved, or a
 * capacity corrected mid-scenario is authoring work and survives.
 */
export function resetPlan(baseline: ScenarioBaseline): BaselineEntry[] {
  return [...baseline.values()].filter((e) => e.source !== "manual");
}

/**
 * Put every Element into the operational state Reset guarantees: full
 * Functionality, no backup countdown, no damage, no blame.
 *
 * This runs unconditionally, independently of the Scenario Baseline. That
 * independence is the point: the Baseline is derived from the update history and
 * can be incomplete — a rewind that crossed a Reset boundary, an entry evicted
 * before it could be retired, a future bug in the fold — and a Reset that
 * silently left the network damaged because its own bookkeeping was wrong is a
 * far worse failure than one that repairs an Element it did not have to.
 *
 * Pure, and copy-on-write per Element: untouched Elements keep their identity,
 * so callers can still count what actually changed by reference.
 */
export function forceOperational(snapshot: GraphSnapshot, n: number): GraphSnapshot {
  let changed = false;
  const sweep = <T extends Record<string, unknown>>(registry: Record<string, T>): Record<string, T> => {
    const out: Record<string, T> = {};
    for (const [id, el] of Object.entries(registry)) {
      const needsWork =
        el.functionality !== n ||
        (el.functionality_time ?? 0) !== 0 ||
        "direct_damage" in el ||
        "expected_repair_time" in el ||
        "responsibility_share" in el;
      if (!needsWork) {
        out[id] = el;
        continue;
      }
      const copy = { ...el, functionality: n, functionality_time: 0 };
      delete copy.direct_damage;
      delete copy.expected_repair_time;
      delete copy.responsibility_share;
      out[id] = copy;
      changed = true;
    }
    return out;
  };

  const nodes = sweep(snapshot.nodes as unknown as Record<string, Record<string, unknown>>);
  const edges = sweep(snapshot.edges as unknown as Record<string, Record<string, unknown>>);
  if (!changed) return snapshot;
  return {
    ...snapshot,
    nodes: nodes as unknown as GraphSnapshot["nodes"],
    edges: edges as unknown as GraphSnapshot["edges"],
  };
}

/**
 * What **Clear Event** reverts: that Event's own writes, and every write the
 * Propagation made — a cascade computed from an input that no longer exists is
 * stale, and showing it is worse than showing nothing.
 *
 * `manual` entries and other Events' entries stand. No Propagation is re-run:
 * the graph lands at "the remaining Events, un-propagated", and recomputing is
 * the user's call.
 */
export function clearEventPlan(baseline: ScenarioBaseline, eventId: string): BaselineEntry[] {
  const tag: BaselineSource = `event:${eventId}`;
  return [...baseline.values()].filter((e) => e.source === tag || e.source === "propagation");
}

/**
 * How to revert one applied Event, given the Baseline — the whole decision in
 * one place, in priority order.
 *
 * Returns a pure transform over the live Scenario, or null when there is
 * nothing to revert. Three tiers, because a project file can have been written
 * by three generations of this app and Clear Event has to do the best available
 * thing with each:
 *
 *  1. **The Scenario Baseline** — this build. Reverts the Event's own writes and
 *     every Propagation write (ADR-0016).
 *  2. **The entry's own `mutation_reversal`** — a build that recorded the
 *     Event's inverse but no Graph Diff. Reverts only the Event's own fields, so
 *     the cascade stays; less than ADR-0016 specifies, but precise, and far
 *     better than tier 3.
 *  3. **A full rewind to the entry's `before` snapshot** — the oldest format,
 *     which discards every edit made since. The only reversal those entries can
 *     support at all.
 *
 * Living here rather than in the store keeps "what does clearing an Event mean"
 * next to the Baseline rules it is defined against, and leaves the store action
 * with one code path instead of three near-identical ones.
 */
export function clearEventReversal(
  entry: AnyUpdateEntry,
  baseline: ScenarioBaseline,
): ((live: GraphSnapshot) => GraphSnapshot) | null {
  if (entry.event_id) {
    const plan = clearEventPlan(baseline, entry.event_id);
    // An Event that changed nothing records an empty plan AND an empty diff;
    // that is a real reversal (a no-op), not a missing record, so it must not
    // fall through to the rewind below.
    if (plan.length > 0 || entry.diff) return (live) => applyBaselineEntries(live, plan);
  }
  if (entry.mutation_reversal) {
    const reversal = entry.mutation_reversal;
    return (live) => reverseMutations(live, reversal);
  }
  if (entry.before) {
    const before = entry.before;
    return () => before;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

/**
 * Write a Baseline's recorded values back onto a Scenario. Pure.
 *
 * DIFF_ABSENT deletes the key rather than writing `null` — an optional-but-not-
 * nullable field set to `null` fails the Zod and Pydantic schemas and desyncs
 * the Scorecard dedup hash from the true prior state. Entries naming a record
 * that no longer exists are skipped, so reversal survives an Element being
 * deleted after the write was recorded.
 */
export function applyBaselineEntries(
  snapshot: GraphSnapshot,
  entries: readonly BaselineEntry[],
): GraphSnapshot {
  if (entries.length === 0) return snapshot;

  const canvasIdx = new Map(snapshot.canvases.map((c, i) => [c.id, i]));
  // One id-keyed working set over all three registries, so "which registry is
  // this record in" is answered once per record rather than at every step.
  const written = new Map<string, Record<string, unknown>>();

  const openForWrite = (id: string): Record<string, unknown> | undefined => {
    const already = written.get(id);
    if (already) return already;
    const canvasAt = canvasIdx.get(id);
    const source =
      snapshot.nodes[id] ?? snapshot.edges[id] ?? (canvasAt === undefined ? undefined : snapshot.canvases[canvasAt]);
    // An entry naming a record that no longer exists is skipped, so reversal
    // survives an Element being deleted after the write was recorded.
    if (!source) return undefined;
    // Copy-on-write per record, so untouched Elements keep their identity —
    // callers count affected Elements by reference (see event-application.ts).
    const copy = { ...(source as unknown as Record<string, unknown>) };
    written.set(id, copy);
    return copy;
  };

  for (const entry of entries) {
    const record = openForWrite(entry.id);
    if (!record) continue;
    // Same primitive diff application uses, so the DIFF_ABSENT and `properties`
    // rules have exactly one implementation between the two modules.
    writeFieldValue(record, entry.field, entry.key, entry.value);
  }

  if (written.size === 0) return snapshot;

  const nodes = { ...snapshot.nodes };
  const edges = { ...snapshot.edges };
  const canvases = [...snapshot.canvases];
  for (const [id, record] of written) {
    if (id in nodes) nodes[id] = record as unknown as GraphSnapshot["nodes"][string];
    else if (id in edges) edges[id] = record as unknown as GraphSnapshot["edges"][string];
    else canvases[canvasIdx.get(id)!] = record as unknown as GraphSnapshot["canvases"][number];
  }
  return { ...snapshot, nodes, edges, canvases };
}

