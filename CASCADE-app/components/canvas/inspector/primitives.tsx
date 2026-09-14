"use client";

/**
 * inspector/primitives.tsx — Pure UI atoms shared across all inspector panels.
 *
 * Exports: Section, Field, TextInput, NumberInput, Toggle, SkipWarning,
 *          vulnHint, isDefined
 */

import { useState } from "react";
import { ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Layout atoms
// ---------------------------------------------------------------------------

export function Section({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-zinc-100 dark:border-zinc-800">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 px-3 py-2 text-left text-xs font-semibold uppercase tracking-widest text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {title}
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  /** One short line under the input — the default, or what the value drives. */
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-2">
      <label className="mb-0.5 block text-xs text-zinc-500 dark:text-zinc-400">{label}</label>
      {children}
      {hint && <p className="mt-0.5 text-[11px] text-zinc-400">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form inputs
// ---------------------------------------------------------------------------

export function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-800 focus:border-blue-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
    />
  );
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  placeholder,
}: {
  value: number | undefined;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Shown while the field is empty — use it for the value that applies then. */
  placeholder?: string;
}) {
  return (
    <input
      type="number"
      value={value ?? ""}
      placeholder={placeholder}
      min={min}
      max={max}
      step={step ?? 1}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-800 focus:border-blue-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
    />
  );
}

export function Toggle({
  value,
  onChange,
  label,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 rounded border-zinc-300 accent-blue-500"
      />
      {label}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Warning badge used in batch panels
// ---------------------------------------------------------------------------

export function SkipWarning({
  skipped,
  total,
  reason,
}: {
  skipped: number;
  total: number;
  reason: string;
}) {
  if (skipped === 0) return null;
  return (
    <div className="mt-1 flex items-start gap-1 rounded-md bg-amber-50 px-2 py-1 text-[10px] text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
      <AlertTriangle size={10} className="mt-0.5 shrink-0" />
      <span>
        <strong>{skipped}</strong> of {total}{" "}
        {skipped === 1 ? "element" : "elements"} will be skipped — {reason}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared pure utilities
// ---------------------------------------------------------------------------

/**
 * Vulnerability level hint string.
 * Range 0…N−1. Engine formula: imposed_functionality = N − stored_drop (clamped 1..N).
 *   0   → N   (immune, no effect)
 *   N−1 → 1   (maximum degradation)
 */
export function vulnHint(level: number, n: number): string {
  return level === 0
    ? "Immune — no effect (default)"
    : `Functionality drops to ${n - level}`;
}

/** Type-safe Boolean filter — narrows T | undefined to T. */
export function isDefined<T>(v: T | undefined): v is T {
  return v !== undefined;
}

// Shared input class used by compound inline editors (e.g. SupplyCapacityEditor)
export const INLINE_INPUT_CLASS =
  "rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-xs focus:border-blue-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200";

// Re-export cn for convenience within inspector sub-modules
export { cn };
