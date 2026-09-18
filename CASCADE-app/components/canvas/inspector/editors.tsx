"use client";

/**
 * inspector/editors.tsx — Inline editors shared by NodeInspector and EdgeInspector.
 *
 * Exports: RulesEditor, PropertiesEditor
 *
 * Neither editor writes to a store directly; both accept the current value and
 * an onChange callback, keeping them pure presenter components testable with
 * only props.
 */

import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/store/ui-store";
import { isRuleDisabled, ruleBody, toggleRuleDisabled, setRuleBody } from "@/lib/rule-status";

// ---------------------------------------------------------------------------
// RulesEditor
// ---------------------------------------------------------------------------

/**
 * Inline editor with per-rule enable/disable toggle.
 *
 * The disabled convention ("// " prefix) is defined in lib/rule-status.ts and
 * shared with the Active Rules panel and the backend engine. The toggle strips
 * or prepends the prefix without touching the rule text.
 */
export function RulesEditor({
  rules,
  onChange,
}: {
  rules: string[];
  onChange: (rules: string[]) => void;
}) {
  function toggleRule(i: number) {
    const next = [...rules];
    next[i] = toggleRuleDisabled(next[i]);
    onChange(next);
  }

  function updateText(i: number, text: string) {
    const next = [...rules];
    next[i] = setRuleBody(next[i], text);
    onChange(next);
  }

  return (
    <div className="space-y-1.5">
      {rules.map((rule, i) => {
        const disabled = isRuleDisabled(rule);
        return (
          <div key={i} className="flex items-start gap-1.5">
            <button
              onClick={() => toggleRule(i)}
              title={disabled ? "Enable rule" : "Disable rule"}
              className={cn(
                "mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
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

            <textarea
              value={ruleBody(rule)}
              rows={2}
              onChange={(e) => updateText(i, e.target.value)}
              className={cn(
                "flex-1 resize-none rounded border px-2 py-1 font-mono text-xs focus:border-blue-400 focus:outline-none",
                "border-zinc-200 bg-white text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
                disabled && "opacity-40",
              )}
            />

            <button
              onClick={() => onChange(rules.filter((_, j) => j !== i))}
              className="mt-1 text-zinc-300 hover:text-red-500"
            >
              <Trash2 size={12} />
            </button>
          </div>
        );
      })}
      {/* Writing a rule belongs in the Active Rules panel, which has the
          grammar-aware suggestions (lib/rule-suggestions.ts) and validates as
          you type. This used to append an empty string and hand the user a
          bare textarea — the same grammar, with none of the help. The panel
          targets the current canvas selection, which is this element. */}
      <button
        onClick={() => useUiStore.getState().openRuleComposer()}
        title="Write a rule with suggestions in the Active Rules panel"
        className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700"
      >
        <Plus size={10} /> Add rule
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PropertiesEditor
// ---------------------------------------------------------------------------

/** Key-value editor with index-stable rows so duplicate keys don't collapse. */
export function PropertiesEditor({
  properties,
  onChange,
}: {
  properties: Record<string, unknown>;
  onChange: (p: Record<string, unknown>) => void;
}) {
  const [rows, setRows] = useState<[string, string][]>(() =>
    Object.entries(properties).map(([k, v]) => [k, String(v ?? "")]),
  );

  // Re-derive rows when the caller passes different properties (adjusted
  // during render, guarded by propKey, rather than in an effect).
  const propKey = JSON.stringify(properties);
  const [prevPropKey, setPrevPropKey] = useState(propKey);
  if (propKey !== prevPropKey) {
    setPrevPropKey(propKey);
    setRows(Object.entries(properties).map(([k, v]) => [k, String(v ?? "")]));
  }

  function commit(next: [string, string][]) {
    setRows(next);
    const obj: Record<string, unknown> = {};
    for (const [k, v] of next) obj[k] = v;
    onChange(obj);
  }

  return (
    <div className="space-y-1">
      {rows.map(([k, v], i) => (
        <div key={i} className="flex items-center gap-1">
          <input
            type="text"
            value={k}
            onChange={(e) =>
              commit(rows.map((r, j): [string, string] => (j === i ? [e.target.value, r[1]] : r)))
            }
            className="w-1/3 rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-xs focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
            placeholder="key"
          />
          <input
            type="text"
            value={v}
            onChange={(e) =>
              commit(rows.map((r, j): [string, string] => (j === i ? [r[0], e.target.value] : r)))
            }
            className="flex-1 rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-xs focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
            placeholder="value"
          />
          <button
            onClick={() => commit(rows.filter((_, j) => j !== i))}
            className="text-zinc-300 hover:text-red-500"
          >
            <X size={12} />
          </button>
        </div>
      ))}
      <button
        onClick={() => commit([...rows, ["", ""]])}
        className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700"
      >
        <Plus size={10} /> Add property
      </button>
    </div>
  );
}
