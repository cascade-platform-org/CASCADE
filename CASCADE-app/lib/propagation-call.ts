/**
 * propagation-call.ts — the one way the app asks the engine for a Propagation.
 *
 * A Propagation reads two things: the Scenario's Elements (a GraphSnapshot), and
 * everything else — the project's Canvases, the Model Configuration, the scope,
 * and the Canvas a local scope trims to. That second part is the **Propagation
 * Context**. `propagationContext()` reads it from the stores, once; every call
 * below takes it as an argument. A caller that propagates many times — a
 * Temporal Simulation run, Compare, a model-based Analysis — captures it at its
 * start, so an edit made meanwhile (the Config modal, the canvas) cannot change
 * what the engine sees halfway through. Before, each call re-read the live
 * stores, and a Save in the Config modal mid-run changed the run's input.
 *
 * Only `commitPropagation` — the Propagate button — writes a store, and it
 * records its Update through lib/run-with-history.ts like every other Update.
 * Everything else returns a new snapshot and leaves the stores alone.
 */

import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore } from "@/store/config-store";
import { useUiStore } from "@/store/ui-store";
import { useAuthStore } from "@/store/auth-store";
import { applyCoalition } from "@/lib/coalition";
import { buildPropagationPayload } from "@/lib/propagation-payload";
import { postPropagate, postPropagateBatch } from "@/lib/api-client";
import { mergeUpdatesIntoSnapshot } from "@/lib/element-update";
import { runWithHistory } from "@/lib/run-with-history";
import type { GraphSnapshot, Project } from "@/lib/schemas/network";
import type { ModelConfiguration } from "@/lib/schemas/config";
import type { PropagationRequest } from "@/lib/schemas/api";
import type { PropagationScope } from "@/lib/schemas/primitives";
import type { Propagated } from "@/lib/step-operator";

/** Everything a Propagation reads besides the Scenario's Elements, fixed when captured. */
export interface PropagationContext {
  /** The project as captured; each call replaces its nodes and edges with the Scenario's. */
  project: Project;
  config: ModelConfiguration;
  scope: PropagationScope;
  /** The Canvas a local scope trims to; sent with a global scope too, as the engine has always received it. */
  canvasId: string | null;
}

/**
 * The scope a Propagation actually runs at. Local needs a Canvas to trim to; a
 * project with no Canvas yet has no active one, and then the run is global —
 * the same answer Propagate, Simulate and Compare give.
 */
export function resolveScope(
  shared: PropagationScope,
  activeCanvasId: string | null,
): { scope: PropagationScope; canvasId: string | null } {
  return { scope: shared === "local" && activeCanvasId ? "local" : "global", canvasId: activeCanvasId };
}

/** Read the Propagation Context from the stores now, at the shared scope (the Action Bar's picker). */
export function propagationContext(): PropagationContext {
  const canvas = useCanvasStore.getState();
  return {
    project: canvas.toProject(),
    config: useConfigStore.getState().config,
    ...resolveScope(useUiStore.getState().propagationScope, canvas.activeCanvasId),
  };
}

/**
 * Why a Propagation cannot run, or null when it can: the one rule every
 * Propagate, Run, Compare and Analyse control is disabled by. The backend
 * enforces `can_propagate` too; this is so the control says why first.
 */
export function propagationBlocked(state: { serverReachable: boolean; canPropagate: boolean }): string | null {
  if (!state.serverReachable) return "Server unreachable — your data is safe locally";
  if (!state.canPropagate) return "Running the propagation engine requires an account. Sign in to continue.";
  return null;
}

function payloadFor(ctx: PropagationContext, scenario: Pick<GraphSnapshot, "nodes" | "edges">): PropagationRequest {
  return buildPropagationPayload({
    project: { ...ctx.project, nodes: scenario.nodes, edges: scenario.edges },
    config: ctx.config,
    scope: ctx.scope,
    activeCanvasId: ctx.canvasId,
  });
}

/**
 * Propagate `snapshot` and return the post-Propagation snapshot with what the
 * Propagation delivered (`served_ratio`, `stored`, which a Temporal Simulation
 * integrates its Stocks from, ADR-0020). Writes no store. Without a context,
 * the stores are read now.
 */
export async function propagateSnapshot(
  snapshot: GraphSnapshot,
  ctx: PropagationContext = propagationContext(),
): Promise<Propagated> {
  const result = await postPropagate(payloadFor(ctx, snapshot));
  return {
    snapshot: mergeUpdatesIntoSnapshot(snapshot, result.updates),
    flow: { served_ratio: result.served_ratio, stored: result.stored },
  };
}

/**
 * Propagate one snapshot under many coalitions in a single request; return the
 * post-Propagation snapshot for each, in order. The payload is built once and
 * the server applies each coalition — a model-based Analysis would otherwise
 * re-send an unchanged Project hundreds of times. Writes no store.
 */
export async function propagateBatch(
  snapshot: GraphSnapshot,
  coalitions: string[][],
  ctx: PropagationContext = propagationContext(),
): Promise<GraphSnapshot[]> {
  const results = await postPropagateBatch({ ...payloadFor(ctx, snapshot), coalitions });
  // Each result is the propagation of `snapshot` with that coalition failed. The
  // failed Elements themselves are re-applied here because the engine reports
  // only what IT changed, and an Element the coalition drove to 1 that nothing
  // cascaded into would otherwise come back at its authored Functionality.
  return results.map((result, i) =>
    mergeUpdatesIntoSnapshot(applyCoalition(snapshot, coalitions[i] ?? []), result.updates),
  );
}

export type CommitOutcome =
  | { status: "done"; scope: PropagationScope; updated: number; warnings: string[] }
  | { status: "busy" }
  | { status: "refused"; message: string }
  | { status: "failed"; message: string };

/**
 * The Propagate button: propagate the live Scenario and write the result into
 * the model as one `propagation` Update, so its Graph Diff is built like every
 * other Update's and the Scenario Baseline tags these writes `propagation` for
 * Reset and Clear Event (ADR-0016). Says what happened; the caller words it.
 */
export async function commitPropagation(): Promise<CommitOutcome> {
  const ui = useUiStore.getState();
  if (ui.isPropagating) return { status: "busy" };
  const blocked = propagationBlocked({
    serverReachable: ui.serverReachable,
    canPropagate: useAuthStore.getState().hasPermission("can_propagate"),
  });
  if (blocked) return { status: "refused", message: blocked };

  const ctx = propagationContext();
  let payload: PropagationRequest;
  try {
    payload = payloadFor(ctx, ctx.project);
  } catch (err) {
    return { status: "failed", message: `Cannot propagate: ${err instanceof Error ? err.message : String(err)}` };
  }

  ui.setIsPropagating(true);
  try {
    const result = await postPropagate(payload);
    runWithHistory(
      () => useCanvasStore.getState().applyPropagationResult(result),
      `Propagation (${ctx.scope})`,
      { updateType: "propagation", scope: ctx.scope, canvasId: ctx.canvasId },
    );
    return { status: "done", scope: ctx.scope, updated: result.updates.length, warnings: result.warnings ?? [] };
  } catch (err) {
    return { status: "failed", message: `Propagation failed — ${err instanceof Error ? err.message : "unexpected error"}` };
  } finally {
    useUiStore.getState().setIsPropagating(false);
  }
}
