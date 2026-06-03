"use client";

/**
 * scorecard-panel.tsx — Full-screen overlay listing all saved Scorecard entries.
 *
 * Displays per-entry Operativity Scores, collapsible canvas snapshots,
 * a ZIP export button, and per-entry delete.
 * The "Save to Scorecard" dialog (operativity-scorecard.tsx) is triggered
 * from here (or from the ActionBar after a Propagation).
 */

import { useState } from "react";
import { X, Download, Trash2, ChevronDown, BookMarked, PlusCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore } from "@/store/config-store";
import { useUiStore } from "@/store/ui-store";
import {
  computeOperativityScore,
  operativityColor,
  exportScorecardZip,
} from "@/lib/scorecard-utils";
import { SaveScorecardDialog } from "./operativity-scorecard";
import type { ScorecardEntry } from "@/lib/schemas/network";

export function ScorecardPanel() {
  const close = useUiStore((s) => s.closeScorecardPanel);
  const scorecard = useCanvasStore((s) => s.scorecard);
  const removeScorecardEntry = useCanvasStore((s) => s.removeScorecardEntry);
  const projectMeta = useCanvasStore((s) => s.projectMeta);
  const config = useConfigStore((s) => s.config);
  const pushToast = useUiStore((s) => s.pushToast);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

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
              onClick={() => setSaveDialogOpen(true)}
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
          {scorecard.length === 0 ? (
            <EmptyState onSave={() => setSaveDialogOpen(true)} />
          ) : (
            <div className="space-y-4">
              {scorecard.map((entry) => (
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  n={n}
                  config={config}
                  onDelete={() => removeScorecardEntry(entry.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {saveDialogOpen && (
        <SaveScorecardDialog onClose={() => setSaveDialogOpen(false)} />
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
// Entry card
// ---------------------------------------------------------------------------

interface EntryCardProps {
  entry: ScorecardEntry;
  n: number;
  config: ReturnType<typeof useConfigStore.getState>["config"];
  onDelete: () => void;
}

function EntryCard({ entry, n, config, onDelete }: EntryCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

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
            <SnapshotImage
              label="Before Propagation"
              dataUrl={entry.before_propagation_image}
              score={scoreBefore}
              config={config}
              n={n}
            />
            {entry.after_propagation && (
              <SnapshotImage
                label="After Propagation"
                dataUrl={entry.after_propagation_image}
                score={scoreAfter ?? 0}
                config={config}
                n={n}
              />
            )}
            {entry.after_temporal_jump && (
              <SnapshotImage
                label={`After ${entry.temporal_jump_hours ?? "?"}h Temporal Jump`}
                dataUrl={entry.after_temporal_jump_image}
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
// Snapshot image cell
// ---------------------------------------------------------------------------

function SnapshotImage({
  label,
  dataUrl,
  score,
  config,
  n,
}: {
  label: string;
  dataUrl: string | undefined;
  score: number;
  config: ReturnType<typeof useConfigStore.getState>["config"];
  n: number;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-1.5 dark:border-zinc-800">
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400 truncate">{label}</span>
        <span
          className="shrink-0 ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white"
          style={{ backgroundColor: operativityColor(score, config) }}
        >
          {score.toFixed(1)}%
        </span>
      </div>
      {dataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={dataUrl}
          alt={label}
          className="h-40 w-full object-cover"
        />
      ) : (
        <div className="flex h-40 items-center justify-center text-xs text-zinc-400">
          No image captured
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Impacted nodes table
// ---------------------------------------------------------------------------

import type { GraphSnapshot } from "@/lib/schemas/network";

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
