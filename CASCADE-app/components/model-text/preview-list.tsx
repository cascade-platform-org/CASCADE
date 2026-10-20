"use client";

/**
 * PreviewList — a checked change as before → after lines (ADR-0022) in the
 * LLM Design window: grouped by the change that made them, each group with a
 * tick to leave it out when the caller allows it.
 */

import { cn } from "@/lib/utils";
import type { Preview } from "@/lib/model-text";
import type { PreviewGroup } from "@/lib/model-text-v2";

/** A checked change's preview, grouped by change, with the LLM's notes. */
export type Shown = { preview: Preview; groups?: PreviewGroup[]; notes?: string };

const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";

/** Lines shown before "… N more": a preview of thousands of rows helps nobody read it. */
const PREVIEW_LINES = 400;
const TONE = {
  add: "text-green-700 dark:text-green-400",
  remove: "text-red-700 dark:text-red-400",
  change: "text-zinc-700 dark:text-zinc-300",
} as const;
const MARK = { add: "+", remove: "−", change: "~" } as const;

function Lines({ lines }: { lines: Preview["lines"] }) {
  return (
    <>
      {lines.slice(0, PREVIEW_LINES).map((l, i) => (
        <p key={i} className={cn("break-all", TONE[l.kind])}>
          {MARK[l.kind]} {l.where}
          {l.kind === "change" && <span className="text-zinc-500">: {l.before} → {l.after}</span>}
          {l.kind !== "change" && (l.after ?? l.before) !== undefined && <span className="text-zinc-500">: {l.after ?? l.before}</span>}
        </p>
      ))}
      {lines.length > PREVIEW_LINES && <p className="text-zinc-400">… {lines.length - PREVIEW_LINES} more</p>}
    </>
  );
}

/**
 * Every change as before → after; for Bulk operations, under the change that
 * made it, with what it skipped, and a tick to leave the change out.
 */
export function PreviewList({ preview, groups, notes, leaveOut, onToggle, className }: Shown & { leaveOut?: ReadonlySet<number>; onToggle?: (index: number) => void; className?: string }) {
  const { counts } = preview;
  return (
    <div className={cn("max-h-64 overflow-y-auto rounded-md border border-zinc-200 p-2 font-mono text-[11px] leading-4 dark:border-zinc-700", className)}>
      {notes && <p className="mb-1 font-sans italic text-zinc-600 dark:text-zinc-300">“{notes}”</p>}
      <p className="mb-1 font-sans font-medium text-zinc-700 dark:text-zinc-200">
        {counts.add} added · {counts.change} changed · {counts.remove} removed
      </p>
      {groups
        ? groups.map((g, i) => (
          <div key={i} className="mb-1.5">
            <p className={cn("font-sans font-medium", g.left_out ? "text-zinc-400 line-through" : "text-zinc-800 dark:text-zinc-100")}>
              {onToggle && g.index !== undefined && (
                <input
                  type="checkbox"
                  aria-label={`Include: ${g.title}`}
                  checked={!leaveOut?.has(g.index)}
                  onChange={() => onToggle(g.index!)}
                  className="mr-1 align-middle"
                />
              )}
              {g.subjects.length || g.lines.length ? (CIRCLED[i] ?? `${i + 1}.`) : "·"} {g.title}
              {g.why && <span className="font-normal text-zinc-500"> — {g.why}</span>}
              {g.left_out && <span className="ml-1 font-normal no-underline"> (left out)</span>}
            </p>
            {g.skipped.length > 0 && (
              <p className="font-sans text-amber-800 dark:text-amber-300">
                Skipped: {g.skipped.slice(0, 8).map((x) => `${x.id} (${x.reason})`).join("; ")}{g.skipped.length > 8 ? ` … ${g.skipped.length - 8} more` : ""}
              </p>
            )}
            <div className="pl-3"><Lines lines={g.lines} /></div>
          </div>
        ))
        : <Lines lines={preview.lines} />}
    </div>
  );
}
