/**
 * model-undo — Ctrl+Z reaches what the project saves beyond the graph (ADR-0017,
 * revised 2026-10-19): Temporal Simulation edits, Series, the configuration,
 * and a whole LLM Design edit or Workbook import, in one history with the
 * graph's edits.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore } from "@/store/config-store";
import { useHistoryStore } from "@/store/history-store";
import { useProjectDataStore } from "@/store/project-data-store";
import { useTemporalSimulationStore } from "@/store/temporal-simulation-store";
import { applyModelBundle } from "@/lib/model-text-apply";
import { currentBundle } from "@/lib/project-bundle";
import { editElement } from "@/lib/element-edit";

const history = () => useHistoryStore.getState().updateHistory;
const sim = () => useTemporalSimulationStore.getState();
const canvas = () => useCanvasStore.getState();
const savedName = () => sim().simulations.find((x) => x.id === sim().selectedId)?.timeline.name;

beforeEach(() => {
  canvas().reset();
  canvas().addCanvas({ id: "c1", label: "Main", graph: { graph_type: "generic", node_ids: [], edge_ids: [] } });
  canvas().upsertNode({ id: "a", label: "A", functionality: 4 });
  useProjectDataStore.getState().loadFromProject([], []);
  useHistoryStore.getState().loadHistory([]);
});

describe("one history for the graph and the model", () => {
  it("records a Timeline name typed letter by letter as one step; undo and redo restore it", () => {
    // The first edit saves the starter as a new Simulation: a step of its own.
    sim().updateTimeline((t) => { t.name = "Original"; });
    for (const name of ["Y", "Ye", "Yea", "Year"]) sim().updateTimeline((t) => { t.name = name; });
    expect(history()).toHaveLength(2);
    expect(history()[0]).toMatchObject({ update_type: "model_update" });
    expect(history()[0].model_diff?.records).toEqual([expect.objectContaining({ op: "update", fields: [expect.objectContaining({ field: "timeline", path: ["name"], before: "Original", after: "Year" })] })]);
    expect(canvas().undo()).toBe(true);
    expect(savedName()).toBe("Original");
    expect(sim().timeline.name).toBe("Original");
    expect(canvas().redo()).toBe(true);
    expect(savedName()).toBe("Year");
    expect(sim().timeline.name).toBe("Year");
  });

  it("keeps edits of two fields as two steps, undone in order with an Element edit between", () => {
    sim().updateTimeline((t) => { t.name = "Year"; });
    editElement("node", "a", { label: "Pump" });
    sim().updateParameters((ps) => { ps.push({ name: "share", value: 0.5 }); });
    expect(history().map((e) => e.update_type)).toEqual(["model_update", "graph_update", "model_update"]);
    canvas().undo();
    expect(sim().parameters).toEqual([]);
    expect(canvas().nodes.a.label).toBe("Pump");
    canvas().undo();
    expect(canvas().nodes.a.label).toBe("A");
    expect(savedName()).toBe("Year");
  });

  it("undoes adding and deleting a Temporal Simulation", () => {
    sim().updateTimeline((t) => { t.name = "First"; });
    sim().addSimulation();
    expect(sim().simulations).toHaveLength(2);
    canvas().undo();
    expect(sim().simulations).toHaveLength(1);
    expect(savedName()).toBe("First");
    sim().deleteSimulation(sim().selectedId);
    expect(sim().simulations).toHaveLength(0);
    canvas().undo();
    expect(sim().simulations.map((x) => x.timeline.name)).toEqual(["First"]);
  });

  it("undoes a Series rename with the references that followed it, as one step", () => {
    const data = () => useProjectDataStore.getState();
    data().addSeries();
    sim().updateProfile((rows) => { rows.push({ id: "r", element: "a", path: ["functionality"], op: "mul", series: "series_1", values: { "2025-01": 1 } }); });
    data().renameSeries("series_1", "hours");
    expect(sim().simulations[0].profile["2025-01"]?.[0].series).toBe("hours");
    canvas().undo();
    expect(data().series.map((x) => x.name)).toEqual(["series_1"]);
    expect(sim().simulations[0].profile["2025-01"]?.[0].series).toBe("series_1");
  });

  it("undoes the configuration's Apply", () => {
    const config = () => useConfigStore.getState();
    const before = config().config.events.length;
    config().openDraft();
    config().addEvent({ label: "Flood", type: "hazard", frequency_per_10y: 1 });
    config().commitDraft();
    expect(config().config.events).toHaveLength(before + 1);
    canvas().undo();
    expect(config().config.events).toHaveLength(before);
    canvas().redo();
    expect(config().config.events.map((e) => e.label)).toContain("Flood");
  });

  it("undoes a whole LLM Design edit or import, graph and model, in one step", () => {
    const b = currentBundle();
    const after = {
      ...b,
      project: { ...b.project, meta: { ...b.project.meta, name: "Renamed" }, nodes: { ...b.project.nodes, a: { ...b.project.nodes.a, label: "Imported" } } },
      config: { ...b.config, events: [...b.config.events, { id: "x", label: "X", type: "hazard" as const, frequency_per_10y: 1 }] },
    };
    expect(applyModelBundle(after, "Import changes from x.xlsx")).not.toBeNull();
    expect(history()[0]).toMatchObject({ update_type: "model_update", label: "Import changes from x.xlsx" });
    canvas().undo();
    expect(canvas().nodes.a.label).toBe("A");
    expect(canvas().projectMeta.name).toBe(b.project.meta.name);
    expect(useConfigStore.getState().config.events.some((e) => e.id === "x")).toBe(false);
  });
});
