/**
 * ephemeral-propagation.ts
 *
 * Runs a Propagation against the engine WITHOUT touching any Zustand store.
 * Used by the Save-to-Scorecard dialog and the Scorecard gap-detection panel
 * to compute `after_propagation` snapshots without side effects on the live canvas.
 */

import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore } from "@/store/config-store";
import { useUiStore } from "@/store/ui-store";
import { applyCoalition } from "@/lib/coalition";
import { buildPropagationPayload } from "@/lib/propagation-payload";
import { postPropagate, postPropagateBatch } from "@/lib/api-client";
import { mergeUpdatesIntoSnapshot } from "@/lib/element-update";
import type { GraphSnapshot } from "@/lib/schemas/network";

/**
 * Send `snapshot` to the engine and return the post-propagation snapshot.
 * Writes nothing to any store — all side effects are contained to local state.
 */
export async function runEphemeralPropagation(snapshot: GraphSnapshot): Promise<GraphSnapshot> {
  const canvasState = useCanvasStore.getState();
  const config = useConfigStore.getState().config;
  const scope = useUiStore.getState().propagationScope;
  const activeCanvasId = canvasState.activeCanvasId;

  const project = canvasState.toProject();
  const snapshotProject = {
    ...project,
    nodes: snapshot.nodes,
    edges: snapshot.edges,
    update_history: [],
    scorecard: [],
  };

  const payload = buildPropagationPayload({
    project: snapshotProject,
    config,
    scope,
    activeCanvasId,
  });

  const result = await postPropagate(payload);
  return mergeUpdatesIntoSnapshot(snapshot, result.updates);
}

/**
 * Send one snapshot and many coalitions in a single request; return the
 * post-propagation snapshot for each, in order.
 *
 * The single-Scenario twin above builds one payload per call. Here the payload
 * is built once and the server applies each coalition, which is the whole point
 * — a model-based Analysis run was re-sending an unchanged Project hundreds of
 * times. Writes nothing to any store, exactly like `runEphemeralPropagation`.
 */
export async function runEphemeralPropagationBatch(
  snapshot: GraphSnapshot,
  coalitions: string[][],
): Promise<GraphSnapshot[]> {
  const canvasState = useCanvasStore.getState();
  const config = useConfigStore.getState().config;
  const scope = useUiStore.getState().propagationScope;

  const project = canvasState.toProject();
  const single = buildPropagationPayload({
    project: {
      ...project,
      nodes: snapshot.nodes,
      edges: snapshot.edges,
      update_history: [],
      scorecard: [],
    },
    config,
    scope,
    activeCanvasId: canvasState.activeCanvasId,
  });

  const results = await postPropagateBatch({ ...single, coalitions });

  // Each result is the propagation of `snapshot` with that coalition failed. The
  // failed Elements themselves are re-applied here because the engine reports
  // only what IT changed, and an Element the coalition drove to 1 that nothing
  // cascaded into would otherwise come back at its authored Functionality.
  return results.map((result, i) =>
    mergeUpdatesIntoSnapshot(applyCoalition(snapshot, coalitions[i] ?? []), result.updates),
  );
}
