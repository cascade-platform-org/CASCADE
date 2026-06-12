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
import { buildPropagationPayload } from "@/lib/propagation-payload";
import { postPropagate } from "@/lib/api-client";
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
