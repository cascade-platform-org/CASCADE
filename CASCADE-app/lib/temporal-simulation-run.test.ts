/**
 * temporal-simulation-run — a run from the window, end to end, with the engine
 * call replaced. What only the wiring can get wrong: the model is read-only while
 * the run computes and is shown, End run leaves it byte-identical, the Run View
 * shows any period, and a cancel keeps nothing.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphSnapshot } from "@/lib/schemas/network";

/** Engine stand-in: the snapshot comes back unchanged, so a period shows exactly what its Events imposed. */
const engine = vi.fn(async (s: GraphSnapshot): Promise<GraphSnapshot> => s);
vi.mock("@/lib/ephemeral-propagation", () => ({
  propagateSnapshot: async (s: GraphSnapshot) => ({ snapshot: await engine(s), flow: { served_ratio: {}, stored: {} } }),
}));

const { useCanvasStore } = await import("@/store/canvas-store");
const { useConfigStore, selectN } = await import("@/store/config-store");
const { useTemporalSimulationStore } = await import("@/store/temporal-simulation-store");
const { cancelTemporalSimulationRun, endTemporalSimulationRun, startTemporalSimulationRun } = await import("./temporal-simulation-run");
const { TEMPORAL_SIMULATION_FORMAT } = await import("@/lib/schemas/temporal-simulation");

const sim = () => useTemporalSimulationStore.getState();
const model = () => JSON.stringify(useCanvasStore.getState().toProject().nodes);

beforeEach(() => {
  engine.mockReset();
  engine.mockImplementation(async (s) => s);
  useCanvasStore.getState().reset();
  const n = selectN(useConfigStore.getState());
  useConfigStore.setState((s) => ({ config: { ...s.config, events: [{ id: "quake", label: "Quake", type: "hazard", frequency_per_10y: 0 }] } }));
  const canvas = useCanvasStore.getState();
  canvas.addCanvas({ id: "c1", label: "Main", graph: { graph_type: "generic", node_ids: [], edge_ids: [] } });
  canvas.upsertNode({ id: "a", label: "A", functionality: n, vulnerability_levels: { quake: 1 } });
  canvas.addNodeToCanvas("a", "c1");
  sim().loadFromProject({
    format: TEMPORAL_SIMULATION_FORMAT,
    timeline: { name: "t", steps: [{ label: "2023-01-01", unit: "day", repeat: 3, phases: [{ events: [{ event: "quake", every: 2 }], propagate: true }] }] },
    profile: {},
    metrics: [],
  });
});

describe("a run from the window", () => {
  it("shows any period on its own copy, refuses model edits, and End run leaves the model byte-identical", async () => {
    const before = model();
    await startTemporalSimulationRun();
    expect(engine).toHaveBeenCalledTimes(3);
    expect(sim().runRecord?.periods.map((p) => p.label)).toEqual(["2023-01-01", "2023-01-02", "2023-01-03"]);

    const n = selectN(useConfigStore.getState());
    expect(sim().shown?.nodes.a.functionality).toBe(n);
    sim().selectPeriod(2);
    expect(sim().shown?.nodes.a.functionality).toBe(n - 1);

    useCanvasStore.getState().updateNode("a", { label: "edited" });
    expect(model()).toBe(before);

    expect(endTemporalSimulationRun()).toBe(true);
    expect(sim().shown).toBeNull();
    expect(model()).toBe(before);
    useCanvasStore.getState().updateNode("a", { label: "edited" });
    expect(model()).not.toBe(before);
  });

  it("keeps nothing when cancelled, and names the period", async () => {
    const before = model();
    engine.mockImplementation(async (s) => { cancelTemporalSimulationRun(); return s; });
    await startTemporalSimulationRun();
    expect(sim().running).toBe(false);
    expect(sim().runRecord).toBeNull();
    expect(sim().runError).toMatch(/^Cancelled — in period 2023-01-02/);
    expect(model()).toBe(before);
  });

  it("reports an engine refusal with its period", async () => {
    engine.mockImplementation(async (s) => { if (engine.mock.calls.length === 3) throw new Error("Rate limit"); return s; });
    await startTemporalSimulationRun();
    expect(sim().runError).toMatch(/^Stopped: Rate limit — in period 2023-01-03/);
    expect(sim().running).toBe(false);
  });
});
