/**
 * The build tour's gates, driven the way a user would satisfy them.
 *
 * Each step of that tour advances on a predicate that reads the stores for a
 * *shape* — "the configuration now has a Category", "something demands
 * something". Those predicates are the only part of a tour that can break
 * silently: rename `category_dependency_profiles[c].demand` and the step still
 * renders perfectly, it just never advances, and the user is stuck staring at
 * "Waiting for a Demand…" having already entered one.
 *
 * So this walks the same steps against the real stores and asserts each gate is
 * shut before the action and open after it.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useCanvasStore } from "@/store/canvas-store";
import { useHistoryStore } from "@/store/history-store";
import { useConfigStore, DEFAULT_CONFIG } from "@/store/config-store";
import { BUILD_MODEL_TOUR } from "./build-model-tour";
import { gate } from "./test-helpers";
import type { EventDefinition } from "@/lib/schemas/config";

const N = 3;
const quake: EventDefinition = { id: "quake", label: "Quake", type: "hazard", frequency_per_10y: 0.1 };

/** Put the stores back to a brand-new project — where the tour starts. */
beforeEach(() => {
  useHistoryStore.setState({ updateHistory: [], redoStack: [], retiredBaseline: [] });
  useConfigStore.setState({ config: { ...DEFAULT_CONFIG, categories: [], events: [] } });
  useCanvasStore.setState({
    nodes: {},
    edges: {},
    canvases: {
      c1: { id: "c1", label: "Main", graph: { graph_type: "default", node_ids: [], edge_ids: [] } },
    },
    canvasOrder: ["c1"],
    activeCanvasId: "c1",
  } as never);
});

function addNodes(count: number) {
  const nodes: Record<string, unknown> = { ...useCanvasStore.getState().nodes };
  for (let i = 0; i < count; i++) {
    const id = `n${Object.keys(nodes).length + 1}`;
    nodes[id] = { id, label: id, functionality: N };
  }
  useCanvasStore.setState({ nodes } as never);
}

function patchNode(id: string, patch: Record<string, unknown>) {
  const nodes = { ...useCanvasStore.getState().nodes };
  nodes[id] = { ...nodes[id], ...patch } as never;
  useCanvasStore.setState({ nodes } as never);
}

function patchConfig(patch: Record<string, unknown>) {
  useConfigStore.setState({ config: { ...useConfigStore.getState().config, ...patch } } as never);
}

describe("build tour — every step's gate", () => {
  it("'Define a Category' opens on a Category in the configuration", () => {
    const open = gate(BUILD_MODEL_TOUR, "Define a Category");
    expect(open()).toBe(false);
    patchConfig({ categories: [{ name: "water", type: "SourceToDemands" }] });
    expect(open()).toBe(true);
  });

  it("'Add two elements' opens only on the second node", () => {
    const open = gate(BUILD_MODEL_TOUR, "Add two elements");
    expect(open()).toBe(false);
    addNodes(1);
    expect(open()).toBe(false);
    addNodes(1);
    expect(open()).toBe(true);
  });

  it("'Declare the supply' opens on a non-zero Supply Capacity", () => {
    addNodes(2);
    const open = gate(BUILD_MODEL_TOUR, "Declare the supply");
    expect(open()).toBe(false);
    patchNode("n1", { supply_capacity: { water: 0 } });
    expect(open(), "a zero supply supplies nothing").toBe(false);
    patchNode("n1", { supply_capacity: { water: 100 } });
    expect(open()).toBe(true);
  });

  it("'Connect supplier to consumer' opens on any new edge", () => {
    addNodes(2);
    const open = gate(BUILD_MODEL_TOUR, "Connect supplier to consumer");
    expect(open()).toBe(false);
    useCanvasStore.setState({
      edges: { e1: { id: "e1", source: "n1", target: "n2", functionality: N } },
    } as never);
    expect(open()).toBe(true);
  });

  it("'Declare the demand' opens on a non-zero Demand", () => {
    addNodes(2);
    const open = gate(BUILD_MODEL_TOUR, "Declare the demand");
    expect(open()).toBe(false);
    // A profile with no demand is a guard parameter, not a request for supply.
    patchNode("n2", { category_dependency_profiles: { water: { dependency_level: N } } });
    expect(open(), "a profile without a demand asks for nothing").toBe(false);
    patchNode("n2", {
      category_dependency_profiles: { water: { dependency_level: N, demand: 40 } },
    });
    expect(open()).toBe(true);
  });

  it("'Define an Event' opens on an Event in the configuration", () => {
    const open = gate(BUILD_MODEL_TOUR, "Define an Event");
    expect(open()).toBe(false);
    patchConfig({ events: [quake] });
    expect(open()).toBe(true);
  });

  it("'Set the vulnerability' opens on a non-zero vulnerability", () => {
    addNodes(2);
    patchConfig({ events: [quake] });
    const open = gate(BUILD_MODEL_TOUR, "Set the vulnerability");
    expect(open()).toBe(false);
    // 0 means immune — same as absent (see the Node schema), so it must not open.
    patchNode("n1", { vulnerability_levels: { quake: 0 } });
    expect(open(), "0 is immune, not vulnerable").toBe(false);
    patchNode("n1", { vulnerability_levels: { quake: 2 } });
    expect(open()).toBe(true);
  });

  it("'Apply the Event' waits for a NEW history entry", () => {
    // Pre-existing history must not satisfy a gate the user has not acted on.
    useHistoryStore.setState({
      updateHistory: [{ id: "old", update_type: "event_applied" }],
    } as never);

    const open = gate(BUILD_MODEL_TOUR, "Apply the Event");
    expect(open(), "the entry that was already there does not count").toBe(false);

    useHistoryStore.setState({
      updateHistory: [{ id: "new", update_type: "event_applied" }, { id: "old", update_type: "event_applied" }],
    } as never);
    expect(open()).toBe(true);
  });

  it("'Run the Propagation' does not open on an Event", () => {
    const open = gate(BUILD_MODEL_TOUR, "Run the Propagation");
    useHistoryStore.setState({
      updateHistory: [{ id: "a", update_type: "event_applied" }],
    } as never);
    expect(open()).toBe(false);
    useHistoryStore.setState({
      updateHistory: [{ id: "b", update_type: "propagation" }],
    } as never);
    expect(open()).toBe(true);
  });
});

describe("build tour — shape", () => {
  it("opens and closes with a step that asks for nothing", () => {
    expect(BUILD_MODEL_TOUR[0].waitFor).toBeUndefined();
    expect(BUILD_MODEL_TOUR[BUILD_MODEL_TOUR.length - 1].waitFor).toBeUndefined();
  });

  it("gives every waiting step a hint, so the tour never looks stuck", () => {
    for (const step of BUILD_MODEL_TOUR) {
      if (step.waitFor) expect(step.waitHint, `"${step.title}" waits with no hint`).toBeTruthy();
    }
  });


  it("defines a Category before asking to supply it, and an Event before asking for a vulnerability", () => {
    // The Inspector only offers what the configuration defines, so a tour that
    // asked in the other order would strand the user on a step they cannot do.
    const at = (title: string) => BUILD_MODEL_TOUR.findIndex((s) => s.title === title);
    expect(at("Define a Category")).toBeLessThan(at("Declare the supply"));
    expect(at("Define an Event")).toBeLessThan(at("Set the vulnerability"));
    // Demand is asked for after the edge exists: that is what makes the
    // consumer's Category Dependency Profile appear without tagging it.
    expect(at("Connect supplier to consumer")).toBeLessThan(at("Declare the demand"));
  });
});
