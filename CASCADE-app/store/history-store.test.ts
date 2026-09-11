/**
 * history-store — eviction, and what eviction owes the Scenario Baseline.
 *
 * The Baseline is derived from `updateHistory` (ADR-0016), so anything the
 * buffer drops would silently stop being resettable. Retiring it on the way out
 * is what makes a scenario able to outlive twenty Updates.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { useHistoryStore, HISTORY_LIMIT, HISTORY_BYTE_BUDGET } from "@/store/history-store";
import { baselineKey, resetPlan } from "@/lib/scenario-baseline";
import { diffGraph } from "@/lib/graph-diff";
import type { AnyUpdateEntry, GraphSnapshot, Node } from "@/lib/schemas/network";

function snap(nodes: Node[]): GraphSnapshot {
  return { nodes: Object.fromEntries(nodes.map((n) => [n.id, n])), edges: {}, canvases: [] };
}
function node(id: string, functionality: number, extra: Partial<Node> = {}): Node {
  return { id, label: id, functionality, ...extra };
}

let seq = 0;
function entry(
  update_type: AnyUpdateEntry["update_type"],
  before: GraphSnapshot,
  after: GraphSnapshot,
  extra: Partial<AnyUpdateEntry> = {},
): AnyUpdateEntry {
  return {
    id: `e${seq++}`, timestamp: "", update_type, label: update_type,
    diff: diffGraph(before, after), ...extra,
  };
}

beforeEach(() => {
  useHistoryStore.setState({ updateHistory: [], redoStack: [], retiredBaseline: [] });
});

describe("eviction", () => {
  it("caps the buffer at HISTORY_LIMIT", () => {
    const push = useHistoryStore.getState().pushUpdateEntry;
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
      push(entry("graph_update", snap([node("n1", 3)]), snap([node("n1", 3, { label: `v${i}` })])));
    }
    expect(useHistoryStore.getState().updateHistory).toHaveLength(HISTORY_LIMIT);
  });

  it("retires what it drops, so Reset still reaches the pre-scenario value", () => {
    const store = useHistoryStore.getState();
    // The Event that started the scenario…
    store.pushUpdateEntry(
      entry("event_applied", snap([node("n1", 3)]), snap([node("n1", 1)]), { event_id: "quake" }),
    );
    // …then more than a bufferful of unrelated model edits, which push it out.
    for (let i = 0; i < HISTORY_LIMIT + 2; i++) {
      store.pushUpdateEntry(
        entry("graph_update", snap([node("n2", 3, { label: `a${i}` })]), snap([node("n2", 3, { label: `b${i}` })])),
      );
    }
    expect(useHistoryStore.getState().updateHistory.some((e) => e.event_id === "quake")).toBe(false);

    const baseline = useHistoryStore.getState().scenarioBaseline();
    expect(baseline.get(baselineKey("n1", "functionality"))?.value).toBe(3);
    expect(resetPlan(baseline).some((e) => e.id === "n1")).toBe(true);
  });

  it("evicts past the byte budget as well as the count", () => {
    const store = useHistoryStore.getState();
    // One diff far larger than twenty ordinary ones — a bulk deletion, say.
    const huge = "x".repeat(HISTORY_BYTE_BUDGET);
    store.pushUpdateEntry(
      entry("graph_update", snap([node("n1", 3)]), snap([node("n1", 3, { label: huge })])),
    );
    store.pushUpdateEntry(
      entry("graph_update", snap([node("n2", 3)]), snap([node("n2", 3, { label: "small" })])),
    );
    // Well under HISTORY_LIMIT entries, yet the buffer trims: a count alone is
    // the wrong bound once entries are variable-size diffs.
    expect(useHistoryStore.getState().updateHistory).toHaveLength(1);
  });

  it("never evicts the last entry, however large", () => {
    const huge = "x".repeat(HISTORY_BYTE_BUDGET * 2);
    useHistoryStore.getState().pushUpdateEntry(
      entry("graph_update", snap([node("n1", 3)]), snap([node("n1", 3, { label: huge })])),
    );
    // An undo stack of zero after one big edit is worse than exceeding the budget.
    expect(useHistoryStore.getState().updateHistory).toHaveLength(1);
  });

  it("does not retire an entry that undo removed — its writes are gone", () => {
    const store = useHistoryStore.getState();
    store.pushUpdateEntry(
      entry("event_applied", snap([node("n1", 3)]), snap([node("n1", 1)]), { event_id: "quake" }),
    );
    useHistoryStore.getState().shiftToRedo();
    expect(useHistoryStore.getState().retiredBaseline).toEqual([]);
    expect(useHistoryStore.getState().scenarioBaseline().size).toBe(0);
  });

  it("rebuilds from a loaded project and retires nothing yet", () => {
    useHistoryStore.setState({ retiredBaseline: [{ id: "stale", field: "functionality", value: 1, source: "manual" }] });
    useHistoryStore.getState().loadHistory([
      entry("event_applied", snap([node("n1", 3)]), snap([node("n1", 1)]), { event_id: "quake" }),
    ]);
    const state = useHistoryStore.getState();
    expect(state.retiredBaseline).toEqual([]); // the previous project's, discarded
    expect(state.scenarioBaseline().get(baselineKey("n1", "functionality"))?.value).toBe(3);
  });

  it("does not retire pre-Reset writes when an over-long loaded history is evicted", () => {
    // A hand-authored or externally-produced file with more than a bufferful of
    // Updates and its scenario_reset NOT among the oldest few. Eviction retires
    // the oldest tail — which here is a dead pre-Reset scenario. Left folded,
    // Reset would restore its degraded values onto the live graph.
    const preReset = entry("event_applied", snap([node("n1", 3)]), snap([node("n1", 1)]), { event_id: "old" });
    const filler = Array.from({ length: HISTORY_LIMIT }, (_, i) =>
      entry("graph_update", snap([node("n2", 3, { label: `a${i}` })]), snap([node("n2", 3, { label: `b${i}` })])),
    );
    // loadHistory takes newest-first: filler on top, then the Reset, then the
    // dead scenario at the tail — 22 entries, so eviction drops the last two.
    useHistoryStore.getState().loadHistory([
      ...filler,
      entry("scenario_reset", snap([node("n1", 1)]), snap([node("n1", 1)])),
      entry("graph_update", snap([node("n1", 1)]), snap([node("n1", 1, { label: "dead" })])),
      preReset,
    ]);
    const baseline = useHistoryStore.getState().scenarioBaseline();
    // n1 was only ever touched before the Reset. Nothing in the current
    // scenario changed it, so it must not be in the Baseline at all.
    expect(baseline.has(baselineKey("n1", "functionality"))).toBe(false);
    expect(resetPlan(baseline).some((e) => e.id === "n1")).toBe(false);
  });
});
