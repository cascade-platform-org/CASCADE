/**
 * network-utils.ts — Shared imperative helpers that operate on Zustand store state.
 *
 * These functions call getState() directly and are safe to call outside React
 * render cycles (event handlers, async callbacks, etc.).
 */

import { nanoid } from "nanoid";
import { useCanvasStore } from "@/store/canvas-store";
import { useHistoryStore } from "@/store/history-store";
import type { PropagationScope } from "@/store/ui-store";

// ---------------------------------------------------------------------------
// Reset functionality
// ---------------------------------------------------------------------------

/**
 * Resets Functionality, direct_damage, and functionality_time to baseline on
 * either the active canvas (local) or all elements (global).
 *
 * When `globalViewActive` is true the reset is always global regardless of scope,
 * because "All" is a full-project context.
 */
export function resetFunctionality({
  n,
  scope,
  globalViewActive,
}: {
  n: number;
  scope: PropagationScope;
  globalViewActive: boolean;
}): void {
  const state = useCanvasStore.getState();
  const activeCanvasId = state.activeCanvasId;
  const isGlobal = globalViewActive || scope === "global";

  if (!isGlobal && !activeCanvasId) return;

  const before = state.toGraphSnapshot();

  if (isGlobal) {
    Object.values(state.nodes).forEach((node) => {
      state.updateNode(node.id, { functionality: n, direct_damage: false, functionality_time: 0, responsibility_share: undefined });
    });
    Object.values(state.edges).forEach((edge) => {
      state.updateEdge(edge.id, { functionality: n, direct_damage: false, functionality_time: 0, responsibility_share: undefined });
    });
  } else {
    const canvas = state.canvases[activeCanvasId!];
    if (!canvas) return;
    canvas.graph.node_ids.forEach((id) => {
      state.updateNode(id, { functionality: n, direct_damage: false, functionality_time: 0, responsibility_share: undefined });
    });
    canvas.graph.edge_ids.forEach((id) => {
      state.updateEdge(id, { functionality: n, direct_damage: false, functionality_time: 0, responsibility_share: undefined });
    });
  }

  useHistoryStore.getState().pushUpdateEntry({
    id: nanoid(),
    timestamp: new Date().toISOString(),
    update_type: "manual_functionality_update",
    label: isGlobal ? "Reset all to Functionality N" : "Reset canvas to Functionality N",
    scope: isGlobal ? "global" : "local",
    canvas_id: isGlobal ? undefined : activeCanvasId ?? undefined,
    before,
    after: useCanvasStore.getState().toGraphSnapshot(),
  });
}
