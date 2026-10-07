"use client";

/**
 * StockEditor — a capacity that is a Stock (ADR-0020): a per-period rate with a
 * level that persists across Temporal Simulation periods. Used for a node's
 * supply in one Category and for an edge's capacity.
 *
 * The draft is kept here and committed only when it passes `StockSchema`: a
 * Stock saved with `max` below `min` would make the whole project fail to load,
 * so an invalid combination stays in the fields, with its reason, until fixed.
 */

import { useState } from "react";
import { StockSchema, type CapacityValue, type Stock } from "@/lib/schemas/network";
import { NumberInput, Toggle, cn } from "./primitives";

/** A plain capacity becomes a Stock carrying the same rate, with nothing stored yet. */
const stockFromRate = (rate: number): Stock => ({ rate, level: 0, retention: 1, efficiency: 1 });

/** A plain number becomes a Stock at that rate; a Stock goes back to its rate. */
export const toggleStock = (value: CapacityValue): CapacityValue => (typeof value === "number" ? stockFromRate(value) : value.rate);

type NumberKey = "rate" | "inflow" | "level" | "min" | "max" | "max_draw" | "max_fill" | "retention" | "efficiency";

export function StockEditor({
  stock,
  onChange,
  storageAllowed,
}: {
  stock: Stock;
  onChange: (next: Stock) => void;
  /** Nodes only: storage fills from the network of its own Category (§1c). */
  storageAllowed: boolean;
}) {
  const [draft, setDraft] = useState<Stock>(stock);
  // Re-sync when the stored Stock changes from elsewhere (undo, an Event), adjusted
  // during render as the supply editor does, rather than in an effect.
  const key = JSON.stringify(stock);
  const [prevKey, setPrevKey] = useState(key);
  if (key !== prevKey) {
    setPrevKey(key);
    setDraft(stock);
  }

  const parsed = StockSchema.safeParse(draft);
  const problem = parsed.success ? null : parsed.error.issues[0]?.message ?? "invalid";

  function update(next: Stock) {
    setDraft(next);
    const checked = StockSchema.safeParse(next);
    if (checked.success) onChange(checked.data);
  }
  const set = (k: NumberKey, v: number | undefined) => {
    const next = { ...draft, [k]: v } as Stock;
    if (v === undefined) delete (next as Partial<Stock>)[k];
    update(next);
  };

  const storage = draft.max_fill !== undefined;
  const field = (k: NumberKey, label: string, placeholder?: string, optional = true) => (
    <label className="flex flex-col gap-0.5 text-[10px] text-zinc-500 dark:text-zinc-400">
      {label}
      <NumberInput
        value={draft[k]}
        placeholder={placeholder}
        step={0.1}
        onChange={(v) => set(k, v)}
        onClear={optional ? () => set(k, undefined) : undefined}
        className="w-full"
      />
    </label>
  );

  return (
    <div className="mt-1 space-y-1.5 rounded-md border border-blue-100 bg-blue-50/40 p-2 dark:border-blue-900/50 dark:bg-blue-900/10">
      <div className="grid grid-cols-2 gap-1.5">
        {!storage && field("rate", "Rate per period", undefined, false)}
        {field("level", "Level (positive = available to draw)", undefined, false)}
        {field("min", "Min", "0")}
        {field("max", "Max", "none")}
        {field("max_draw", "Max draw per period", "no limit")}
        {field("inflow", "Inflow per period", storage ? "none" : `= rate (${draft.rate})`)}
        {field("retention", "Retention (× level)", "1", false)}
        {field("efficiency", "Efficiency (× inflow)", "1", false)}
        {storage && field("max_fill", "Max fill per period", undefined, false)}
      </div>
      {storageAllowed && (
        <Toggle
          label="Storage: fills from the network, used last"
          value={storage}
          onChange={(on) => {
            const next = { ...draft };
            if (on) {
              next.max_fill = next.max_draw ?? Math.max(0, (next.max ?? 0) - next.level);
              next.rate = 0;
            } else delete next.max_fill;
            update(next);
          }}
        />
      )}
      <p className={cn("text-[10px] leading-snug", problem ? "text-red-600 dark:text-red-400" : "text-zinc-500 dark:text-zinc-400")}>
        {problem
          ? `Not saved: ${problem}.`
          : storage
            ? "A tank: other sources serve first and the tank tops up after every consumer. A Temporal Simulation run updates its level each period."
            : "Supplies its rate plus what the level can give above Min. A Temporal Simulation run updates the level each period."}
      </p>
    </div>
  );
}
