/**
 * event-application.ts — applying an Event to a Scenario.
 *
 * This is the single home for what an Event *does* to a multi-canvas: the
 * imposed Functionality from `vulnerability_levels`, the Hazard `direct_damage`
 * fan-out, free-form `attribute_mutations`, and Temporal Jump expiry. It is a
 * pure transform over a GraphSnapshot, so the live canvas and every what-if
 * path (Save-to-Scorecard, Scorecard gap-fill, the "Run" button on an uncovered
 * Event) get the same answer from the same code.
 *
 * Before this module existed the transform lived only as a Zustand action that
 * mutated the registry in place, so a what-if had no way to ask "what WOULD this
 * Event do" without disturbing the canvas. The Save dialog worked around that by
 * re-implementing Temporal Jump, and the two implementations disagreed: the
 * store recorded the Event as the Responsibility Share of an expired Element and
 * the dialog left the previous Propagation's blame in place. That divergence is
 * the reason this seam is a pure function rather than a store action.
 *
 * REFERENCE IDENTITY IS PART OF THE INTERFACE. The returned snapshot reuses the
 * caller's object for every Element the Event did not touch (copy-on-write per
 * Element). Callers diff before/after by identity to count affected Elements —
 * see `countChangedElements` in components/canvas/action-bar.tsx — so a
 * wholesale clone would silently report every Element as affected.
 *
 * Monotonicity is NOT enforced here beyond what each phase specifies.
 * `vulnerability_levels` only ever worsens (§5.5), but `attribute_mutations` is
 * an unrestricted overwrite by design (CONTEXT.md → Event), and a Temporal Jump
 * expiry writes Functionality 1 outright. The engine's monotone commit is a
 * separate guarantee that lives in the engine (ADR-0003).
 */

import { nanoid } from "nanoid";

import { DIFF_ABSENT } from "@/lib/schemas/network";
import type { Node, Edge, GraphSnapshot } from "@/lib/schemas/network";
import type { EventDefinition } from "@/lib/schemas/config";

/**
 * Sentinel stored in a MutationReversal for a field that had no value before the
 * Event (as opposed to a field explicitly set to `null`/`false`). Reversal
 * deletes the key when it sees this marker rather than writing back a literal
 * `null`, which would violate the optional-but-not-nullable Zod/Pydantic field
 * schemas and desync the Scorecard dedup hash from the true prior state.
 *
 * Re-exported from the schema module rather than declared again: a Graph Diff
 * and a Scenario Baseline use the same sentinel, and three hand-kept copies of
 * one string literal is exactly the invariant that breaks silently.
 */
export const ABSENT = DIFF_ABSENT;

/**
 * The inverse of one Event application: every field it overwrote, keyed
 * `"<elementId>.<field>"`, holding the value that field had *before*. A field
 * that did not exist before is recorded as ABSENT.
 *
 * Keys split on the LAST "." — field names are fixed identifiers that never
 * contain a dot, but a free-form element id (a raw `.inp` label, say) can, and
 * splitting on the first dot would truncate it.
 */
export type MutationReversal = Record<string, unknown>;

export interface EventApplication {
  /** The Scenario after the Event. Untouched Elements keep their identity. */
  snapshot: GraphSnapshot;
  /** How to undo it — feed to `reverseMutations`. */
  reversal: MutationReversal;
}

/** Split a `"<elementId>.<field>"` key. Returns null when there is no dot. */
function splitFieldKey(key: string): { elementId: string; field: string } | null {
  const dotIdx = key.lastIndexOf(".");
  if (dotIdx === -1) return null;
  return { elementId: key.slice(0, dotIdx), field: key.slice(dotIdx + 1) };
}

/**
 * Mutable working set over a GraphSnapshot that copies an Element only the first
 * time it is written, so untouched Elements come back by reference.
 */
class ElementWriter {
  private readonly nodes: Record<string, Node>;
  private readonly edges: Record<string, Edge>;
  private readonly copied = new Set<string>();
  private dirty = false;

  constructor(private readonly source: GraphSnapshot) {
    this.nodes = { ...source.nodes };
    this.edges = { ...source.edges };
  }

  /** The Element as it was before any write in this application. */
  original(id: string): Node | Edge | undefined {
    return this.source.nodes[id] ?? this.source.edges[id];
  }

  has(id: string): boolean {
    return id in this.source.nodes || id in this.source.edges;
  }

  /** Every Element in the Scenario, in node-then-edge order. */
  *all(): Generator<{ id: string; el: Node | Edge }> {
    for (const el of Object.values(this.source.nodes)) yield { id: el.id, el };
    for (const el of Object.values(this.source.edges)) yield { id: el.id, el };
  }

  /** Write `fields` onto one Element, copying it on first touch. */
  write(id: string, fields: Record<string, unknown>): void {
    const bucket = id in this.nodes ? this.nodes : id in this.edges ? this.edges : null;
    if (!bucket) return;
    if (!this.copied.has(id)) {
      (bucket as Record<string, unknown>)[id] = { ...(bucket[id] as object) };
      this.copied.add(id);
    }
    Object.assign(bucket[id] as Record<string, unknown>, fields);
    this.dirty = true;
  }

  /** Delete one field from an Element (the ABSENT case on reversal). */
  unset(id: string, field: string): void {
    const bucket = id in this.nodes ? this.nodes : id in this.edges ? this.edges : null;
    if (!bucket) return;
    if (!this.copied.has(id)) {
      (bucket as Record<string, unknown>)[id] = { ...(bucket[id] as object) };
      this.copied.add(id);
    }
    delete (bucket[id] as Record<string, unknown>)[field];
    this.dirty = true;
  }

  /** The resulting Scenario. Returns the source itself when nothing changed. */
  result(): GraphSnapshot {
    if (!this.dirty) return this.source;
    return { ...this.source, nodes: this.nodes, edges: this.edges };
  }
}

/**
 * Build the synthetic Event that advances simulated time by `hours`.
 *
 * A Temporal Jump is an Event kind, not a separate mechanism (CONTEXT.md →
 * Temporal Jump), so it travels through `applyEventToSnapshot` like any other
 * and lands in history as a normal entry. It is always system-generated, never
 * user-authored, which is why it is minted here rather than read from the Model
 * Configuration.
 */
export function temporalJumpEvent(hours: number): EventDefinition {
  return {
    id: `tj-${nanoid(6)}`,
    // The `tj-` prefix is READ BACK by `canvas-store.clearEvent` to recognise
    // this Event as a Temporal Jump — the synthetic EventDefinition itself is
    // never persisted, only its effects. The hours travel structurally via
    // `duration_hours` below, recorded onto the history entry's own
    // `temporal_jump_hours` field (see canvas-store.applyEvent), not parsed
    // back out of this label.
    label: `Temporal Jump (+${hours}h)`,
    type: "temporal_jump",
    frequency_per_10y: 0,
    duration_hours: hours,
  };
}

/**
 * Apply one Event to a Scenario.
 *
 * `n` is the top of the Functionality scale (N). Phases run in a fixed order and
 * every phase reads the ORIGINAL Element state, never a previous phase's output,
 * so a later phase overwriting an earlier one is a deliberate last-writer-wins
 * (`attribute_mutations` is the escape hatch that can overwrite anything):
 *
 *   0. Temporal Jump — advance `functionality_time`, expire to Functionality 1
 *   1. `vulnerability_levels` — impose `N − level`, only where it worsens
 *   2. `direct_damage` — Hazards only, on every Element the Event affects
 *   3. `attribute_mutations` — unrestricted field overwrites
 *
 * The Event becomes the Responsibility Share of every Element whose Functionality
 * it changed (`{ [event.id]: 1.0 }`), so the UI reports the Event as the cause
 * rather than a stale Propagation from a previous run.
 */
export function applyEventToSnapshot(
  snapshot: GraphSnapshot,
  event: EventDefinition,
  n: number,
): EventApplication {
  const writer = new ElementWriter(snapshot);
  const reversal: MutationReversal = {};
  const eventCause = { [event.id]: 1.0 };

  /**
   * Record a field's prior value.
   *
   * First capture wins. This is defence in depth, not a live behaviour: every
   * phase below reads the ORIGINAL Element, so two phases capturing the same
   * field record the identical value today and the guard is unobservable. It
   * exists so that invariant is safe to break — a phase changed to read written
   * state would otherwise start recording an intermediate value as the thing to
   * reverse to, silently corrupting undo. Removing this line passes the suite;
   * that is the point of the comment.
   */
  const capture = (elementId: string, field: string, value: unknown): void => {
    const key = `${elementId}.${field}`;
    if (key in reversal) return;
    reversal[key] = value;
  };

  /** Capture + write a Functionality change, attributing it to the Event. */
  const degrade = (id: string, el: Node | Edge, functionality: number): void => {
    capture(id, "functionality", el.functionality);
    capture(id, "responsibility_share", el.responsibility_share ?? ABSENT);
    writer.write(id, { functionality, responsibility_share: eventCause });
  };

  // ── 0. Temporal Jump ──────────────────────────────────────────────────────
  // Only Elements already holding on backup (Functionality Time > 0) move; on
  // expiry the reserve is spent and the Element drops to 1 (requirements §9.2).
  if (event.type === "temporal_jump") {
    const hours = event.duration_hours ?? 0;
    for (const { id, el } of writer.all()) {
      const ft = el.functionality_time ?? 0;
      if (ft <= 0) continue;
      capture(id, "functionality_time", ft);
      const remaining = ft - hours;
      if (remaining <= 0) {
        capture(id, "functionality", el.functionality);
        capture(id, "responsibility_share", el.responsibility_share ?? ABSENT);
        writer.write(id, {
          functionality_time: 0,
          functionality: 1,
          responsibility_share: eventCause,
        });
      } else {
        writer.write(id, { functionality_time: remaining });
      }
    }
  }

  // ── 1. vulnerability_levels ───────────────────────────────────────────────
  // A missing or zero entry means immune. The imposed level applies only if it
  // WORSENS the current Functionality (requirements §5.5).
  for (const { id, el } of writer.all()) {
    const level = el.vulnerability_levels?.[event.id] ?? 0;
    if (level === 0) continue;
    const imposed = Math.max(1, n - level);
    if (imposed < (el.functionality ?? n)) degrade(id, el, imposed);
  }

  // ── 2. direct_damage (Hazards only) ───────────────────────────────────────
  // Every Element the Hazard affects is flagged, which is what puts it on the
  // repair list — including one whose Functionality was already at or below the
  // imposed level, hence the independent walk. `direct_damage_effects` supplies
  // per-Element repair-time overrides on top of the Event's default; it does NOT
  // decide which Elements are damaged (requirements §6.4).
  if (event.type === "hazard") {
    const explicitEffects = event.direct_damage_effects ?? {};
    const defaultRepairTime = event.default_repair_time;
    for (const { id, el } of writer.all()) {
      const level = el.vulnerability_levels?.[event.id] ?? 0;
      if (level === 0) continue;
      capture(id, "direct_damage", el.direct_damage ?? ABSENT);
      capture(id, "expected_repair_time", el.expected_repair_time ?? ABSENT);
      const repairTime = explicitEffects[id]?.expected_repair_time ?? defaultRepairTime;
      writer.write(id, {
        direct_damage: true,
        ...(repairTime !== undefined ? { expected_repair_time: repairTime } : {}),
      });
    }
  }

  // ── 3. attribute_mutations ────────────────────────────────────────────────
  // Unrestricted overwrites, so this runs last and wins. A mutation that writes
  // Functionality re-attributes the cause to the Event, matching phase 1.
  for (const [key, newVal] of Object.entries(event.attribute_mutations ?? {})) {
    const parsed = splitFieldKey(key);
    if (!parsed) continue;
    const { elementId, field } = parsed;
    const el = writer.original(elementId);
    if (!el) continue;
    const existing = (el as Record<string, unknown>)[field];
    capture(elementId, field, existing === undefined ? ABSENT : existing);
    if (field === "functionality") {
      capture(elementId, "responsibility_share", el.responsibility_share ?? ABSENT);
      writer.write(elementId, { [field]: newVal, responsibility_share: eventCause });
    } else {
      writer.write(elementId, { [field]: newVal });
    }
  }

  return { snapshot: writer.result(), reversal };
}

/**
 * Undo one Event application, given the MutationReversal it produced.
 *
 * A field recorded as ABSENT is deleted rather than written back as `null` —
 * see the ABSENT docstring for why that distinction is load-bearing. Keys naming
 * an Element that no longer exists are skipped, so reversal survives an Element
 * being deleted after the Event was applied.
 *
 * Untouched Elements keep their identity, exactly as in `applyEventToSnapshot`.
 */
export function reverseMutations(
  snapshot: GraphSnapshot,
  reversal: MutationReversal,
): GraphSnapshot {
  const writer = new ElementWriter(snapshot);
  for (const [key, oldVal] of Object.entries(reversal)) {
    const parsed = splitFieldKey(key);
    if (!parsed) continue;
    const { elementId, field } = parsed;
    if (!writer.has(elementId)) continue;
    if (oldVal === ABSENT) writer.unset(elementId, field);
    else writer.write(elementId, { [field]: oldVal });
  }
  return writer.result();
}
