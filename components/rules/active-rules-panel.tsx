"use client";

/**
 * Active Rules Panel (F8) — read-only list of all rules in the active Canvas.
 * Opened from the Status Bar "Rules: N active ↗" button.
 */

import { X, BookOpen } from "lucide-react";
import { useCanvasStore, selectActiveCanvas, selectActiveNodes, selectActiveEdges } from "@/store/canvas-store";
import { useUiStore } from "@/store/ui-store";
import { useNetworkStore } from "@/store/network-store";
import { useShallow } from "zustand/react/shallow";
import { cn } from "@/lib/utils";
import { isRuleDisabled, ruleBody, toggleRuleDisabled } from "@/lib/rule-status";

export function ActiveRulesPanel() {
  const closeActiveRulesPanel = useUiStore((s) => s.closeActiveRulesPanel);
  const toggleRulesManualPanel = useUiStore((s) => s.toggleRulesManualPanel);
  const activeCanvas = useCanvasStore(selectActiveCanvas);
  const nodes = useCanvasStore(useShallow(selectActiveNodes));
  const edges = useCanvasStore(useShallow(selectActiveEdges));
  const selectNode = useNetworkStore((s) => s.selectNode);
  const selectEdge = useNetworkStore((s) => s.selectEdge);
  const updateNode = useCanvasStore((s) => s.updateNode);
  const updateEdge = useCanvasStore((s) => s.updateEdge);
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

  // Flip a rule's active/inactive state in place, writing back through the same
  // store action the Inspector uses (updateNode/updateEdge with a rules patch).
  function toggleRule(entry: RuleEntry) {
    const current =
      entry.elementType === "node"
        ? nodes.find((n) => n.id === entry.elementId)?.rules
        : edges.find((e) => e.id === entry.elementId)?.rules;
    if (!current) return;
    const next = [...current];
    next[entry.index] = toggleRuleDisabled(next[entry.index]);
    if (entry.elementType === "node") {
      updateNode(entry.elementId, { rules: next });
    } else {
      updateEdge(entry.elementId, { rules: next });
    }
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
          <div className="flex items-center gap-1">
            <button
              onClick={toggleRulesManualPanel}
              className="flex items-center gap-1.5 rounded-md border border-zinc-200 px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-800 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              title="Open the rule-writing manual"
            >
              <BookOpen size={14} />
              Manual
            </button>
            <button
              onClick={closeActiveRulesPanel}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {ruleEntries.length === 0 ? (
            <p className="py-6 text-center text-xs text-zinc-400 italic">
              No rules defined on any element in this canvas.
            </p>
          ) : (
            <div className="space-y-2">
              {ruleEntries.map((entry) => {
                const disabled = isRuleDisabled(entry.rule);
                return (
                <div
                  key={`${entry.elementId}-${entry.index}`}
                  className="flex items-start gap-3 rounded-md border border-zinc-100 p-2.5 dark:border-zinc-800"
                >
                  {/* Enable / disable toggle — same convention as the Inspector */}
                  <button
                    onClick={() => toggleRule(entry)}
                    title={disabled ? "Enable rule" : "Disable rule"}
                    className={cn(
                      "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                      disabled
                        ? "border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-800"
                        : "border-blue-500 bg-blue-500 dark:border-blue-400 dark:bg-blue-400",
                    )}
                  >
                    {!disabled && (
                      <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
                        <path d="M1 3L3 5L7 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="mb-0.5 flex items-center gap-1.5">
                      <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                        {entry.elementType}
                      </span>
                      <span className="truncate text-xs font-medium text-zinc-700 dark:text-zinc-300">
                        {entry.elementLabel}
                      </span>
                    </div>
                    <code className={cn(
                      "block whitespace-pre-wrap break-all font-mono text-xs text-zinc-600 dark:text-zinc-400",
                      disabled && "opacity-40",
                    )}>
                      {ruleBody(entry.rule) || <span className="italic text-zinc-300">empty rule</span>}
                    </code>
                  </div>
                  <button
                    onClick={() => showInInspector(entry)}
                    className="shrink-0 text-xs text-blue-500 hover:text-blue-700"
                  >
                    Show ↗
                  </button>
                </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
