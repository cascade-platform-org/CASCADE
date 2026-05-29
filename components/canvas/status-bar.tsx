"use client";

/**
 * StatusBar — bottom strip.
 * [node/edge count] [Rules: N active ↗] [Zoom 85%] [● unsaved] [scope]
 */

import { useShallow } from "zustand/react/shallow";
import { useCanvasStore, selectActiveCanvas, selectActiveNodes, selectActiveEdges } from "@/store/canvas-store";
import { useUiStore } from "@/store/ui-store";

export function StatusBar() {
  const activeCanvas = useCanvasStore(selectActiveCanvas);
  const nodes = useCanvasStore(useShallow(selectActiveNodes));
  const edges = useCanvasStore(useShallow(selectActiveEdges));
  const scope = useUiStore((s) => s.propagationScope);
  const propagationWarnings = useUiStore((s) => s.propagationWarnings);
  const toggleActiveRulesPanel = useUiStore((s) => s.toggleActiveRulesPanel);

  const nodeCount = nodes.length;
  const edgeCount = edges.length;

  // Rule count — count all rules across active canvas elements
  const ruleCount = [
    ...nodes.flatMap((n) => n.rules ?? []),
    ...edges.flatMap((e) => e.rules ?? []),
  ].length;

  return (
    <div className="flex h-7 shrink-0 items-center gap-4 border-t border-zinc-200 bg-white px-4 text-xs text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900">
      {activeCanvas && (
        <span className="font-mono">
          {nodeCount} {nodeCount === 1 ? "node" : "nodes"} · {edgeCount} {edgeCount === 1 ? "edge" : "edges"}
        </span>
      )}

      <button
        onClick={toggleActiveRulesPanel}
        className="hover:text-zinc-600 dark:hover:text-zinc-300"
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
