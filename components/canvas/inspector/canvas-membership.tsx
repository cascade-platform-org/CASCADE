"use client";

/**
 * inspector/canvas-membership.tsx — Canvas Membership section.
 *
 * Shared by NodeInspector (single node) and MultiSelectPanel (batch nodes).
 * Allows copying or moving nodes to another Canvas. Hidden when only one
 * Canvas exists.
 */

import { useState } from "react";
import { Copy, ArrowRight } from "lucide-react";
import { useCanvasStore, selectOrderedCanvases } from "@/store/canvas-store";
import { useNetworkStore } from "@/store/network-store";
import { useShallow } from "zustand/react/shallow";
import { Section, Field } from "./primitives";

export function CanvasMembershipSection({ nodeIds }: { nodeIds: string[] }) {
  const copyNodesToCanvas = useCanvasStore((s) => s.copyNodesToCanvas);
  const moveNodesToCanvas = useCanvasStore((s) => s.moveNodesToCanvas);
  const activeCanvasId = useCanvasStore((s) => s.activeCanvasId);
  const orderedCanvases = useCanvasStore(useShallow(selectOrderedCanvases));
  const clearSelection = useNetworkStore((s) => s.clearSelection);

  const [targetCanvasId, setTargetCanvasId] = useState("");
  const otherCanvases = orderedCanvases.filter((c) => c.id !== activeCanvasId);

  if (otherCanvases.length === 0) return null;

  return (
    <Section title="Canvas Membership">
      <p className="mb-2 text-[10px] leading-tight text-zinc-400">
        Copy keeps nodes in this canvas too. Move removes them from this canvas
        (edges crossing the boundary become inter-canvas edges).
      </p>
      <Field label="Target canvas">
        <select
          value={targetCanvasId}
          onChange={(e) => setTargetCanvasId(e.target.value)}
          className="w-full rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-800 focus:border-blue-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
        >
          <option value="">— select —</option>
          {otherCanvases.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label ?? c.id}
            </option>
          ))}
        </select>
      </Field>
      <div className="flex gap-2">
        <button
          disabled={!targetCanvasId}
          onClick={() => {
            if (!targetCanvasId) return;
            copyNodesToCanvas(nodeIds, targetCanvasId);
          }}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-blue-50 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-40 dark:bg-blue-900/20 dark:text-blue-300"
        >
          <Copy size={11} />
          Copy
        </button>
        <button
          disabled={!targetCanvasId || !activeCanvasId}
          onClick={() => {
            if (!targetCanvasId || !activeCanvasId) return;
            moveNodesToCanvas(nodeIds, activeCanvasId, targetCanvasId);
            clearSelection();
          }}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-violet-50 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-40 dark:bg-violet-900/20 dark:text-violet-300"
        >
          <ArrowRight size={11} />
          Move
        </button>
      </div>
    </Section>
  );
}
