"use client";

/**
 * Wired wrapper for InterCanvasEdgeDialog.
 *
 * Pulls store state (canvases, nodes, active canvas, selected source node),
 * and writes the resulting edge + update history entry on confirm.
 */

import { nanoid } from "nanoid";
import { InterCanvasEdgeDialog } from "./inter-canvas-edge-dialog";
import { useCanvasStore, selectActiveCanvas, selectOrderedCanvases } from "@/store/canvas-store";
import { useHistoryStore } from "@/store/history-store";
import { useNetworkStore } from "@/store/network-store";
import { useUiStore } from "@/store/ui-store";
import { useConfigStore, selectN } from "@/store/config-store";
import { useShallow } from "zustand/react/shallow";
import { pickHandles } from "@/lib/edge-routing";
import type { Edge } from "@/lib/schemas/network";

export function InterCanvasEdgeDialogWired() {
  const closeInterCanvasEdgeDialog = useUiStore((s) => s.closeInterCanvasEdgeDialog);
  const sourceNodeId = useUiStore((s) => s.interCanvasEdgeSourceNodeId);

  const activeCanvas = useCanvasStore(selectActiveCanvas);
  const canvases = useCanvasStore(useShallow(selectOrderedCanvases));
  const allNodes = useCanvasStore((s) => s.nodes);
  const upsertEdge = useCanvasStore((s) => s.upsertEdge);
  const addEdgeToCanvas = useCanvasStore((s) => s.addEdgeToCanvas);
  const toGraphSnapshot = useCanvasStore((s) => s.toGraphSnapshot);

  const selectedNodeIds = useNetworkStore((s) => s.selectedNodeIds);
  const n = useConfigStore(selectN);

  // Determine source node: prefer explicit sourceNodeId, else first selected node
  const resolvedSourceNodeId = sourceNodeId ?? [...selectedNodeIds][0] ?? null;
  const sourceNode = resolvedSourceNodeId ? allNodes[resolvedSourceNodeId] : null;

  // Need both an active canvas and a tail node to open this dialog meaningfully
  if (!activeCanvas || !sourceNode) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
          <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
            Select a tail node on the active canvas first, then open the inter-canvas edge dialog.
          </p>
          <button
            onClick={closeInterCanvasEdgeDialog}
            className="rounded bg-zinc-100 px-4 py-1.5 text-sm text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  function handleConfirm(targetCanvasId: string, targetNodeId: string) {
    const before = toGraphSnapshot();
    const targetNode = allNodes[targetNodeId];
    const { sourceHandle, targetHandle } = pickHandles(
      { position: sourceNode!.position ?? { x: 0, y: 0 } },
      { position: targetNode?.position ?? { x: 0, y: 0 } },
    );
    const edge: Edge = {
      id: `edge-${nanoid(8)}`,
      source: sourceNode!.id,
      target: targetNodeId,
      sourceHandle,
      targetHandle,
      functionality: n,
    };

    upsertEdge(edge);
    // Add edge to both canvases so it renders from either side (Fix 5)
    addEdgeToCanvas(edge.id, activeCanvas!.id);
    addEdgeToCanvas(edge.id, targetCanvasId);

    useHistoryStore.getState().pushUpdateEntry({
      id: nanoid(),
      timestamp: new Date().toISOString(),
      update_type: "graph_update",
      label: "Add inter-canvas edge",
      canvas_id: activeCanvas!.id,
      before,
      after: toGraphSnapshot(),
    });

    closeInterCanvasEdgeDialog();
  }

  return (
    <InterCanvasEdgeDialog
      tailCanvas={activeCanvas}
      tailNode={sourceNode}
      allCanvases={canvases}
      nodeRegistry={allNodes}
      onConfirm={handleConfirm}
      onCancel={closeInterCanvasEdgeDialog}
    />
  );
}
