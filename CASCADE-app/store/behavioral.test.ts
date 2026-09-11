/**
 * behavioral.test.ts — whole user sessions, not single actions.
 *
 * Every other test file in this project asks "does this one function do the
 * right thing." This file asks a different question: when a user does several
 * things in the order they actually would — apply an Event, propagate, look at
 * an Analysis Heatmap, jump time, save to the Scorecard, undo — do the RESULTS
 * of those actions agree with each other?
 *
 * That is where this session's real bugs lived. Reset alone worked; Reset after
 * a Temporal Jump did not. Clear Event alone worked; Clear Event after a
 * Propagation needed the cascade gone too. Unit tests on `resetFunctionality`
 * or `clearEvent` in isolation cannot catch that class of bug BY CONSTRUCTION —
 * they set up exactly the state the function expects. A behavioral test builds
 * that state the way the app actually builds it: one store action at a time.
 *
 * Each `describe` block is one session. Each `it` drives the stores the way the
 * UI does — `applyEvent`, `propagate`, `undo`, `revertRun`, `clearHeatmap` — and
 * asserts what a user would actually see: the graph, the Situation window, the
 * Scorecard's "you have unsaved work" nudge, the Analysis Heatmap.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { useCanvasStore } from "@/store/canvas-store";
import { useHistoryStore } from "@/store/history-store";
import { useAnalysisStore } from "@/store/analysis-store";
import { useScorecardStore } from "@/store/scorecard-store";
import { useConfigStore, DEFAULT_CONFIG } from "@/store/config-store";
import { resetFunctionality } from "@/lib/network-utils";
import { extendRun, revertRun } from "@/lib/temporal-jump-run";
import { runWithHistory } from "@/lib/run-with-history";
import { deriveSituation, situationSnapshots, situationEventIds } from "@/lib/situation";
import { findUnsavedRuns, findUncoveredEvents } from "@/lib/scorecard-utils";
import type { EventDefinition } from "@/lib/schemas/config";
import type { ElementUpdate } from "@/lib/schemas/propagation";
import type { PropagationScorecardEntry } from "@/lib/schemas/network";

const N = 3;

// Vulnerability lives on the Element, not the Event (CONTEXT.md → Event) — the
// canvas fixture below sets n1's `vulnerability_levels: { quake: 2 }`.
const quake: EventDefinition = { id: "quake", label: "Quake", type: "hazard", frequency_per_10y: 0.1 };
const flood: EventDefinition = { id: "flood", label: "Flood", type: "hazard", frequency_per_10y: 0.2 };

beforeEach(() => {
  useHistoryStore.setState({ updateHistory: [], redoStack: [], retiredBaseline: [] });
  useAnalysisStore.getState().clearHeatmap();
  useScorecardStore.setState({ scorecard: [] });
  useConfigStore.setState({ config: { ...DEFAULT_CONFIG, events: [quake, flood] } });
  useCanvasStore.setState({
    nodes: {
      n1: { id: "n1", label: "Pump", functionality: N, vulnerability_levels: { quake: 2 } },
      n2: { id: "n2", label: "Tank", functionality: N },
    },
    edges: {},
    canvases: {
      c1: { id: "c1", label: "C1", graph: { graph_type: "g", node_ids: ["n1", "n2"], edge_ids: [] } },
    },
    canvasOrder: ["c1"],
    activeCanvasId: "c1",
  });
});

/** What `usePropagate` does once a PropagationResult comes back (lib/run-with-history.ts seam). */
function propagate(updates: ElementUpdate[]): void {
  runWithHistory(
    () =>
      useCanvasStore.getState().applyPropagationResult({
        updates, warnings: [], scope: "global", iterations: 1, computed_at: new Date().toISOString(),
      }),
    "Propagation (global)",
    { updateType: "propagation", scope: "global", canvasId: null },
  );
}

/** What the Save-to-Scorecard dialog writes, given the derived Situation. */
function saveCurrentSituationToScorecard(): PropagationScorecardEntry | null {
  const history = useHistoryStore.getState().updateHistory;
  const situation = deriveSituation(history);
  if (!situation) return null;
  const live = useCanvasStore.getState().toGraphSnapshot();
  const { before, after } = situationSnapshots(situation, history, live);
  const entry: PropagationScorecardEntry = {
    type: "propagation",
    id: `sc-${useScorecardStore.getState().scorecard.length}`,
    label: "Saved run",
    created_at: new Date().toISOString(),
    event_ids: situationEventIds(situation),
    before_propagation: before,
    after_propagation: after,
  };
  useScorecardStore.getState().addScorecardEntry(entry);
  return entry;
}

describe("Event → Propagate → Save → Undo: the Situation and the Scorecard agree at every step", () => {
  it("walks the whole session forward and back without the two disagreeing", () => {
    // 1. Apply the Event. Situation shows it, un-propagated.
    useCanvasStore.getState().applyEvent(quake, N);
    let situation = deriveSituation(useHistoryStore.getState().updateHistory);
    expect(situationEventIds(situation!)).toEqual(["quake"]);
    expect(situation!.propEntry).toBeNull();

    // 2. Propagate. The cascade lands, Situation now pairs the Event with it.
    propagate([{ id: "n2", functionality: 1 }]);
    situation = deriveSituation(useHistoryStore.getState().updateHistory);
    expect(situation!.propEntry?.update_type).toBe("propagation");
    expect(useCanvasStore.getState().nodes.n2.functionality).toBe(1);

    // 3. Save to Scorecard. The saved before/after must be the actual pre- and
    // post-engine Scenarios — not the live graph re-derived some other way.
    const saved = saveCurrentSituationToScorecard();
    expect(saved).not.toBeNull();
    expect(saved!.before_propagation.nodes.n1.functionality).toBe(1); // post-Event, pre-engine
    expect(saved!.after_propagation!.nodes.n2.functionality).toBe(1); // post-engine

    // 4. Undo the Propagation. The cascade is gone; the Event still stands.
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().nodes.n2.functionality).toBe(N);
    situation = deriveSituation(useHistoryStore.getState().updateHistory);
    expect(situationEventIds(situation!)).toEqual(["quake"]);
    expect(situation!.propEntry).toBeNull();

    // 5. Undo the Event. Clean slate — no Situation to report.
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().nodes.n1.functionality).toBe(N);
    expect(deriveSituation(useHistoryStore.getState().updateHistory)).toBeNull();

    // 6. Redo both. The graph and the Situation must land back exactly where
    // they were at step 2 — a redo that reapplies the Update but re-derives a
    // DIFFERENT Situation from it would be a bug nothing but this walk exposes.
    useCanvasStore.getState().redo();
    useCanvasStore.getState().redo();
    expect(useCanvasStore.getState().nodes.n1.functionality).toBe(1);
    expect(useCanvasStore.getState().nodes.n2.functionality).toBe(1);
    situation = deriveSituation(useHistoryStore.getState().updateHistory);
    expect(situationEventIds(situation!)).toEqual(["quake"]);
    expect(situation!.propEntry?.update_type).toBe("propagation");
  });
});

describe("Two stacked Events, one Propagation, Clear Event: only the cascade and the cleared Event go", () => {
  it("leaves the standing Event un-propagated rather than re-running it", () => {
    useCanvasStore.getState().applyEvent(flood, N); // n2 not vulnerable — no direct effect
    useCanvasStore.getState().applyEvent(quake, N); // n1 → 1
    expect(situationEventIds(deriveSituation(useHistoryStore.getState().updateHistory)!))
      .toEqual(["quake", "flood"]); // newest first

    propagate([{ id: "n2", functionality: 2 }]); // the stacked pair's combined cascade

    // Clear the newest Event (quake) and its Propagation's writes.
    expect(useCanvasStore.getState().clearEvent()).toBe(true);

    const after = useCanvasStore.getState();
    expect(after.nodes.n1.functionality).toBe(N); // quake's own write undone
    expect(after.nodes.n2.functionality).toBe(N); // the stale cascade undone with it

    // flood is still in the scenario, but nothing has been computed for it since.
    const situation = deriveSituation(useHistoryStore.getState().updateHistory);
    expect(situationEventIds(situation!)).toEqual(["flood"]);
    expect(situation!.propEntry).toBeNull();

    // Ctrl+Z brings quake and its cascade straight back — Clear Event is one
    // undoable Update, not a rewrite of history.
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().nodes.n1.functionality).toBe(1);
    expect(useCanvasStore.getState().nodes.n2.functionality).toBe(2);
  });
});

describe("Event → Propagate → Analysis Heatmap → Reset: every side effect Reset promises actually fires", () => {
  it("clears the graph, the Heatmap, and the Situation together", () => {
    useCanvasStore.getState().applyEvent(quake, N);
    propagate([{ id: "n2", functionality: 1 }]);

    useAnalysisStore.getState().applyHeatmap(
      { n1: "#ff0000", n2: "#ff0000" },
      { title: "Betweenness", nodes: { type: "gradient", low: "#eee", high: "#f00", minLabel: "0", maxLabel: "1" } },
    );
    expect(useAnalysisStore.getState().heatmapActive).toBe(true);

    const affected = resetFunctionality();
    expect(affected).toBeGreaterThan(0);

    // The graph:
    expect(useCanvasStore.getState().nodes.n1.functionality).toBe(N);
    expect(useCanvasStore.getState().nodes.n2.functionality).toBe(N);
    // The Heatmap — a colour key for a Scenario that no longer exists:
    expect(useAnalysisStore.getState().heatmapActive).toBe(false);
    // The Situation — the scenario Reset just ended:
    expect(deriveSituation(useHistoryStore.getState().updateHistory)).toBeNull();
  });
});

describe("Event → Propagate → Temporal Jump → Reset: Reset ends the run, not just the graph", () => {
  it("leaves nothing for −Xh to revert into once Reset has run", () => {
    // n1 holds a 5h backup — something for a jump to spend.
    useCanvasStore.setState((s) => ({ nodes: { ...s.nodes, n1: { ...s.nodes.n1, functionality_time: 5 } } }));

    useCanvasStore.getState().applyEvent(quake, N);
    propagate([{ id: "n2", functionality: 2 }]);
    extendRun(6, N); // past the 5h reserve — n1 expires to Functionality 1
    expect(useCanvasStore.getState().nodes.n1.functionality).toBe(1);

    expect(resetFunctionality()).toBeGreaterThan(0);
    expect(useCanvasStore.getState().nodes.n1.functionality).toBe(N);

    // This is the fix: Reset calls endRun() unconditionally, so the run that
    // was live when Reset fired is over. Reaching for −Xh now must find
    // nothing to do — the pre-fix bug was this call silently restoring a
    // snapshot from a scenario Reset had just ended.
    expect(revertRun("global")).toBe(0);
    expect(useCanvasStore.getState().nodes.n1.functionality).toBe(N); // untouched by the no-op revert
  });

  it("stays resettable even when the jump is reverted BEFORE Reset runs", () => {
    useCanvasStore.setState((s) => ({ nodes: { ...s.nodes, n1: { ...s.nodes.n1, functionality_time: 5 } } }));
    useCanvasStore.getState().applyEvent(quake, N);
    propagate([{ id: "n2", functionality: 2 }]);
    extendRun(6, N);

    expect(revertRun("global")).toBe(6); // the ordinary path — a real run to unwind
    expect(resetFunctionality()).toBeGreaterThan(0);
    expect(Object.values(useCanvasStore.getState().nodes).every((e) => e.functionality === N)).toBe(true);
  });
});

describe("Reset's two halves really are independent: a hand edit's fate depends on WHICH field it touched", () => {
  it("forces a hand-edited Scenario Field operational but leaves a hand-edited model field alone", () => {
    useCanvasStore.getState().applyEvent(quake, N);
    propagate([{ id: "n2", functionality: 2 }]);

    // A what-if Functionality edit (Scenario Field) and a genuine correction to
    // a model attribute, made by hand on top of the machine's writes.
    runWithHistory(
      () => useCanvasStore.getState().updateNode("n2", { functionality: 1 }),
      "hand edit ft",
      { updateType: "manual_functionality_update" },
    );
    runWithHistory(
      () => useCanvasStore.getState().updateNode("n2", { label: "Tank (corrected)" }),
      "hand edit label",
      { updateType: "graph_update" },
    );

    resetFunctionality();

    // Scenario Field: forceOperational overrides it outright, whoever wrote it.
    expect(useCanvasStore.getState().nodes.n2.functionality).toBe(N);
    // Model field: the Baseline only reverts MACHINE writes — a hand correction
    // to a label, position, or capacity is authoring work and survives.
    expect(useCanvasStore.getState().nodes.n2.label).toBe("Tank (corrected)");
  });
});

describe("findUnsavedRuns after a Temporal Jump run is reverted: the stale run drops out, the legitimate one does not", () => {
  it("excludes only the Propagation that ran mid-jump, not the one that ran before it", async () => {
    useCanvasStore.getState().applyEvent(quake, N);
    propagate([{ id: "n2", functionality: 1 }]); // P1 — before the jump, stays valid however the jump ends
    extendRun(4, N); // pushes its own event_applied(temporal_jump), then:
    propagate([{ id: "n2", functionality: 1, functionality_time: 2 }]); // P2 — runs WHILE the jump is live

    const live = useCanvasStore.getState().toGraphSnapshot();
    const beforeRevert = await findUnsavedRuns(
      useHistoryStore.getState().updateHistory, useScorecardStore.getState().scorecard, live,
    );
    expect(beforeRevert).toHaveLength(2); // P1 (quake) and P2 (the jump) both unsaved right now

    revertRun("global");

    const liveAfter = useCanvasStore.getState().toGraphSnapshot();
    const afterRevert = await findUnsavedRuns(
      useHistoryStore.getState().updateHistory, useScorecardStore.getState().scorecard, liveAfter,
    );
    // P2 describes a Scenario the project is no longer in — offering to save
    // it would write a Scorecard entry for a cascade that was undone. P1 ran
    // before the jump ever started and is untouched by reverting it.
    expect(afterRevert).toHaveLength(1);
    expect(afterRevert[0].eventIds).toEqual(["quake"]);
  });
});

describe("findUncoveredEvents tracks the Scorecard's history, not the live scenario", () => {
  it("stays uncovered through Clear Event and Reset — only an actual save documents it", () => {
    // Both configured Events start undocumented: no Scorecard entry has ever
    // named either of them.
    const config = useConfigStore.getState().config;
    expect(findUncoveredEvents(config, useScorecardStore.getState().scorecard).map((e) => e.eventId))
      .toEqual(expect.arrayContaining(["quake", "flood"]));

    // Applying and clearing quake touches the live scenario, not the Scorecard.
    // Clear Event does not retroactively document anything — it undoes work.
    useCanvasStore.getState().applyEvent(quake, N);
    useCanvasStore.getState().clearEvent();
    resetFunctionality();
    expect(findUncoveredEvents(config, useScorecardStore.getState().scorecard).map((e) => e.eventId))
      .toContain("quake");

    // The one thing that documents an Event is an actual Scorecard save.
    useCanvasStore.getState().applyEvent(quake, N);
    propagate([{ id: "n1", functionality: 1 }]);
    saveCurrentSituationToScorecard();
    expect(findUncoveredEvents(config, useScorecardStore.getState().scorecard).map((e) => e.eventId))
      .not.toContain("quake");
    // flood was never saved, so it is uncovered on its own merits — this must
    // stay true, or the assertion above would be vacuous.
    expect(findUncoveredEvents(config, useScorecardStore.getState().scorecard).map((e) => e.eventId))
      .toContain("flood");
  });
});

