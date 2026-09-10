/**
 * situation.ts — derive the "current Situation" from the Any Graph Update history.
 *
 * A Situation is the human-facing summary of "what scenario is currently set up":
 * every Event applied since the last Propagation (there may be more than one —
 * the user can stack several Events before running a single Propagation), plus
 * the Propagation that was run for them (if any). It is the single source of
 * truth for both:
 *   - the floating Situation window (informational badge on the canvas), and
 *   - the Save-to-Scorecard dialog's before/after snapshot resolution.
 *
 * Everything is derived from `update_history` (newest-first) so undo, redo,
 * event-clear, and reset all keep the Situation automatically correct — there is
 * no separate mutable copy to keep in sync.
 *
 * Snapshot mapping (matches requirements §12.1):
 *   - before_propagation = state just before the Propagation (post-Events, pre-engine)
 *   - after_propagation  = state after the Propagation (absent if none was run)
 */

import { materialiseAround } from "@/lib/graph-diff";
import type { AnyUpdateEntry } from "@/lib/schemas";
import type { GraphSnapshot } from "@/lib/schemas/network";

export interface Situation {
  /**
   * Every `event_applied` entry applied since the last Propagation, newest first.
   * Always has at least one entry (deriveSituation returns null otherwise).
   */
  eventEntries: AnyUpdateEntry[];
  /**
   * The `propagation` entry that was run *after* all of `eventEntries`, or null
   * if the user has applied the Event(s) but not yet propagated. A stale
   * Propagation from a previous scenario (older than the newest Event) is
   * deliberately ignored.
   */
  propEntry: AnyUpdateEntry | null;
}

/**
 * Build the current Situation from history. Returns null when no Event has been
 * applied (a purely manual what-if — no Situation to summarise).
 *
 * `updateHistory` is newest-first, so the first match is always the most recent.
 */
export function deriveSituation(updateHistory: AnyUpdateEntry[]): Situation | null {
  // Walk from the top past anything that isn't an Event. The first Propagation
  // encountered before any Event is the one that was run for this session (if
  // any) — entries above it, like a manual graph edit, don't change that.
  //
  // This has to be ONE walk, not "find the newest Event anywhere, then find the
  // newest Propagation and compare indices": two Propagation entries can sit
  // back-to-back (e.g. the user re-runs Propagation with no new Event in
  // between) while an older, already-superseded Event still exists further
  // back in history. Scanning for "the newest Event anywhere" would find that
  // stale one and report a non-null Situation, while the boundary-respecting
  // collection loop below would (correctly) stop at the nearer Propagation and
  // collect nothing — a non-null Situation with an empty `eventEntries`, which
  // crashed situation-window.tsx's `situation.eventEntries[0].id` read.
  let i = 0;
  let propEntry: AnyUpdateEntry | null = null;
  for (; i < updateHistory.length; i++) {
    const entry = updateHistory[i];
    if (entry.update_type === "event_applied") break;
    // A Reset ends the scenario: everything older belongs to a dead session,
    // and nothing newer was an Event (we would have broken at it above).
    if (entry.update_type === "scenario_reset") return null;
    // Temporal Jumps were undone. The graph is back to its pre-jump state, so
    // the Situation is whatever was live *before* those jumps — the jumps
    // themselves are Events (temporal_jump synthetic ones) and would otherwise
    // still be reported, along with a Propagation that no longer describes the
    // graph. Skipping to the recorded boundary rewinds the whole run at once,
    // however many jumps and Propagations it contained.
    if (entry.update_type === "temporal_jump_revert") {
      const boundary = entry.reverts_to_entry_id;
      const at = boundary ? updateHistory.findIndex((e) => e.id === boundary) : -1;
      // No boundary recorded, or it has aged out of the capped history: the
      // pre-jump scenario cannot be reconstructed, and reporting the reverted
      // one would be worse than reporting none.
      if (at === -1) return null;
      i = at - 1; // -1 because the loop's i++ moves onto the boundary entry
      continue;
    }
    if (entry.update_type === "propagation") {
      propEntry = entry;
      i++;
      break;
    }
  }

  // From here, collect every Event applied in this session — walk older until
  // hitting another Propagation or a Reset, both of which mark the boundary of
  // a prior session.
  const eventEntries: AnyUpdateEntry[] = [];
  for (; i < updateHistory.length; i++) {
    const entry = updateHistory[i];
    if (entry.update_type === "propagation" || entry.update_type === "scenario_reset") break;
    // Same rewind as above: the jumps it undid are not part of this Situation.
    if (entry.update_type === "temporal_jump_revert") {
      const boundary = entry.reverts_to_entry_id;
      const at = boundary ? updateHistory.findIndex((e) => e.id === boundary) : -1;
      if (at === -1) break;
      i = at - 1;
      continue;
    }
    if (entry.update_type === "event_applied") eventEntries.push(entry);
  }

  // No Event in the current session (e.g. two Propagations back-to-back) —
  // nothing to summarise, regardless of what an older session left behind.
  if (eventEntries.length === 0) return null;

  return { eventEntries, propEntry };
}

/**
 * Resolve the before/after snapshots a Scorecard entry should store for a
 * Situation. `before` is always the post-Event(s) / pre-engine state; `after` is
 * present only once a Propagation has been run for this Situation.
 */
export function situationSnapshots(
  situation: Situation,
  history: readonly AnyUpdateEntry[],
  live: GraphSnapshot,
): { before: GraphSnapshot; after?: GraphSnapshot } {
  // History entries carry a Graph Diff, not whole Scenarios (ADR-0017), so a
  // whole Scenario is rebuilt by walking the LIVE graph backwards — at most
  // HISTORY_LIMIT steps, with no stored base to replay from. `indexOf` is by
  // object identity: these entries came out of this same array.
  const around = (entry: AnyUpdateEntry) =>
    materialiseAround(live, history, history.indexOf(entry));

  if (situation.propEntry) {
    const { before, after } = around(situation.propEntry);
    return { before, after };
  }
  // No Propagation yet — the state after the most recently applied Event (which
  // already includes every earlier stacked Event) is the scenario to save.
  return { before: around(situation.eventEntries[0]).after };
}

/** EventDefinition ids for every Event in the Situation, newest-applied first. */
export function situationEventIds(situation: Situation): string[] {
  return situation.eventEntries
    .map((e) => e.event_id)
    .filter((id): id is string => Boolean(id));
}
