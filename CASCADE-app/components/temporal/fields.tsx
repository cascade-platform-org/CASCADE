"use client";

/**
 * Small shared controls for the Temporal Simulation prototype window. Every
 * control takes an `onExplain` fired on focus or click, which is how the window
 * shows "what this will do" for the control being used.
 */

import React, { useState } from "react";
import { cn } from "@/lib/utils";

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

/** Parse a number input; empty → undefined. */
export const numOrUndef = (v: string): number | undefined => (v.trim() === "" || Number.isNaN(Number(v)) ? undefined : Number(v));

/** A path list shown as "a, b, c"; typed back the same way. */
export const formatPath = (path: string[]): string => path.join(", ");
export const parsePath = (text: string): string[] => text.split(",").map((p) => p.trim());

/** Numbers and booleans are typed as text and read back as their type; anything else stays a string. */
export function parseValue(text: string): number | boolean | string {
  const t = text.trim();
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
