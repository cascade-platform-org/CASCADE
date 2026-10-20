import { beforeEach, describe, expect, it } from "vitest";
import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore } from "@/store/config-store";
import { useProjectDataStore } from "@/store/project-data-store";
import { useTemporalSimulationStore } from "@/store/temporal-simulation-store";
import { buildPropagationPayload } from "@/lib/propagation-payload";
import { ProjectSchema } from "@/lib/schemas/network";
import type { Series } from "@/lib/schemas/series";

const series: Series[] = [{ name: "worked_h", unit: "h", rows: { "act-pul": { "2023-01": 21555 }, "*": { "2023-01": 0 } } }];
const saveAndParse = () => ProjectSchema.parse(JSON.parse(JSON.stringify(useCanvasStore.getState().toProject())));

beforeEach(() => {
  useCanvasStore.getState().reset();
  useProjectDataStore.getState().loadFromProject(undefined);
  useTemporalSimulationStore.getState().loadFromProject(undefined);
});

describe("Series in the project file", () => {
  it("round-trip through toProject, the schema and fromProject", () => {
    useProjectDataStore.getState().loadFromProject(series);
    const file = saveAndParse();
    expect(file.series).toEqual(series);
    useProjectDataStore.getState().loadFromProject(undefined);
    useCanvasStore.getState().fromProject(file);
    expect(useProjectDataStore.getState()).toMatchObject({ series });
  });

  it("leave a project without them without the key", () => {
    const file = JSON.parse(JSON.stringify(useCanvasStore.getState().toProject()));
    expect("series" in file).toBe(false);
  });

  it("stay out of the Propagation request, in both scopes", () => {
    useProjectDataStore.getState().loadFromProject(series);
    useCanvasStore.getState().addCanvas({ id: "c1", label: "Main", graph: { graph_type: "generic", node_ids: [], edge_ids: [] } });
    const config = useConfigStore.getState().config;
    for (const scope of ["global", "local"] as const) {
      const payload = buildPropagationPayload({ project: useCanvasStore.getState().toProject(), config, scope, activeCanvasId: "c1" });
      expect(payload.project.series).toBeUndefined();
    }
  });
});

describe("the project's creation time", () => {
  it("survives a save and a load, while the update time is restamped", () => {
    const file = saveAndParse();
    useCanvasStore.getState().fromProject({ ...file, meta: { ...file.meta, created_at: "2024-05-01T10:00:00.000Z" } });
    const again = useCanvasStore.getState().toProject();
    expect(again.meta.created_at).toBe("2024-05-01T10:00:00.000Z");
    expect(again.meta.updated_at).not.toBe("2024-05-01T10:00:00.000Z");
  });
});

describe("editing Series", () => {
  const data = () => useProjectDataStore.getState();
  it("adds, validates, and renames a Series with every Simulation's operations that read it", () => {
    const name = data().addSeries()!;
    expect(name).toBe("series_1");
    expect(data().setSeries(name, { name, rows: { a: { "2024-01": Number.NaN } } })).toMatch(/./);
    expect(data().setSeries(name, { name, rows: { a: { "2024-01": 5 } } })).toBeNull();
    useTemporalSimulationStore.getState().updateProfile((rows) => {
      rows.push({ id: "r", element: "a", path: ["p"], op: "add", series: name, values: { "2023-01": 1 } });
    });
    expect(data().renameSeries(name, "worked_h")).toBeNull();
    expect(data().series.map((x) => x.name)).toEqual(["worked_h"]);
    expect(useTemporalSimulationStore.getState().simulations[0].profile["2023-01"][0].series).toBe("worked_h");
    expect(useTemporalSimulationStore.getState().profile[0].series).toBe("worked_h");
    data().addSeries();
    expect(data().renameSeries("series_1", "worked_h")).toMatch(/exists/);
  });

  it("refuses edits while a run is shown", () => {
    useTemporalSimulationStore.setState({ running: true });
    expect(data().addSeries()).toBeNull();
    expect(data().removeSeries("x")).toMatch(/End run/);
    useTemporalSimulationStore.setState({ running: false });
  });
});
