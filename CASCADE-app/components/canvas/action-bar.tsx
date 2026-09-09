"use client";

/**
 * ActionBar — sits below the Topbar.
 *
 * Left zone:  [▶ Propagate] [↺ Reset] [Undo] [Redo]
 * Divider
 * Event zone: [⚡ Ev1] ... [⚡ Ev5] [More ▼] [+]
 * Divider
 * Temporal:   [⏱ Time ▾]
 */

import React, { useState, useRef, useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { Play, RotateCcw, Plus, ChevronDown, Zap, Waves, Undo2, Redo2, Clock, SkipForward, ChevronsRight, BarChart2 } from "lucide-react";
import { resolveIcon, subscribeIconsReady } from "@/lib/category-icons";
import { cn } from "@/lib/utils";
import type { GraphSnapshot } from "@/lib/schemas/network";
import type { EventDefinition } from "@/lib/schemas/config";
import { useUiStore } from "@/store/ui-store";
import { useAnalysisStore } from "@/store/analysis-store";
import {
  useConfigStore,
  selectActionBarEvents,
  selectOverflowEvents,
  selectN,
} from "@/store/config-store";
import { temporalJumpEvent } from "@/lib/event-application";
import { useCanvasStore } from "@/store/canvas-store";
import { useHistoryStore } from "@/store/history-store";
import { runWithHistory } from "@/lib/run-with-history";
import { useNetworkHistory } from "@/hooks/useNetworkHistory";
import { usePropagate } from "@/hooks/usePropagate";
import { useAuthStore } from "@/store/auth-store";
import { resetFunctionality } from "@/lib/network-utils";

// Shared core for both revert call-sites (bar button + panel button).
// Restores the pre-jump snapshot, records a history entry, and clears elapsed
// state. Callers are responsible for their own trailing side effects (toast,
// snapshot-tick refresh).
function executeRevert({
  revertSnapshot,
  elapsedHours,
  scope,
  clearTemporalJumpProgress,
}: {
  revertSnapshot: GraphSnapshot;
  elapsedHours: number;
  scope: "local" | "global";
  clearTemporalJumpProgress: () => void;
}) {
  // `temporal_jump_revert`, not a plain manual edit: the Situation track has to
  // recognise it and rewind to the scenario that was live before the jumps —
  // otherwise the canvas shows the pre-jump state while the Situation window
  // still reports the jumps and their Propagation.
  runWithHistory(
    () => useCanvasStore.getState().restoreSnapshot(revertSnapshot),
    `Revert temporal jumps (−${elapsedHours}h)`,
    {
      scope,
      updateType: "temporal_jump_revert",
      revertsToEntryId: useUiStore.getState().temporalJumpRevertFromEntryId,
    },
  );
  clearTemporalJumpProgress();
}

export function ActionBar() {
  const openAnalysisPage = useAnalysisStore((s) => s.openAnalysisPage);
  const scope = useUiStore((s) => s.propagationScope);
  const setPropagationScope = useUiStore((s) => s.setPropagationScope);
  const openConfigModal = useUiStore((s) => s.openConfigModal);
  const pushToast = useUiStore((s) => s.pushToast);
  const revertSnapshot = useUiStore((s) => s.temporalJumpRevertSnapshot);
  const elapsedHours = useUiStore((s) => s.temporalJumpElapsedHours);
  const clearTemporalJumpProgress = useUiStore((s) => s.clearTemporalJumpProgress);
  const globalViewActive = useUiStore((s) => s.globalViewActive);

  const actionBarEvents = useConfigStore(useShallow(selectActionBarEvents));
  const overflowEvents = useConfigStore(useShallow(selectOverflowEvents));
  const n = useConfigStore(selectN);

  const { undo, redo, canUndo, canRedo } = useNetworkHistory();
  const { propagate, isPropagating, serverReachable } = usePropagate();
  const canPropagate = useAuthStore((s) => s.hasPermission("can_propagate"));

  const [moreOpen, setMoreOpen] = useState(false);

  function handleRevertFromBar() {
    if (!revertSnapshot || elapsedHours === 0) return;
    executeRevert({ revertSnapshot, elapsedHours, scope, clearTemporalJumpProgress });
    pushToast({ message: `Reverted −${elapsedHours}h of temporal jumps.`, variant: "success", durationMs: 3000 });
  }

  function handleReset() {
    resetFunctionality({ n, scope, globalViewActive });
  }

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-zinc-200 bg-white px-3 dark:border-zinc-800 dark:bg-zinc-900">
      {/* Split Propagate button */}
      <PropagateSplitButton
        scope={scope}
        onPropagate={propagate}
        onScopeChange={setPropagationScope}
        disabled={!serverReachable || isPropagating || !canPropagate}
        loading={isPropagating}
        serverReachable={serverReachable}
      />

      {/* Analyse */}
      <ActionButton
        onClick={openAnalysisPage}
        title="Open Topological Analysis"
        className="text-indigo-600 dark:text-indigo-400"
      >
        <BarChart2 size={13} />
        <span>Analyse</span>
      </ActionButton>

      {/* Reset */}
      <span data-tour="reset" className="flex items-center">
        <ActionButton
          onClick={handleReset}
          title={scope === "local" ? "Reset active canvas elements to Functionality N" : "Reset all elements to Functionality N"}
          className="text-zinc-600 dark:text-zinc-400"
        >
          <RotateCcw size={13} />
          <span>Reset</span>
        </ActionButton>
      </span>

      {/* Undo */}
      <ActionButton onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)" className="text-zinc-600 dark:text-zinc-400">
        <Undo2 size={13} />
      </ActionButton>

      {/* Redo */}
      <ActionButton onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)" className="text-zinc-600 dark:text-zinc-400">
        <Redo2 size={13} />
      </ActionButton>

      {/* Divider */}
      <div className="mx-1.5 h-5 w-px bg-zinc-200 dark:bg-zinc-700" />

      {/* Event buttons */}
      <span data-tour="events" className="flex items-center gap-1">
        {actionBarEvents.map((ev) => (
          <EventButton key={ev.id} event={ev} pushToast={pushToast} />
        ))}
      </span>

      {/* More ▼ */}
      {overflowEvents.length > 0 && (
        <div className="relative">
          <ActionButton onClick={() => setMoreOpen((v) => !v)} className="text-zinc-500">
            <span>More</span>
            <ChevronDown size={12} className={cn("transition-transform", moreOpen && "rotate-180")} />
          </ActionButton>
          {moreOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)} />
              <div className="absolute left-0 top-full z-50 mt-1 min-w-[160px] rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
                {overflowEvents.map((ev) => (
                  <button
                    key={ev.id}
                    onClick={() => { setMoreOpen(false); }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-700"
                  >
                    <EventIcon type={ev.type} icon={ev.icon} size={13} />
                    {ev.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* + shortcut → Config Events tab */}
      <button
        onClick={() => openConfigModal("events")}
        title="Add event (opens Config)"
        className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
      >
        <Plus size={13} />
      </button>

      {/* Divider */}
      <div className="mx-1.5 h-5 w-px bg-zinc-200 dark:bg-zinc-700" />

      {/* Temporal Jump controls */}
      <span data-tour="temporal" className="flex items-center">
        <TemporalJumpControls propagate={propagate} isPropagating={isPropagating} />
      </span>

      {/* Persistent revert — visible whenever temporal jumps are pending, even with panel closed */}
      {revertSnapshot && elapsedHours > 0 && (
        <ActionButton
          onClick={handleRevertFromBar}
          title={`Revert all temporal jumps applied in this session (−${elapsedHours}h)`}
          className="text-zinc-500 hover:text-red-600 dark:hover:text-red-400"
        >
          <RotateCcw size={12} />
          <span>−{elapsedHours}h</span>
        </ActionButton>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Temporal Jump controls
// ---------------------------------------------------------------------------

const MAX_AUTO_ADVANCE_STEPS = 50;

function TemporalJumpControls({
  propagate,
  isPropagating,
}: {
  propagate: () => Promise<boolean>;
  isPropagating: boolean;
}) {
  const n = useConfigStore(selectN);
  const scope = useUiStore((s) => s.propagationScope);
  const autoPropagate = useUiStore((s) => s.temporalAutoPropagate);
  const setAutoPropagate = useUiStore((s) => s.setTemporalAutoPropagate);
  const revertSnapshot = useUiStore((s) => s.temporalJumpRevertSnapshot);
  const elapsedHours = useUiStore((s) => s.temporalJumpElapsedHours);
  const saveTemporalRevertSnapshot = useUiStore((s) => s.saveTemporalRevertSnapshot);
  const addTemporalElapsedHours = useUiStore((s) => s.addTemporalElapsedHours);
  const clearTemporalJumpProgress = useUiStore((s) => s.clearTemporalJumpProgress);
  const pushToast = useUiStore((s) => s.pushToast);

  // Live ft values from the store — used to build ticks when the popover opens.
  const liveTicks = useCanvasStore(useShallow((s) => {
    const seen = new Set<number>();
    for (const node of Object.values(s.nodes)) {
      const ft = node.functionality_time ?? 0;
      if (ft > 0) seen.add(ft);
    }
    for (const edge of Object.values(s.edges)) {
      const ft = edge.functionality_time ?? 0;
      if (ft > 0) seen.add(ft);
    }
    return Array.from(seen).sort((a, b) => a - b);
  }));

  const [open, setOpen] = useState(false);
  const [manualHours, setManualHours] = useState("");
  const [isAutoAdvancing, setIsAutoAdvancing] = useState(false);
  // Snapshot of ticks: when jumps are in progress use the pre-jump ticks (stable);
  // otherwise use live ticks. Pre-jump ticks are derived from revertSnapshot.
  const [snapshotTicks, setSnapshotTicks] = useState<number[]>([]);
  const cancelRef = useRef(false);

  // When popover opens: re-derive snapshot ticks from the revert snapshot if present,
  // or from live ticks if no jumps have been applied yet. Don't reset elapsed/revert.
  useEffect(() => {
    if (open) {
      setManualHours("");
      if (revertSnapshot) {
        // Derive ticks from the pre-jump state so the full original range is visible.
        const seen = new Set<number>();
        for (const node of Object.values(revertSnapshot.nodes)) {
          const ft = node.functionality_time ?? 0;
          if (ft > 0) seen.add(ft);
        }
        for (const edge of Object.values(revertSnapshot.edges)) {
          const ft = edge.functionality_time ?? 0;
          if (ft > 0) seen.add(ft);
        }
        setSnapshotTicks(Array.from(seen).sort((a, b) => a - b));
      } else {
        setSnapshotTicks(liveTicks);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const busy = isPropagating || isAutoAdvancing;
  // Use snapshot ticks when jumps are in progress (stable original range).
  // Fall back to live ticks when no jumps have been applied yet.
  const displayTicks = (revertSnapshot !== null || isAutoAdvancing) ? snapshotTicks : liveTicks;
  const maxHours = displayTicks[displayTicks.length - 1] ?? 0;

  function getMinFt(): number | null {
    const state = useCanvasStore.getState();
    const allFt = [
      ...Object.values(state.nodes).map((node) => node.functionality_time ?? 0),
      ...Object.values(state.edges).map((edge) => edge.functionality_time ?? 0),
    ].filter((ft) => ft > 0);
    if (allFt.length === 0) return null;
    return Math.min(...allFt);
  }

  async function applyJump(hours: number) {
    const event = temporalJumpEvent(hours);
    const canvasState = useCanvasStore.getState();
    // Save pre-jump state on the very first jump so revert can restore it.
    if (revertSnapshot === null) {
      // The newest entry now is where the jumps start — the revert records it
      // so the Situation can be rewound to what was live before them.
      saveTemporalRevertSnapshot(
        canvasState.toGraphSnapshot(),
        useHistoryStore.getState().updateHistory[0]?.id ?? null,
      );
    }
    // applyEvent pushes its own event_applied entry (with mutation_reversal) —
    // pushing a second one here would double the undo stack per jump and let
    // clearEvent find the reversal-less duplicate first.
    canvasState.applyEvent(event, n);
    addTemporalElapsedHours(hours);
    if (autoPropagate) {
      await propagate();
    }
  }

  async function handleManualJump() {
    const hours = parseInt(manualHours, 10);
    if (!Number.isInteger(hours) || hours < 1) return;
    await applyJump(hours);
    setManualHours("");
  }

  async function handleStep() {
    const minFt = getMinFt();
    if (minFt === null) {
      pushToast({ message: "No elements have Functionality Time > 0.", variant: "info", durationMs: 3000 });
      return;
    }
    // Keep popover open during step so timeline is visible.
    await applyJump(minFt);
  }

  async function handlePlay() {
    setIsAutoAdvancing(true);
    cancelRef.current = false;
    let steps = 0;

    while (!cancelRef.current && steps < MAX_AUTO_ADVANCE_STEPS) {
      const minFt = getMinFt();
      if (minFt === null) break;
      await applyJump(minFt);
      steps++;
    }

    setIsAutoAdvancing(false);

    if (steps >= MAX_AUTO_ADVANCE_STEPS) {
      pushToast({
        message: `Auto-advance stopped after ${MAX_AUTO_ADVANCE_STEPS} steps — check for elements stuck with Functionality Time.`,
        variant: "warning",
        durationMs: 6000,
      });
    } else if (steps > 0) {
      pushToast({
        message: `Auto-advance complete — ${steps} step${steps !== 1 ? "s" : ""} applied.`,
        variant: "success",
        durationMs: 4000,
      });
    }
  }

  function handleRevert() {
    if (!revertSnapshot || elapsedHours === 0) return;
    executeRevert({ revertSnapshot, elapsedHours, scope, clearTemporalJumpProgress });
    pushToast({ message: `Reverted −${elapsedHours}h of temporal jumps.`, variant: "success", durationMs: 3000 });
  }

  const manualValid =
    manualHours.trim() !== "" &&
    Number.isInteger(parseInt(manualHours, 10)) &&
    parseInt(manualHours, 10) >= 1;

  return (
    <div className="relative">
      <ActionButton
        onClick={() => { if (!busy) setOpen((v) => !v); }}
        disabled={busy}
        title="Temporal Jump controls"
        className={cn("gap-1 text-violet-600 dark:text-violet-400", busy && "opacity-40")}
      >
        <Clock size={13} className={cn(isAutoAdvancing && "animate-pulse")} />
        <span>{isAutoAdvancing ? "Advancing…" : "Time"}</span>
        <ChevronDown size={11} className={cn("transition-transform", open && "rotate-180")} />
      </ActionButton>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">

            {/* Timeline slider — only shown when elements have Functionality Time */}
            {maxHours > 0 && (
              <>
                <div className="px-4 pt-3 pb-1">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
                      Timeline
                      {elapsedHours > 0 && (
                        <span className="ml-2 normal-case font-normal text-violet-500">
                          +{elapsedHours}h
                        </span>
                      )}
                    </p>
                    {elapsedHours > 0 && !isAutoAdvancing && (
                      <button
                        onClick={handleRevert}
                        title={`Revert all temporal jumps (−${elapsedHours}h)`}
                        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                      >
                        ↩ Revert
                      </button>
                    )}
                  </div>
                  <TimelineSlider
                    ticks={displayTicks}
                    maxHours={maxHours}
                    elapsed={elapsedHours}
                    readOnly={isAutoAdvancing}
                    onSeek={(h) => setManualHours(String(h))}
                  />
                </div>
                <div className="border-t border-zinc-100 dark:border-zinc-800" />
              </>
            )}

            {/* Manual jump */}
            <div className="px-3 pt-3 pb-2">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-400">Manual jump</p>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={manualHours}
                  onChange={(e) => setManualHours(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && manualValid) handleManualJump(); }}
                  placeholder="hours"
                  className="w-20 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs focus:border-violet-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />
                <button
                  onClick={handleManualJump}
                  disabled={!manualValid}
                  className="flex items-center gap-1 rounded-md bg-violet-600 px-2 py-1 text-xs font-medium text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Play size={10} />
                  Jump
                </button>
              </div>
            </div>

            <div className="border-t border-zinc-100 dark:border-zinc-800" />

            {/* Auto-advance */}
            <div className="px-3 py-2">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-400">Auto-advance</p>
              <div className="flex gap-1.5">
                <button
                  onClick={handleStep}
                  disabled={isAutoAdvancing}
                  className="flex flex-1 items-center justify-center gap-1 rounded-md border border-zinc-200 px-2 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  title="Jump to next expiry (minimum Functionality Time)"
                >
                  <SkipForward size={11} />
                  Step
                </button>
                <button
                  onClick={isAutoAdvancing ? () => { cancelRef.current = true; } : handlePlay}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-xs font-medium",
                    isAutoAdvancing
                      ? "border-red-200 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
                      : "border-violet-200 text-violet-600 hover:bg-violet-50 dark:border-violet-800 dark:text-violet-400 dark:hover:bg-violet-900/20",
                  )}
                  title={isAutoAdvancing ? "Stop auto-advance" : "Run to completion"}
                >
                  <ChevronsRight size={11} />
                  {isAutoAdvancing ? "Stop" : "Play"}
                </button>
              </div>
            </div>

            <div className="border-t border-zinc-100 dark:border-zinc-800" />

            {/* Auto-propagate toggle */}
            <div className="px-3 py-2.5">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={autoPropagate}
                  onChange={(e) => setAutoPropagate(e.target.checked)}
                  className="h-3 w-3 rounded accent-violet-600"
                />
                <span className="text-xs text-zinc-600 dark:text-zinc-400">Auto-propagate</span>
              </label>
              <p className="mt-0.5 pl-5 text-[10px] text-zinc-400">
                Uses current scope ({scope})
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timeline slider
// ---------------------------------------------------------------------------

function TimelineSlider({
  ticks,
  maxHours,
  elapsed,
  readOnly,
  onSeek,
}: {
  ticks: number[];
  maxHours: number;
  elapsed: number;
  readOnly: boolean;
  onSeek: (hours: number) => void;
}) {
  // Percentage along the track for a given hour value.
  const pct = (h: number) => Math.min(100, (h / maxHours) * 100);

  // Decide which tick labels to show: if ticks are very close together, skip
  // intermediate labels to avoid overlap. Minimum spacing: ~28px in a ~224px track.
  const TRACK_PX = 224; // w-72 minus padding
  const MIN_LABEL_SPACING_PCT = (28 / TRACK_PX) * 100;
  const showLabel = ticks.reduce<{ last: number; flags: boolean[] }>(
    (acc, t) => {
      const p = pct(t);
      const show = p - acc.last >= MIN_LABEL_SPACING_PCT;
      acc.flags.push(show);
      return show ? { last: p, flags: acc.flags } : acc;
    },
    { last: -Infinity, flags: [] },
  ).flags;

  return (
    // Extra bottom padding to hold tick labels (positioned absolutely below the track).
    <div className="relative pb-5 select-none">
      {/* Track background */}
      <div className="relative h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-700">
        {/* Elapsed fill */}
        <div
          className="absolute left-0 top-0 h-full rounded-full bg-violet-500 transition-all duration-300"
          style={{ width: `${pct(elapsed)}%` }}
        />

        {/* Tick marks on the track */}
        {ticks.map((t) => (
          <div
            key={t}
            className="absolute top-0 h-full w-px bg-zinc-400/60 dark:bg-zinc-500/60"
            style={{ left: `${pct(t)}%` }}
          />
        ))}

        {/* Thumb */}
        <div
          className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-violet-600 bg-white shadow-sm transition-all duration-300 dark:bg-zinc-900"
          style={{ left: `${pct(elapsed)}%` }}
        />
      </div>

      {/* Tick labels below the track */}
      {ticks.map((t, i) => (
        <button
          key={t}
          disabled={readOnly}
          onClick={() => onSeek(t)}
          title={`Jump to ${t}h`}
          className={cn(
            "absolute top-2.5 -translate-x-1/2 text-[9px] leading-none transition-colors",
            readOnly
              ? "cursor-default text-zinc-400 dark:text-zinc-500"
              : "cursor-pointer text-zinc-400 hover:text-violet-500 dark:text-zinc-500 dark:hover:text-violet-400",
            // Always show a tick line; only show the number label when there's room.
            !showLabel[i] && "opacity-0 pointer-events-none",
          )}
          style={{ left: `${pct(t)}%` }}
        >
          {t >= 1000 ? `${Math.round(t / 1000)}k` : t}h
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Split Propagate button
// ---------------------------------------------------------------------------

function PropagateSplitButton({
  scope,
  onPropagate,
  onScopeChange,
  disabled,
  loading,
  serverReachable,
}: {
  scope: "local" | "global";
  onPropagate: () => void;
  onScopeChange: (v: "local" | "global") => void;
  disabled: boolean;
  loading: boolean;
  serverReachable: boolean;
}) {
  const [scopeOpen, setScopeOpen] = useState(false);

  const title = !serverReachable
    ? "Server unreachable — your data is safe locally"
    : `Run ${scope} propagation (Ctrl+Enter)`;

  return (
    <div
      data-tour="propagate"
      className="flex items-center rounded-md border border-green-300 dark:border-green-800"
    >
      <button
        onClick={disabled ? undefined : onPropagate}
        disabled={disabled}
        title={title}
        className={cn(
          "flex h-7 items-center gap-1.5 rounded-l-md px-2.5 text-xs font-medium transition-colors",
          "text-green-700 dark:text-green-400",
          disabled
            ? "cursor-not-allowed opacity-40"
            : "hover:bg-green-50 dark:hover:bg-green-900/20",
        )}
      >
        <Play size={12} className={cn(loading && "animate-pulse")} />
        <span>{loading ? "Running…" : "Propagate"}</span>
      </button>

      <div className="h-5 w-px bg-green-200 dark:bg-green-800" />

      <div className="relative">
        <button
          onClick={() => setScopeOpen((v) => !v)}
          title="Switch propagation scope"
          className="flex h-7 items-center gap-1 rounded-r-md px-2 text-xs font-medium text-green-700 transition-colors hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/20"
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
                  onClick={() => { onScopeChange(v); setScopeOpen(false); }}
                  className={cn(
                    "flex w-full items-center px-3 py-1.5 text-xs capitalize transition-colors",
                    v === scope
                      ? "font-semibold text-green-700 dark:text-green-400"
                      : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-700",
                  )}
                >
                  {v}
                  {v === scope && <span className="ml-auto text-green-500">✓</span>}
                </button>
              ))}
              <div className="border-t border-zinc-100 px-3 py-1.5 dark:border-zinc-700">
                <p className="text-[10px] leading-tight text-zinc-400">
                  {scope === "local"
                    ? "Active canvas only — inter-canvas edges excluded"
                    : "Full multi-canvas — all canvases sent to engine"}
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event button
// ---------------------------------------------------------------------------

function EventButton({
  event,
  pushToast,
}: {
  event: EventDefinition;
  pushToast: ReturnType<typeof useUiStore.getState>["pushToast"];
}) {
  // Force a re-render once the full icon cache is ready so the stored icon shows immediately.
  const [, forceRender] = React.useReducer((n: number) => n + 1, 0);
  useEffect(() => subscribeIconsReady(forceRender), []);

  function applyEvent() {
    const storeState = useCanvasStore.getState();
    if (!storeState.activeCanvasId) return;

    const N = useConfigStore.getState().getFunctionalityN();
    const snapshotBefore = storeState.toGraphSnapshot();

    storeState.applyEvent(event, N);

    const snapshotAfter = useCanvasStore.getState().toGraphSnapshot();
    const affected = countChangedElements(snapshotBefore, snapshotAfter);

    pushToast({
      message: affected > 0
        ? `${event.label} applied — ${affected} element${affected > 1 ? "s" : ""} affected`
        : `${event.label} applied — no elements matched this event`,
      variant: affected > 0 ? (event.type === "hazard" ? "error" : "warning") : "info",
      durationMs: 3500,
    });
  }

  return (
    <ActionButton
      onClick={applyEvent}
      title={`Apply: ${event.label} (Escape to clear)`}
      className={cn(
        "gap-1",
        event.type === "hazard"
          ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
          : "text-orange-500 hover:bg-orange-50 dark:text-orange-400 dark:hover:bg-orange-900/20",
      )}
    >
      <EventIcon type={event.type} icon={event.icon} size={13} />
      <span className="max-w-[80px] truncate">{event.label}</span>
    </ActionButton>
  );
}

function countChangedElements(before: GraphSnapshot, after: GraphSnapshot): number {
  // The store is Immer-backed (canvas-store.ts): applying an event `set`s a
  // fresh object reference only for the nodes/edges it actually touches,
  // untouched ones keep their old reference. So a plain reference check
  // catches ANY mutated field (functionality_time, category_dependency_profiles,
  // direct_damage, ...), not just `functionality` — a Disservice like
  // "Demand Surge" or "Tank Reserve" changes fields other than functionality
  // by design (the element stays fully functional until its own countdown/
  // condition triggers), so checking functionality alone always reported
  // "no elements matched" for those events even though the mutation landed.
  let count = 0;
  for (const id of Object.keys(after.nodes)) {
    if (before.nodes[id] !== after.nodes[id]) count++;
  }
  for (const id of Object.keys(after.edges)) {
    if (before.edges[id] !== after.edges[id]) count++;
  }
  return count;
}

function EventIcon({ type, icon, size }: { type: "hazard" | "disservice" | "temporal_jump"; icon?: string; size: number }) {
  if (icon) {
    const Resolved = resolveIcon(icon) as React.FC<{ size?: number; strokeWidth?: number }> | null;
    if (Resolved) return <Resolved size={size} strokeWidth={2} />;
  }
  if (type === "temporal_jump") return <Clock size={size} />;
  return type === "hazard" ? <Zap size={size} /> : <Waves size={size} />;
}

// ---------------------------------------------------------------------------
// Generic action button
// ---------------------------------------------------------------------------

function ActionButton({
  onClick,
  disabled,
  title,
  className,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      title={title}
      disabled={disabled}
      className={cn(
        "flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors",
        "hover:bg-zinc-100 dark:hover:bg-zinc-800",
        disabled && "cursor-not-allowed opacity-40",
        className,
      )}
    >
      {children}
    </button>
  );
}
