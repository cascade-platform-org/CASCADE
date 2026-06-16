"use client";

/**
 * Active Rules Panel (F8) — list of all rules in the active Canvas with
 * add / edit / delete / toggle support.
 *
 * Add: shows a form with auto-detected target element. If exactly one
 * node or edge is selected in the canvas the target is pre-filled; otherwise
 * the user picks from a dropdown of all canvas elements.
 *
 * Edit: click the rule body to open an inline textarea; Escape cancels,
 * Enter (without Shift) saves.
 *
 * Delete: trash icon on each row, removes the rule from its element.
 */

import { useState, useRef, useEffect } from "react";
import { X, BookOpen, Plus, Trash2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import {
  useCanvasStore,
  selectActiveCanvas,
  selectActiveNodes,
  selectActiveEdges,
} from "@/store/canvas-store";
import { useNetworkStore } from "@/store/network-store";
import { useUiStore } from "@/store/ui-store";
import { cn } from "@/lib/utils";
import {
  isRuleDisabled,
  ruleBody,
  toggleRuleDisabled,
  setRuleBody,
} from "@/lib/rule-status";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ElementOption = {
  id: string;
  label: string;
  kind: "node" | "edge";
};

type RuleEntry = {
  elementId: string;
  elementLabel: string;
  elementType: "node" | "edge";
  rule: string;
  index: number;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ActiveRulesPanel() {
  const closeActiveRulesPanel = useUiStore((s) => s.closeActiveRulesPanel);
  const toggleRulesManualPanel = useUiStore((s) => s.toggleRulesManualPanel);
  const activeCanvas = useCanvasStore(selectActiveCanvas);
  const nodes = useCanvasStore(useShallow(selectActiveNodes));
  const edges = useCanvasStore(useShallow(selectActiveEdges));
  const updateNode = useCanvasStore((s) => s.updateNode);
  const updateEdge = useCanvasStore((s) => s.updateEdge);
  const selectNode = useNetworkStore((s) => s.selectNode);
  const selectEdge = useNetworkStore((s) => s.selectEdge);
  const setInspectorOpen = useUiStore((s) => s.setInspectorOpen);
  const selectedNodeIds = useNetworkStore((s) => s.selectedNodeIds);
  const selectedEdgeIds = useNetworkStore((s) => s.selectedEdgeIds);

  // ── Inline-edit state ──────────────────────────────────────────────────────
  // editingKey = "<elementId>-<index>" of the rule currently being edited.
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const editRef = useRef<HTMLTextAreaElement>(null);

  // ── Add-rule form state ────────────────────────────────────────────────────
  const [addingRule, setAddingRule] = useState(false);
  const [newRuleText, setNewRuleText] = useState("");
  const [targetId, setTargetId] = useState<string>("");
  const addTextRef = useRef<HTMLTextAreaElement>(null);

  // ── Build rule entries ─────────────────────────────────────────────────────
  const ruleEntries: RuleEntry[] = [
    ...nodes.flatMap((n) =>
      (n.rules ?? []).map((rule, index) => ({
        elementId: n.id,
        elementLabel: n.label ?? n.id,
        elementType: "node" as const,
        rule,
        index,
      }))
    ),
    ...edges.flatMap((e) =>
      (e.rules ?? []).map((rule, index) => ({
        elementId: e.id,
        elementLabel: `${
          nodes.find((n) => n.id === e.source)?.label ?? e.source
        } → ${nodes.find((n) => n.id === e.target)?.label ?? e.target}`,
        elementType: "edge" as const,
        rule,
        index,
      }))
    ),
  ];

  // ── Element options for the target picker ─────────────────────────────────
  const elementOptions: ElementOption[] = [
    ...nodes.map((n) => ({
      id: n.id,
      label: n.label ?? n.id,
      kind: "node" as const,
    })),
    ...edges.map((e) => ({
      id: e.id,
      label: `${nodes.find((n) => n.id === e.source)?.label ?? e.source} → ${
        nodes.find((n) => n.id === e.target)?.label ?? e.target
      }`,
      kind: "edge" as const,
    })),
  ];

  // ── Auto-detect target from selection ─────────────────────────────────────
  function autoDetectTarget(): string {
    const selNodes = [...selectedNodeIds];
    const selEdges = [...selectedEdgeIds];
    if (selNodes.length === 1 && selEdges.length === 0) return selNodes[0];
    if (selEdges.length === 1 && selNodes.length === 0) return selEdges[0];
    return "";
  }

  // ── Open the add-rule form ─────────────────────────────────────────────────
  function openAddForm() {
    setAddingRule(true);
    setNewRuleText("");
    setTargetId(autoDetectTarget());
  }

  // Focus textarea when form appears
  useEffect(() => {
    if (addingRule) addTextRef.current?.focus();
  }, [addingRule]);

  useEffect(() => {
    if (editingKey) editRef.current?.focus();
  }, [editingKey]);

  // ── Write helpers ──────────────────────────────────────────────────────────
  function getRules(id: string, kind: "node" | "edge"): string[] {
    if (kind === "node") return nodes.find((n) => n.id === id)?.rules ?? [];
    return edges.find((e) => e.id === id)?.rules ?? [];
  }

  function writeRules(id: string, kind: "node" | "edge", rules: string[]) {
    if (kind === "node") updateNode(id, { rules });
    else updateEdge(id, { rules });
  }

  // ── Toggle enable/disable ──────────────────────────────────────────────────
  function toggleRule(entry: RuleEntry) {
    const current = getRules(entry.elementId, entry.elementType);
    const next = [...current];
    next[entry.index] = toggleRuleDisabled(next[entry.index]);
    writeRules(entry.elementId, entry.elementType, next);
  }

  // ── Delete ─────────────────────────────────────────────────────────────────
  function deleteRule(entry: RuleEntry) {
    const current = getRules(entry.elementId, entry.elementType);
    writeRules(
      entry.elementId,
      entry.elementType,
      current.filter((_, j) => j !== entry.index)
    );
    if (editingKey === `${entry.elementId}-${entry.index}`) {
      setEditingKey(null);
    }
  }

  // ── Start inline edit ──────────────────────────────────────────────────────
  function startEdit(entry: RuleEntry) {
    setEditingKey(`${entry.elementId}-${entry.index}`);
    setEditText(ruleBody(entry.rule));
  }

  // ── Commit inline edit ─────────────────────────────────────────────────────
  function commitEdit(entry: RuleEntry) {
    const current = getRules(entry.elementId, entry.elementType);
    const next = [...current];
    next[entry.index] = setRuleBody(next[entry.index], editText);
    writeRules(entry.elementId, entry.elementType, next);
    setEditingKey(null);
  }

  // ── Save new rule ──────────────────────────────────────────────────────────
  function saveNewRule() {
    if (!newRuleText.trim() || !targetId) return;
    const opt = elementOptions.find((o) => o.id === targetId);
    if (!opt) return;
    const current = getRules(targetId, opt.kind);
    writeRules(targetId, opt.kind, [...current, newRuleText.trim()]);
    setAddingRule(false);
    setNewRuleText("");
    setTargetId("");
  }

  // ── Navigate to element in Inspector ──────────────────────────────────────
  function showInInspector(entry: RuleEntry) {
    if (entry.elementType === "node") selectNode(entry.elementId);
    else selectEdge(entry.elementId);
    setInspectorOpen(true);
    closeActiveRulesPanel();
  }

  // ── Resolve target element label for the add form ─────────────────────────
  const targetOption = elementOptions.find((o) => o.id === targetId);
  const autoFilled = !!autoDetectTarget() && targetId === autoDetectTarget();

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/20 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeActiveRulesPanel();
      }}
    >
      <div className="mb-8 flex max-h-[70vh] w-[640px] max-w-[95vw] flex-col rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <div>
            <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
              Active Rules
            </h2>
            <p className="text-xs text-zinc-400">
              {ruleEntries.length} rule{ruleEntries.length !== 1 ? "s" : ""} in{" "}
              <span className="font-medium">
                {activeCanvas?.label ?? "this canvas"}
              </span>
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

        {/* ── Rule list ──────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-3">
          {ruleEntries.length === 0 && !addingRule ? (
            <p className="py-6 text-center text-xs text-zinc-400 italic">
              No rules defined on any element in this canvas.
            </p>
          ) : (
            <div className="space-y-2">
              {ruleEntries.map((entry) => {
                const key = `${entry.elementId}-${entry.index}`;
                const disabled = isRuleDisabled(entry.rule);
                const isEditing = editingKey === key;

                return (
                  <div
                    key={key}
                    className="flex items-start gap-3 rounded-md border border-zinc-100 p-2.5 dark:border-zinc-800"
                  >
                    {/* Enable / disable toggle */}
                    <button
                      onClick={() => toggleRule(entry)}
                      title={disabled ? "Enable rule" : "Disable rule"}
                      className={cn(
                        "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                        disabled
                          ? "border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-800"
                          : "border-blue-500 bg-blue-500 dark:border-blue-400 dark:bg-blue-400"
                      )}
                    >
                      {!disabled && (
                        <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
                          <path
                            d="M1 3L3 5L7 1"
                            stroke="white"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </button>

                    {/* Element badge + rule body */}
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-1.5">
                        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                          {entry.elementType}
                        </span>
                        <span className="truncate text-xs font-medium text-zinc-700 dark:text-zinc-300">
                          {entry.elementLabel}
                        </span>
                      </div>

                      {isEditing ? (
                        <div className="space-y-1">
                          <textarea
                            ref={editRef}
                            value={editText}
                            rows={2}
                            onChange={(e) => setEditText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") setEditingKey(null);
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                commitEdit(entry);
                              }
                            }}
                            className="w-full resize-none rounded border border-blue-400 px-2 py-1 font-mono text-xs focus:outline-none dark:bg-zinc-800 dark:text-zinc-200"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => commitEdit(entry)}
                              className="text-xs font-medium text-blue-600 hover:text-blue-800"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingKey(null)}
                              className="text-xs text-zinc-400 hover:text-zinc-600"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <code
                          onClick={() => startEdit(entry)}
                          title="Click to edit"
                          className={cn(
                            "block cursor-text whitespace-pre-wrap break-all font-mono text-xs text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200",
                            disabled && "opacity-40"
                          )}
                        >
                          {ruleBody(entry.rule) || (
                            <span className="italic text-zinc-300">
                              empty rule
                            </span>
                          )}
                        </code>
                      )}
                    </div>

                    {/* Actions */}
                    {!isEditing && (
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <button
                          onClick={() => showInInspector(entry)}
                          className="text-xs text-blue-500 hover:text-blue-700"
                        >
                          Show ↗
                        </button>
                        <button
                          onClick={() => deleteRule(entry)}
                          title="Delete rule"
                          className="text-zinc-300 hover:text-red-500"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Add-rule form ──────────────────────────────────────────────── */}
        <div className="shrink-0 border-t border-zinc-100 px-3 py-3 dark:border-zinc-800">
          {addingRule ? (
            <div className="space-y-2">
              {/* Target element selector */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  Target element:
                </span>
                {autoFilled && targetOption ? (
                  <span className="flex items-center gap-1 rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                    <span className="rounded bg-blue-200 px-1 py-0 text-[10px] font-semibold dark:bg-blue-800">
                      {targetOption.kind}
                    </span>
                    {targetOption.label}
                    <button
                      onClick={() => setTargetId("")}
                      className="ml-1 text-blue-400 hover:text-blue-700"
                      title="Change target"
                    >
                      ×
                    </button>
                  </span>
                ) : (
                  <select
                    value={targetId}
                    onChange={(e) => setTargetId(e.target.value)}
                    className="flex-1 rounded border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                  >
                    <option value="">— pick a node or edge —</option>
                    {nodes.length > 0 && (
                      <optgroup label="Nodes">
                        {nodes.map((n) => (
                          <option key={n.id} value={n.id}>
                            {n.label ?? n.id}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {edges.length > 0 && (
                      <optgroup label="Edges">
                        {edges.map((e) => (
                          <option key={e.id} value={e.id}>
                            {nodes.find((n) => n.id === e.source)?.label ??
                              e.source}{" "}
                            →{" "}
                            {nodes.find((n) => n.id === e.target)?.label ??
                              e.target}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                )}
              </div>

              {/* Rule text */}
              <textarea
                ref={addTextRef}
                value={newRuleText}
                rows={2}
                onChange={(e) => setNewRuleText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setAddingRule(false);
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    saveNewRule();
                  }
                }}
                placeholder='e.g. node_a.functionality is < 2'
                className="w-full resize-none rounded border border-zinc-200 px-2 py-1.5 font-mono text-xs focus:border-blue-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
              />

              <div className="flex items-center justify-between">
                <p className="text-[11px] text-zinc-400">
                  Enter to save · Esc to cancel · Shift+Enter for new line
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setAddingRule(false)}
                    className="text-xs text-zinc-400 hover:text-zinc-600"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveNewRule}
                    disabled={!newRuleText.trim() || !targetId}
                    className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
                  >
                    Add rule
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <button
              onClick={openAddForm}
              disabled={elementOptions.length === 0}
              className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 disabled:opacity-40 dark:text-blue-400"
            >
              <Plus size={13} />
              Add rule
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
