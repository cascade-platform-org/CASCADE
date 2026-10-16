import { beforeEach, describe, expect, it } from "vitest";
import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore } from "@/store/config-store";
import { useProjectDataStore } from "@/store/project-data-store";
import { useTemporalSimulationStore } from "@/store/temporal-simulation-store";
import { buildPropagationPayload } from "@/lib/propagation-payload";
import { ProjectSchema } from "@/lib/schemas/network";
import type { Series } from "@/lib/schemas/series";
import type { CustomSheet } from "@/lib/schemas/custom-sheet";

const series: Series[] = [{ name: "worked_h", unit: "h", rows: { "act-pul": { "2023-01": 21555 }, "*": { "2023-01": 0 } } }];
const sheets: CustomSheet[] = [{ name: "Forecast", writes: "S·worked_h", rows: [[{ v: "element" }, { v: "2023-01" }], [{ v: "act-pul" }, { v: 1, f: "Nodes!B2*2" }, null]] }];
const saveAndParse = () => ProjectSchema.parse(JSON.parse(JSON.stringify(useCanvasStore.getState().toProject())));

beforeEach(() => {
  useCanvasStore.getState().reset();
  useProjectDataStore.getState().loadFromProject(undefined, undefined);
  useTemporalSimulationStore.getState().loadFromProject(undefined);
});

describe("Series and custom sheets in the project file", () => {
  it("round-trip through toProject, the schema and fromProject", () => {
    useProjectDataStore.getState().loadFromProject(series, sheets);
    const file = saveAndParse();
    expect(file.series).toEqual(series);
    expect(file.sheets).toEqual(sheets);
    useProjectDataStore.getState().loadFromProject(undefined, undefined);
    useCanvasStore.getState().fromProject(file);
    expect(useProjectDataStore.getState()).toMatchObject({ series, sheets });
  });

  it("leave a project without them without the keys", () => {
    const file = JSON.parse(JSON.stringify(useCanvasStore.getState().toProject()));
    expect("series" in file || "sheets" in file).toBe(false);
  });

  it("stay out of the Propagation request, in both scopes", () => {
    useProjectDataStore.getState().loadFromProject(series, sheets);
    useCanvasStore.getState().addCanvas({ id: "c1", label: "Main", graph: { graph_type: "generic", node_ids: [], edge_ids: [] } });
    const config = useConfigStore.getState().config;
    for (const scope of ["global", "local"] as const) {
      const payload = buildPropagationPayload({ project: useCanvasStore.getState().toProject(), config, scope, activeCanvasId: "c1" });
      expect(payload.project.series).toBeUndefined();
      expect(payload.project.sheets).toBeUndefined();
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
