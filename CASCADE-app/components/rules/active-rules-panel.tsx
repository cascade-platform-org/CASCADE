"use client";

/**
 * Active Rules Panel (F8) — the rules on one Canvas, or on all of them, with
 * add / edit / delete / toggle support.
 *
 * It is a {@link FloatingWindow}, like Analysis: draggable, resizable,
 * collapsible, and with no dimmed backdrop, because a rule is written *about*
 * the network and reading it against a covered canvas is guesswork. Closing
 * flies the window back into the Status Bar counter that reopens it
 * (`flyToOnClose`), which is where that choreography now lives for every
 * window rather than only this one.
 *
 * The Canvas is chosen in the header and starts on the one the user is looking
 * at (all of them, in the Global view). It is panel-local: reading another
 * Canvas's rules should not move the editor — following a rule to the
 * Inspector does, because that element has to be on screen to be inspected.
 *
 * Guidance: while typing a rule the textarea shows a context-aware suggestion
 * popup that mirrors the backend grammar (lib/rule-suggestions.ts). Context
 * is derived from the tokens already typed, not just from a prefix match
 * against a flat list. Suggestions include:
 *   - element display labels and category names
 *   - functionality scale labels ('critical', 'warning', …)
 *   - comparison operators (<, <=, >, …) after 'is'
 *   - node attributes (.functionality, .direct_damage, …) after '.'
 *   - continuation keywords (and, or, then) after a condition value
 *   - propagation function names (worst_of, best_of, …) at the start
 */

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { BookOpen, Plus, Trash2, ScrollText } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useCanvasStore } from "@/store/canvas-store";
import { useNetworkStore } from "@/store/network-store";
import { useUiStore } from "@/store/ui-store";
import {
  useConfigStore,
  selectCategories,
  selectScaleLevels,
  selectN,
} from "@/store/config-store";
import { cn } from "@/lib/utils";
import { FloatingWindow } from "@/components/ui/floating-window";
import { RULES_ANCHOR_ID, RULES_MANUAL_ANCHOR_ID } from "@/lib/ui-anchors";
import {
  isRuleDisabled,
  ruleBody,
  toggleRuleDisabled,
  setRuleBody,
} from "@/lib/rule-status";
import {
  computeRuleSuggestions,
  getPartialToken,
  contextLabel,
  extractTargetFromRule,
  type RuleSuggestionCtx,
} from "@/lib/rule-suggestions";
import type { Node, Edge } from "@/lib/schemas/network";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ElementOption = {
  id: string;
  label: string;
  kind: "node" | "edge";
  canvasLabel?: string;
};

type RuleEntry = {
  elementId: string;
  elementLabel: string;
  elementType: "node" | "edge";
  canvasLabel?: string;
  /** Which Canvas the element sits on — so "show in Inspector" can switch to it. */
  canvasId?: string;
  rule: string;
  index: number;
};

// ---------------------------------------------------------------------------
// RuleTextArea — textarea with context-aware suggestion popup
// ---------------------------------------------------------------------------

interface RuleTextAreaProps {
  value: string;
  rows?: number;
  placeholder?: string;
  className?: string;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  onChange: (v: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  /** Called with (text, cursorPos) → ordered suggestion strings. */
  getSuggestions: (text: string, cursorPos: number) => string[];
}

function RuleTextArea({
  value,
  rows = 2,
  placeholder,
  className,
  textareaRef,
  onChange,
  onKeyDown,
  getSuggestions,
}: RuleTextAreaProps) {
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const taRef =
    (textareaRef as React.RefObject<HTMLTextAreaElement | null> | undefined) ??
    internalRef;

  const [popupItems, setPopupItems] = useState<string[]>([]);
  const [ctxHint, setCtxHint] = useState<string>("");
  const [activeIdx, setActiveIdx] = useState(0);
  const [wordStart, setWordStart] = useState(0);

  const recompute = useCallback(
    (text: string, cursor: number) => {
      const { wordStart: ws } = getPartialToken(text, cursor);
      const items = getSuggestions(text, cursor);
      const hint = contextLabel(text, cursor);
      setWordStart(ws);
      setPopupItems(items);
      setCtxHint(hint);
      setActiveIdx(0);
    },
    [getSuggestions],
  );

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    onChange(e.target.value);
    recompute(
      e.target.value,
      e.target.selectionStart ?? e.target.value.length,
    );
  }

  function applyCompletion(item: string) {
    const ta = taRef.current;
    if (!ta) return;
    const cursor = ta.selectionStart ?? value.length;
    // Replace the partial token [wordStart..cursor] with the chosen item.
    const newText = value.slice(0, wordStart) + item + value.slice(cursor);
    onChange(newText);
    setPopupItems([]);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = wordStart + item.length;
      ta.setSelectionRange(pos, pos);
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (popupItems.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, popupItems.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        applyCompletion(popupItems[activeIdx]);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        // Enter with popup open: apply suggestion, not save
        e.preventDefault();
        applyCompletion(popupItems[activeIdx]);
        return;
      }
      if (e.key === "Escape") {
        setPopupItems([]);
        // fall through — parent Escape handler will cancel the edit
      }
    }
    onKeyDown?.(e);
  }

  return (
    <div className="relative">
      <textarea
        ref={taRef as React.RefObject<HTMLTextAreaElement>}
        value={value}
        rows={rows}
        placeholder={placeholder}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onClick={(e) =>
          recompute(
            value,
            (e.target as HTMLTextAreaElement).selectionStart ?? value.length,
          )
        }
        onBlur={() => setTimeout(() => setPopupItems([]), 150)}
        className={className}
      />

      {popupItems.length > 0 && (
        <div className="absolute left-0 top-full z-50 mt-0.5 w-full rounded border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {/* Context hint */}
          <div className="border-b border-zinc-100 px-2 py-0.5 text-[10px] text-zinc-400 dark:border-zinc-800">
            expecting: <span className="font-medium text-zinc-500 dark:text-zinc-300">{ctxHint}</span>
            <span className="float-right">Tab to complete · ↑↓ to navigate</span>
          </div>

          <ul className="max-h-64 overflow-y-auto py-0.5">
            {popupItems.map((item, idx) => (
              <li
                key={item}
                onMouseDown={(e) => {
                  e.preventDefault();
                  applyCompletion(item);
                }}
                className={cn(
                  "cursor-pointer px-2 py-1 font-mono text-xs",
                  idx === activeIdx
                    ? "bg-blue-500 text-white"
                    : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
                )}
              >
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Canvas-scope sentinel: show the rules on every Canvas at once. */
const ALL_CANVASES = "__all__";

/** An element plus the Canvas it was reached through. */
type ScopedNode = Node & { _canvasLabel?: string; _canvasId?: string };
type ScopedEdge = Edge & { _canvasLabel?: string; _canvasId?: string };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ActiveRulesPanel() {
  const closeActiveRulesPanel = useUiStore((s) => s.closeActiveRulesPanel);
  const toggleRulesManualPanel = useUiStore((s) => s.toggleRulesManualPanel);
  const globalViewActive = useUiStore((s) => s.globalViewActive);

  const allCanvasesMap = useCanvasStore((s) => s.canvases);
  const allNodesMap = useCanvasStore((s) => s.nodes);
  const allEdgesMap = useCanvasStore((s) => s.edges);
  const canvasOrder = useCanvasStore((s) => s.canvasOrder);

  // Rule guidance context from Model Configuration
  const categories = useConfigStore(useShallow(selectCategories));
  const scaleLevels = useConfigStore(useShallow(selectScaleLevels));
  const functionalityN = useConfigStore(selectN);

  const updateNode = useCanvasStore((s) => s.updateNode);
  const setActiveCanvas = useCanvasStore((s) => s.setActiveCanvas);
  const updateEdge = useCanvasStore((s) => s.updateEdge);
  const selectNode = useNetworkStore((s) => s.selectNode);
  const selectEdge = useNetworkStore((s) => s.selectEdge);
  const setInspectorOpen = useUiStore((s) => s.setInspectorOpen);
  const selectedNodeIds = useNetworkStore((s) => s.selectedNodeIds);
  const selectedEdgeIds = useNetworkStore((s) => s.selectedEdgeIds);

  // ── Inline-edit state ──────────────────────────────────────────────────────
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const editRef = useRef<HTMLTextAreaElement>(null);

  // ── Add-rule form state ────────────────────────────────────────────────────
  // Opened straight into the compose form when the Inspector's "Add rule" sent
  // us here. Read once, at mount, rather than in an effect: the panel is
  // unmounted while closed, so mount IS the moment the request arrives, and an
  // effect would just re-render to reach the same first paint.
  const [addingRule, setAddingRule] = useState(
    () => useUiStore.getState().rulesComposeRequested,
  );
  const [newRuleText, setNewRuleText] = useState("");
  const [targetId, setTargetId] = useState<string>("");
  // When true the user has explicitly overridden auto-detection via the dropdown;
  // auto-detection from rule text will not overwrite the manual choice.
  const [targetManuallySet, setTargetManuallySet] = useState(false);
  const addTextRef = useRef<HTMLTextAreaElement>(null);

  // ── Canvas scope ──────────────────────────────────────────────────────────
  // Which Canvas's rules this panel is showing. Defaults to the one the user is
  // looking at, and to every Canvas when the Global view is active — the two
  // cases the panel used to infer and offer no way out of. Panel-local on
  // purpose: reading another Canvas's rules should not move the editor.
  const [scopeCanvasId, setScopeCanvasId] = useState<string>(() =>
    globalViewActive ? ALL_CANVASES : (useCanvasStore.getState().activeCanvasId ?? ALL_CANVASES),
  );
  // A Canvas deleted while the panel is open would otherwise leave it scoped to
  // nothing, with no visible reason why the list is empty.
  const scopeValid = scopeCanvasId === ALL_CANVASES || !!allCanvasesMap[scopeCanvasId];
  const scope = scopeValid ? scopeCanvasId : ALL_CANVASES;

  // ── Resolve nodes / edges for the chosen scope ────────────────────────────
  const { nodes, edges } = useMemo(() => {
    const ids = scope === ALL_CANVASES ? canvasOrder : [scope];
    const multi = ids.length > 1;
    const seenNodes = new Set<string>();
    const seenEdges = new Set<string>();
    const nodes: ScopedNode[] = [];
    const edges: ScopedEdge[] = [];
    for (const canvasId of ids) {
      const canvas = allCanvasesMap[canvasId];
      if (!canvas) continue;
      // The label only earns its place when more than one Canvas is listed.
      const canvasLabel = multi ? (canvas.label ?? canvasId) : undefined;
      for (const nid of canvas.graph.node_ids) {
        if (!seenNodes.has(nid) && allNodesMap[nid]) {
          seenNodes.add(nid);
          nodes.push({ ...allNodesMap[nid], _canvasLabel: canvasLabel, _canvasId: canvasId });
        }
      }
      for (const eid of canvas.graph.edge_ids) {
        if (!seenEdges.has(eid) && allEdgesMap[eid]) {
          seenEdges.add(eid);
          edges.push({ ...allEdgesMap[eid], _canvasLabel: canvasLabel, _canvasId: canvasId });
        }
      }
    }
    return { nodes, edges };
  }, [scope, canvasOrder, allCanvasesMap, allNodesMap, allEdgesMap]);

  // ── Build rule entries ─────────────────────────────────────────────────────
  const ruleEntries: RuleEntry[] = [
    ...nodes.flatMap((n) =>
      (n.rules ?? []).map((rule, index) => ({
        elementId: n.id,
        elementLabel: n.label ?? n.id,
        elementType: "node" as const,
        canvasLabel: n._canvasLabel,
        canvasId: n._canvasId,
        rule,
        index,
      })),
    ),
    ...edges.flatMap((e) => {
      const srcLabel = nodes.find((n) => n.id === e.source)?.label ?? e.source;
      const tgtLabel = nodes.find((n) => n.id === e.target)?.label ?? e.target;
      return (e.rules ?? []).map((rule, index) => ({
        elementId: e.id,
        elementLabel: `${srcLabel} → ${tgtLabel}`,
        elementType: "edge" as const,
        canvasLabel: e._canvasLabel,
        canvasId: e._canvasId,
        rule,
        index,
      }));
    }),
  ];

  // ── Element options for the target picker ─────────────────────────────────
  const elementOptions: ElementOption[] = useMemo(() => [
    ...nodes.map((n) => ({
      id: n.id,
      label: n.label ?? n.id,
      kind: "node" as const,
      canvasLabel: n._canvasLabel,
    })),
    ...edges.map((e) => {
      const srcLabel = nodes.find((n) => n.id === e.source)?.label ?? e.source;
      const tgtLabel = nodes.find((n) => n.id === e.target)?.label ?? e.target;
      return {
        id: e.id,
        label: `${srcLabel} → ${tgtLabel}`,
        kind: "edge" as const,
        canvasLabel: e._canvasLabel,
      };
    }),
  ], [nodes, edges]);

  // ── Suggestion context (stable reference) ─────────────────────────────────
  const suggestionCtx: RuleSuggestionCtx = {
    elementLabels: nodes.map((n) => n.label ?? n.id),
    categoryNames: categories.map((c) => c.name),
    functionalityLabels: scaleLevels.map((l) => l.label),
    functionalityN,
  };

  // Memoised wrapper passed down to each RuleTextArea. Depends on the
  // *content* of the suggestion context, not its object identity.
  const suggestionCtxKey = [
    suggestionCtx.elementLabels.join(","),
    suggestionCtx.categoryNames.join(","),
    suggestionCtx.functionalityLabels.join(","),
    String(suggestionCtx.functionalityN),
  ].join("|");
  const getSuggestions = useCallback(
    (text: string, cursor: number) =>
      computeRuleSuggestions(text, cursor, suggestionCtx),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [suggestionCtxKey],
  );

  // ── Target detection ──────────────────────────────────────────────────────

  // ID of the element that is currently selected in the canvas (if exactly one).
  const selectionTargetId = useMemo(() => {
    const selNodes = [...selectedNodeIds];
    const selEdges = [...selectedEdgeIds];
    if (selNodes.length === 1 && selEdges.length === 0) return selNodes[0];
    if (selEdges.length === 1 && selNodes.length === 0) return selEdges[0];
    return "";
  }, [selectedNodeIds, selectedEdgeIds]);

  // Resolve the target name written inside the rule text to an element ID.
  // Tries exact ID match first, then case-insensitive label match.
  const ruleTargetId = useMemo(() => {
    const raw = extractTargetFromRule(newRuleText);
    if (!raw) return "";
    const lower = raw.toLowerCase();
    return (
      elementOptions.find((o) => o.id === raw)?.id ??
      elementOptions.find((o) => o.label.toLowerCase() === lower)?.id ??
      ""
    );
  }, [newRuleText, elementOptions]);

  // Whenever the rule text produces a new target and the user hasn't manually
  // overridden, keep targetId in sync. Falls back to canvas selection.
  // Adjusted during render (guarded by prevSyncedTargetId) rather than in an
  // effect: null while manually overridden, so a change made only to
  // ruleTargetId/selectionTargetId during that override correctly has no
  // effect, matching the original effect's dependency array exactly.
  const syncedTargetId = targetManuallySet ? null : ruleTargetId || selectionTargetId;
  const [prevSyncedTargetId, setPrevSyncedTargetId] = useState(syncedTargetId);
  if (syncedTargetId !== prevSyncedTargetId) {
    setPrevSyncedTargetId(syncedTargetId);
    if (syncedTargetId !== null) setTargetId(syncedTargetId);
  }

  function openAddForm() {
    setAddingRule(true);
    setNewRuleText("");
    setTargetManuallySet(false);
    setTargetId(selectionTargetId);
  }

  // The request is one-shot: clear it so reopening the panel normally just
  // lists the rules. The target is left to the auto-detection effect above,
  // which already falls back to the canvas selection — the element whose
  // Inspector the user pressed "Add rule" in.
  useEffect(() => {
    useUiStore.getState().clearRulesComposeRequest();
  }, []);

  useEffect(() => {
    if (addingRule) addTextRef.current?.focus();
  }, [addingRule]);

  useEffect(() => {
    if (editingKey) editRef.current?.focus();
  }, [editingKey]);

  // ── Write helpers ──────────────────────────────────────────────────────────
  function getRules(id: string, kind: "node" | "edge"): string[] {
    if (kind === "node") return allNodesMap[id]?.rules ?? [];
    return allEdgesMap[id]?.rules ?? [];
  }

  function writeRules(id: string, kind: "node" | "edge", rules: string[]) {
    if (kind === "node") updateNode(id, { rules });
    else updateEdge(id, { rules });
  }

  function toggleRule(entry: RuleEntry) {
    const current = getRules(entry.elementId, entry.elementType);
    const next = [...current];
    next[entry.index] = toggleRuleDisabled(next[entry.index]);
    writeRules(entry.elementId, entry.elementType, next);
  }

  function deleteRule(entry: RuleEntry) {
    const current = getRules(entry.elementId, entry.elementType);
    writeRules(
      entry.elementId,
      entry.elementType,
      current.filter((_, j) => j !== entry.index),
    );
    if (editingKey === `${entry.elementId}-${entry.index}`) setEditingKey(null);
  }

  function startEdit(entry: RuleEntry) {
    setEditingKey(`${entry.elementId}-${entry.index}`);
    setEditText(ruleBody(entry.rule));
  }

  function commitEdit(entry: RuleEntry) {
    const current = getRules(entry.elementId, entry.elementType);
    const next = [...current];
    next[entry.index] = setRuleBody(next[entry.index], editText);
    writeRules(entry.elementId, entry.elementType, next);
    setEditingKey(null);
  }

  function saveNewRule() {
    if (!newRuleText.trim() || !targetId) return;
    const opt = elementOptions.find((o) => o.id === targetId);
    if (!opt) return;
    const current = getRules(targetId, opt.kind);
    writeRules(targetId, opt.kind, [...current, newRuleText.trim()]);
    setAddingRule(false);
    setNewRuleText("");
    setTargetId("");
    setTargetManuallySet(false);
  }

  function showInInspector(entry: RuleEntry) {
    // The panel can be scoped to a Canvas the editor is not showing, so follow
    // the element there first — otherwise the Inspector fills with an element
    // that is nowhere on screen.
    if (entry.canvasId && entry.canvasId !== useCanvasStore.getState().activeCanvasId) {
      setActiveCanvas(entry.canvasId);
    }
    if (entry.elementType === "node") selectNode(entry.elementId);
    else selectEdge(entry.elementId);
    setInspectorOpen(true);
    closeActiveRulesPanel();
  }

  const targetOption = elementOptions.find((o) => o.id === targetId);
  // Which mechanism produced the current targetId?
  const targetSource: "rule" | "selection" | "manual" | null = targetId
    ? targetManuallySet
      ? "manual"
      : ruleTargetId && ruleTargetId === targetId
        ? "rule"
        : selectionTargetId && selectionTargetId === targetId
          ? "selection"
          : null
    : null;
  const scopeLabel =
    scope === ALL_CANVASES
      ? "all canvases"
      : (allCanvasesMap[scope]?.label ?? "this canvas");

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <FloatingWindow
      open
      onClose={closeActiveRulesPanel}
      title="Active Rules"
      icon={<ScrollText size={15} className="shrink-0 text-blue-600 dark:text-blue-400" />}
      flyToOnClose={RULES_ANCHOR_ID}
      storageKey="cascade.rules.window"
      defaultSize={{ w: 640, h: 520 }}
      minSize={{ w: 420, h: 260 }}
      headerActions={
        <>
          {/* Which Canvas's rules to list. Starts on the one you are looking
              at; the panel used to infer this and give no way to look
              anywhere else. */}
          <select
            value={scope}
            onChange={(e) => setScopeCanvasId(e.target.value)}
            title="Which canvas's rules to show"
            className="rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-xs font-medium text-zinc-700 focus:border-blue-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
          >
            {canvasOrder.map((id) => {
              const canvas = allCanvasesMap[id];
              if (!canvas) return null;
              return (
                <option key={id} value={id}>
                  {canvas.label ?? id}
                </option>
              );
            })}
            <option value={ALL_CANVASES}>All canvases</option>
          </select>
          <span className="text-xs text-zinc-400">
            {ruleEntries.length} rule{ruleEntries.length !== 1 ? "s" : ""}
          </span>
          <button
            id={RULES_MANUAL_ANCHOR_ID}
            onClick={toggleRulesManualPanel}
            className="flex items-center gap-1.5 rounded-md border border-zinc-200 px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-800 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            title="Open the rule-writing manual"
          >
            <BookOpen size={14} />
            Manual
          </button>
        </>
      }
    >
      <div className="flex min-w-0 flex-1 flex-col">
        {/* ── Rule list ──────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-3">
          {ruleEntries.length === 0 && !addingRule ? (
            <p className="py-6 text-center text-xs text-zinc-400 italic">
              No rules defined on any element in {scopeLabel}.
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
                          : "border-blue-500 bg-blue-500 dark:border-blue-400 dark:bg-blue-400",
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
                        {entry.canvasLabel && (
                          <span className="ml-auto shrink-0 rounded bg-zinc-50 px-1 py-0.5 text-[10px] text-zinc-400 dark:bg-zinc-800">
                            {entry.canvasLabel}
                          </span>
                        )}
                      </div>

                      {isEditing ? (
                        <div className="space-y-1">
                          <RuleTextArea
                            textareaRef={editRef}
                            value={editText}
                            rows={2}
                            onChange={setEditText}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") setEditingKey(null);
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                commitEdit(entry);
                              }
                            }}
                            getSuggestions={getSuggestions}
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
                            disabled && "opacity-40",
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
              {/* Target element — auto-detected or manually overridden */}
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
                  Target:
                </span>

                {targetOption && targetSource !== "manual" ? (
                  /* Auto-detected badge */
                  <span
                    className={cn(
                      "flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium",
                      targetSource === "rule"
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                        : "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
                    )}
                  >
                    <span
                      className={cn(
                        "rounded px-1 py-0 text-[10px] font-semibold",
                        targetSource === "rule"
                          ? "bg-emerald-200 dark:bg-emerald-800"
                          : "bg-blue-200 dark:bg-blue-800",
                      )}
                    >
                      {targetSource === "rule" ? "from rule" : "selected"}
                    </span>
                    {targetOption.kind === "node" ? "node" : "edge"}&nbsp;·&nbsp;
                    <span className="font-semibold">{targetOption.label}</span>
                    <button
                      onClick={() => {
                        setTargetManuallySet(true);
                        setTargetId("");
                      }}
                      className="ml-1 opacity-60 hover:opacity-100"
                      title="Override target manually"
                    >
                      ×
                    </button>
                  </span>
                ) : (
                  /* Manual dropdown (shown when overriding or nothing auto-detected) */
                  <select
                    value={targetId}
                    onChange={(e) => {
                      setTargetManuallySet(true);
                      setTargetId(e.target.value);
                    }}
                    className="flex-1 rounded border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                  >
                    <option value="">— pick a node or edge —</option>
                    {scope === ALL_CANVASES
                      ? canvasOrder.map((cid) => {
                          const canvas = allCanvasesMap[cid];
                          if (!canvas) return null;
                          const cNodes = canvas.graph.node_ids.flatMap((id) =>
                            allNodesMap[id] ? [allNodesMap[id]] : [],
                          );
                          const cEdges = canvas.graph.edge_ids.flatMap((id) =>
                            allEdgesMap[id] ? [allEdgesMap[id]] : [],
                          );
                          if (cNodes.length + cEdges.length === 0) return null;
                          return (
                            <optgroup key={cid} label={canvas.label ?? cid}>
                              {cNodes.map((n) => (
                                <option key={n.id} value={n.id}>
                                  [node] {n.label ?? n.id}
                                </option>
                              ))}
                              {cEdges.map((e) => {
                                const src =
                                  allNodesMap[e.source]?.label ?? e.source;
                                const tgt =
                                  allNodesMap[e.target]?.label ?? e.target;
                                return (
                                  <option key={e.id} value={e.id}>
                                    [edge] {src} → {tgt}
                                  </option>
                                );
                              })}
                            </optgroup>
                          );
                        })
                      : <>
                          {nodes.length > 0 && (
                            <optgroup label="Nodes">
                              {(nodes as Node[]).map((n) => (
                                <option key={n.id} value={n.id}>
                                  {n.label ?? n.id}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {edges.length > 0 && (
                            <optgroup label="Edges">
                              {(edges as Edge[]).map((e) => (
                                <option key={e.id} value={e.id}>
                                  {(nodes as Node[]).find((n) => n.id === e.source)?.label ?? e.source}{" "}
                                  →{" "}
                                  {(nodes as Node[]).find((n) => n.id === e.target)?.label ?? e.target}
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </>}
                  </select>
                )}
              </div>

              {/* Rule textarea with autocomplete */}
              <RuleTextArea
                textareaRef={addTextRef}
                value={newRuleText}
                rows={2}
                onChange={setNewRuleText}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setAddingRule(false);
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    saveNewRule();
                  }
                }}
                placeholder="e.g. if pump is critical then tank is critical"
                getSuggestions={getSuggestions}
                className="w-full resize-none rounded border border-zinc-200 px-2 py-1.5 font-mono text-xs focus:border-blue-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
              />

              <div className="flex items-center justify-between">
                <p className="text-[11px] text-zinc-400">
                  Tab · ↑↓ to navigate suggestions · Shift+Enter for new line
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
    </FloatingWindow>
  );
}
