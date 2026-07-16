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

/**
 * Drop `source_inp_content` (the embedded original .inp text) from canvases
 * whose graph_type is not "epanet" — only the live-EPANET solve path reads it
 * (ADR-0013); for a normal engine run it is dead weight in the request body.
 */
function stripUnusedInpContent(canvas: Canvas): Canvas {
  if (canvas.graph.graph_type === "epanet" || canvas.source_inp_content === undefined) {
    return canvas;
  }
  const { source_inp_content: _unused, ...rest } = canvas;
  return rest;
}

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
    // Full registry, but NOT the bookkeeping: update_history entries each
    // carry two whole GraphSnapshots and scorecard entries embed base64 PNGs
    // — sending them can push the body past the edge's 10MB cap (Caddy 413)
    // while the engine reads neither.
    return {
      project: {
        ...project,
        canvases: project.canvases.map(stripUnusedInpContent),
        update_history: [],
        scorecard: [],
      },
      config,
      scope,
      active_canvas_id: activeCanvasId ?? undefined,
    };
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

  const trimmedCanvas: Canvas = stripUnusedInpContent({
    ...activeCanvas,
    graph: {
      ...activeCanvas.graph,
      node_ids: [...activeNodeIds],
      edge_ids: activeEdgeIds,
    },
  });

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
