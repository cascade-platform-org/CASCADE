"use client";

/**
 * situation-window.tsx — small floating card summarising the current Situation.
 *
 * Appears over the canvas (top-right) after an Event is applied. It shows which
 * Event set up the current scenario and whether a Propagation has been run for
 * it, and gives a one-click shortcut to save exactly that Situation to the
 * Scorecard.
 *
 * The window is purely a read-out of `update_history` (via deriveSituation) — the
 * Save button opens the same Save-to-Scorecard dialog, which reconstructs the
 * identical before/after snapshots from history. There is no separate state to
 * keep in sync, so undo / redo / event-clear keep the window correct for free.
 */

import React, { useState } from "react";
import { BookMarked, X, Zap, Waves, Clock, Check, Circle, Minus } from "lucide-react";
import { resolveIcon, subscribeIconsReady } from "@/lib/category-icons";
import { useHistoryStore } from "@/store/history-store";
import { useConfigStore } from "@/store/config-store";
import { useUiStore } from "@/store/ui-store";
import { deriveSituation } from "@/lib/situation";
import { cn } from "@/lib/utils";

type EventType = "hazard" | "disservice" | "temporal_jump" | undefined;

/** Icon associated with the Event: its configured icon if any, else a type default. */
function SituationIcon({ icon, type, size }: { icon?: string; type: EventType; size: number }) {
  if (icon) {
    const Resolved = resolveIcon(icon) as React.FC<{ size?: number; strokeWidth?: number }> | null;
    if (Resolved) return <Resolved size={size} strokeWidth={2} />;
  }
  if (type === "hazard") return <Zap size={size} />;
  if (type === "disservice") return <Waves size={size} />;
  return <Clock size={size} />;
}

function iconTint(type: EventType): string {
  if (type === "hazard") return "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400";
  if (type === "disservice") return "bg-orange-50 text-orange-500 dark:bg-orange-900/20 dark:text-orange-400";
  return "bg-violet-50 text-violet-600 dark:bg-violet-900/20 dark:text-violet-400";
}

export function SituationWindow() {
  const updateHistory = useHistoryStore((s) => s.updateHistory);
  const dismissedSituationId = useUiStore((s) => s.dismissedSituationId);
  const dismissSituation = useUiStore((s) => s.dismissSituation);
  const openScorecardSaveDialog = useUiStore((s) => s.openScorecardSaveDialog);
  const getEventById = useConfigStore((s) => s.getEventById);
  const [minimized, setMinimized] = useState(false);

  // Re-render once the full icon cache is ready so a configured Event icon shows.
  const [, forceRender] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => subscribeIconsReady(forceRender), []);

  const situation = deriveSituation(updateHistory);
  if (!situation) return null;
  // The newest applied Event — identifies the Situation for dismissal purposes;
  // a newer Event brings the window back regardless of how many are stacked.
  const newestEntry = situation.eventEntries[0];
  if (newestEntry.id === dismissedSituationId) return null;

  const { eventEntries, propEntry } = situation;
  // Config events lose their definition once cleared; fall back to the stored
  // history label (stripped of its "Apply event: " prefix) per entry.
  const eventDefs = eventEntries.map((e) => (e.event_id ? getEventById(e.event_id) : undefined));
  const eventLabels = eventEntries.map(
    (e, i) => eventDefs[i]?.label ?? e.label.replace(/^Apply event:\s*/, ""),
  );
  // Oldest-first for display order ("Earthquake + Blackout"): eventEntries is newest-first.
  const combinedLabel = [...eventLabels].reverse().join(" + ");
  // Icon reflects the newest Event; a stacked scenario still reads as "what just happened".
  const eventDef = eventDefs[0];
  const eventType: EventType = eventDef?.type;
  const propagated = propEntry !== null;

  // Minimised: a compact pill showing just the Event's icon. Click to expand.
  if (minimized) {
    return (
      <button
        onClick={() => setMinimized(false)}
        title={`Situation — ${combinedLabel}`}
        className="pointer-events-auto absolute right-4 top-4 z-30 flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white/95 py-1 pl-1 pr-2.5 shadow-lg backdrop-blur-sm hover:bg-white dark:border-zinc-700 dark:bg-zinc-900/95 dark:hover:bg-zinc-900"
      >
        <span className={cn("flex h-6 w-6 items-center justify-center rounded-full", iconTint(eventType))}>
          <SituationIcon icon={eventDef?.icon} type={eventType} size={13} />
        </span>
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Situation</span>
        {propagated && <Check size={12} className="text-green-600 dark:text-green-400" />}
      </button>
    );
  }

  return (
    <div className="pointer-events-auto absolute right-4 top-4 z-30 w-64 overflow-hidden rounded-lg border border-zinc-200 bg-white/95 shadow-lg backdrop-blur-sm dark:border-zinc-700 dark:bg-zinc-900/95">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-1.5 dark:border-zinc-800">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
          Situation
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setMinimized(true)}
            title="Minimise"
            className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
          >
            <Minus size={13} />
          </button>
          <button
            onClick={() => dismissSituation(newestEntry.id)}
            title="Dismiss"
            className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="space-y-2 px-3 py-2.5">
        {/* Event applied */}
        <div className="flex items-center gap-2">
          <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-md", iconTint(eventType))}>
            <SituationIcon icon={eventDef?.icon} type={eventType} size={13} />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
              {combinedLabel}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-zinc-400">
              {eventEntries.length > 1 ? `${eventEntries.length} Events applied` : "Event applied"}
            </div>
          </div>
        </div>

        {/* Propagation status */}
        <div
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs",
            propagated
              ? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
              : "bg-zinc-50 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
          )}
        >
          {propagated ? <Check size={13} /> : <Circle size={11} />}
          {propagated ? "Propagation run" : "Propagation not run yet"}
        </div>

        {/* Save */}
        <button
          onClick={openScorecardSaveDialog}
          className="flex w-full items-center justify-center gap-1.5 rounded-md bg-blue-600 px-2 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700"
        >
          <BookMarked size={13} />
          Save to Scorecard
        </button>
      </div>
    </div>
  );
}
