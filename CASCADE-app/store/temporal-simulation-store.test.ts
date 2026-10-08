/**
 * temporal-simulation-store — the project's Temporal Simulations (ADR-0019).
 *
 * The text form and the plan are tested in their own files. What only the store
 * can get wrong: an edit that passes the schema is saved into the list, one
 * that does not leaves the last valid document in place, a shown run refuses
 * edits and a change of Simulation, and the list survives a project save and load.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore } from "@/store/config-store";
import { useScorecardStore } from "@/store/scorecard-store";
import { useTemporalSimulationStore } from "@/store/temporal-simulation-store";
import { buildPropagationPayload } from "@/lib/propagation-payload";
import { ProjectSchema } from "@/lib/schemas/network";
import { STANDARD_METRICS, TEMPORAL_SIMULATION_FORMAT, type StoredTemporalSimulation } from "@/lib/schemas/temporal-simulation";

const doc: StoredTemporalSimulation = {
  id: "week",
  format: TEMPORAL_SIMULATION_FORMAT,
  standard_metrics: [...STANDARD_METRICS],
  scope: "global",
  timeline: { name: "Week", steps: [{ label: "2023-03-06", unit: "day", repeat: 7, phases: [{ events: [{ event: "quake", every: 2 }], propagate: true }] }] },
  profile: { "2023-03-07": [{ element: "pool", path: ["supply_capacity", "water"], op: "mul", value: 0.5 }] },
  metrics: [],
};

const store = () => useTemporalSimulationStore.getState();
/** The selected Simulation's saved document. */
const saved = () => store().simulations.find((x) => x.id === store().selectedId);

beforeEach(() => {
  useCanvasStore.getState().reset();
});

describe("saving into the project", () => {
  it("starts from the starter Timeline, unsaved until the first edit", () => {
    expect(saved()).toBeUndefined();
    expect(store().timeline.steps.length).toBeGreaterThan(0);
    store().updateTimeline((t) => { t.name = "Renamed"; });
    expect(saved()?.timeline.name).toBe("Renamed");
    expect(store().unsaved).toEqual([]);
  });

  it("keeps the last valid document while an edit fails the schema, and says why", () => {
    store().loadFromProject([doc]);
    store().updateTimeline((t) => { t.steps[0].label = ""; });
    expect(saved()).toEqual(doc);
    expect(store().unsaved.join("\n")).toMatch(/timeline\.steps\.0\.label/);
    store().updateTimeline((t) => { t.steps[0].label = "2023-03-13"; });
    expect(saved()?.timeline.steps[0].label).toBe("2023-03-13");
    expect(store().unsaved).toEqual([]);
  });

  it("shows and hides a standard Metric, in the standard order, and saves it", () => {
    store().loadFromProject([doc]);
    store().showStandardMetric("operativity", false);
    expect(saved()?.standard_metrics).toEqual(["coverage", "stock_level"]);
    store().showStandardMetric("operativity", true);
    expect(saved()?.standard_metrics).toEqual([...STANDARD_METRICS]);
  });

  it("refuses definition edits while a run is shown", () => {
    store().loadFromProject([doc]);
    store().beginRun(0);
    store().updateTimeline((t) => { t.name = "Changed"; });
    expect(store().timeline.name).toBe("Week");
    expect(saved()).toEqual(doc);
    store().endRun();
  });
});

describe("several Simulations", () => {
  it("adds, duplicates, selects and deletes, each saved in the list", () => {
    store().loadFromProject([doc]);
    store().addSimulation();
    const added = store().selectedId;
    expect(store().simulations.map((x) => x.id)).toEqual(["week", added]);
    expect(store().timeline.name).toBe("New Temporal Simulation");

    store().selectSimulation("week");
    store().duplicateSimulation();
    expect(store().simulations).toHaveLength(3);
    expect(store().timeline.name).toBe("Week (copy)");
    expect(saved()).toMatchObject({ profile: doc.profile, timeline: { steps: doc.timeline.steps } });

    store().deleteSimulation(store().selectedId);
    expect(store().simulations.map((x) => x.id)).toEqual(["week", added]);
    expect(store().selectedId).toBe(added);
    store().deleteSimulation(added);
    store().deleteSimulation("week");
    expect(store().simulations).toEqual([]);
    expect(store().timeline.steps.length).toBeGreaterThan(0);
  });

  it("an edit saves into the selected Simulation only", () => {
    store().loadFromProject([doc, { ...doc, id: "other", timeline: { ...doc.timeline, name: "Other" } }]);
    store().selectSimulation("other");
    store().updateTimeline((t) => { t.name = "Renamed"; });
    expect(store().simulations.map((x) => x.timeline.name)).toEqual(["Week", "Renamed"]);
  });

  it("keeps the scope with the Simulation: local names its Canvas, global drops it", () => {
    store().loadFromProject([doc]);
    store().setScope("local", "c1");
    expect(saved()).toMatchObject({ scope: "local", canvas: "c1" });
    store().setScope("global");
    expect(saved()?.scope).toBe("global");
    expect(saved()).not.toHaveProperty("canvas");
  });

  it("refuses a change of Simulation or of the list while a run is shown", () => {
    store().loadFromProject([doc, { ...doc, id: "other" }]);
    store().beginRun(0);
    const cue = store().endRunCue;
    store().selectSimulation("other");
    store().addSimulation();
    store().deleteSimulation("week");
    expect(store().selectedId).toBe("week");
    expect(store().simulations).toHaveLength(2);
    expect(store().endRunCue).toBe(cue + 3);
    store().endRun();
  });
});

describe("the project file", () => {
  it("round-trips the document through toProject, the schema and fromProject", () => {
    store().loadFromProject([doc]);
    const file = ProjectSchema.parse(JSON.parse(JSON.stringify(useCanvasStore.getState().toProject())));
    expect(file.temporal_simulations).toEqual([doc]);

    useCanvasStore.getState().reset();
    expect(saved()).toBeUndefined();

    useCanvasStore.getState().fromProject(file);
    expect(saved()).toEqual(doc);
    expect(store().profile).toHaveLength(1);
    expect(store().profile[0].values).toEqual({ "2023-03-07": 0.5 });
  });

  it("round-trips a saved run, and loads an older one-period entry as a run of one", () => {
    const start = { nodes: { a: { id: "a", functionality: 3 } }, edges: {}, canvases: [] };
    const head = { type: "temporal_simulation" as const, id: "r", label: "r", created_at: "2023-01-01T00:00:00Z", timeline_name: "t" };
    useScorecardStore.getState().addScorecardEntry({
      ...head, start, metric_min: { x: 1 }, metric_mean: { x: 2 },
      periods: [{ label: "p1", diff: { nodes: [], edges: [], canvases: [] }, metrics: { x: 1 }, stock_values: [] }],
    });
    const file = ProjectSchema.parse(JSON.parse(JSON.stringify(useCanvasStore.getState().toProject())));
    useCanvasStore.getState().reset();
    useCanvasStore.getState().fromProject(file);
    expect(useScorecardStore.getState().scorecard[0]).toMatchObject({ start, periods: [{ label: "p1" }] });

    const older = ProjectSchema.parse({
      ...file,
      scorecard: [
        { ...head, id: "o", period_label: "p", snapshot: start, metrics: { x: 4 }, level_reading: "change", stock_values: [{ element: "a", value: 1 }] },
        { ...head, id: "gone", period_label: "p", base_id: "b", diff: { nodes: [], edges: [], canvases: [] } },
      ],
    });
    expect(older.scorecard).toHaveLength(1);
    expect(older.scorecard[0]).toMatchObject({ id: "o", start, periods: [{ label: "p", metrics: { x: 4 }, stock_values: [{ element: "a", value: 1 }] }] });
  });

  it("loads a project saved with one Simulation as the list's only entry", () => {
    const { id: _id, ...single } = doc;
    const file = ProjectSchema.parse({ ...JSON.parse(JSON.stringify(useCanvasStore.getState().toProject())), temporal_simulation: single });
    expect(file.temporal_simulations).toEqual([{ ...doc, id: "simulation-1" }]);
    expect(file).not.toHaveProperty("temporal_simulation");
  });

  it("leaves a project without a simulation without the key", () => {
    expect("temporal_simulations" in JSON.parse(JSON.stringify(useCanvasStore.getState().toProject()))).toBe(false);
  });
});

describe("the Propagation request", () => {
  it("leaves the document out, in both scopes", () => {
    store().loadFromProject([doc]);
    useCanvasStore.getState().addCanvas({ id: "c1", label: "Main", graph: { graph_type: "generic", node_ids: [], edge_ids: [] } });
    const { toProject } = useCanvasStore.getState();
    const config = useConfigStore.getState().config;
    for (const scope of ["global", "local"] as const) {
      const payload = buildPropagationPayload({ project: toProject(), config, scope, activeCanvasId: "c1" });
      expect(payload.project.temporal_simulations).toBeUndefined();
    }
  });
});
