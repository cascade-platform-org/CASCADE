/**
 * scenario-history.ts — which Any Graph Updates belong to the current scenario.
 *
 * `update_history` is one flat, newest-first list spanning every scenario the
 * project has ever been in. Two very different questions are asked of it:
 *
 *   - **Situation** (`lib/situation.ts`) — what scenario is set up right now?
 *   - **Scenario Baseline** (`lib/scenario-baseline.ts`) — what did this scenario
 *     change, and what puts it back?
 *
 * Both first have to answer the same prior question — *where does the current
 * scenario begin, and which Updates count as inside it* — and both used to
 * answer it themselves. The rules are subtle enough that having two copies was a
 * standing risk: the two could disagree about what the current scenario even is,
 * with nothing failing.
 *
 * There are exactly two rules, and this module is the only place either is
 * written down:
 *
 *  1. **A `scenario_reset` ends the scenario.** Nothing older belongs to it, so
 *     the walk stops there (ADR-0016).
 *  2. **A `temporal_jump_revert` undid a whole run of Temporal Jumps.** It names
 *     the entry that was live before the run started (`reverts_to_entry_id`), so
 *     the walk can skip the entire run at once, however many jumps and
 *     Propagations it contained.
 *
 * Rule 2 is where the two readings part company, which is why this module
 * exports two named walks rather than one with a flag — see each below.
 */

import type { AnyUpdateEntry } from "@/lib/schemas/network";

/**
 * The shared walk. Newest-first, stopping at the scenario boundary.
 *
 * `followReverts` decides whether a reverted Temporal Jump run is skipped or
 * walked through. Private, because the two call sites want opposite answers and
 * "true"/"false" at a call site says nothing about which — the exported wrappers
 * carry that meaning in their names.
 */
function* walk(
  history: readonly AnyUpdateEntry[],
  followReverts: boolean,
): Generator<AnyUpdateEntry> {
  for (let i = 0; i < history.length; i++) {
    const entry = history[i];
    if (entry.update_type === "scenario_reset") return;

    if (followReverts && entry.update_type === "temporal_jump_revert") {
      const boundary = entry.reverts_to_entry_id;
      const at = boundary ? history.findIndex((e) => e.id === boundary) : -1;
      // No boundary recorded, or it has aged out of the capped history: the
      // pre-jump scenario cannot be reconstructed, and reporting the reverted
      // one would be worse than reporting none. Stop rather than guess.
      if (at === -1) return;
      i = at - 1; // -1 because the loop's i++ moves onto the boundary entry
      continue;
    }

    yield entry;
  }
}

/**
 * Every Update since the last Reset, newest-first — **including** ones a
 * Temporal Jump revert later undid.
 *
 * This is the **Scenario Baseline**'s reading. A reverted jump's Updates are
 * still worth folding: under first-write-wins their `before` values are only
 * consulted for fields no earlier Update in the scenario touched, and the
 * revert's own entry is skipped by the Baseline for a separate reason (its diff
 * describes a discarded cascade — see `REVERTING_UPDATES`).
 */
export function updatesInScenario(history: readonly AnyUpdateEntry[]): AnyUpdateEntry[] {
  return [...walk(history, false)];
}

/**
 * Every Update since the last Reset that still describes the live graph,
 * newest-first — a reverted Temporal Jump run is **skipped whole**.
 *
 * This is the **Situation**'s reading. The graph is back at its pre-jump state,
 * so reporting those jumps (and the Propagation that followed them) would
 * describe a Scenario the canvas is no longer showing.
 */
export function liveUpdatesInScenario(history: readonly AnyUpdateEntry[]): AnyUpdateEntry[] {
  return [...walk(history, true)];
}
