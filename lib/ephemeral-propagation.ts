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
import { PropagationResultSchema } from "@/lib/schemas/api";
import type { ElementUpdate } from "@/lib/schemas/api";
import type { GraphSnapshot } from "@/lib/schemas/network";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/** Apply ElementUpdate[] onto a GraphSnapshot copy. Pure — does not mutate input. */
export function mergeUpdatesIntoSnapshot(
  snapshot: GraphSnapshot,
  updates: ElementUpdate[],
): GraphSnapshot {
  const nodes = { ...snapshot.nodes };
  const edges = { ...snapshot.edges };
  for (const u of updates) {
    if (nodes[u.id]) {
      nodes[u.id] = {
        ...nodes[u.id],
        functionality: u.functionality,
        ...(u.functionality_time !== undefined ? { functionality_time: u.functionality_time } : {}),
        ...(u.direct_damage !== undefined ? { direct_damage: u.direct_damage } : {}),
        ...(u.expected_repair_time !== undefined ? { expected_repair_time: u.expected_repair_time } : {}),
      };
    } else if (edges[u.id]) {
      edges[u.id] = {
        ...edges[u.id],
        functionality: u.functionality,
        ...(u.functionality_time !== undefined ? { functionality_time: u.functionality_time } : {}),
        ...(u.direct_damage !== undefined ? { direct_damage: u.direct_damage } : {}),
        ...(u.expected_repair_time !== undefined ? { expected_repair_time: u.expected_repair_time } : {}),
      };
    }
  }
  return { ...snapshot, nodes, edges };
}

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

  const response = await fetch(`${API_BASE}/api/propagate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(`Server returned ${response.status}: ${detail}`);
  }

  const raw = await response.json();
  const result = PropagationResultSchema.parse(raw);
  return mergeUpdatesIntoSnapshot(snapshot, result.updates);
}
