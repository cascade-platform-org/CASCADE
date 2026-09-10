"use client";

/**
 * operativity-scorecard.tsx — Save-to-Scorecard dialog.
 *
 * Presents the user with:
 *  - A label input
 *  - Preview Operativity Scores for before_propagation and after_propagation
 *    (derived from the last propagation entry in update_history, or from an
 *    ephemeral propagation run triggered inside the dialog — no side effects)
 *  - Optional ephemeral Temporal Jump: enter hours → client-side preview
 *    (applies functionality_time countdown math only; no backend call, no side effects)
 *  - Saves the entry to the Scorecard, capturing canvas snapshots via html-to-image
 *
 * Deduplication: blocks save if before_propagation hash matches an existing entry.
 */

import { useState, useEffect, useMemo } from "react";
import { X, BookMarked, Clock, AlertTriangle, Check, Play, Loader2 } from "lucide-react";
import { nanoid } from "nanoid";
import { cn } from "@/lib/utils";
import { useCanvasStore } from "@/store/canvas-store";
import { useHistoryStore } from "@/store/history-store";
import { useScorecardStore } from "@/store/scorecard-store";
import { useConfigStore } from "@/store/config-store";
import { useUiStore } from "@/store/ui-store";
import { useAnalysisStore } from "@/store/analysis-store";
import {
  computeOperativityScore,
  operativityColor,
  hashSnapshot,
} from "@/lib/scorecard-utils";
import { runEphemeralPropagation } from "@/lib/ephemeral-propagation";
import { applyEventToSnapshot, temporalJumpEvent } from "@/lib/event-application";
import { deriveSituation, situationSnapshots, situationEventIds } from "@/lib/situation";
import type { GraphSnapshot, PropagationScorecardEntry } from "@/lib/schemas/network";


// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

interface SaveScorecardDialogProps {
  onClose: () => void;
  /** When provided, pre-selects `before` and `after` snapshots instead of reading history. */
  beforeSnapshot?: GraphSnapshot;
  afterSnapshot?: GraphSnapshot;
  /** Pre-fill label (e.g. from the event name). */
  defaultLabel?: string;
  /** Associate with one or more event ids (a scenario may stack several Events). */
  eventIds?: string[];
}

export function SaveScorecardDialog({
  onClose,
  beforeSnapshot,
  afterSnapshot,
  defaultLabel = "",
  eventIds,
}: SaveScorecardDialogProps) {
  const updateHistory = useHistoryStore((s) => s.updateHistory);
  const scorecard = useScorecardStore((s) => s.scorecard);
  const addScorecardEntry = useScorecardStore((s) => s.addScorecardEntry);
  const config = useConfigStore((s) => s.config);
  const pushToast = useUiStore((s) => s.pushToast);
  // Shared Operativity weighting (same setting the Scorecard panel exposes).
  const oiWeightAttr = useAnalysisStore((s) => s.oiWeightAttr);

  const n = config.functionality_scale.length;

  // ---------------------------------------------------------------------------
  // Resolve before/after synchronously so scores are correct on first render.
  // `after` is kept in state so the ephemeral propagation button can update it
  // without touching any store.
  // ---------------------------------------------------------------------------

  const { initialBefore, initialAfter, initialEventIds } = useMemo(() => {
    if (beforeSnapshot) {
      return { initialBefore: beforeSnapshot, initialAfter: afterSnapshot, initialEventIds: eventIds ?? [] };
    }
    // "Save current": reconstruct the Situation from history so the entry stores
    // the real before→after of the current scenario. Several Events may have
    // been stacked before a single Propagation (requirements §12.3a) — all of
    // them are captured in `event_ids`, newest-applied first. When a Propagation
    // has been run, `before` is the post-Event(s) / pre-engine state and `after`
    // is the propagated state (requirements §12.1) — i.e. the already-run
    // Propagation is captured, not discarded. When only Event(s) have been
    // applied (no Propagation yet), `after` is left empty until the user clicks
    // Run Propagation. With no Event at all it is a manual what-if: snapshot the
    // live canvas as `before`.
    const situation = deriveSituation(updateHistory);
    if (situation) {
      const { before, after } = situationSnapshots(
        situation,
        updateHistory,
        useCanvasStore.getState().toGraphSnapshot(),
      );
      return {
        initialBefore: before,
        initialAfter: after,
        initialEventIds: eventIds ?? situationEventIds(situation),
      };
    }
    return {
      initialBefore: useCanvasStore.getState().toGraphSnapshot(),
      initialAfter: undefined as GraphSnapshot | undefined,
      initialEventIds: eventIds ?? [],
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally stable — snapshots are immutable once the dialog opens

  // ---------------------------------------------------------------------------
  // Local state
  // ---------------------------------------------------------------------------

  const before = initialBefore;
  const resolvedEventIds = initialEventIds;
  const [after, setAfter] = useState<GraphSnapshot | undefined>(initialAfter);
  // Pre-fill the label from the Event(s) that set up this scenario (§12.2),
  // joined oldest-first when several were stacked, unless the caller supplied
  // an explicit default.
  const resolvedDefaultLabel =
    defaultLabel ||
    (resolvedEventIds.length > 0
      ? [...resolvedEventIds]
          .reverse()
          .map((id) => config.events.find((e) => e.id === id)?.label ?? id)
          .join(" + ")
      : "");
  const [label, setLabel] = useState(resolvedDefaultLabel);
  const [temporalHours, setTemporalHours] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [duplicate, setDuplicate] = useState(false);
  const [ephemeralPropagating, setEphemeralPropagating] = useState(false);
  const [ephemeralError, setEphemeralError] = useState<string | undefined>();

  async function handleEphemeralPropagate() {
    setEphemeralPropagating(true);
    setEphemeralError(undefined);
    try {
      const result = await runEphemeralPropagation(before);
      setAfter(result);
    } catch (err) {
      setEphemeralError(err instanceof Error ? err.message : "Propagation failed.");
    } finally {
      setEphemeralPropagating(false);
    }
  }

  const temporalJumpHours = temporalHours.trim() !== "" ? parseInt(temporalHours, 10) : undefined;
  const temporalValid = temporalJumpHours === undefined || (Number.isInteger(temporalJumpHours) && temporalJumpHours > 0);

  // A Temporal Jump preview goes through the same Event-application module the
  // canvas uses, so the dialog cannot drift from what applying it would really do.
  const temporalSnapshot: GraphSnapshot | undefined =
    temporalJumpHours && temporalValid && after
      ? applyEventToSnapshot(after, temporalJumpEvent(temporalJumpHours), n).snapshot
      : temporalJumpHours && temporalValid && !after
        ? applyEventToSnapshot(before, temporalJumpEvent(temporalJumpHours), n).snapshot
        : undefined;

  const scoreBefore = computeOperativityScore(before, n, oiWeightAttr);
  const scoreAfter = after ? computeOperativityScore(after, n, oiWeightAttr) : null;
  const scoreTemporal = temporalSnapshot ? computeOperativityScore(temporalSnapshot, n, oiWeightAttr) : null;

  // Check for duplicate on mount and when before snapshot changes
  useEffect(() => {
    let cancelled = false;
    hashSnapshot(before).then((hash) => {
      if (cancelled) return;
      Promise.all(scorecard.filter((e): e is PropagationScorecardEntry => e.type === "propagation").map((e) => hashSnapshot(e.before_propagation))).then((hashes) => {
        if (!cancelled) setDuplicate(hashes.includes(hash));
      });
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Save handler
  // ---------------------------------------------------------------------------

  async function handleSave() {
    if (!label.trim() || saving || duplicate) return;
    setSaving(true);
    try {
      const captureCanvas = useUiStore.getState().captureCanvasFn;

      // One screenshot of whatever is currently on screen — the user frames the
      // view they want before clicking Save. The same image is stored for every
      // snapshot slot so the expanded entry always shows a consistent picture.
      const image = captureCanvas ? await captureCanvas() : undefined;

      const entry: PropagationScorecardEntry = {
        type: "propagation",
        id: `sc-${nanoid(10)}`,
        label: label.trim(),
        created_at: new Date().toISOString(),
        event_ids: resolvedEventIds,
        before_propagation: before,
        after_propagation: after,
        after_temporal_jump: temporalSnapshot,
        temporal_jump_hours: temporalSnapshot ? temporalJumpHours : undefined,
        before_propagation_image: image,
        after_propagation_image: after ? image : undefined,
        after_temporal_jump_image: temporalSnapshot ? image : undefined,
      };

      addScorecardEntry(entry);
      pushToast({ message: `"${entry.label}" saved to Scorecard.`, variant: "success", durationMs: 3000 });
      onClose();
    } catch (err) {
      pushToast({ message: `Failed to save — ${err instanceof Error ? err.message : "unexpected error"}`, variant: "error", durationMs: 4000 });
    } finally {
      setSaving(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-100 px-6 py-4 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <BookMarked size={17} className="text-blue-600" />
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Save to Scorecard</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-5 px-6 py-5">
          {/* Duplicate warning */}
          {duplicate && (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800/40 dark:bg-amber-900/20">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-sm text-amber-700 dark:text-amber-400">
                An entry with the same pre-propagation state already exists. Saving again would create a duplicate.
              </p>
            </div>
          )}

          {/* Label */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Label
            </label>
            <input
              autoFocus
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") onClose(); }}
              placeholder="e.g. Flood scenario — Day 0"
              className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </div>

          {/* Operativity preview */}
          <div>
            <p className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">Operativity Score preview</p>
            <div className="flex flex-wrap items-center gap-3">
              <ScoreCard label="Before" score={scoreBefore} config={config} n={n} />
              {scoreAfter !== null && (
                <>
                  <span className="text-zinc-400">→</span>
                  <ScoreCard label="After Propagation" score={scoreAfter} config={config} n={n} />
                </>
              )}
              {scoreAfter === null && (
                <span className="text-xs text-zinc-400 italic">
                  No Propagation run yet.
                </span>
              )}
              {scoreAfter !== null && Math.abs(scoreAfter - scoreBefore) < 0.01 && (
                <span className="text-xs text-amber-500 italic">
                  Propagation made no changes — canvas may already be fully degraded. Try Reset first.
                </span>
              )}
              {/* Ephemeral propagation — runs against the engine without modifying the live canvas */}
              <button
                onClick={handleEphemeralPropagate}
                disabled={ephemeralPropagating}
                title="Run a propagation for this Scorecard entry only — does not affect the canvas"
                className={cn(
                  "ml-auto flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                  ephemeralPropagating
                    ? "cursor-not-allowed border-zinc-200 text-zinc-400 dark:border-zinc-700"
                    : "border-green-300 text-green-700 hover:bg-green-50 dark:border-green-700 dark:text-green-400 dark:hover:bg-green-900/20",
                )}
              >
                {ephemeralPropagating
                  ? <Loader2 size={12} className="animate-spin" />
                  : <Play size={12} />}
                {ephemeralPropagating ? "Running…" : after ? "Re-run Propagation" : "Run Propagation"}
              </button>
            </div>
            {ephemeralError && (
              <p className="mt-1.5 text-xs text-red-500">{ephemeralError}</p>
            )}
          </div>

          {/* Temporal jump (optional) */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Clock size={14} className="text-zinc-400" />
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Temporal Jump (optional)
              </span>
            </div>
            <p className="mb-2 text-xs text-zinc-400">
              Preview the state after advancing simulated time. Applies functionality_time countdown math
              locally — no Propagation is called; cascading effects are not computed.
            </p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                step={1}
                value={temporalHours}
                onChange={(e) => setTemporalHours(e.target.value)}
                placeholder="hours"
                className={cn(
                  "w-28 rounded-lg border px-3 py-2 text-sm focus:outline-none dark:bg-zinc-800 dark:text-zinc-100",
                  !temporalValid
                    ? "border-red-400 focus:border-red-500"
                    : "border-zinc-200 focus:border-blue-500 dark:border-zinc-700",
                )}
              />
              {scoreTemporal !== null && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-400">→</span>
                  <ScoreCard label={`+${temporalJumpHours}h`} score={scoreTemporal} config={config} n={n} />
                </div>
              )}
            </div>
            {!temporalValid && (
              <p className="mt-1 text-xs text-red-500">Must be a whole number greater than 0.</p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-zinc-100 px-6 py-4 dark:border-zinc-800">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!label.trim() || saving || !temporalValid}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors",
              !label.trim() || saving || !temporalValid
                ? "cursor-not-allowed bg-zinc-300 dark:bg-zinc-700"
                : "bg-blue-600 hover:bg-blue-700",
            )}
          >
            <Check size={14} />
            {saving ? "Saving…" : "Save entry"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Score preview card
// ---------------------------------------------------------------------------

function ScoreCard({
  label,
  score,
  config,
  n: _n,
}: {
  label: string;
  score: number;
  config: ReturnType<typeof useConfigStore.getState>["config"];
  n: number;
}) {
  const color = operativityColor(score, config);
  return (
    <div className="flex flex-col items-center rounded-lg border border-zinc-200 px-3 py-2 text-center dark:border-zinc-700">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">{label}</span>
      <span className="mt-0.5 text-lg font-bold" style={{ color }}>{score.toFixed(1)}%</span>
    </div>
  );
}
