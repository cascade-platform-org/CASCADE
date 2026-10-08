/**
 * temporal-simulation-store — the project's Temporal Simulation (ADR-0019).
 *
 * The text form and the plan are tested in their own files. What only the store
 * can get wrong: an edit that passes the schema is saved into the project, one
 * that does not leaves the last valid document in place, a shown run refuses
 * edits, and the document survives a project save and load.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore } from "@/store/config-store";
import { useScorecardStore } from "@/store/scorecard-store";
import { useTemporalSimulationStore } from "@/store/temporal-simulation-store";
import { buildPropagationPayload } from "@/lib/propagation-payload";
import { ProjectSchema } from "@/lib/schemas/network";
import { STANDARD_METRICS, TEMPORAL_SIMULATION_FORMAT, type TemporalSimulation } from "@/lib/schemas/temporal-simulation";

const doc: TemporalSimulation = {
  format: TEMPORAL_SIMULATION_FORMAT,
  standard_metrics: [...STANDARD_METRICS],
  timeline: { name: "Week", steps: [{ label: "2023-03-06", unit: "day", repeat: 7, phases: [{ events: [{ event: "quake", every: 2 }], propagate: true }] }] },
  profile: { "2023-03-07": [{ element: "pool", path: ["supply_capacity", "water"], op: "mul", value: 0.5 }] },
  metrics: [],
};

const store = () => useTemporalSimulationStore.getState();

beforeEach(() => {
  useCanvasStore.getState().reset();
});

describe("saving into the project", () => {
  it("starts from the starter Timeline, unsaved until the first edit", () => {
    expect(store().saved).toBeUndefined();
    expect(store().timeline.steps.length).toBeGreaterThan(0);
    store().updateTimeline((t) => { t.name = "Renamed"; });
    expect(store().saved?.timeline.name).toBe("Renamed");
    expect(store().unsaved).toEqual([]);
  });

  it("keeps the last valid document while an edit fails the schema, and says why", () => {
    store().loadFromProject(doc);
    store().updateTimeline((t) => { t.steps[0].label = ""; });
    expect(store().saved).toEqual(doc);
    expect(store().unsaved.join("\n")).toMatch(/timeline\.steps\.0\.label/);
    store().updateTimeline((t) => { t.steps[0].label = "2023-03-13"; });
    expect(store().saved?.timeline.steps[0].label).toBe("2023-03-13");
    expect(store().unsaved).toEqual([]);
  });

  it("shows and hides a standard Metric, in the standard order, and saves it", () => {
    store().loadFromProject(doc);
    store().showStandardMetric("operativity", false);
    expect(store().saved?.standard_metrics).toEqual(["coverage", "stock_level"]);
    store().showStandardMetric("operativity", true);
    expect(store().saved?.standard_metrics).toEqual([...STANDARD_METRICS]);
  });

  it("refuses definition edits while a run is shown", () => {
    store().loadFromProject(doc);
    store().beginRun(0);
    store().updateTimeline((t) => { t.name = "Changed"; });
    expect(store().timeline.name).toBe("Week");
    expect(store().saved).toEqual(doc);
    store().endRun();
  });
});

describe("the project file", () => {
  it("round-trips the document through toProject, the schema and fromProject", () => {
    store().loadFromProject(doc);
    const file = ProjectSchema.parse(JSON.parse(JSON.stringify(useCanvasStore.getState().toProject())));
    expect(file.temporal_simulation).toEqual(doc);

    useCanvasStore.getState().reset();
    expect(store().saved).toBeUndefined();

    useCanvasStore.getState().fromProject(file);
    expect(store().saved).toEqual(doc);
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

  it("leaves a project without a simulation without the key", () => {
    expect("temporal_simulation" in JSON.parse(JSON.stringify(useCanvasStore.getState().toProject()))).toBe(false);
  });
});

describe("the Propagation request", () => {
  it("leaves the document out, in both scopes", () => {
    store().loadFromProject(doc);
    useCanvasStore.getState().addCanvas({ id: "c1", label: "Main", graph: { graph_type: "generic", node_ids: [], edge_ids: [] } });
    const { toProject } = useCanvasStore.getState();
    const config = useConfigStore.getState().config;
    for (const scope of ["global", "local"] as const) {
      const payload = buildPropagationPayload({ project: toProject(), config, scope, activeCanvasId: "c1" });
      expect(payload.project.temporal_simulation).toBeUndefined();
    }
  });
});
