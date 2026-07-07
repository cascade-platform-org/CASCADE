/**
 * situation.ts — derive the "current Situation" from the Any Graph Update history.
 *
 * A Situation is the human-facing summary of "what scenario is currently set up":
 * the most recent Event that was applied, plus the Propagation that was run for
 * it (if any). It is the single source of truth for both:
 *   - the floating Situation window (informational badge on the canvas), and
 *   - the Save-to-Scorecard dialog's before/after snapshot resolution.
 *
 * Everything is derived from `update_history` (newest-first) so undo, redo,
 * event-clear, and reset all keep the Situation automatically correct — there is
 * no separate mutable copy to keep in sync.
 *
 * Snapshot mapping (matches requirements §12.1):
 *   - before_propagation = state just before the Propagation (post-Event, pre-engine)
 *   - after_propagation  = state after the Propagation (absent if none was run)
 */

import type { AnyUpdateEntry } from "@/lib/schemas";
import type { GraphSnapshot } from "@/lib/schemas/network";

export interface Situation {
  /** The most recent `event_applied` entry — the Event that set up this scenario. */
  eventEntry: AnyUpdateEntry;
  /**
   * The `propagation` entry that was run *after* the Event, or null if the user
   * has applied the Event but not yet propagated. A stale Propagation from a
   * previous scenario (older than the latest Event) is deliberately ignored.
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

  const eventEntry = updateHistory[eventIdx];

  const propIdx = updateHistory.findIndex((e) => e.update_type === "propagation");
  // A Propagation counts only if it is newer (nearer the top) than the Event.
  const propEntry = propIdx !== -1 && propIdx < eventIdx ? updateHistory[propIdx] : null;

  return { eventEntry, propEntry };
}

/**
 * Resolve the before/after snapshots a Scorecard entry should store for a
 * Situation. `before` is always the post-Event / pre-engine state; `after` is
 * present only once a Propagation has been run for this Event.
 */
export function situationSnapshots(
  situation: Situation,
): { before: GraphSnapshot; after?: GraphSnapshot } {
  if (situation.propEntry) {
    return { before: situation.propEntry.before, after: situation.propEntry.after };
  }
  // No Propagation yet — the post-Event state is the scenario to save.
  return { before: situation.eventEntry.after };
}
