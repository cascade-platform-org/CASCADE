/**
 * project-bundle — opening a project, the one path every source takes. What
 * the hand-wired loaders got wrong between them: a configuration opened alone
 * was never checked against the open project, only one kept the active Canvas,
 * and a save read back from localStorage reached the stores unchecked.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore, DEFAULT_CONFIG } from "@/store/config-store";
import { useTemporalSimulationStore } from "@/store/temporal-simulation-store";
import { currentBundle, openBundle } from "./project-bundle";
import { getBeforeUnloadSave } from "./file-io";
import type { ProjectBundle } from "@/lib/schemas/bundle";
import type { Canvas } from "@/lib/schemas/network";

const canvas = (id: string, nodeIds: string[]): Canvas => ({ id, label: id, graph: { graph_type: "generic", node_ids: nodeIds, edge_ids: [] } });

function bundle(): ProjectBundle {
  return {
    project: {
      version: "2.0",
      meta: { name: "P" },
      nodes: { a: { id: "a", label: "A", functionality: 4, vulnerability_levels: { quake: 2 } } },
      edges: {},
      canvases: [canvas("c1", ["a"]), canvas("c2", [])],
      update_history: [],
      scorecard: [],
    },
    config: { ...DEFAULT_CONFIG, events: [{ id: "quake", label: "Quake", type: "hazard", frequency_per_10y: 0 }] },
  };
}

beforeEach(() => {
  useCanvasStore.getState().reset();
  useConfigStore.getState().loadConfig(DEFAULT_CONFIG);
});

describe("openBundle", () => {
  it("opens both parts, on the first Canvas, and reads back the same bundle", () => {
    const b = bundle();
    expect(openBundle(b)).toEqual([]);
    expect(useCanvasStore.getState().activeCanvasId).toBe("c1");
    expect(currentBundle().config.events).toEqual(b.config.events);
    expect(Object.keys(currentBundle().project.nodes)).toEqual(["a"]);
  });

  it("keeps the active Canvas when asked and it still exists", () => {
    openBundle(bundle());
    useCanvasStore.getState().setActiveCanvas("c2");
    openBundle(bundle(), { keepActiveCanvas: true });
    expect(useCanvasStore.getState().activeCanvasId).toBe("c2");
    openBundle(bundle());
    expect(useCanvasStore.getState().activeCanvasId).toBe("c1");
  });

  it("checks a configuration opened alone against the project that stays open", () => {
    openBundle(bundle());
    const issues = openBundle({ config: DEFAULT_CONFIG });
    expect(issues.map((i) => i.code)).toContain("NODE_UNKNOWN_EVENT");
    expect(Object.keys(useCanvasStore.getState().nodes)).toEqual(["a"]);
  });

  it("ends a shown Temporal Simulation run, whichever part it opens", () => {
    openBundle(bundle());
    useTemporalSimulationStore.setState({ running: true });
    openBundle({ config: bundle().config });
    expect(useTemporalSimulationStore.getState().running).toBe(false);
  });
});

describe("getBeforeUnloadSave", () => {
  it("refuses a save whose bundle no longer matches the schemas", () => {
    const store = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    } as Storage;
    store.set("cascade:beforeunload", JSON.stringify({ saved_at: "2026-01-01T00:00:00Z", bundle: { project: { nodes: "broken" }, config: {} } }));
    expect(getBeforeUnloadSave()).toBeNull();
    store.set("cascade:beforeunload", JSON.stringify({ saved_at: "2026-01-01T00:00:00Z", bundle: bundle() }));
    expect(getBeforeUnloadSave()?.bundle.project.nodes.a?.label).toBe("A");
  });
});
