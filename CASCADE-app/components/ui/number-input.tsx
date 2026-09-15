"use client";

/**
 * NumberInput — one numeric field for the whole app.
 *
 * A plain `<input type="number" value={someNumber}>` fights the person typing
 * in it. The field holds text, the model holds a number, and the two disagree
 * for as long as the text is a half-finished number:
 *
 *   - a field showing `0` that is typed into without clearing first reads
 *     `05`, because `0` is still sitting there and `Number("05")` is a
 *     perfectly good 5 — so nothing ever rewrites the text;
 *   - typing `0.5` passes through `0.`, which parses to the 0 already stored,
 *     so the value prop does not change and the trailing dot is wiped;
 *   - clearing the field to retype writes `Number("") === 0` on the way.
 *
 * So the text is kept here while the field has focus, and the number is
 * published only when the text is a complete number. On blur the local text is
 * dropped and the canonical value is shown — `05` becomes `5`, `0.` becomes
 * `0` — which is also what makes a leading zero disappear the moment the user
 * moves on.
 */

import { useState } from "react";
import { cn } from "@/lib/utils";

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  placeholder,
  className,
}: {
  value: number | undefined;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Shown while the field is empty — use it for the value that applies then. */
  placeholder?: string;
  className?: string;
}) {
  /** What the user is typing. `null` = show the number we were given. */
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <input
      type="number"
      value={draft ?? value ?? ""}
      placeholder={placeholder}
      min={min}
      max={max}
      step={step ?? 1}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        // An empty or half-typed field ("", "-", "0.", "1e") publishes nothing:
        // the previous value stands until the text means something.
        const parsed = Number(raw);
        if (raw.trim() !== "" && Number.isFinite(parsed)) onChange(parsed);
      }}
      onBlur={() => {
        // A field left empty commits 0, which is what it did before the draft
        // existed — leaving it blank would keep a value the field is no longer
        // showing.
        if (draft !== null && draft.trim() === "") onChange(0);
        setDraft(null);
      }}
      className={cn(
        "rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-800 focus:border-blue-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
        className,
      )}
    />
  );
}
