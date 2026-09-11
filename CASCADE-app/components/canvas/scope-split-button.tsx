"use client";

/**
 * ScopeSplitButton — an action button with its scope picked on the side.
 *
 * Propagate and Analyse are the two scoped actions in the app, and CONTEXT.md
 * gives them the same vocabulary: scope is **local** (active Canvas only) or
 * **global** (full multi-canvas). They now share the control as well as the
 * words, so scope is chosen the same way in both places — before the action
 * runs, where the choice actually applies.
 *
 * `tone` is the only thing that varies between the two: Propagate is green
 * (it runs the engine), Analyse is blue (the app's accent for read-only work).
 */

import React, { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type Scope = "local" | "global";

type Tone = "green" | "blue";

const TONE: Record<Tone, { border: string; divider: string; text: string; hover: string; check: string }> = {
  green: {
    border: "border-green-300 dark:border-green-800",
    divider: "bg-green-200 dark:bg-green-800",
    text: "text-green-700 dark:text-green-400",
    hover: "hover:bg-green-50 dark:hover:bg-green-900/20",
    check: "text-green-500",
  },
  blue: {
    border: "border-blue-300 dark:border-blue-800",
    divider: "bg-blue-200 dark:bg-blue-800",
    text: "text-blue-700 dark:text-blue-400",
    hover: "hover:bg-blue-50 dark:hover:bg-blue-900/20",
    check: "text-blue-500",
  },
};

const SCOPE_HINT: Record<Scope, string> = {
  local: "Active canvas only — inter-canvas edges excluded",
  global: "Full multi-canvas — every canvas included",
};

interface ScopeSplitButtonProps {
  label: React.ReactNode;
  icon: React.ReactNode;
  tone: Tone;
  scope: Scope;
  onScopeChange: (v: Scope) => void;
  onAction: () => void;
  disabled?: boolean;
  title?: string;
  /** Forwarded to the wrapper so the guided tour can still find the button. */
  dataTour?: string;
}

export function ScopeSplitButton({
  label,
  icon,
  tone,
  scope,
  onScopeChange,
  onAction,
  disabled = false,
  title,
  dataTour,
}: ScopeSplitButtonProps) {
  const [scopeOpen, setScopeOpen] = useState(false);
  const t = TONE[tone];

  return (
    <div data-tour={dataTour} className={cn("flex items-center rounded-md border", t.border)}>
      <button
        onClick={disabled ? undefined : onAction}
        disabled={disabled}
        title={title}
        className={cn(
          "flex h-7 items-center gap-1.5 rounded-l-md px-2.5 text-xs font-medium transition-colors",
          t.text,
          disabled ? "cursor-not-allowed opacity-40" : t.hover,
        )}
      >
        {icon}
        <span>{label}</span>
      </button>

      <div className={cn("h-5 w-px", t.divider)} />

      <div className="relative">
        <button
          onClick={() => setScopeOpen((v) => !v)}
          title="Switch scope"
          className={cn(
            "flex h-7 items-center gap-1 rounded-r-md px-2 text-xs font-medium transition-colors",
            t.text,
            t.hover,
          )}
        >
          <span className="capitalize">{scope}</span>
          <ChevronDown size={11} className={cn("transition-transform", scopeOpen && "rotate-180")} />
        </button>

        {scopeOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setScopeOpen(false)} />
            <div className="absolute left-0 top-full z-50 mt-1 min-w-[96px] overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
              {(["local", "global"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => {
                    onScopeChange(v);
                    setScopeOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center px-3 py-1.5 text-xs capitalize transition-colors",
                    v === scope
                      ? cn("font-semibold", t.text)
                      : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-700",
                  )}
                >
                  {v}
                  {v === scope && <span className={cn("ml-auto", t.check)}>✓</span>}
                </button>
              ))}
              <div className="border-t border-zinc-100 px-3 py-1.5 dark:border-zinc-700">
                <p className="text-[10px] leading-tight text-zinc-400">{SCOPE_HINT[scope]}</p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
