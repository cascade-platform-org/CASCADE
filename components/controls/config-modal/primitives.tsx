"use client";

import React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCanvasStore } from "@/store/canvas-store";
import { useState } from "react";

export { cn };

// ---------------------------------------------------------------------------
// TextInput
// ---------------------------------------------------------------------------

export function TextInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={cn(
        "rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-800 focus:border-blue-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
        className,
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// NumberInput
// ---------------------------------------------------------------------------

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  className,
}: {
  value: number | undefined;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
}) {
  return (
    <input
      type="number"
      value={value ?? ""}
      min={min}
      max={max}
      step={step ?? 1}
      onChange={(e) => onChange(Number(e.target.value))}
      className={cn(
        "rounded border border-zinc-200 bg-white px-2 py-1 text-xs focus:border-blue-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
        className,
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// ColBtn — ghost / danger variants
// ---------------------------------------------------------------------------

export function ColBtn({
  onClick,
  children,
  variant = "ghost",
}: {
  onClick: () => void;
  children: React.ReactNode;
  variant?: "ghost" | "danger";
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors",
        variant === "danger"
          ? "text-red-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
          : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300",
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// CollapsibleSection — chevron-toggle used inside event cards
// ---------------------------------------------------------------------------

export function CollapsibleSection({
  label,
  badge,
  badgeFromStore,
  children,
}: {
  label: string;
  badge?: number;
  /** When set, reads the vulnerability level count for this eventId from canvas store. */
  badgeFromStore?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  const vulnCount = useCanvasStore((s) => {
    if (!badgeFromStore) return 0;
    let count = 0;
    for (const nd of Object.values(s.nodes)) {
      if ((nd.vulnerability_levels?.[badgeFromStore] ?? 0) > 0) count++;
    }
    for (const e of Object.values(s.edges)) {
      if ((e.vulnerability_levels?.[badgeFromStore] ?? 0) > 0) count++;
    }
    return count;
  });

  const displayBadge = badgeFromStore !== undefined ? vulnCount : badge;

  return (
    <div className="mt-2 border-t border-zinc-100 dark:border-zinc-800">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 py-2 text-left"
      >
        {open
          ? <ChevronDown size={13} className="shrink-0 text-zinc-400" />
          : <ChevronRight size={13} className="shrink-0 text-zinc-400" />
        }
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{label}</span>
        {displayBadge !== undefined && displayBadge > 0 && (
          <span className="ml-1 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
            {displayBadge}
          </span>
        )}
      </button>
      {open && <div className="pb-2">{children}</div>}
    </div>
  );
}
