"use client";

/**
 * Active Rules Panel (F8) — read-only list of all rules in the active Canvas.
 * Opened from the Status Bar "Rules: N active ↗" button.
 */

import { X, CheckCircle2, AlertCircle } from "lucide-react";
import { useCanvasStore, selectActiveCanvas, selectActiveNodes, selectActiveEdges } from "@/store/canvas-store";
import { useUiStore } from "@/store/ui-store";
import { useNetworkStore } from "@/store/network-store";
import { useShallow } from "zustand/react/shallow";

export function ActiveRulesPanel() {
  const closeActiveRulesPanel = useUiStore((s) => s.closeActiveRulesPanel);
  const activeCanvas = useCanvasStore(selectActiveCanvas);
  const nodes = useCanvasStore(useShallow(selectActiveNodes));
  const edges = useCanvasStore(useShallow(selectActiveEdges));
  const selectNode = useNetworkStore((s) => s.selectNode);
  const selectEdge = useNetworkStore((s) => s.selectEdge);
  const setInspectorOpen = useUiStore((s) => s.setInspectorOpen);

  type RuleEntry = {
    elementId: string;
    elementLabel: string;
    elementType: "node" | "edge";
    rule: string;
    index: number;
  };

  const ruleEntries: RuleEntry[] = [
    ...nodes.flatMap((n) =>
      (n.rules ?? []).map((rule, index) => ({
        elementId: n.id,
        elementLabel: n.label ?? n.id,
        elementType: "node" as const,
        rule,
        index,
      })),
    ),
    ...edges.flatMap((e) =>
      (e.rules ?? []).map((rule, index) => ({
        elementId: e.id,
        elementLabel: `${e.source} → ${e.target}`,
        elementType: "edge" as const,
        rule,
        index,
      })),
    ),
  ];

  function showInInspector(entry: RuleEntry) {
    if (entry.elementType === "node") {
      selectNode(entry.elementId);
    } else {
      selectEdge(entry.elementId);
    }
    setInspectorOpen(true);
    closeActiveRulesPanel();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/20 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) closeActiveRulesPanel(); }}
    >
      <div className="mb-8 flex max-h-[60vh] w-[600px] max-w-[95vw] flex-col rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <div>
            <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Active Rules</h2>
            <p className="text-xs text-zinc-400">
              {ruleEntries.length} rule{ruleEntries.length !== 1 ? "s" : ""} in{" "}
              <span className="font-medium">{activeCanvas?.label ?? "this canvas"}</span>
            </p>
          </div>
          <button
            onClick={closeActiveRulesPanel}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {ruleEntries.length === 0 ? (
            <p className="py-6 text-center text-xs text-zinc-400 italic">
              No rules defined on any element in this canvas.
            </p>
          ) : (
            <div className="space-y-2">
              {ruleEntries.map((entry) => (
                <div
                  key={`${entry.elementId}-${entry.index}`}
                  className="flex items-start gap-3 rounded-md border border-zinc-100 p-2.5 dark:border-zinc-800"
                >
                  {entry.rule.trim().length > 0 ? (
                    <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-green-500" />
                  ) : (
                    <AlertCircle size={14} className="mt-0.5 shrink-0 text-amber-400" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="mb-0.5 flex items-center gap-1.5">
                      <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                        {entry.elementType}
                      </span>
                      <span className="truncate text-xs font-medium text-zinc-700 dark:text-zinc-300">
                        {entry.elementLabel}
                      </span>
                    </div>
                    <code className="block whitespace-pre-wrap break-all font-mono text-xs text-zinc-600 dark:text-zinc-400">
                      {entry.rule || <span className="italic text-zinc-300">empty rule</span>}
                    </code>
                  </div>
                  <button
                    onClick={() => showInInspector(entry)}
                    className="shrink-0 text-xs text-blue-500 hover:text-blue-700"
                  >
                    Show ↗
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
