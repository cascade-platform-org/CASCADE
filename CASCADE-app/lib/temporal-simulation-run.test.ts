/**
 * temporal-simulation-run — a run from the window, end to end, with only the
 * HTTP call replaced: scope, the payload, and the Propagation Context the run
 * captures are the real ones. What only the wiring can get wrong: the model is
 * read-only while the run computes and is shown, End run leaves it
 * byte-identical, the Run View shows any period, a cancel keeps nothing, and
 * nothing edited after Run reaches the engine.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PropagationRequest } from "@/lib/schemas/api";
import type { PropagationResult } from "@/lib/schemas/propagation";

/** Engine stand-in: no Element changes, so a period shows exactly what its Events imposed. */
const unchanged = (payload: PropagationRequest): PropagationResult => ({
  updates: [], warnings: [], scope: payload.scope, iterations: 1, computed_at: "2026-01-01T00:00:00Z", served_ratio: {}, stored: {},
});
const engine = vi.fn(async (payload: PropagationRequest) => unchanged(payload));
vi.mock(import("@/lib/api-client"), async (importOriginal) => ({
  ...(await importOriginal()),
  postPropagate: (payload: PropagationRequest) => engine(payload),
}));

const { useCanvasStore } = await import("@/store/canvas-store");
const { useConfigStore, selectN } = await import("@/store/config-store");
const { useUiStore } = await import("@/store/ui-store");
const { useTemporalSimulationStore } = await import("@/store/temporal-simulation-store");
const { cancelTemporalSimulationRun, endTemporalSimulationRun, startTemporalSimulationRun } = await import("./temporal-simulation-run");
const { STANDARD_METRICS, TEMPORAL_SIMULATION_FORMAT } = await import("@/lib/schemas/temporal-simulation");

const sim = () => useTemporalSimulationStore.getState();
const model = () => JSON.stringify(useCanvasStore.getState().toProject().nodes);

beforeEach(() => {
  engine.mockReset();
  engine.mockImplementation(async (payload) => unchanged(payload));
  useCanvasStore.getState().reset();
  useUiStore.getState().setPropagationScope("global");
  const n = selectN(useConfigStore.getState());
  useConfigStore.setState((s) => ({ config: { ...s.config, events: [{ id: "quake", label: "Quake", type: "hazard", frequency_per_10y: 0 }] } }));
  const canvas = useCanvasStore.getState();
  canvas.addCanvas({ id: "c1", label: "Main", graph: { graph_type: "generic", node_ids: [], edge_ids: [] } });
  canvas.upsertNode({ id: "a", label: "A", functionality: n, vulnerability_levels: { quake: 1 } });
  canvas.addNodeToCanvas("a", "c1");
  sim().loadFromProject([{
    id: "s",
    parameters: [],
    format: TEMPORAL_SIMULATION_FORMAT,
    standard_metrics: [...STANDARD_METRICS],
    scope: "global",
    timeline: { name: "t", steps: [{ label: "2023-01-01", unit: "day", repeat: 3, phases: [{ events: [{ event: "quake", every: 2 }], propagate: true }] }] },
    profile: {},
    metrics: [],
  }]);
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
    engine.mockImplementation(async (payload) => { cancelTemporalSimulationRun(); return unchanged(payload); });
    await startTemporalSimulationRun();
    expect(sim().running).toBe(false);
    expect(sim().runRecord).toBeNull();
    expect(sim().runError).toMatch(/^Cancelled — in period 2023-01-02/);
    expect(model()).toBe(before);
  });

  it("reports an engine refusal with its period", async () => {
    engine.mockImplementation(async (payload) => { if (engine.mock.calls.length === 3) throw new Error("Rate limit"); return unchanged(payload); });
    await startTemporalSimulationRun();
    expect(sim().runError).toMatch(/^Stopped: Rate limit — in period 2023-01-03/);
    expect(sim().running).toBe(false);
  });

  it("runs at the shared local scope on the active Canvas, and records it in the Simulation", async () => {
    useCanvasStore.getState().setActiveCanvas("c1");
    useUiStore.getState().setPropagationScope("local");
    await startTemporalSimulationRun();
    expect(engine.mock.calls.map(([p]) => [p.scope, p.active_canvas_id])).toEqual([["local", "c1"], ["local", "c1"], ["local", "c1"]]);
    expect([sim().scope, sim().canvas]).toEqual(["local", "c1"]);
  });

  it("refuses a Config Save while the run is shown, and no edit made after Run reaches the engine", async () => {
    const eventsAtStart = JSON.stringify(useConfigStore.getState().config.events);
    engine.mockImplementation(async (payload) => {
      if (engine.mock.calls.length === 1) {
        // The Config modal's Save: refused, the draft kept.
        const config = useConfigStore.getState();
        config.openDraft();
        config.updateEvent("quake", { label: "Edited" });
        expect(useConfigStore.getState().commitDraft()).toBe(false);
        expect(useConfigStore.getState().isDirty).toBe(true);
        // Any write that skipped the lock: the run already holds its own input.
        useConfigStore.setState((s) => ({ config: { ...s.config, events: [] } }));
        useUiStore.getState().setPropagationScope("local");
      }
      return unchanged(payload);
    });
    await startTemporalSimulationRun();
    expect(sim().runError).toBeNull();
    expect(engine.mock.calls.map(([p]) => [p.scope, JSON.stringify(p.config.events)])).toEqual(
      Array.from({ length: 3 }, () => ["global", eventsAtStart]),
    );
  });
});
