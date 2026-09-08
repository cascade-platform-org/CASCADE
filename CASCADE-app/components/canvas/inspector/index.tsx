"use client";

/**
 * inspector/index.tsx — Inspector root: thin dispatch wrapper.
 *
 * Reads selection state and routes to the appropriate sub-panel:
 *   - Single node selected  → NodeInspector
 *   - Single edge selected  → EdgeInspector
 *   - Multi-select          → MultiSelectPanel
 *   - Global view, nothing  → AllCanvasesMeta
 *   - Canvas, nothing       → CanvasMeta
 *
 * All store subscriptions in this file are routing-only. The sub-panels own
 * their own store subscriptions, keeping this module a trivially thin router.
 */

import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCanvasStore } from "@/store/canvas-store";
import { useNetworkStore } from "@/store/network-store";
import { useUiStore } from "@/store/ui-store";
import { useHistoryAction } from "@/hooks/useHistoryAction";
import { NodeInspector } from "./node-inspector";
import { EdgeInspector } from "./edge-inspector";
import { MultiSelectPanel } from "./multi-select-panel";
import { CanvasMeta, AllCanvasesMeta } from "./canvas-meta";

export function Inspector() {
  const inspectorOpen = useUiStore((s) => s.inspectorOpen);
  const globalViewActive = useUiStore((s) => s.globalViewActive);
  const historyAction = useHistoryAction();

  const selectedNodeIds = useNetworkStore((s) => s.selectedNodeIds);
  const selectedEdgeIds = useNetworkStore((s) => s.selectedEdgeIds);

  const allNodes = useCanvasStore((s) => s.nodes);
  const allEdges = useCanvasStore((s) => s.edges);

  const nodeIdArr = [...selectedNodeIds];
  const edgeIdArr = [...selectedEdgeIds];
  const totalSelected = nodeIdArr.length + edgeIdArr.length;

  const singleNode =
    totalSelected === 1 && nodeIdArr.length === 1 ? allNodes[nodeIdArr[0]] : null;
  const singleEdge =
    totalSelected === 1 && edgeIdArr.length === 1 ? allEdges[edgeIdArr[0]] : null;
  const isMulti = totalSelected > 1;

  function handleDeleteSelected() {
    if (!singleNode && !singleEdge) return;
    const s = useCanvasStore.getState();
    const label = singleNode
      ? `Delete node "${singleNode.label ?? singleNode.id}"`
      : "Delete edge";
    historyAction(
      () => {
        if (singleNode) s.removeNode(singleNode.id);
        else if (singleEdge) s.removeEdge(singleEdge.id);
      },
      label,
      "graph_update",
    );
    useNetworkStore.getState().clearSelection();
    useUiStore.getState().setInspectorOpen(false);
  }

  const headerLabel = singleNode
    ? "Node"
    : singleEdge
    ? "Edge"
    : isMulti
    ? "Selection"
    : "Canvas";

  const canDelete = !!(singleNode || singleEdge);

  return (
    <div
      data-tour="inspector"
      className={cn(
        "flex shrink-0 flex-col border-l border-zinc-200 bg-white transition-all dark:border-zinc-800 dark:bg-zinc-900",
        inspectorOpen ? "w-80" : "w-0 overflow-hidden",
      )}
    >
      {inspectorOpen && (
        <>
          <div className="flex h-10 shrink-0 items-center justify-between border-b border-zinc-100 px-4 dark:border-zinc-800">
            <span className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
              {headerLabel}
            </span>
            {canDelete && (
              <button
                onClick={handleDeleteSelected}
                title={`Delete ${headerLabel.toLowerCase()}`}
                className="rounded p-1 text-zinc-300 transition-colors hover:bg-red-50 hover:text-red-500 dark:text-zinc-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>

          {singleNode ? (
            <NodeInspector key={singleNode.id} node={singleNode} />
          ) : singleEdge ? (
            <EdgeInspector key={singleEdge.id} edge={singleEdge} />
          ) : isMulti ? (
            <MultiSelectPanel
              key={
                [...nodeIdArr].sort().join(",") + "|" + [...edgeIdArr].sort().join(",")
              }
              nodeIds={nodeIdArr}
              edgeIds={edgeIdArr}
            />
          ) : globalViewActive ? (
            <AllCanvasesMeta />
          ) : (
            <CanvasMeta />
          )}
        </>
      )}
    </div>
  );
}
