/**
 * propagation-call — the one way the app calls the engine, with only the HTTP
 * call replaced. The Propagate button's path (`commitPropagation`) was a React
 * hook before, which no test reached; these go through it as the button does.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PropagationRequest } from "@/lib/schemas/api";
import type { PropagationResult } from "@/lib/schemas/propagation";

const engine = vi.fn(async (payload: PropagationRequest): Promise<PropagationResult> => ({
  updates: [{ id: "a", functionality: 1 }],
  warnings: [], scope: payload.scope, iterations: 1, computed_at: "2026-01-01T00:00:00Z", served_ratio: {}, stored: {},
}));
vi.mock(import("@/lib/api-client"), async (importOriginal) => ({
  ...(await importOriginal()),
  postPropagate: (payload: PropagationRequest) => engine(payload),
}));

const { useCanvasStore } = await import("@/store/canvas-store");
const { useConfigStore, selectN } = await import("@/store/config-store");
const { useHistoryStore } = await import("@/store/history-store");
const { useUiStore } = await import("@/store/ui-store");
const { useAuthStore } = await import("@/store/auth-store");
const { commitPropagation, propagateSnapshot, propagationContext, resolveScope } = await import("./propagation-call");

beforeEach(() => {
  engine.mockClear();
  useCanvasStore.getState().reset();
  useHistoryStore.getState().loadHistory([]);
  useUiStore.setState({ serverReachable: true, isPropagating: false, propagationScope: "global" });
  useAuthStore.setState({ mode: "local", authEnabled: false });
  const canvas = useCanvasStore.getState();
  canvas.addCanvas({ id: "c1", label: "Main", graph: { graph_type: "generic", node_ids: [], edge_ids: [] } });
  canvas.upsertNode({ id: "a", label: "A", functionality: selectN(useConfigStore.getState()) });
  canvas.addNodeToCanvas("a", "c1");
  canvas.setActiveCanvas("c1");
});

describe("resolveScope", () => {
  it("is local only with a Canvas to trim to", () => {
    expect(resolveScope("local", "c1")).toEqual({ scope: "local", canvasId: "c1" });
    expect(resolveScope("local", null)).toEqual({ scope: "global", canvasId: null });
    expect(resolveScope("global", "c1")).toEqual({ scope: "global", canvasId: "c1" });
  });
});

describe("commitPropagation — the Propagate button", () => {
  it("writes the result as one undoable `propagation` Update at the shared scope", async () => {
    useUiStore.getState().setPropagationScope("local");
    const outcome = await commitPropagation();
    expect(outcome).toEqual({ status: "done", scope: "local", updated: 1, warnings: [] });
    expect(engine.mock.calls[0]?.[0]).toMatchObject({ scope: "local", active_canvas_id: "c1" });
    expect(useCanvasStore.getState().nodes.a?.functionality).toBe(1);
    const [entry] = useHistoryStore.getState().updateHistory;
    expect(entry).toMatchObject({ update_type: "propagation", scope: "local" });
    expect(useUiStore.getState().isPropagating).toBe(false);
  });

  it("refuses without calling the engine when the account may not propagate, or the server is away", async () => {
    useAuthStore.setState({ mode: "guest" });
    expect((await commitPropagation()).status).toBe("refused");
    useAuthStore.setState({ mode: "local" });
    useUiStore.setState({ serverReachable: false });
    expect(await commitPropagation()).toEqual({ status: "refused", message: expect.stringMatching(/^Server unreachable/) });
    expect(engine).not.toHaveBeenCalled();
    expect(useHistoryStore.getState().updateHistory).toHaveLength(0);
  });

  it("reports an engine failure and writes nothing", async () => {
    engine.mockRejectedValueOnce(new Error("Rate limit"));
    expect(await commitPropagation()).toEqual({ status: "failed", message: "Propagation failed — Rate limit" });
    expect(useCanvasStore.getState().nodes.a?.functionality).toBe(selectN(useConfigStore.getState()));
    expect(useUiStore.getState().isPropagating).toBe(false);
  });
});

describe("propagateSnapshot", () => {
  it("sends the captured context, whatever the stores hold by the time it is called, and writes no store", async () => {
    const ctx = propagationContext();
    const snapshot = useCanvasStore.getState().toGraphSnapshot();
    useConfigStore.setState((s) => ({ config: { ...s.config, events: [{ id: "late", label: "Late", type: "hazard", frequency_per_10y: 0 }] } }));
    useUiStore.getState().setPropagationScope("local");
    const { snapshot: after } = await propagateSnapshot(snapshot, ctx);
    expect(engine.mock.calls[0]?.[0]).toMatchObject({ scope: "global", config: { events: ctx.config.events } });
    expect(after.nodes.a?.functionality).toBe(1);
    expect(useCanvasStore.getState().nodes.a?.functionality).toBe(selectN(useConfigStore.getState()));
  });
});
