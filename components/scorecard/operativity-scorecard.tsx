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
 *  - Saves the entry to the Scorecard, capturing canvas snapshots via html2canvas
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
import {
  computeOperativityScore,
  operativityColor,
  hashSnapshot,
} from "@/lib/scorecard-utils";
import { buildPropagationPayload } from "@/lib/propagation-payload";
import { PropagationResultSchema } from "@/lib/schemas/api";
import type { ElementUpdate } from "@/lib/schemas/api";
import type { GraphSnapshot, ScorecardEntry } from "@/lib/schemas/network";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ---------------------------------------------------------------------------
// Ephemeral temporal jump math (client-side, no propagation call)
// ---------------------------------------------------------------------------

/**
 * Apply a temporal jump of `hours` to a snapshot.
 * For every Element with functionality_time > 0, subtract hours.
 * If result ≤ 0 → clamp functionality_time to 0 AND set functionality to 1.
 * Returns a new snapshot — does NOT mutate the input.
 */
function applyTemporalJump(snapshot: GraphSnapshot, hours: number): GraphSnapshot {
  const newNodes = { ...snapshot.nodes };
  const newEdges = { ...snapshot.edges };

  for (const [id, node] of Object.entries(newNodes)) {
    const ft = node.functionality_time ?? 0;
    if (ft > 0) {
      const remaining = ft - hours;
      newNodes[id] = {
        ...node,
        functionality_time: Math.max(0, remaining),
        ...(remaining <= 0 ? { functionality: 1 } : {}),
      };
    }
  }
  for (const [id, edge] of Object.entries(newEdges)) {
    const ft = edge.functionality_time ?? 0;
    if (ft > 0) {
      const remaining = ft - hours;
      newEdges[id] = {
        ...edge,
        functionality_time: Math.max(0, remaining),
        ...(remaining <= 0 ? { functionality: 1 } : {}),
      };
    }
  }

  return { ...snapshot, nodes: newNodes, edges: newEdges };
}

// ---------------------------------------------------------------------------
// Ephemeral propagation — calls the engine without touching any store
// ---------------------------------------------------------------------------

/** Apply ElementUpdate[] onto a GraphSnapshot copy. Pure — does not mutate input. */
function mergeUpdatesIntoSnapshot(
  snapshot: GraphSnapshot,
  updates: ElementUpdate[],
): GraphSnapshot {
  const nodes = { ...snapshot.nodes };
  const edges = { ...snapshot.edges };
  for (const u of updates) {
    if (nodes[u.id]) {
      nodes[u.id] = {
        ...nodes[u.id],
        functionality: u.functionality,
        ...(u.functionality_time !== undefined ? { functionality_time: u.functionality_time } : {}),
        ...(u.direct_damage !== undefined ? { direct_damage: u.direct_damage } : {}),
        ...(u.expected_repair_time !== undefined ? { expected_repair_time: u.expected_repair_time } : {}),
      };
    } else if (edges[u.id]) {
      edges[u.id] = {
        ...edges[u.id],
        functionality: u.functionality,
        ...(u.functionality_time !== undefined ? { functionality_time: u.functionality_time } : {}),
        ...(u.direct_damage !== undefined ? { direct_damage: u.direct_damage } : {}),
        ...(u.expected_repair_time !== undefined ? { expected_repair_time: u.expected_repair_time } : {}),
      };
    }
  }
  return { ...snapshot, nodes, edges };
}

/**
 * Send `snapshot` to the engine and return the post-propagation snapshot.
 * Writes nothing to any store — all side effects are contained to local state.
 */
async function runEphemeralPropagation(snapshot: GraphSnapshot): Promise<GraphSnapshot> {
  const canvasState = useCanvasStore.getState();
  const config = useConfigStore.getState().config;
  const scope = useUiStore.getState().propagationScope;
  const activeCanvasId = canvasState.activeCanvasId;

  // Build a minimal Project from the snapshot so buildPropagationPayload can trim it.
  const project = canvasState.toProject();
  const snapshotProject = {
    ...project,
    nodes: snapshot.nodes,
    edges: snapshot.edges,
    update_history: [],
    scorecard: [],
  };

  const payload = buildPropagationPayload({
    project: snapshotProject,
    config,
    scope,
    activeCanvasId,
  });

  const response = await fetch(`${API_BASE}/api/propagate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(`Server returned ${response.status}: ${detail}`);
  }

  const raw = await response.json();
  const result = PropagationResultSchema.parse(raw);
  return mergeUpdatesIntoSnapshot(snapshot, result.updates);
}


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
  /** Associate with an event id. */
  eventId?: string;
}

export function SaveScorecardDialog({
  onClose,
  beforeSnapshot,
  afterSnapshot,
  defaultLabel = "",
  eventId,
}: SaveScorecardDialogProps) {
  const updateHistory = useHistoryStore((s) => s.updateHistory);
  const scorecard = useScorecardStore((s) => s.scorecard);
  const addScorecardEntry = useScorecardStore((s) => s.addScorecardEntry);
  const config = useConfigStore((s) => s.config);
  const pushToast = useUiStore((s) => s.pushToast);

  const n = config.functionality_scale.length;

  // ---------------------------------------------------------------------------
  // Resolve before/after synchronously so scores are correct on first render.
  // `after` is kept in state so the ephemeral propagation button can update it
  // without touching any store.
  // ---------------------------------------------------------------------------

  const { initialBefore, initialAfter, initialEventId } = useMemo(() => {
    if (beforeSnapshot) {
      return { initialBefore: beforeSnapshot, initialAfter: afterSnapshot, initialEventId: eventId };
    }
    const propEntry = updateHistory.find((e) => e.update_type === "propagation");
    if (propEntry) {
      const propIdx = updateHistory.indexOf(propEntry);
      // History is newest-first (unshift). Entries before propIdx are newer —
      // the event that triggered this propagation sits immediately before it.
      const evEntry = !eventId && propIdx > 0
        ? updateHistory.slice(0, propIdx).find((e) => e.update_type === "event_applied")
        : undefined;
      return {
        initialBefore: propEntry.before,
        initialAfter: propEntry.after as GraphSnapshot | undefined,
        initialEventId: eventId ?? evEntry?.event_id,
      };
    }
    return {
      initialBefore: useCanvasStore.getState().toGraphSnapshot(),
      initialAfter: undefined as GraphSnapshot | undefined,
      initialEventId: eventId,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally stable — snapshots are immutable once the dialog opens

  // ---------------------------------------------------------------------------
  // Local state
  // ---------------------------------------------------------------------------

  const before = initialBefore;
  const resolvedEventId = initialEventId;
  const [after, setAfter] = useState<GraphSnapshot | undefined>(initialAfter);
  const [label, setLabel] = useState(defaultLabel);
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

  const temporalSnapshot: GraphSnapshot | undefined =
    temporalJumpHours && temporalValid && after
      ? applyTemporalJump(after, temporalJumpHours)
      : temporalJumpHours && temporalValid && !after
        ? applyTemporalJump(before, temporalJumpHours)
        : undefined;

  const scoreBefore = computeOperativityScore(before, n);
  const scoreAfter = after ? computeOperativityScore(after, n) : null;
  const scoreTemporal = temporalSnapshot ? computeOperativityScore(temporalSnapshot, n) : null;

  // Check for duplicate on mount and when before snapshot changes
  useEffect(() => {
    let cancelled = false;
    hashSnapshot(before).then((hash) => {
      if (cancelled) return;
      Promise.all(scorecard.map((e) => hashSnapshot(e.before_propagation))).then((hashes) => {
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

      const entry: ScorecardEntry = {
        id: `sc-${nanoid(10)}`,
        label: label.trim(),
        created_at: new Date().toISOString(),
        event_id: resolvedEventId,
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
  n,
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
