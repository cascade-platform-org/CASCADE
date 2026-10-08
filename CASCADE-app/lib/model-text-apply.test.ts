/**
 * model-text-apply — writing a checked LLM Design, and Undo this edit
 * (ADR-0022): apply then undo gives back exactly the project and the
 * configuration it started from, and a shown Temporal Simulation run refuses
 * both, like every model edit.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore, DEFAULT_CONFIG } from "@/store/config-store";
import { useTemporalSimulationStore } from "@/store/temporal-simulation-store";
import { MODEL_TEXT_FORMAT, checkChange, parseChangeText } from "./model-text";
import { applyModelBundle, currentBundle, restoreModelBundle } from "./model-text-apply";
import type { ProjectBundle } from "./file-io";

/** The bundle without what toProject stamps afresh on every call. */
const comparable = (b: ProjectBundle) => ({ ...b, project: { ...b.project, meta: { ...b.project.meta, created_at: undefined, updated_at: undefined } } });

function checked(text: object): ProjectBundle {
  const parsed = parseChangeText(JSON.stringify({ format: MODEL_TEXT_FORMAT, ...text }));
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  const r = checkChange(currentBundle(), parsed.change);
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return r.after;
}

beforeEach(() => {
  useCanvasStore.getState().reset();
  useConfigStore.getState().loadConfig(structuredClone(DEFAULT_CONFIG));
  const canvas = useCanvasStore.getState();
  canvas.addCanvas({ id: "c1", label: "Main", graph: { graph_type: "generic", node_ids: [], edge_ids: [] } });
  canvas.upsertNode({ id: "a", label: "A", functionality: DEFAULT_CONFIG.functionality_scale.length });
  canvas.addNodeToCanvas("a", "c1");
});

describe("applying a LLM Design", () => {
  it("writes the model and the configuration, and Undo this edit restores both exactly", () => {
    const start = currentBundle();
    const before = applyModelBundle(checked({
      patch: [
        { op: "replace", path: "/project/nodes/a/label", value: "Renamed" },
        { op: "add", path: "/config/events/-", value: { id: "flood", label: "Flood", type: "hazard", frequency_per_10y: 1 } },
      ],
    }));
    expect(before).not.toBeNull();
    expect(useCanvasStore.getState().nodes.a.label).toBe("Renamed");
    expect(useConfigStore.getState().config.events.map((e) => e.id)).toContain("flood");
    expect(useCanvasStore.getState().activeCanvasId).toBe("c1");

    expect(restoreModelBundle(before!)).toBe(true);
    expect(comparable(currentBundle())).toEqual(comparable(start));
  });

  it("is refused while a run is shown, and the model stays as it was", () => {
    const after = checked({ patch: [{ op: "replace", path: "/project/nodes/a/label", value: "X" }] });
    useTemporalSimulationStore.getState().beginRun(0);
    expect(applyModelBundle(after)).toBeNull();
    expect(useCanvasStore.getState().nodes.a.label).toBe("A");
    useTemporalSimulationStore.getState().endRun();
  });
});
