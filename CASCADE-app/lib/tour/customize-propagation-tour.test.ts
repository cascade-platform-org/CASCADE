/**
 * Gates and shape of "Customize the Propagation".
 *
 * This tour's steps each change one declaration and then re-propagate, so its
 * gates read two different things: a change in the stores (a Demand rose, a
 * Dependency level rose, a Category Type changed) and a new Propagation. Both
 * are the kind of predicate that fails silently — the card renders, the user
 * does what it says, and nothing advances — so each is driven here the way a
 * user would satisfy it.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore, DEFAULT_CONFIG } from "@/store/config-store";
import { useHistoryStore } from "@/store/history-store";
import { CUSTOMIZE_PROPAGATION_TOUR } from "./customize-propagation-tour";
import { gate } from "./test-helpers";

const N = 3;

/** The sample state the tour opens on: a City demanding 5 at dependency 2. */
beforeEach(() => {
  useHistoryStore.setState({ updateHistory: [], redoStack: [], retiredBaseline: [] });
  useConfigStore.setState({
    config: {
      ...DEFAULT_CONFIG,
      categories: [{ name: "electric", category_type: "SourceToDemands" }],
    },
  } as never);
  useCanvasStore.setState({
    nodes: {
      city: {
        id: "city",
        label: "City",
        functionality: N,
        category_dependency_profiles: { electric: { dependency_level: 2, demand: 5 } },
      },
    },
    edges: {},
  } as never);
});

function patchCityProfile(patch: Record<string, unknown>) {
  const nodes = { ...useCanvasStore.getState().nodes };
  const city = nodes.city as never as { category_dependency_profiles: Record<string, unknown> };
  nodes.city = {
    ...city,
    category_dependency_profiles: {
      electric: { ...(city.category_dependency_profiles.electric as object), ...patch },
    },
  } as never;
  useCanvasStore.setState({ nodes } as never);
}

describe("customize tour — every step's gate", () => {
  it("'Raise the Dependency level' opens when any dependency level rises", () => {
    const open = gate(CUSTOMIZE_PROPAGATION_TOUR, "Raise the Dependency level");
    expect(open()).toBe(false);
    patchCityProfile({ dependency_level: 1 });
    expect(open(), "lowering it is the opposite change").toBe(false);
    patchCityProfile({ dependency_level: 3 });
    expect(open()).toBe(true);
  });

  it("'Change the Category Type' opens on a type switch, not on a rename", () => {
    const open = gate(CUSTOMIZE_PROPAGATION_TOUR, "Change the Category Type");
    expect(open()).toBe(false);
    useConfigStore.setState({
      config: {
        ...useConfigStore.getState().config,
        categories: [{ name: "electric", category_type: "Requisite" }],
      },
    } as never);
    expect(open()).toBe(true);
  });

  it("'Rules override the aggregation' opens on a rule the user just wrote", () => {
    const open = gate(CUSTOMIZE_PROPAGATION_TOUR, "Rules override the aggregation");
    expect(open()).toBe(false);
    const nodes = { ...useCanvasStore.getState().nodes };
    nodes.city = { ...nodes.city, rules: ["average_of(a, b) propagates to City electric"] } as never;
    useCanvasStore.setState({ nodes } as never);
    expect(open()).toBe(true);
  });

  it("every Propagate step waits for a NEW Propagation", () => {
    useHistoryStore.setState({
      updateHistory: [{ id: "old", update_type: "propagation" }],
    } as never);

    // Arm every gate while the old entry is the latest — a gate is armed when
    // its step appears, so arming after the new entry would be a different test.
    const armed = CUSTOMIZE_PROPAGATION_TOUR.filter(
      (s) => s.anchor === "propagate" && s.waitFor,
    ).map((s) => ({ title: s.title, open: s.waitFor!() }));
    expect(armed.length, "no Propagate step carries a gate").toBeGreaterThan(3);

    for (const { title, open } of armed) {
      expect(open(), `"${title}" accepted a Propagation that predates it`).toBe(false);
    }

    useHistoryStore.setState({
      updateHistory: [
        { id: "new", update_type: "propagation" },
        { id: "old", update_type: "propagation" },
      ],
    } as never);
    for (const { title, open } of armed) {
      expect(open(), `"${title}" missed a new Propagation`).toBe(true);
    }
  });

  it("'Break the source' waits for a new Event", () => {
    const open = gate(CUSTOMIZE_PROPAGATION_TOUR, "Break the source");
    useHistoryStore.setState({
      updateHistory: [{ id: "a", update_type: "propagation" }],
    } as never);
    expect(open()).toBe(false);
    useHistoryStore.setState({
      updateHistory: [{ id: "b", update_type: "event_applied" }],
    } as never);
    expect(open()).toBe(true);
  });

  it("'Start from a known state' waits for a Reset, not for any update", () => {
    const open = gate(CUSTOMIZE_PROPAGATION_TOUR, "Start from a known state");
    useHistoryStore.setState({
      updateHistory: [{ id: "a", update_type: "propagation" }],
    } as never);
    expect(open()).toBe(false);
    useHistoryStore.setState({
      updateHistory: [{ id: "b", update_type: "scenario_reset" }],
    } as never);
    expect(open()).toBe(true);
  });
});

describe("customize tour — shape", () => {
  it("re-propagates after every declaration it changes", () => {
    // The whole tour is the before/after discipline; a change step with no
    // Propagation after it teaches the opposite.
    const steps = CUSTOMIZE_PROPAGATION_TOUR;
    const changeSteps = [
      "Break the source",
      "Change the Category Type",
      "Raise the Dependency level",
      "Rules override the aggregation",
    ];
    for (const title of changeSteps) {
      const i = steps.findIndex((s) => s.title === title);
      expect(i, `"${title}" is missing`).toBeGreaterThanOrEqual(0);
      expect(steps[i + 1]?.anchor, `"${title}" is not followed by a Propagate step`).toBe("propagate");
    }
  });

  it("opens and closes with a step that asks for nothing", () => {
    expect(CUSTOMIZE_PROPAGATION_TOUR[0].waitFor).toBeUndefined();
    expect(CUSTOMIZE_PROPAGATION_TOUR[CUSTOMIZE_PROPAGATION_TOUR.length - 1].waitFor).toBeUndefined();
  });

  it("gives every waiting step a hint, so the tour never looks stuck", () => {
    for (const step of CUSTOMIZE_PROPAGATION_TOUR) {
      if (step.waitFor) expect(step.waitHint, `"${step.title}" waits with no hint`).toBeTruthy();
    }
  });

});
