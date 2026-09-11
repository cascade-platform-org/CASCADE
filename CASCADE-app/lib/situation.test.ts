/**
 * situation — deriving the current Situation from the Any Graph Update history.
 *
 * These cases are the ones the module's own comments record as past bugs: a
 * stale Event reported as live because two Propagations sat back-to-back, and a
 * reverted Temporal Jump run still being described after the graph had rewound
 * out of it. Both used to be reachable only through the UI.
 */

import { describe, it, expect } from "vitest";

import { deriveSituation, situationEventIds } from "@/lib/situation";
import { updatesInScenario, liveUpdatesInScenario } from "@/lib/scenario-history";
import type { AnyUpdateEntry } from "@/lib/schemas/network";

let seq = 0;
function entry(
  update_type: AnyUpdateEntry["update_type"],
  extra: Partial<AnyUpdateEntry> = {},
): AnyUpdateEntry {
  return {
    id: `e${seq++}`,
    timestamp: new Date().toISOString(),
    update_type,
    label: update_type,
    ...extra,
  };
}
/** History is stored newest-first; these read top-down the same way. */
const history = (...entries: AnyUpdateEntry[]) => entries;

describe("deriveSituation", () => {
  it("returns null when no Event has been applied", () => {
    expect(deriveSituation(history(entry("graph_update"), entry("graph_update")))).toBeNull();
  });

  it("reports an Event applied but not yet propagated", () => {
    const ev = entry("event_applied", { event_id: "quake" });
    const s = deriveSituation(history(ev));
    expect(s?.eventEntries).toEqual([ev]);
    expect(s?.propEntry).toBeNull();
  });

  it("pairs an Event with the Propagation run after it", () => {
    const prop = entry("propagation");
    const ev = entry("event_applied", { event_id: "quake" });
    const s = deriveSituation(history(prop, ev));
    expect(s?.propEntry).toBe(prop);
    expect(s?.eventEntries).toEqual([ev]);
  });

  it("collects every Event stacked before one Propagation, newest first", () => {
    const prop = entry("propagation");
    const flood = entry("event_applied", { event_id: "flood" });
    const quake = entry("event_applied", { event_id: "quake" });
    const s = deriveSituation(history(prop, flood, quake));
    expect(situationEventIds(s!)).toEqual(["flood", "quake"]);
  });

  it("ignores a manual edit sitting above the Propagation", () => {
    const edit = entry("graph_update");
    const prop = entry("propagation");
    const ev = entry("event_applied", { event_id: "quake" });
    const s = deriveSituation(history(edit, prop, ev));
    expect(s?.propEntry).toBe(prop);
    expect(s?.eventEntries).toEqual([ev]);
  });

  // The bug the module's comment records: scanning for "the newest Event
  // anywhere" would find the stale one below and report a Situation whose
  // eventEntries was empty, which crashed situation-window.tsx.
  it("returns null when two Propagations sit back-to-back above a stale Event", () => {
    const s = deriveSituation(
      history(
        entry("propagation"),
        entry("propagation"),
        entry("event_applied", { event_id: "quake" }),
      ),
    );
    expect(s).toBeNull();
  });

  it("stops at a Reset — an Event from a dead scenario is not reported", () => {
    const s = deriveSituation(
      history(entry("scenario_reset"), entry("event_applied", { event_id: "quake" })),
    );
    expect(s).toBeNull();
  });

  it("does not report a Temporal Jump run that was reverted", () => {
    const boundary = entry("event_applied", { event_id: "quake" });
    const s = deriveSituation(
      history(
        entry("temporal_jump_revert", { reverts_to_entry_id: boundary.id }),
        entry("propagation"),
        entry("event_applied", { event_id: "temporal_jump" }),
        boundary,
      ),
    );
    // The jump and its Propagation are gone; the Event that was live before the
    // run is what the canvas is showing.
    expect(situationEventIds(s!)).toEqual(["quake"]);
    expect(s?.propEntry).toBeNull();
  });

  it("returns null when a revert's boundary has aged out of the capped history", () => {
    const s = deriveSituation(
      history(
        entry("temporal_jump_revert", { reverts_to_entry_id: "evicted" }),
        entry("event_applied", { event_id: "quake" }),
      ),
    );
    expect(s).toBeNull();
  });

  // Clear Event does not remove the Propagation entry it invalidates — only the
  // cleared event_applied is removed (store/canvas-store.ts) — so a stale
  // Propagation is left sitting directly below the event_cleared entry. Found by
  // a behavioral test (store/behavioral.test.ts) walking Event → Propagate →
  // Clear Event as a real session; a unit test setting up `history` by hand
  // could not have discovered it, because it never has to reproduce the exact
  // shape Clear Event actually leaves behind.
  it("does not attribute a Propagation that Clear Event invalidated to the Event still standing", () => {
    const s = deriveSituation(
      history(
        entry("event_cleared", { event_id: "quake" }),
        entry("propagation"), // the cascade quake's Propagation produced — now stale
        entry("event_applied", { event_id: "flood" }),
      ),
    );
    // flood was applied before that Propagation ran and is still un-propagated —
    // reporting the stale Propagation would let a Save-to-Scorecard attribute
    // quake's now-reverted cascade to flood alone.
    expect(situationEventIds(s!)).toEqual(["flood"]);
    expect(s?.propEntry).toBeNull();
  });

  it("invalidates only the nearest Propagation, leaving an older session untouched", () => {
    // Reachable as: applyEvent(earlier) → propagate() [B] → applyEvent(flood) →
    // propagate() [A] → applyEvent(quake) → clearEvent() (clears quake, and with
    // it A — the Baseline's only outstanding Propagation writes at that point).
    const olderSession = entry("propagation");
    const s = deriveSituation(
      history(
        entry("event_cleared", { event_id: "quake" }),
        entry("propagation"), // A — invalidated by the clear above
        entry("event_applied", { event_id: "flood" }),
        olderSession, // B — flood's clear never reached this far back
        entry("event_applied", { event_id: "earlier" }),
      ),
    );
    // flood is standing, un-propagated — A is gone, not silently reused for it.
    expect(situationEventIds(s!)).toEqual(["flood"]);
    expect(s?.propEntry).toBeNull();
  });
});

describe("scenario-history", () => {
  it("both readings stop at a Reset", () => {
    const h = history(entry("graph_update"), entry("scenario_reset"), entry("event_applied"));
    expect(updatesInScenario(h)).toHaveLength(1);
    expect(liveUpdatesInScenario(h)).toHaveLength(1);
  });

  // The one axis on which the Baseline and the Situation disagree.
  it("keeps a reverted jump run for the Baseline and drops it for the Situation", () => {
    const boundary = entry("event_applied", { event_id: "quake" });
    const jump = entry("event_applied", { event_id: "temporal_jump" });
    const revert = entry("temporal_jump_revert", { reverts_to_entry_id: boundary.id });
    const h = history(revert, jump, boundary);

    expect(updatesInScenario(h)).toEqual([revert, jump, boundary]);
    expect(liveUpdatesInScenario(h)).toEqual([boundary]);
  });

  it("yields the identical entry objects, so callers can index back into history", () => {
    const ev = entry("event_applied");
    const h = history(ev);
    expect(liveUpdatesInScenario(h)[0]).toBe(ev);
    expect(h.indexOf(liveUpdatesInScenario(h)[0])).toBe(0);
  });
});
