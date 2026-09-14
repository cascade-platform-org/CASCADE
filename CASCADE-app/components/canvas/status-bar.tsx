"use client";

/**
 * StatusBar — bottom strip.
 * [node/edge count] [Rules: N active ↗] [● unsaved] [scope]
 *
 * In global view: counts across the full registry (all canvases).
 * In per-canvas view: counts for the active canvas only.
 */

import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { cn } from "@/lib/utils";
import { RULES_ANCHOR_ID } from "@/lib/ui-anchors";
import { useCanvasStore, selectActiveCanvas, selectActiveNodes, selectActiveEdges } from "@/store/canvas-store";
import { useUiStore } from "@/store/ui-store";

export function StatusBar() {
  const globalViewActive = useUiStore((s) => s.globalViewActive);
  const activeCanvas = useCanvasStore(selectActiveCanvas);
  const nodes = useCanvasStore(useShallow(selectActiveNodes));
  const edges = useCanvasStore(useShallow(selectActiveEdges));

  // Global registry — used when global view is active.
  const allNodes = useCanvasStore(useShallow((s) => Object.values(s.nodes)));
  const allEdges = useCanvasStore(useShallow((s) => Object.values(s.edges)));

  const scope = useUiStore((s) => s.propagationScope);
  const propagationWarnings = useUiStore((s) => s.propagationWarnings);
  const toggleActiveRulesPanel = useUiStore((s) => s.toggleActiveRulesPanel);
  const rulesAnchorFlash = useUiStore((s) => s.rulesAnchorFlash);

  // The Active Rules panel animates back into this control when it closes.
  // The flash is the end of that sentence: the eye follows the panel here,
  // and then this lights up, so the way to reopen it is learned once rather
  // than hunted for.
  useEffect(() => {
    if (!rulesAnchorFlash) return;
    const t = setTimeout(() => useUiStore.getState().clearRulesAnchorFlash(), 1400);
    return () => clearTimeout(t);
  }, [rulesAnchorFlash]);

  const displayNodes = globalViewActive ? allNodes : nodes;
  const displayEdges = globalViewActive ? allEdges : edges;

  const nodeCount = displayNodes.length;
  const edgeCount = displayEdges.length;

  const ruleCount = [
    ...displayNodes.flatMap((n) => n.rules ?? []),
    ...displayEdges.flatMap((e) => e.rules ?? []),
  ].length;

  const showCounts = globalViewActive || !!activeCanvas;

  return (
    <div className="flex h-7 shrink-0 items-center gap-4 border-t border-zinc-200 bg-white px-4 text-xs text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900">
      {showCounts && (
        <span className="font-mono">
          {nodeCount} {nodeCount === 1 ? "node" : "nodes"} · {edgeCount} {edgeCount === 1 ? "edge" : "edges"}
          {globalViewActive && " (all canvases)"}
        </span>
      )}

      <button
        id={RULES_ANCHOR_ID}
        data-tour="rules"
        onClick={toggleActiveRulesPanel}
        className={cn(
          "rounded px-1 transition-colors duration-300 hover:text-zinc-600 dark:hover:text-zinc-300",
          rulesAnchorFlash &&
            "bg-blue-100 text-blue-700 ring-2 ring-blue-400 dark:bg-blue-900/40 dark:text-blue-300",
        )}
      >
        Rules: {ruleCount} active ↗
      </button>

      {propagationWarnings.length > 0 && (
        <span className="ml-auto text-amber-500" title={propagationWarnings.join("\n")}>
          ⚠ Propagation incomplete
        </span>
      )}

      <span className={propagationWarnings.length > 0 ? "capitalize" : "ml-auto capitalize"}>
        {scope}
      </span>
    </div>
  );
}
