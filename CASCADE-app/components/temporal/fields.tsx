"use client";

/**
 * Small shared controls for the Temporal Simulation window. Every
 * control takes an `onExplain` fired on focus or click, which is how the window
 * shows "what this will do" for the control being used.
 */

import React, { useMemo, useState } from "react";
import { AlertTriangle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useConfigStore } from "@/store/config-store";
import { useCanvasStore } from "@/store/canvas-store";
import { useTemporalSimulationStore } from "@/store/temporal-simulation-store";
import { planTimeline, type TimelinePlan } from "@/lib/timeline-plan";
import { countTargets } from "@/lib/element-filter";
import { rowOperation, type ProfileRow } from "@/lib/temporal-simulation-text";
import { explainProfileCarry, explainProfileOp, explainProfileRow } from "@/lib/temporal-simulation-explainers";
import type { EventDefinition } from "@/lib/schemas/config";

export const inputCls =
  "w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-800 focus:border-blue-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100";

export function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-0.5", className)}>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{label}</span>
      {children}
    </label>
  );
}

export function SmallButton({
  onClick,
  children,
  tone = "neutral",
  disabled,
  title,
}: {
  onClick: () => void;
  children: React.ReactNode;
  tone?: "neutral" | "accent" | "danger";
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors disabled:opacity-40",
        tone === "accent" && "border-blue-200 text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-400 dark:hover:bg-blue-900/30",
        tone === "danger" && "border-red-200 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/30",
        tone === "neutral" && "border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800",
      )}
    >
      {children}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-700">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={cn(
            "px-2.5 py-1 text-xs font-medium transition-colors",
            value === o.id ? "bg-blue-600 text-white" : "text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const NOTICE_TONE = {
  error: { box: "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300", Icon: XCircle },
  warning: { box: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300", Icon: AlertTriangle },
};

/** Messages of one tone, one per line with its icon; nothing when there are none. */
export function Notices({ tone, items, alert }: { tone: keyof typeof NOTICE_TONE; items: readonly string[]; alert?: boolean }) {
  if (items.length === 0) return null;
  const { box, Icon } = NOTICE_TONE[tone];
  return (
    <ul role={alert ? "alert" : undefined} className={cn("max-h-32 space-y-1 overflow-y-auto rounded-md border p-2 text-xs", box)}>
      {items.map((m, i) => <li key={i} className="flex gap-1.5"><Icon size={12} className="mt-0.5 shrink-0" />{m}</li>)}
    </ul>
  );
}

/** A path list shown as "a, b, c"; typed back the same way. */
export const formatPath = (path: string[]): string => path.join(", ");
export const parsePath = (text: string): string[] => text.split(",").map((p) => p.trim()).filter(Boolean);

/**
 * Numbers and booleans are typed as text and read back as their type; anything
 * else stays a string. "1,5" (a decimal comma, typed or pasted) reads as 1.5.
 */
export function parseValue(text: string): number | boolean | string {
  const t = text.trim().replace(/^(-?\d+),(\d+)$/, "$1.$2");
  if (t !== "" && !Number.isNaN(Number(t))) return Number(t);
  if (t === "true" || t === "false") return t === "true";
  return text;
}

/**
 * An input that keeps the text as typed ("1." stays "1." while a decimal is
 * entered) and reports every change. Remount it (React key) to load a new value.
 */
export function TextBackedInput({
  initial,
  onCommit,
  onFocus,
  placeholder,
  className,
}: {
  initial: string;
  onCommit: (text: string) => void;
  onFocus?: () => void;
  placeholder?: string;
  className?: string;
}) {
  const [text, setText] = useState(initial);
  return (
    <input
      className={className ?? inputCls}
      value={text}
      placeholder={placeholder}
      onFocus={onFocus}
      onChange={(e) => { setText(e.target.value); onCommit(e.target.value); }}
    />
  );
}

/** The committed Events by id, and an id's label (the id itself when unknown). */
export function useEventLookup(): { byId: Map<string, EventDefinition>; eventLabel: (id: string) => string } {
  const events = useConfigStore((s) => s.config.events);
  return useMemo(() => {
    const byId = new Map(events.map((e) => [e.id, e]));
    return { byId, eventLabel: (id: string) => byId.get(id)?.label ?? id };
  }, [events]);
}

/** The Timeline's plan, recomputed only when its Steps change (a renamed Timeline keeps it). */
export function usePlan(): TimelinePlan {
  const steps = useTemporalSimulationStore((s) => s.timeline.steps);
  return useMemo(() => planTimeline({ name: "", steps }), [steps]);
}

/** Explain a profile row: what it acts on and how many periods hold a value. */
export function describeRow(row: ProfileRow): void {
  useTemporalSimulationStore.getState().explain(
    explainProfileRow(row, countTargets(row, useCanvasStore.getState()), Object.keys(row.values).length),
  );
}

/** Explain one cell of a profile row: its operation, or the value carried into it. */
export function describeCell(row: ProfileRow, label: string, carried: string | undefined): void {
  useTemporalSimulationStore.getState().explain(
    label in row.values
      ? explainProfileOp(label, rowOperation(row, row.values[label]), countTargets(row, useCanvasStore.getState()))
      : explainProfileCarry(label, row.op, carried),
  );
}
