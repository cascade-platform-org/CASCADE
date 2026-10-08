"use client";

/**
 * ScopePicker — the one scope Propagate, Simulate and Analyse share.
 *
 * CONTEXT.md gives the three the same vocabulary: scope is **local** (active
 * Canvas only) or **global** (full multi-canvas). One picker in front of the
 * three buttons sets it for all of them, so the scope a Propagation, a
 * Temporal Simulation run and an Analysis use is the one on screen.
 *
 * The group wears `ACTION_TONE`, the accent of the Action Bar's main actions.
 */

import React, { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type Scope = "local" | "global";

/** The look of the Action Bar's main actions: Propagate, Simulate and Analyse. */
export const ACTION_TONE = {
  border: "border-blue-300 dark:border-blue-800",
  divider: "bg-blue-200 dark:bg-blue-800",
  text: "text-blue-700 dark:text-blue-400",
  hover: "hover:bg-blue-50 dark:hover:bg-blue-900/20",
  check: "text-blue-500",
};

const SCOPE_HINT: Record<Scope, string> = {
  local: "Active canvas only — inter-canvas edges excluded",
  global: "Full multi-canvas — every canvas included",
};

export function ScopePicker({ scope, onScopeChange }: { scope: Scope; onScopeChange: (v: Scope) => void }) {
  const [open, setOpen] = useState(false);
  const t = ACTION_TONE;
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title={`Scope of Propagate, Simulate and Analyse: ${SCOPE_HINT[scope]}`}
        className={cn("flex h-7 items-center gap-1 rounded-l-md px-2 text-xs font-medium transition-colors", t.text, t.hover)}
      >
        <span className="capitalize">{scope}</span>
        <ChevronDown size={11} className={cn("transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 min-w-[96px] overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
            {(["local", "global"] as const).map((v) => (
              <button
                key={v}
                onClick={() => { onScopeChange(v); setOpen(false); }}
                className={cn(
                  "flex w-full items-center px-3 py-1.5 text-xs capitalize transition-colors",
                  v === scope ? cn("font-semibold", t.text) : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-700",
                )}
              >
                {v}
                {v === scope && <span className={cn("ml-auto", t.check)}>✓</span>}
              </button>
            ))}
            <div className="border-t border-zinc-100 px-3 py-1.5 dark:border-zinc-700">
              <p className="text-[10px] leading-tight text-zinc-400">{SCOPE_HINT[scope]}. Applies to Propagate, Simulate and Analyse.</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** One button of the main-actions group. */
export function GroupButton({
  label,
  icon,
  onClick,
  disabled = false,
  title,
  dataTour,
  id,
}: {
  label: React.ReactNode;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  /** For the guided tour. */
  dataTour?: string;
  /** DOM id a floating window flies back into on close (lib/ui-anchors.ts). */
  id?: string;
}) {
  const t = ACTION_TONE;
  return (
    <>
      <div className={cn("h-5 w-px", t.divider)} />
      <button
        id={id}
        data-tour={dataTour}
        onClick={disabled ? undefined : onClick}
        disabled={disabled}
        title={title}
        className={cn(
          "flex h-7 items-center gap-1.5 px-2.5 text-xs font-medium transition-colors last:rounded-r-md",
          t.text,
          disabled ? "cursor-not-allowed opacity-40" : t.hover,
        )}
      >
        {icon}
        <span>{label}</span>
      </button>
    </>
  );
}
