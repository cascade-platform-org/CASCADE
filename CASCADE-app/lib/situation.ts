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
import { liveUpdatesInScenario } from "@/lib/scenario-history";
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
 * Walks `liveUpdatesInScenario` — so the Reset boundary and reverted Temporal
 * Jump runs are already gone from the list, and this function only has to find
 * the Propagation/Event structure inside what is left.
 *
 * The walk has to be ONE pass, not "find the newest Event anywhere, then find
 * the newest Propagation and compare indices": two Propagation entries can sit
 * back-to-back (e.g. the user re-runs Propagation with no new Event in between)
 * while an older, already-superseded Event still exists further back in history.
 * Scanning for "the newest Event anywhere" would find that stale one and report
 * a non-null Situation, while the boundary-respecting collection loop below
 * would (correctly) stop at the nearer Propagation and collect nothing — a
 * non-null Situation with an empty `eventEntries`, which crashed
 * situation-window.tsx's `situation.eventEntries[0].id` read.
 *
 * `event_cleared` needs the same care. Clear Event does not remove the
 * `propagation` entry it invalidates — it reverts that Propagation's writes and
 * leaves the entry itself sitting in history (only the cleared `event_applied`
 * is removed), so a plain walk finds that stale Propagation and misattributes
 * it to whichever Events still stand. `clearEventPlan` (scenario-baseline.ts)
 * always reverts every currently-outstanding cascade write regardless of which
 * specific run produced it, so from the walk's perspective one `event_cleared`
 * cancels exactly one Propagation — the nearest one still older than it that
 * hasn't already been cancelled by an earlier clear. `outstandingClears` counts
 * clears not yet paired with the Propagation they invalidated; every Propagation
 * this walk meets is skipped (treated as if absent) while the count is positive.
 */
export function deriveSituation(updateHistory: AnyUpdateEntry[]): Situation | null {
  const live = liveUpdatesInScenario(updateHistory);
  let outstandingClears = 0;

  // Walk from the top past anything that isn't an Event. The first Propagation
  // encountered before any Event — and not itself cancelled by a clear — is the
  // one that was run for this session (if any); entries above it, like a manual
  // graph edit, don't change that.
  let i = 0;
  let propEntry: AnyUpdateEntry | null = null;
  for (; i < live.length; i++) {
    const type = live[i].update_type;
    if (type === "event_cleared") { outstandingClears++; continue; }
    if (type === "propagation") {
      if (outstandingClears > 0) { outstandingClears--; continue; }
      propEntry = live[i];
      i++;
      break;
    }
    if (type === "event_applied") break;
  }

  // From here, collect every Event applied in this session — walk older until
  // hitting another (live) Propagation, which marks the boundary of a prior
  // session.
  const eventEntries: AnyUpdateEntry[] = [];
  for (; i < live.length; i++) {
    const type = live[i].update_type;
    if (type === "event_cleared") { outstandingClears++; continue; }
    if (type === "propagation") {
      if (outstandingClears > 0) { outstandingClears--; continue; }
      break;
    }
    if (type === "event_applied") eventEntries.push(live[i]);
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
