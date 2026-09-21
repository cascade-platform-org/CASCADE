"use client";

/**
 * scorecard-panel.tsx — the saved Scorecard entries, listed in a
 * {@link FloatingWindow}.
 *
 * Displays per-entry Operativity Scores, collapsible canvas snapshots,
 * a ZIP export button, and per-entry delete.
 * The "Save to Scorecard" dialog (operativity-scorecard.tsx) is triggered
 * from here (or from the ActionBar after a Propagation).
 *
 * A window rather than a modal, like Analysis and Active Rules: an entry is
 * read *against* the network it scores, and comparing a saved snapshot with
 * what is live on the canvas was impossible while the canvas was behind a
 * dimmed backdrop. Closing flies the window back into the Topbar button that
 * reopens it.
 */

import { useState, useEffect, useMemo } from "react";
import { X, Download, Trash2, ChevronDown, BookMarked, PlusCircle, AlertTriangle, Play, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCanvasStore } from "@/store/canvas-store";
import { useScorecardStore } from "@/store/scorecard-store";
import { useConfigStore } from "@/store/config-store";
import { useUiStore } from "@/store/ui-store";
import { useHistoryStore } from "@/store/history-store";
import { useAnalysisStore } from "@/store/analysis-store";
import { buildOiWeightOptions } from "@/lib/oi-weight-attrs";
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
import { FloatingWindow } from "@/components/ui/floating-window";
import { SCORECARD_ANCHOR_ID } from "@/lib/ui-anchors";
import { SaveScorecardDialog } from "./operativity-scorecard";
import { SnapshotFlowView } from "./snapshot-flow-view";
import { buildColorMap } from "@/lib/analysis-legend";
import { scoresToResult } from "@/lib/topological-analysis";
import type { GraphSnapshot, PropagationScorecardEntry, AnalysisScorecardEntry } from "@/lib/schemas/network";

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
  // Operativity weighting — shared app-wide with the model-based analysis so a
  // single choice drives every Operativity Score in the app.
  const oiWeightAttr = useAnalysisStore((s) => s.oiWeightAttr);
  const setOiWeightAttr = useAnalysisStore((s) => s.setOiWeightAttr);
  const oiWeightOptions = buildOiWeightOptions(useCanvasStore.getState().nodes);

  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveDialogProps, setSaveDialogProps] = useState<{
    beforeSnapshot?: GraphSnapshot;
    afterSnapshot?: GraphSnapshot;
    defaultLabel?: string;
    eventIds?: string[];
  }>({});
  const [exporting, setExporting] = useState(false);

  // Gap detection (async — SHA-256 hashing)
  const [unsavedRuns, setUnsavedRuns] = useState<UnsavedRun[]>([]);
  const [computingGaps, setComputingGaps] = useState(false);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setComputingGaps(true);
      findUnsavedRuns(updateHistory, scorecard, useCanvasStore.getState().toGraphSnapshot()).then((runs) => {
        if (!cancelled) { setUnsavedRuns(runs); setComputingGaps(false); }
      });
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
      await exportScorecardZip(scorecard, config, projectMeta.name, oiWeightAttr);
    } catch (err) {
      pushToast({ message: "Export failed — see console for details.", variant: "error", durationMs: 4000 });
      console.error(err);
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <FloatingWindow
        open
        onClose={close}
        title="Scorecard"
        icon={<BookMarked size={15} className="shrink-0 text-blue-600 dark:text-blue-400" />}
        flyToOnClose={SCORECARD_ANCHOR_ID}
        storageKey="cascade.scorecard.window"
        defaultSize={{ w: 880, h: 620 }}
        minSize={{ w: 460, h: 300 }}
        headerActions={
          <>
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              {scorecard.length} {scorecard.length === 1 ? "entry" : "entries"}
            </span>

            {/* Operativity weighting selector — controls how every score below is computed */}
            <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              <span className="shrink-0">Weight</span>
              <select
                value={oiWeightAttr}
                onChange={(e) => setOiWeightAttr(e.target.value)}
                title="How the Operativity Score is weighted across nodes"
                className="rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[11px] text-zinc-700 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
              >
                {oiWeightOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>

            <button
              onClick={() => openSaveDialog()}
              className="flex items-center gap-1 rounded-md bg-blue-600 px-2 py-1 text-[11px] font-medium text-white transition-colors hover:bg-blue-700"
            >
              <PlusCircle size={12} />
              Save current
            </button>

            <button
              onClick={handleExport}
              disabled={scorecard.length === 0 || exporting}
              title="Export as ZIP (scorecard.md + images)"
              className={cn(
                "flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 text-[11px] font-medium transition-colors dark:border-zinc-700",
                scorecard.length === 0 || exporting
                  ? "cursor-not-allowed opacity-40 text-zinc-400"
                  : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800",
              )}
            >
              <Download size={12} />
              {exporting ? "Exporting…" : "Export ZIP"}
            </button>
          </>
        }
      >
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Gap detection */}
          {(hasGaps || computingGaps) && (
            <GapsSection
              unsavedRuns={unsavedRuns}
              incompleteEntries={incompleteEntries}
              uncoveredEvents={uncoveredEvents}
              loading={computingGaps}
              serverReachable={serverReachable}
              onSaveRun={(run) => openSaveDialog({
                beforeSnapshot: run.beforeSnapshot,
                afterSnapshot: run.afterSnapshot,
                defaultLabel: run.eventLabel,
                eventIds: run.eventIds,
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
                // 1. End whatever scenario is live, so this uncovered Event is
                //    measured against the network's own state rather than on top
                //    of someone else's cascade. Reset is scope-independent and
                //    reaches back through the loaded history (ADR-0016), so this
                //    works on a project that shipped mid-scenario.
                resetFunctionality();
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
                  eventIds: [ev.eventId],
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
      </FloatingWindow>

      {saveDialogOpen && (
        <SaveScorecardDialog
          onClose={() => setSaveDialogOpen(false)}
          {...saveDialogProps}
        />
      )}
    </>
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

  const topEntries = useMemo(
    () => Object.entries(entry.scores).sort(([, a], [, b]) => b - a).slice(0, 5),
    [entry.scores],
  );

  // Rebuild the Analysis Heatmap this entry was saved with, from the scores the
  // entry stores — the same two functions the Analysis window paints with, so
  // the mini-graph shows exactly the colours the canvas showed at save time.
  // Cheap, and it keeps the entry small: the colours are derived, not stored.
  const heatmapColors = useMemo(
    () =>
      buildColorMap(
        scoresToResult(entry.metric, entry.scores, (id) =>
          id in entry.snapshot.nodes ? "node" : "edge",
        ),
      ),
    [entry.metric, entry.scores, entry.snapshot.nodes],
  );

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/40">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-medium text-zinc-900 dark:text-zinc-100">{entry.label}</p>
            <span className="shrink-0 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
              analysis
            </span>
          </div>
          <p className="text-xs text-zinc-400">
            {new Date(entry.created_at).toLocaleString()}
            <span className="ml-2 text-zinc-500">{entry.metric} · {entry.scope}</span>
          </p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? "Collapse" : "Show the network and top elements"}
            className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
          >
            <ChevronDown size={14} className={cn("transition-transform", expanded && "rotate-180")} />
          </button>
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
          {/* The network as it stood, painted with this entry's own heatmap —
              the same mini-graph a Propagation entry shows for its snapshots. */}
          <div className="mb-3 overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
            <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-1.5 dark:border-zinc-800">
              <span className="truncate text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Network at computation &mdash; {entry.metric}
              </span>
              <span className="ml-2 shrink-0 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                {Object.keys(entry.scores).length} scored
              </span>
            </div>
            <SnapshotFlowView snapshot={entry.snapshot} colors={heatmapColors} heightClass="h-52" />
          </div>

          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-400">Top Elements by Score</p>
          <div className="space-y-1">
            {topEntries.map(([id, score], i) => {
              const node = entry.snapshot.nodes[id];
              return (
                <div key={id} className="flex items-center justify-between text-xs">
                  <span className="truncate text-zinc-600 dark:text-zinc-400">
                    {i + 1}. {node?.label ?? id}
                  </span>
                  <span className="ml-2 font-mono text-blue-600 dark:text-blue-400">{score.toFixed(4)}</span>
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
  // Shared Operativity weighting — keeps card scores in step with the selector.
  const oiWeightAttr = useAnalysisStore((s) => s.oiWeightAttr);

  // Resolve event name(s): look up in config, fall back to entry label. Several
  // Events may have been stacked before the Propagation this entry captures.
  const eventLabel = entry.event_ids.length > 0
    ? [...entry.event_ids]
        .reverse()
        .map((id) => config.events.find((e) => e.id === id)?.label ?? id)
        .join(" + ")
    : entry.label;

  const scoreBefore = computeOperativityScore(entry.before_propagation, n, oiWeightAttr);
  const scoreAfter = entry.after_propagation
    ? computeOperativityScore(entry.after_propagation, n, oiWeightAttr)
    : null;
  const scoreTemporal = entry.after_temporal_jump
    ? computeOperativityScore(entry.after_temporal_jump, n, oiWeightAttr)
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
            {entry.event_ids.length > 0 && (
              <span className="ml-2 rounded bg-orange-100 px-1.5 py-0.5 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                {entry.event_ids.length > 1 ? `${entry.event_ids.length} events` : "event"}
              </span>
            )}
          </p>
        </div>

        {/* Score pills */}
        <div className="flex items-center gap-1.5 shrink-0">
          <ScorePill label="Before" value={scoreBefore} config={config} />
          {scoreAfter !== null && (
            <>
              <span className="text-xs text-zinc-400">→</span>
              <ScorePill label="After" value={scoreAfter} config={config} />
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
              <ScorePill label="Temporal" value={scoreTemporal} config={config} />
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
              score={scoreBefore}
              config={config}
            />
            {entry.after_propagation && (
              <SnapshotMiniGraph
                label="After Propagation"
                snapshot={entry.after_propagation}
                score={scoreAfter ?? 0}
                config={config}
              />
            )}
            {entry.after_temporal_jump && (
              <SnapshotMiniGraph
                label={`+${entry.temporal_jump_hours ?? "?"}h Temporal Jump`}
                snapshot={entry.after_temporal_jump}
                score={scoreTemporal ?? 0}
                config={config}
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
}: {
  label: string;
  value: number;
  config: ReturnType<typeof useConfigStore.getState>["config"];
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
  score: number;
  config: ReturnType<typeof useConfigStore.getState>["config"];
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
