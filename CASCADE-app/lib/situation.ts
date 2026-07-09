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
  const eventIdx = updateHistory.findIndex((e) => e.update_type === "event_applied");
  if (eventIdx === -1) return null;

  // A Propagation counts only if it is newer (nearer the top) than the newest Event.
  const propIdx = updateHistory.findIndex((e) => e.update_type === "propagation");
  const propEntry = propIdx !== -1 && propIdx < eventIdx ? updateHistory[propIdx] : null;

  // Collect every event_applied entry in the current session: start right after
  // propEntry (or at the top of history if there is none), and walk older until
  // hitting a propagation entry — that boundary belongs to a previous session.
  const startIdx = propEntry ? propIdx + 1 : 0;
  const eventEntries: AnyUpdateEntry[] = [];
  for (let i = startIdx; i < updateHistory.length; i++) {
    const entry = updateHistory[i];
    if (entry.update_type === "propagation") break;
    if (entry.update_type === "event_applied") eventEntries.push(entry);
  }

  return { eventEntries, propEntry };
}

/**
 * Resolve the before/after snapshots a Scorecard entry should store for a
 * Situation. `before` is always the post-Event(s) / pre-engine state; `after` is
 * present only once a Propagation has been run for this Situation.
 */
export function situationSnapshots(
  situation: Situation,
): { before: GraphSnapshot; after?: GraphSnapshot } {
  if (situation.propEntry) {
    return { before: situation.propEntry.before, after: situation.propEntry.after };
  }
  // No Propagation yet — the state after the most recently applied Event (which
  // already includes every earlier stacked Event) is the scenario to save.
  return { before: situation.eventEntries[0].after };
}

/** EventDefinition ids for every Event in the Situation, newest-applied first. */
export function situationEventIds(situation: Situation): string[] {
  return situation.eventEntries
    .map((e) => e.event_id)
    .filter((id): id is string => Boolean(id));
}
