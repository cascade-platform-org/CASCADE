/**
 * buildPropagationPayload — assembles the PropagationRequest to send to
 * POST /api/propagate.
 *
 * Scope contract (CONTEXT.md):
 *   Local  — payload contains ONLY the active Canvas's nodes and the edges
 *            whose both endpoints are within that Canvas. Inter-canvas edges
 *            are physically absent from the payload; the engine never sees them.
 *   Global — payload is the full Project unchanged.
 *
 * The returned Project is a structural copy — the original store state is not
 * mutated.
 */

import type { Project, Canvas } from "@/lib/schemas/network";
import type { ModelConfiguration } from "@/lib/schemas/config";
import type { PropagationRequest } from "@/lib/schemas/api";

export function buildPropagationPayload({
  project,
  config,
  scope,
  activeCanvasId,
}: {
  project: Project;
  config: ModelConfiguration;
  scope: "local" | "global";
  activeCanvasId: string | null;
}): PropagationRequest {
  if (scope === "global") {
    return { project, config, scope, active_canvas_id: activeCanvasId ?? undefined };
  }

  if (!activeCanvasId) {
    throw new Error("Local propagation requires an active canvas.");
  }

  const activeCanvas = project.canvases.find((c) => c.id === activeCanvasId);
  if (!activeCanvas) {
    throw new Error(`Active canvas '${activeCanvasId}' not found in project.`);
  }

  const activeNodeIds = new Set(activeCanvas.graph.node_ids);

  // Include only edges whose both endpoints are within the active canvas.
  const activeEdgeIds = activeCanvas.graph.edge_ids.filter((eid) => {
    const edge = project.edges[eid];
    return edge && activeNodeIds.has(edge.source) && activeNodeIds.has(edge.target);
  });

  const trimmedNodes: Project["nodes"] = {};
  for (const id of activeNodeIds) {
    if (project.nodes[id]) trimmedNodes[id] = project.nodes[id];
  }

  const trimmedEdges: Project["edges"] = {};
  for (const id of activeEdgeIds) {
    trimmedEdges[id] = project.edges[id];
  }

  const trimmedCanvas: Canvas = {
    ...activeCanvas,
    graph: {
      ...activeCanvas.graph,
      node_ids: [...activeNodeIds],
      edge_ids: activeEdgeIds,
    },
  };

  const trimmedProject: Project = {
    ...project,
    nodes: trimmedNodes,
    edges: trimmedEdges,
    canvases: [trimmedCanvas],
    // update_history and scorecard are not needed by the engine
    update_history: [],
    scorecard: [],
  };

  return {
    project: trimmedProject,
    config,
    scope,
    active_canvas_id: activeCanvasId,
  };
}
