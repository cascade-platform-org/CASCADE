"use client";

/**
 * Wired wrapper for InterCanvasEdgeDialog.
 *
 * Pulls store state (canvases, nodes, active canvas, selected source node)
 * and delegates confirm to canvas-store.addInterCanvasEdge — the store owns
 * edge creation + history; this wrapper is pure UI wiring.
 */

import { InterCanvasEdgeDialog } from "./inter-canvas-edge-dialog";
import { useCanvasStore, selectActiveCanvas, selectOrderedCanvases } from "@/store/canvas-store";
import { useNetworkStore } from "@/store/network-store";
import { useUiStore } from "@/store/ui-store";
import { useConfigStore, selectN } from "@/store/config-store";
import { useShallow } from "zustand/react/shallow";

export function InterCanvasEdgeDialogWired() {
  const closeInterCanvasEdgeDialog = useUiStore((s) => s.closeInterCanvasEdgeDialog);
  const sourceNodeId = useUiStore((s) => s.interCanvasEdgeSourceNodeId);

  const activeCanvas = useCanvasStore(selectActiveCanvas);
  const canvases = useCanvasStore(useShallow(selectOrderedCanvases));
  const allNodes = useCanvasStore((s) => s.nodes);
  const allEdges = useCanvasStore((s) => s.edges);
  const addInterCanvasEdge = useCanvasStore((s) => s.addInterCanvasEdge);

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
    addInterCanvasEdge({
      sourceNodeId: sourceNode!.id,
      sourceCanvasId: activeCanvas!.id,
      targetNodeId,
      targetCanvasId,
      functionality: n,
    });
    closeInterCanvasEdgeDialog();
  }

  const existingEdges = Object.values(allEdges).map((e) => ({
    source: e.source,
    target: e.target,
  }));

  return (
    <InterCanvasEdgeDialog
      tailCanvas={activeCanvas}
      tailNode={sourceNode}
      allCanvases={canvases}
      nodeRegistry={allNodes}
      existingEdges={existingEdges}
      onConfirm={handleConfirm}
      onCancel={closeInterCanvasEdgeDialog}
    />
  );
}
