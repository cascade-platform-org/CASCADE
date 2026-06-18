"use client";

/**
 * scorecard-panel.tsx — Full-screen overlay listing all saved Scorecard entries.
 *
 * Displays per-entry Operativity Scores, collapsible canvas snapshots,
 * a ZIP export button, and per-entry delete.
 * The "Save to Scorecard" dialog (operativity-scorecard.tsx) is triggered
 * from here (or from the ActionBar after a Propagation).
 */

import { useState, useEffect, useMemo } from "react";
import { X, Download, Trash2, ChevronDown, BookMarked, PlusCircle, AlertTriangle, Play, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCanvasStore } from "@/store/canvas-store";
import { useScorecardStore } from "@/store/scorecard-store";
import { useConfigStore } from "@/store/config-store";
import { useUiStore } from "@/store/ui-store";
import { useHistoryStore } from "@/store/history-store";
import {
  computeOperativityScore,
  operativityColor,
  exportScorecardZip,
  findUnsavedRuns,
  findUncoveredEvents,
  type UnsavedRun,
  type UncoveredEvent,
} from "@/lib/scorecard-utils";
import { runEphemeralPropagation } from "@/lib/ephemeral-propagation";
import { resetFunctionality } from "@/lib/network-utils";
import { SaveScorecardDialog } from "./operativity-scorecard";
import { SnapshotFlowView } from "./snapshot-flow-view";
import type { GraphSnapshot, ScorecardEntry, PropagationScorecardEntry, AnalysisScorecardEntry } from "@/lib/schemas/network";

export function ScorecardPanel() {
  const close = useUiStore((s) => s.closeScorecardPanel);
  const scorecard = useScorecardStore((s) => s.scorecard);
  const updateScorecardEntry = useScorecardStore((s) => s.updateScorecardEntry);
  const removeScorecardEntry = useScorecardStore((s) => s.removeScorecardEntry);
  const projectMeta = useCanvasStore((s) => s.projectMeta);
  const config = useConfigStore((s) => s.config);
  const updateHistory = useHistoryStore((s) => s.updateHistory);
  const pushToast = useUiStore((s) => s.pushToast);
  const serverReachable = useUiStore((s) => s.serverReachable);
  const scope = useUiStore((s) => s.propagationScope);
  const globalViewActive = useUiStore((s) => s.globalViewActive);

  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveDialogProps, setSaveDialogProps] = useState<{
    beforeSnapshot?: GraphSnapshot;
    afterSnapshot?: GraphSnapshot;
    defaultLabel?: string;
    eventId?: string;
  }>({});
  const [exporting, setExporting] = useState(false);

  // Gap detection (async — SHA-256 hashing)
  const [unsavedRuns, setUnsavedRuns] = useState<UnsavedRun[]>([]);
  const [computingGaps, setComputingGaps] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setComputingGaps(true);
    findUnsavedRuns(updateHistory, scorecard).then((runs) => {
      if (!cancelled) { setUnsavedRuns(runs); setComputingGaps(false); }
    });
    return () => { cancelled = true; };
  }, [updateHistory, scorecard]);

  const uncoveredEvents = useMemo(
    () => findUncoveredEvents(config, scorecard),
    [config, scorecard],
  );

  const incompleteEntries = useMemo(
    () => scorecard.filter((e): e is PropagationScorecardEntry => e.type === "propagation" && !e.after_propagation),
    [scorecard],
  );

  const hasGaps = unsavedRuns.length > 0 || incompleteEntries.length > 0 || uncoveredEvents.length > 0;

  function openSaveDialog(props: typeof saveDialogProps = {}) {
    setSaveDialogProps(props);
    setSaveDialogOpen(true);
  }

  const n = config.functionality_scale.length;

  async function handleExport() {
    if (scorecard.length === 0) return;
    setExporting(true);
    try {
      await exportScorecardZip(scorecard, config, projectMeta.name);
    } catch (err) {
      pushToast({ message: "Export failed — see console for details.", variant: "error", durationMs: 4000 });
      console.error(err);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div className="flex h-[90dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-100 px-6 py-4 dark:border-zinc-800">
          <div className="flex items-center gap-2.5">
            <BookMarked size={18} className="text-blue-600" />
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Scorecard</h2>
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              {scorecard.length} {scorecard.length === 1 ? "entry" : "entries"}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => openSaveDialog()}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
            >
              <PlusCircle size={14} />
              Save current
            </button>

            <button
              onClick={handleExport}
              disabled={scorecard.length === 0 || exporting}
              title="Export as ZIP (scorecard.md + images)"
              className={cn(
                "flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium transition-colors dark:border-zinc-700",
                scorecard.length === 0 || exporting
                  ? "cursor-not-allowed opacity-40 text-zinc-400"
                  : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800",
              )}
            >
              <Download size={14} />
              {exporting ? "Exporting…" : "Export ZIP"}
            </button>

            <button
              onClick={close}
              className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Gap detection */}
          {(hasGaps || computingGaps) && (
            <GapsSection
              unsavedRuns={unsavedRuns}
              incompleteEntries={incompleteEntries}
              uncoveredEvents={uncoveredEvents}
              loading={computingGaps}
              serverReachable={serverReachable}
              config={config}
              onSaveRun={(run) => openSaveDialog({
                beforeSnapshot: run.beforeSnapshot,
                afterSnapshot: run.afterSnapshot,
                defaultLabel: run.eventLabel,
                eventId: run.eventId,
              })}
              onComputeEntry={async (entry: PropagationScorecardEntry) => {
                if (!serverReachable) return;
                try {
                  const after = await runEphemeralPropagation(entry.before_propagation);
                  updateScorecardEntry(entry.id, { after_propagation: after });
                  pushToast({ message: `"${entry.label}" updated with propagation result.`, variant: "success", durationMs: 3000 });
                } catch (err) {
                  pushToast({ message: `Compute failed — ${err instanceof Error ? err.message : "error"}`, variant: "error", durationMs: 4000 });
                }
              }}
              onRunEvent={(ev) => {
                const n = config.functionality_scale.length;
                // 1. Reset canvas (globalViewActive → always global)
                resetFunctionality({ n, scope, globalViewActive });
                // 2. Apply the event on the live canvas
                const eventDef = config.events.find((e) => e.id === ev.eventId);
                if (eventDef) {
                  useCanvasStore.getState().applyEvent(eventDef, n);
                }
                // 3. Snapshot AFTER event — this is "before propagation" in the scorecard
                const afterEvent = useCanvasStore.getState().toGraphSnapshot();
                // 4. Open save dialog; user can optionally run propagation then save
                openSaveDialog({
                  beforeSnapshot: afterEvent,
                  defaultLabel: ev.eventLabel,
                  eventId: ev.eventId,
                });
              }}
            />
          )}

          {scorecard.length === 0 ? (
            <EmptyState onSave={() => openSaveDialog()} />
          ) : (
            <div className="space-y-4">
              {scorecard.map((entry) =>
                entry.type === "propagation" ? (
                  <EntryCard
                    key={entry.id}
                    entry={entry}
                    n={n}
                    config={config}
                    onDelete={() => removeScorecardEntry(entry.id)}
                  />
                ) : (
                  <AnalysisEntryCard
                    key={entry.id}
                    entry={entry}
                    onDelete={() => removeScorecardEntry(entry.id)}
                  />
                )
              )}
            </div>
          )}
        </div>
      </div>

      {saveDialogOpen && (
        <SaveScorecardDialog
          onClose={() => setSaveDialogOpen(false)}
          {...saveDialogProps}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ onSave }: { onSave: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
      <BookMarked size={40} className="text-zinc-300 dark:text-zinc-600" />
      <div>
        <p className="text-base font-medium text-zinc-600 dark:text-zinc-400">No entries yet</p>
        <p className="mt-1 text-sm text-zinc-400 dark:text-zinc-500">
          Run a Propagation and click <strong>Save to Scorecard</strong> to create the first entry.
        </p>
      </div>
      <button
        onClick={onSave}
        className="mt-2 flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
      >
        <PlusCircle size={14} />
        Save current state
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gap detection section
// ---------------------------------------------------------------------------

interface GapsSectionProps {
  unsavedRuns: UnsavedRun[];
  incompleteEntries: PropagationScorecardEntry[];
  uncoveredEvents: UncoveredEvent[];
  loading: boolean;
  serverReachable: boolean;
  config: ReturnType<typeof useConfigStore.getState>["config"];
  onSaveRun: (run: UnsavedRun) => void;
  onComputeEntry: (entry: PropagationScorecardEntry) => Promise<void>;
  onRunEvent: (ev: UncoveredEvent) => void;
}

function GapsSection({
  unsavedRuns,
  incompleteEntries,
  uncoveredEvents,
  loading,
  serverReachable,
  onSaveRun,
  onComputeEntry,
  onRunEvent,
}: GapsSectionProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [computingIds, setComputingIds] = useState<Set<string>>(new Set());
  // IDs of unsaved runs the user has manually dismissed (session-only).
  const [dismissedRunIds, setDismissedRunIds] = useState<Set<string>>(new Set());

  const visibleRuns = unsavedRuns.filter((r) => !dismissedRunIds.has(r.eventEntryId));
  const total = visibleRuns.length + incompleteEntries.length + uncoveredEvents.length;

  function dismissRun(id: string) {
    setDismissedRunIds((s) => new Set(s).add(id));
  }
  function dismissAllRuns() {
    setDismissedRunIds(new Set(unsavedRuns.map((r) => r.eventEntryId)));
  }

  async function handleCompute(entry: PropagationScorecardEntry) {
    setComputingIds((s) => new Set(s).add(entry.id));
    await onComputeEntry(entry);
    setComputingIds((s) => { const n = new Set(s); n.delete(entry.id); return n; });
  }

  if (loading || total === 0) return null;

  return (
    <div className="mb-5 overflow-hidden rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-800/40 dark:bg-amber-900/10">
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
      >
        <AlertTriangle size={14} className="shrink-0 text-amber-600 dark:text-amber-400" />
        <span className="flex-1 text-sm font-medium text-amber-800 dark:text-amber-300">
          {total} gap{total !== 1 ? "s" : ""} detected
        </span>
        <ChevronDown size={14} className={cn("text-amber-500 transition-transform", collapsed && "rotate-180")} />
      </button>

      {!collapsed && (
        <div className="border-t border-amber-200 dark:border-amber-800/40">
          {/* Type 1 — Unsaved runs */}
          {visibleRuns.length > 0 && (
            <div className="px-4 py-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-600 dark:text-amber-500">
                  Unrecorded propagation runs
                </p>
                {visibleRuns.length > 1 && (
                  <button
                    onClick={dismissAllRuns}
                    className="text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                  >
                    Dismiss all
                  </button>
                )}
              </div>
              <div className="space-y-1.5">
                {visibleRuns.map((run) => (
                  <div key={run.eventEntryId} className="flex items-center justify-between gap-3">
                    <span className="truncate text-xs text-zinc-700 dark:text-zinc-300">{run.eventLabel}</span>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        onClick={() => onSaveRun(run)}
                        className="flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
                      >
                        <PlusCircle size={11} />
                        Save
                      </button>
                      <button
                        onClick={() => dismissRun(run.eventEntryId)}
                        title="Dismiss"
                        className="rounded p-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Type 2 — Incomplete entries */}
          {incompleteEntries.length > 0 && (
            <div className={cn("px-4 py-3", visibleRuns.length > 0 && "border-t border-amber-200 dark:border-amber-800/40")}>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-amber-600 dark:text-amber-500">
                Missing propagation results
              </p>
              <div className="space-y-1.5">
                {incompleteEntries.map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between gap-3">
                    <span className="truncate text-xs text-zinc-700 dark:text-zinc-300">{entry.label}</span>
                    <button
                      onClick={() => handleCompute(entry)}
                      disabled={!serverReachable || computingIds.has(entry.id)}
                      title={!serverReachable ? "Server unreachable" : "Run ephemeral propagation"}
                      className="flex shrink-0 items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-800"
                    >
                      {computingIds.has(entry.id)
                        ? <Loader2 size={11} className="animate-spin" />
                        : <Play size={11} />}
                      Compute
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Type 3 — Uncovered events */}
          {uncoveredEvents.length > 0 && (
            <div className={cn("px-4 py-3", (visibleRuns.length > 0 || incompleteEntries.length > 0) && "border-t border-amber-200 dark:border-amber-800/40")}>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-amber-600 dark:text-amber-500">
                Never covered events
              </p>
              <div className="space-y-1.5">
                {uncoveredEvents.map((ev) => (
                  <div key={ev.eventId} className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={cn(
                        "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
                        ev.eventType === "hazard"
                          ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                          : "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
                      )}>
                        {ev.eventType}
                      </span>
                      <span className="truncate text-xs text-zinc-700 dark:text-zinc-300">{ev.eventLabel}</span>
                    </div>
                    <button
                      onClick={() => onRunEvent(ev)}
                      className="flex shrink-0 items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-800"
                    >
                      <Play size={11} />
                      Run
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Analysis entry card
// ---------------------------------------------------------------------------

interface AnalysisEntryCardProps {
  entry: AnalysisScorecardEntry;
  onDelete: () => void;
}

function AnalysisEntryCard({ entry, onDelete }: AnalysisEntryCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const topEntries = Object.entries(entry.scores)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/40">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-medium text-zinc-900 dark:text-zinc-100">{entry.label}</p>
            <span className="shrink-0 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400">
              analysis
            </span>
          </div>
          <p className="text-xs text-zinc-400">
            {new Date(entry.created_at).toLocaleString()}
            <span className="ml-2 text-zinc-500">{entry.metric} · {entry.scope}</span>
          </p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {topEntries.length > 0 && (
            <button
              onClick={() => setExpanded((v) => !v)}
              title={expanded ? "Collapse" : "Show top elements"}
              className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
            >
              <ChevronDown size={14} className={cn("transition-transform", expanded && "rotate-180")} />
            </button>
          )}
          {confirmDelete ? (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-red-600 dark:text-red-400">Delete?</span>
              <button onClick={onDelete} className="rounded px-2 py-0.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20">Yes</button>
              <button onClick={() => setConfirmDelete(false)} className="rounded px-2 py-0.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-700">No</button>
            </div>
          ) : (
            <button onClick={() => setConfirmDelete(true)} title="Delete entry" className="rounded-md p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-700">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-400">Top Elements by Score</p>
          <div className="space-y-1">
            {topEntries.map(([id, score], i) => {
              const node = entry.snapshot.nodes[id];
              return (
                <div key={id} className="flex items-center justify-between text-xs">
                  <span className="truncate text-zinc-600 dark:text-zinc-400">
                    {i + 1}. {node?.label ?? id}
                  </span>
                  <span className="ml-2 font-mono text-indigo-600 dark:text-indigo-400">{score.toFixed(4)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entry card
// ---------------------------------------------------------------------------

interface EntryCardProps {
  entry: PropagationScorecardEntry;
  n: number;
  config: ReturnType<typeof useConfigStore.getState>["config"];
  onDelete: () => void;
}

function EntryCard({ entry, n, config, onDelete }: EntryCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Resolve event name: look up in config, fall back to entry label
  const eventLabel = entry.event_id
    ? (config.events.find((e) => e.id === entry.event_id)?.label ?? entry.label)
    : entry.label;

  const scoreBefore = computeOperativityScore(entry.before_propagation, n);
  const scoreAfter = entry.after_propagation
    ? computeOperativityScore(entry.after_propagation, n)
    : null;
  const scoreTemporal = entry.after_temporal_jump
    ? computeOperativityScore(entry.after_temporal_jump, n)
    : null;

  const delta = scoreAfter !== null ? scoreAfter - scoreBefore : null;

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/40">
      {/* Entry header */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Label + date */}
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-zinc-900 dark:text-zinc-100">{entry.label}</p>
          <p className="text-xs text-zinc-400">
            {new Date(entry.created_at).toLocaleString()}
            {entry.event_id && (
              <span className="ml-2 rounded bg-orange-100 px-1.5 py-0.5 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                event
              </span>
            )}
          </p>
        </div>

        {/* Score pills */}
        <div className="flex items-center gap-1.5 shrink-0">
          <ScorePill label="Before" value={scoreBefore} config={config} n={n} />
          {scoreAfter !== null && (
            <>
              <span className="text-xs text-zinc-400">→</span>
              <ScorePill label="After" value={scoreAfter} config={config} n={n} />
              {delta !== null && (
                <span className={cn(
                  "ml-1 text-xs font-medium",
                  delta < -0.5 ? "text-red-600 dark:text-red-400" :
                  delta > 0.5 ? "text-green-600 dark:text-green-400" :
                  "text-zinc-400",
                )}>
                  ({delta >= 0 ? "+" : ""}{delta.toFixed(1)}%)
                </span>
              )}
            </>
          )}
          {scoreTemporal !== null && (
            <>
              <span className="text-xs text-zinc-400 ml-1">+{entry.temporal_jump_hours}h→</span>
              <ScorePill label="Temporal" value={scoreTemporal} config={config} n={n} />
            </>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? "Collapse snapshots" : "Expand canvas snapshots"}
            className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
          >
            <ChevronDown size={14} className={cn("transition-transform", expanded && "rotate-180")} />
          </button>

          {confirmDelete ? (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-red-600 dark:text-red-400">Delete?</span>
              <button
                onClick={onDelete}
                className="rounded px-2 py-0.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                Yes
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="rounded px-2 py-0.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-700"
              >
                No
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              title="Delete entry"
              className="rounded-md p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Expandable canvas snapshots */}
      {expanded && (
        <div className="border-t border-zinc-200 px-4 py-4 dark:border-zinc-700">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <SnapshotMiniGraph
              label={eventLabel}
              snapshot={entry.before_propagation}
              imageDataUrl={entry.before_propagation_image}
              score={scoreBefore}
              config={config}
              n={n}
            />
            {entry.after_propagation && (
              <SnapshotMiniGraph
                label="After Propagation"
                snapshot={entry.after_propagation}
                imageDataUrl={entry.after_propagation_image}
                score={scoreAfter ?? 0}
                config={config}
                n={n}
              />
            )}
            {entry.after_temporal_jump && (
              <SnapshotMiniGraph
                label={`+${entry.temporal_jump_hours ?? "?"}h Temporal Jump`}
                snapshot={entry.after_temporal_jump}
                imageDataUrl={entry.after_temporal_jump_image}
                score={scoreTemporal ?? 0}
                config={config}
                n={n}
              />
            )}
          </div>

          {/* Most impacted nodes */}
          {entry.after_propagation && (
            <ImpactedNodesTable
              before={entry.before_propagation}
              after={entry.after_propagation}
              n={n}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Score pill
// ---------------------------------------------------------------------------

function ScorePill({
  label,
  value,
  config,
  n,
}: {
  label: string;
  value: number;
  config: ReturnType<typeof useConfigStore.getState>["config"];
  n: number;
}) {
  const color = operativityColor(value, config);
  return (
    <span
      title={`${label}: ${value.toFixed(1)}%`}
      className="rounded-full px-2 py-0.5 text-xs font-semibold text-white"
      style={{ backgroundColor: color }}
    >
      {value.toFixed(1)}%
    </span>
  );
}

// ---------------------------------------------------------------------------
// Snapshot visualisation — interactive pannable/zoomable React Flow view
// ---------------------------------------------------------------------------

function SnapshotMiniGraph({
  label,
  snapshot,
  score,
  config,
}: {
  label: string;
  snapshot: GraphSnapshot;
  imageDataUrl?: string; // kept for API compat (ZIP export), not displayed
  score: number;
  config: ReturnType<typeof useConfigStore.getState>["config"];
  n: number;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-1.5 dark:border-zinc-800">
        <span className="truncate text-xs font-medium text-zinc-600 dark:text-zinc-400">{label}</span>
        <span
          className="ml-2 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white"
          style={{ backgroundColor: operativityColor(score, config) }}
        >
          {score.toFixed(1)}%
        </span>
      </div>
      <SnapshotFlowView snapshot={snapshot} heightClass="h-52" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Impacted nodes table
// ---------------------------------------------------------------------------

function ImpactedNodesTable({ before, after, n }: { before: GraphSnapshot; after: GraphSnapshot; n: number }) {
  const rows = Object.values(after.nodes)
    .map((nd) => {
      const prev = before.nodes[nd.id];
      const delta = (prev?.functionality ?? n) - (nd.functionality ?? n);
      return {
        id: nd.id,
        label: nd.label ?? nd.id,
        importance: nd.importance ?? 0,
        delta,
      };
    })
    .filter((r) => r.delta > 0)
    .sort((a, b) => b.importance * b.delta - a.importance * a.delta)
    .slice(0, 8);

  if (rows.length === 0) return null;

  return (
    <div className="mt-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-zinc-400">Most impacted Elements</p>
      <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-zinc-50 text-left dark:bg-zinc-800">
              <th className="px-3 py-1.5 font-semibold text-zinc-500">Element</th>
              <th className="px-3 py-1.5 font-semibold text-zinc-500 text-right">Importance</th>
              <th className="px-3 py-1.5 font-semibold text-zinc-500 text-right">Δ Functionality</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="px-3 py-1.5 text-zinc-700 dark:text-zinc-300 truncate max-w-[200px]">{r.label}</td>
                <td className="px-3 py-1.5 text-right text-zinc-500">{r.importance.toFixed(2)}</td>
                <td className="px-3 py-1.5 text-right font-medium text-red-600 dark:text-red-400">−{r.delta}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
