/**
 * canvas-store — the Event/Reset adapter over lib/event-application.ts,
 * lib/scenario-baseline.ts and lib/graph-diff.ts.
 *
 * Those transforms are tested in their own files. What is left here is what
 * only the store can get wrong: which history entry `clearEvent` picks, what it
 * does to work done AFTER the Event, whether undo can recover it, and whether
 * Reset reaches back through a history that was LOADED rather than performed.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { useCanvasStore } from "@/store/canvas-store";
import { useHistoryStore } from "@/store/history-store";
import { useAnalysisStore } from "@/store/analysis-store";
import { useUiStore } from "@/store/ui-store";
import { temporalJumpEvent } from "@/lib/event-application";
import { resetFunctionality } from "@/lib/network-utils";
import { runWithHistory } from "@/lib/run-with-history";
import type { EventDefinition } from "@/lib/schemas/config";
import type { Project } from "@/lib/schemas/network";

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
  useHistoryStore.setState({ updateHistory: [], redoStack: [], retiredBaseline: [] });
  useAnalysisStore.getState().clearHeatmap();
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

/** A Propagation landing on the canvas — the `propagation` source tag. */
function cascade(id: string, functionality: number) {
  runWithHistory(
    () => useCanvasStore.getState().updateNode(id, { functionality }),
    "Propagation (global)",
    { updateType: "propagation", scope: "global" },
  );
}

/** A hand edit — the `manual` source tag. */
function handEdit(id: string, patch: Record<string, unknown>, type: "manual_functionality_update" | "graph_update") {
  runWithHistory(
    () => useCanvasStore.getState().updateNode(id, patch),
    "hand edit",
    { updateType: type },
  );
}

describe("clearEvent", () => {
  it("clears an Event that changed nothing without discarding later work", () => {
    // Regression. An Event nothing is vulnerable to records an EMPTY Graph
    // Diff, which is not the same as recording no entry at all. Treating empty
    // as "nothing recorded" fell through to a full rewind, undoing every
    // Propagation and edit made after the Event.
    useCanvasStore.getState().applyEvent(inertEvent, N);
    const recorded = useHistoryStore.getState().updateHistory[0];
    expect(recorded.update_type).toBe("event_applied"); // recorded…
    expect(recorded.diff?.nodes).toEqual([]);           // …and empty

    handEdit("n2", { functionality: 1 }, "manual_functionality_update");
    expect(useCanvasStore.getState().clearEvent()).toBe(true);

    expect(useCanvasStore.getState().nodes.n2.functionality).toBe(1); // survived
  });

  it("reverts the Event's own fields AND the cascade, leaving hand edits standing", () => {
    // ADR-0016: a cascade computed from an input that no longer exists is stale.
    // The earlier version of this test simulated the cascade with a direct state
    // write, so it was tagged `manual` and asserted the opposite rule while
    // claiming in a comment that "a Propagation cascades".
    useCanvasStore.getState().applyEvent(quake, N);
    expect(useCanvasStore.getState().nodes.n1.functionality).toBe(1); // N − 2

    cascade("n2", 2);
    handEdit("n2", { label: "renamed by hand" }, "graph_update");

    useCanvasStore.getState().clearEvent();
    const after = useCanvasStore.getState();
    expect(after.nodes.n1.functionality).toBe(N);          // Event undone
    expect("direct_damage" in after.nodes.n1).toBe(false); // and its Hazard flag
    expect(after.nodes.n2.functionality).toBe(N);          // cascade undone with it
    expect(after.nodes.n2.label).toBe("renamed by hand");  // hand edit stands
  });

  it("runs no Propagation of its own", () => {
    // Clearing lands the graph at "the remaining Events, un-propagated". Firing
    // an engine call would spend an Entitlement the user did not agree to.
    useCanvasStore.getState().applyEvent(quake, N);
    cascade("n2", 2);
    useCanvasStore.getState().clearEvent();
    expect(
      useHistoryStore.getState().updateHistory.filter((e) => e.update_type === "propagation"),
    ).toHaveLength(1); // the original one, and no second
  });

  it("is undoable — CTRL+Z brings the Event and its cascade back", () => {
    useCanvasStore.getState().applyEvent(quake, N);
    cascade("n2", 2);
    useCanvasStore.getState().clearEvent();
    expect(useHistoryStore.getState().updateHistory[0].update_type).toBe("event_cleared");

    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().nodes.n1.functionality).toBe(1);
    expect(useCanvasStore.getState().nodes.n2.functionality).toBe(2);
  });

  it("clears the newest Event and reports when there is none", () => {
    expect(useCanvasStore.getState().clearEvent()).toBe(false); // nothing to clear

    useCanvasStore.getState().applyEvent(quake, N);
    useCanvasStore.getState().applyEvent(inertEvent, N);

    useCanvasStore.getState().clearEvent();
    const events = useHistoryStore.getState().updateHistory.filter((e) => e.update_type === "event_applied");
    expect(events).toHaveLength(1);
    expect(events[0].event_id).toBe("quake"); // the older Event still stands
    expect(useCanvasStore.getState().nodes.n1.functionality).toBe(1);
  });
});

describe("Reset", () => {
  it("reverts Event and Propagation writes and restores hand-edited Functionality", () => {
    useCanvasStore.getState().applyEvent(quake, N);
    cascade("n2", 2);
    handEdit("n2", { functionality: 1 }, "manual_functionality_update"); // Scenario Field
    handEdit("n1", { label: "Renamed" }, "graph_update");                // model field

    expect(resetFunctionality()).toBeGreaterThan(0);
    const after = useCanvasStore.getState();
    expect(after.nodes.n1.functionality).toBe(N);   // Event undone
    expect(after.nodes.n2.functionality).toBe(N);   // cascade AND the hand edit on top of it
    expect(after.nodes.n1.label).toBe("Renamed");   // model edit survives
    expect("direct_damage" in after.nodes.n1).toBe(false);
  });

  it("forces every Element operational, even one authored below N", () => {
    // Reset guarantees a working network rather than a reconstructed one. An
    // Element authored below max is promoted too — the deliberate cost of
    // making half 1 independent of the Baseline (see lib/network-utils.ts).
    useCanvasStore.setState((st) => ({ nodes: { ...st.nodes, n2: { ...st.nodes.n2, functionality: 2 } } }));
    useCanvasStore.getState().applyEvent(quake, N);
    cascade("n2", 1);

    resetFunctionality();
    expect(useCanvasStore.getState().nodes.n2.functionality).toBe(N);
  });

  it("repairs the graph even when the Baseline is empty", () => {
    // The independence that matters: no history at all, so nothing to fold,
    // and Reset must still hand back a working network.
    useHistoryStore.setState({ updateHistory: [], redoStack: [], retiredBaseline: [] });
    useCanvasStore.setState((st) => ({
      nodes: {
        ...st.nodes,
        n1: { ...st.nodes.n1, functionality: 1, direct_damage: true, expected_repair_time: 9 },
      },
    }));

    expect(resetFunctionality()).toBeGreaterThan(0);
    const n1 = useCanvasStore.getState().nodes.n1;
    expect(n1.functionality).toBe(N);
    expect("direct_damage" in n1).toBe(false);
    expect("expected_repair_time" in n1).toBe(false);
  });

  it("reports zero and changes nothing when no scenario has been run", () => {
    handEdit("n1", { label: "Renamed" }, "graph_update");
    expect(resetFunctionality()).toBe(0);
    expect(useCanvasStore.getState().nodes.n1.label).toBe("Renamed");
  });

  it("clears the Analysis Heatmap, whose colours mean a Scenario that is gone", () => {
    useCanvasStore.getState().applyEvent(quake, N);
    useAnalysisStore.getState().applyHeatmap({ n1: "#fff" }, { title: "Betweenness" });
    expect(useAnalysisStore.getState().heatmapActive).toBe(true);

    resetFunctionality();
    expect(useAnalysisStore.getState().heatmapActive).toBe(false);
    expect(useAnalysisStore.getState().heatmapLegend).toBeNull();
  });

  it("ends the scenario, so a second Reset has nothing to do", () => {
    useCanvasStore.getState().applyEvent(quake, N);
    resetFunctionality();
    expect(resetFunctionality()).toBe(0);
  });

  it("is undoable, and the scenario can then be reset again", () => {
    // The Baseline is DERIVED from history, so undoing the Reset restores the
    // map along with the graph — an accumulated copy cleared by Reset would
    // leave the second Reset a no-op.
    useCanvasStore.getState().applyEvent(quake, N);
    resetFunctionality();
    expect(useCanvasStore.getState().nodes.n1.functionality).toBe(N);

    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().nodes.n1.functionality).toBe(1);

    expect(resetFunctionality()).toBeGreaterThan(0);
    expect(useCanvasStore.getState().nodes.n1.functionality).toBe(N);
  });

  it("reaches back through a history that was LOADED, not performed", () => {
    // The guided tour's whole premise (requirements §8.5): IJDRR_example.json
    // ships post-Earthquake, post-Propagation, and step 4 asks the user to press
    // Reset. Without seeding the Baseline from the loaded history this is a
    // silent no-op and the tour walks onto a still-cascaded graph.
    useCanvasStore.getState().applyEvent(quake, N);
    cascade("n2", 1);
    const saved: Project = useCanvasStore.getState().toProject();

    useHistoryStore.setState({ updateHistory: [], redoStack: [], retiredBaseline: [] });
    useCanvasStore.getState().fromProject(saved);
    expect(useCanvasStore.getState().nodes.n1.functionality).toBe(1); // shipped cascaded

    expect(resetFunctionality()).toBeGreaterThan(0);
    expect(useCanvasStore.getState().nodes.n1.functionality).toBe(N);
    expect(useCanvasStore.getState().nodes.n2.functionality).toBe(N);
  });
});

describe("clearEvent on entries older builds wrote", () => {
  /** An entry as a pre-ADR-0017 build wrote it: snapshots, no diff. */
  function legacyEntry(extra: Record<string, unknown>) {
    useCanvasStore.getState().updateNode("n1", { functionality: 1 });
    useHistoryStore.setState({
      updateHistory: [
        {
          id: "legacy", timestamp: "", update_type: "event_applied",
          label: "Apply event: Quake", event_id: "quake",
          before: { nodes: { n1: { id: "n1", label: "n1", functionality: N }, n2: { id: "n2", label: "n2", functionality: N } }, edges: {}, canvases: [] },
          after: { nodes: { n1: { id: "n1", label: "n1", functionality: 1 }, n2: { id: "n2", label: "n2", functionality: N } }, edges: {}, canvases: [] },
          ...extra,
        },
      ],
      redoStack: [], retiredBaseline: [],
    });
  }

  it("uses the recorded mutation_reversal, keeping work done since", () => {
    legacyEntry({ mutation_reversal: { "n1.functionality": N } });
    useCanvasStore.getState().updateNode("n2", { functionality: 2 }); // later work
    expect(useCanvasStore.getState().clearEvent()).toBe(true);

    expect(useCanvasStore.getState().nodes.n1.functionality).toBe(N); // Event undone
    expect(useCanvasStore.getState().nodes.n2.functionality).toBe(2); // and n2 kept
  });

  it("falls back to a full rewind only when there is nothing else", () => {
    legacyEntry({});
    useCanvasStore.getState().updateNode("n2", { functionality: 2 });
    expect(useCanvasStore.getState().clearEvent()).toBe(true);

    expect(useCanvasStore.getState().nodes.n1.functionality).toBe(N);
    // The documented cost of the oldest format: later work goes with it.
    expect(useCanvasStore.getState().nodes.n2.functionality).toBe(N);
  });
});

describe("Reset and Temporal Jumps", () => {
  /** What `action-bar.tsx`'s applyJump does: save the pre-jump snapshot on the
   *  first jump, apply the jump as an Event, and count the hours. */
  function applyJump(hours: number) {
    const ui = useUiStore.getState();
    if (ui.temporalJumpRevertSnapshot === null) {
      ui.saveTemporalRevertSnapshot(
        useCanvasStore.getState().toGraphSnapshot(),
        useHistoryStore.getState().updateHistory[0]?.id ?? null,
      );
    }
    useCanvasStore.getState().applyEvent(temporalJumpEvent(hours), N);
    useUiStore.getState().addTemporalElapsedHours(hours);
  }

  /** What the −Xh button does. */
  function revertJumps() {
    const ui = useUiStore.getState();
    const snapshot = ui.temporalJumpRevertSnapshot!;
    runWithHistory(
      () => useCanvasStore.getState().restoreSnapshot(snapshot),
      `Revert temporal jumps (−${ui.temporalJumpElapsedHours}h)`,
      { updateType: "temporal_jump_revert", revertsToEntryId: ui.temporalJumpRevertFromEntryId },
    );
    useUiStore.getState().clearTemporalJumpProgress();
  }

  beforeEach(() => {
    useUiStore.getState().clearTemporalJumpProgress();
    // n1 holds a 4h backup, so a jump has something to spend.
    useCanvasStore.setState((st) => ({
      nodes: { ...st.nodes, n1: { ...st.nodes.n1, functionality_time: 4 } },
    }));
  });

  it("clears a Temporal Jump's damage and its countdown", () => {
    applyJump(6); // past the 4h reserve → expires to Functionality 1
    expect(useCanvasStore.getState().nodes.n1.functionality).toBe(1);

    expect(resetFunctionality()).toBeGreaterThan(0);
    expect(useCanvasStore.getState().nodes.n1.functionality).toBe(N);
    // Zeroed, not restored to the 4h it had: Functionality Time is scenario
    // state, and Reset ends the scenario.
    expect(useCanvasStore.getState().nodes.n1.functionality_time).toBe(0);
  });

  it("ends the jump run, so the −Xh control stops offering a dead rewind", () => {
    applyJump(6);
    resetFunctionality();

    // The revert snapshot was taken inside a scenario Reset has just ended.
    // Leaving it live lets the user rewind INTO that dead scenario.
    expect(useUiStore.getState().temporalJumpElapsedHours).toBe(0);
    expect(useUiStore.getState().temporalJumpRevertSnapshot).toBeNull();
  });

  it("stays resettable when the user Resets and only then reverts the jumps", () => {
    // The reported bug. Reset left the jump run live, so −Xh restored the
    // pre-jump (cascaded) snapshot — but that restore lands ABOVE the
    // scenario_reset entry, where deriveBaseline stops folding. The graph was
    // damaged again with an empty Baseline behind it: "Nothing to reset".
    useCanvasStore.getState().applyEvent(quake, N);
    cascade("n2", 1);
    applyJump(6);

    resetFunctionality();
    expect(useCanvasStore.getState().nodes.n1.functionality).toBe(N);

    if (useUiStore.getState().temporalJumpRevertSnapshot) revertJumps();

    // Whatever the graph is now, Reset must still be able to end it.
    const damaged = Object.values(useCanvasStore.getState().nodes).some((el) => el.functionality < N);
    if (damaged) expect(resetFunctionality()).toBeGreaterThan(0);
    expect(
      Object.values(useCanvasStore.getState().nodes).every((el) => el.functionality === N),
    ).toBe(true);
  });
});
