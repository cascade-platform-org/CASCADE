/**
 * canvas-store — the Event adapter over lib/event-application.ts.
 *
 * The transform itself is tested in lib/event-application.test.ts. What is left
 * here is what only the store can get wrong: which history entry `clearEvent`
 * picks, which reversal strategy it chooses, and what it does to work the user
 * did AFTER the Event.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { useCanvasStore } from "@/store/canvas-store";
import { useHistoryStore } from "@/store/history-store";
import type { EventDefinition } from "@/lib/schemas/config";

const N = 3;

const inertEvent: EventDefinition = {
  id: "inert",
  label: "Nothing is vulnerable to this",
  type: "disservice",
  frequency_per_10y: 0,
};

const quake: EventDefinition = {
  id: "quake",
  label: "Quake",
  type: "hazard",
  frequency_per_10y: 0,
};

beforeEach(() => {
  useHistoryStore.setState({ updateHistory: [], redoStack: [] });
  useCanvasStore.setState({
    nodes: {
      n1: { id: "n1", label: "n1", functionality: N, vulnerability_levels: { quake: 2 } },
      n2: { id: "n2", label: "n2", functionality: N },
    },
    edges: {},
    canvases: {
      c1: { id: "c1", label: "C1", graph: { graph_type: "g", node_ids: ["n1", "n2"], edge_ids: [] } },
    },
    canvasOrder: ["c1"],
    activeCanvasId: "c1",
  });
});

/** Stand in for a Propagation landing, or any edit the user makes afterwards. */
function laterWork(id: string, functionality: number) {
  useCanvasStore.setState((st) => ({
    nodes: { ...st.nodes, [id]: { ...st.nodes[id], functionality } },
  }));
}

describe("clearEvent", () => {
  it("clears an Event that changed nothing without discarding later work", () => {
    // Regression. An Event nothing is vulnerable to records an EMPTY Mutation
    // Reversal, which is not the same as recording none. Treating empty as
    // "nothing recorded" fell through to a full-snapshot rewind, undoing every
    // Propagation and edit made after the Event — the user loses work by
    // pressing Ctrl+R on an Event that did nothing in the first place.
    const store = useCanvasStore.getState();
    store.applyEvent(inertEvent, N);

    const entry = useHistoryStore.getState().updateHistory[0];
    expect(entry.mutation_reversal).toEqual({}); // recorded, and empty

    laterWork("n2", 1);
    expect(useCanvasStore.getState().clearEvent()).toBe(true);

    expect(useCanvasStore.getState().nodes.n2.functionality).toBe(1); // survived
  });

  it("reverses only the Event's own fields, leaving later work standing", () => {
    const store = useCanvasStore.getState();
    store.applyEvent(quake, N);
    expect(useCanvasStore.getState().nodes.n1.functionality).toBe(1); // N − 2

    // A Propagation cascades to a node the Event never touched.
    laterWork("n2", 2);

    useCanvasStore.getState().clearEvent();
    const after = useCanvasStore.getState();
    expect(after.nodes.n1.functionality).toBe(N); // Event undone
    expect("direct_damage" in after.nodes.n1).toBe(false); // and its Hazard flag
    expect(after.nodes.n2.functionality).toBe(2); // cascade left alone
  });

  it("clears the newest Event and reports when there is none", () => {
    const store = useCanvasStore.getState();
    expect(store.clearEvent()).toBe(false); // nothing to clear

    store.applyEvent(quake, N);
    useCanvasStore.getState().applyEvent(inertEvent, N);
    expect(useHistoryStore.getState().updateHistory).toHaveLength(2);

    useCanvasStore.getState().clearEvent();
    const history = useHistoryStore.getState().updateHistory;
    expect(history).toHaveLength(1);
    expect(history[0].event_id).toBe("quake"); // the older Event still stands
    expect(useCanvasStore.getState().nodes.n1.functionality).toBe(1);
  });
});
