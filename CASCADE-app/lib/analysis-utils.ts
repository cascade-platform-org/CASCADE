/**
 * analysis-utils.ts — store-aware helpers for analysis section components.
 *
 * Kept separate from topological-analysis.ts which is pure (no store access).
 */

import { useCanvasStore } from "@/store/canvas-store";
import type { AnalysisGraph } from "@/lib/topological-analysis";

/**
 * Build an AnalysisGraph scoped to the active canvas (local) or all canvases (global).
 * Reads from the Zustand store imperatively — call inside event handlers, not during render.
 */
export function buildScopedGraph(
  scope: "local" | "global",
  activeCanvasId: string | null,
): AnalysisGraph {
  const state = useCanvasStore.getState();
  if (scope === "global") {
    return { nodes: state.nodes, edges: state.edges, canvases: Object.values(state.canvases) };
  }
  const canvas = activeCanvasId ? state.canvases[activeCanvasId] : null;
  if (!canvas) return { nodes: state.nodes, edges: state.edges, canvases: Object.values(state.canvases) };
  return {
    nodes: Object.fromEntries(
      canvas.graph.node_ids.filter((id) => id in state.nodes).map((id) => [id, state.nodes[id]]),
    ),
    edges: Object.fromEntries(
      canvas.graph.edge_ids.filter((id) => id in state.edges).map((id) => [id, state.edges[id]]),
    ),
    canvases: Object.values(state.canvases),
  };
}
