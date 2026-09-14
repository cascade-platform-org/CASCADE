"use client";

import { useMemo, useState } from "react";
import { X, Wrench, Clock, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/store/ui-store";
import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore } from "@/store/config-store";
import {
  computeInterventionPrioritisation,
  type RepairCandidate,
  type AtRiskElement,
} from "@/lib/intervention-prioritisation";
import type { GraphSnapshot } from "@/lib/schemas/network";
import { levelColor } from "@/lib/colors";
import { brandColor } from "@/lib/brand";

type SortMode = "efficiency" | "importance" | "cost";

export function InterventionPanel() {
  const close = useUiStore((s) => s.closeInterventionPanel);
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const config = useConfigStore((s) => s.config);
  const N = Math.max(...config.functionality_scale.map((l) => l.level));
  const [sort, setSort] = useState<SortMode>("importance");
  const [atRiskOpen, setAtRiskOpen] = useState(false);

  const snapshot = useMemo(
    (): GraphSnapshot => ({ nodes, edges, canvases: [] }),
    [nodes, edges],
  );

  const summary = useMemo(
    () => computeInterventionPrioritisation(snapshot, N),
    [snapshot, N],
  );

  const candidates =
    sort === "efficiency" ? summary.byEfficiency
    : sort === "importance" ? summary.byImportance
    : summary.byCostOfDisservice;

  function elementLabel(id: string): string {
    const node = nodes[id];
    if (node) return node.label ?? id;
    const edge = edges[id];
    if (edge) {
      const src = nodes[edge.source]?.label ?? edge.source;
      const tgt = nodes[edge.target]?.label ?? edge.target;
      return `${src} → ${tgt}`;
    }
    return id;
  }

  const levelColorFn = (level: number) => levelColor(config.functionality_scale, level);

  const recoverySum = summary.byValue.reduce((s, c) => s + c.recoveryValue, 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div className="flex h-[85dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">

        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-100 px-6 py-4 dark:border-zinc-800">
          <div className="flex items-center gap-2.5">
            <Wrench size={18} className="text-amber-600" />
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Repair Priority</h2>
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              {summary.byValue.length} candidate{summary.byValue.length !== 1 ? "s" : ""}
            </span>
          </div>
          <button
            onClick={close}
            className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {summary.byValue.length === 0 && summary.atRisk.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              <CandidateTable
                candidates={candidates}
                sort={sort}
                onSort={setSort}
                elementLabel={elementLabel}
                levelColor={levelColorFn}
                N={N}
              />

              {/* At-risk collapsible section */}
              {summary.atRisk.length > 0 && (
                <div className="border-t border-zinc-100 dark:border-zinc-800">
                  <button
                    onClick={() => setAtRiskOpen((v) => !v)}
                    className="flex w-full items-center gap-2 px-6 py-3 text-left text-xs font-semibold text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
                  >
                    <Clock size={13} className="text-violet-500" />
                    <span className="flex-1">
                      At Risk — {summary.atRisk.length} element{summary.atRisk.length !== 1 ? "s" : ""} on backup countdown
                    </span>
                    <span className={cn("text-zinc-400 transition-transform", atRiskOpen && "rotate-180")}>▼</span>
                  </button>
                  {atRiskOpen && (
                    <AtRiskTable
                      items={summary.atRisk}
                      elementLabel={elementLabel}
                      levelColor={levelColorFn}
                      N={N}
                    />
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer — loss conservation */}
        {summary.totalLoss > 0 && (
          <div className="shrink-0 border-t border-zinc-100 px-6 py-3 dark:border-zinc-800">
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-500">
              <span>
                <span className="font-medium text-zinc-700 dark:text-zinc-300">Total loss</span>{" "}
                {summary.totalLoss.toFixed(2)}
              </span>
              <span>
                <span className="font-medium text-amber-600 dark:text-amber-400">Recovery value</span>{" "}
                {recoverySum.toFixed(2)}
              </span>
              {summary.nonRepairableLoss > 0 && (
                <span>
                  <span className="font-medium text-zinc-500">Non-repairable</span>{" "}
                  {summary.nonRepairableLoss.toFixed(2)}
                </span>
              )}
              {summary.unattributedLoss > 0 && (
                <span title="Loss cut by cycle detection">
                  <AlertTriangle size={11} className="mr-0.5 inline text-orange-400" />
                  <span className="font-medium text-orange-500">Unattributed</span>{" "}
                  {summary.unattributedLoss.toFixed(2)}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unified candidate table
// ---------------------------------------------------------------------------

// Module-level (not defined inside the table render): a component created
// during render gets a new identity every render, defeating reconciliation.
function SortTh({
  mode,
  sort,
  onSort,
  children,
  className,
}: {
  mode: SortMode;
  sort: SortMode;
  onSort: (mode: SortMode) => void;
  children: React.ReactNode;
  className?: string;
}) {
  const active = sort === mode;
  return (
    <th
      onClick={() => onSort(mode)}
      className={cn(
        "cursor-pointer select-none px-3 py-2.5 text-right font-semibold transition-colors",
        active
          ? "text-amber-600 dark:text-amber-400"
          : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300",
        className,
      )}
    >
      {children}{active ? " ▼" : ""}
    </th>
  );
}

function CandidateTable({
  candidates,
  sort,
  onSort,
  elementLabel,
  levelColor,
  N,
}: {
  candidates: RepairCandidate[];
  sort: SortMode;
  onSort: (mode: SortMode) => void;
  elementLabel: (id: string) => string;
  levelColor: (level: number) => string;
  N: number;
}) {
  if (candidates.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Wrench size={32} className="mb-3 text-zinc-300 dark:text-zinc-600" />
        <p className="text-sm text-zinc-500">No physically damaged elements.</p>
        <p className="mt-1 text-xs text-zinc-400">Apply a hazard and run Propagation first.</p>
      </div>
    );
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-zinc-100 bg-zinc-50 text-left dark:border-zinc-800 dark:bg-zinc-800/40">
          <th className="w-8 px-4 py-2.5 font-semibold text-zinc-400">#</th>
          <th className="px-4 py-2.5 font-semibold text-zinc-500">Element</th>
          <th className="px-3 py-2.5 text-center font-semibold text-zinc-500">f</th>
          <SortTh mode="importance" sort={sort} onSort={onSort}>
            <span className="block text-[9px] font-normal leading-tight opacity-60">Expected Recovery By</span>
            Importance
          </SortTh>
          <SortTh mode="cost" sort={sort} onSort={onSort}>
            <span className="block text-[9px] font-normal leading-tight opacity-60">Expected Recovery By</span>
            Value
          </SortTh>
          <th className="px-3 py-2.5 text-right font-semibold text-zinc-500">Repair Time</th>
          <SortTh mode="efficiency" sort={sort} onSort={onSort}>Value / h</SortTh>
        </tr>
      </thead>
      <tbody>
        {candidates.map((c, i) => (
          <tr
            key={c.id}
            className="border-b border-zinc-50 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40"
          >
            <td className="px-4 py-2.5 text-zinc-400">{i + 1}</td>

            <td className="px-4 py-2.5">
              <div className="flex items-center gap-2">
                <span
                  className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white"
                  style={{ backgroundColor: c.kind === "node" ? brandColor("accent", 500) : brandColor("accent", 700) }}
                >
                  {c.kind}
                </span>
                <span className="max-w-[160px] truncate font-medium text-zinc-800 dark:text-zinc-200">
                  {elementLabel(c.id)}
                </span>
              </div>
            </td>

            <td className="px-3 py-2.5 text-center">
              <span
                className="inline-block rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
                style={{ backgroundColor: levelColor(c.functionality) }}
              >
                {c.functionality}/{N}
              </span>
            </td>

            {/* Expected recovery by importance weight */}
            <td className={cn("px-3 py-2.5 text-right", sort === "importance" ? "font-semibold text-amber-700 dark:text-amber-400" : "text-zinc-500")}>
              {c.recoveryByImportance.toFixed(2)}
            </td>

            {/* Expected recovery by economic value weight */}
            <td className={cn("px-3 py-2.5 text-right", sort === "cost" ? "font-semibold text-amber-700 dark:text-amber-400" : "text-zinc-500")}>
              {c.recoveryByValue.toFixed(2)}
            </td>

            {/* Repair time */}
            <td className="px-3 py-2.5 text-right text-zinc-500">
              {c.expectedRepairTime === undefined ? (
                <span className="text-orange-400" title="No repair estimate">—</span>
              ) : c.expectedRepairTime === 0 ? (
                "~0h"
              ) : (
                `${c.expectedRepairTime}h`
              )}
            </td>

            {/* Value / h */}
            <td className={cn("px-4 py-2.5 text-right", sort === "efficiency" ? "font-semibold text-amber-700 dark:text-amber-400" : "text-zinc-600 dark:text-zinc-300")}>
              {c.valuePerHour === undefined ? (
                <span className="font-normal text-orange-400" title="No repair estimate">—</span>
              ) : c.valuePerHour === Infinity ? (
                <span title="Instantaneous repair">∞</span>
              ) : (
                c.valuePerHour.toFixed(2)
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// At-risk table (collapsible section)
// ---------------------------------------------------------------------------

function AtRiskTable({
  items,
  elementLabel,
  levelColor,
  N,
}: {
  items: AtRiskElement[];
  elementLabel: (id: string) => string;
  levelColor: (level: number) => string;
  N: number;
}) {
  return (
    <>
      <p className="px-6 pb-2 text-xs text-zinc-400">
        Sorted by time remaining (most urgent first). Upstream attribution for deferred drops requires the propagation engine.
      </p>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-zinc-100 bg-zinc-50 text-left dark:border-zinc-800 dark:bg-zinc-800/40">
            <th className="px-4 py-2 font-semibold text-zinc-500">Element</th>
            <th className="px-3 py-2 text-center font-semibold text-zinc-500">f</th>
            <th className="px-3 py-2 text-right font-semibold text-zinc-500">Time Left ▲</th>
            <th className="px-3 py-2 text-center font-semibold text-zinc-500">Direct Damage</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.id}
              className="border-b border-zinc-50 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40"
            >
              <td className="px-4 py-2">
                <div className="flex items-center gap-2">
                  <span
                    className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white"
                    style={{ backgroundColor: item.kind === "node" ? brandColor("accent", 500) : brandColor("accent", 700) }}
                  >
                    {item.kind}
                  </span>
                  <span className="max-w-[240px] truncate font-medium text-zinc-800 dark:text-zinc-200">
                    {elementLabel(item.id)}
                  </span>
                </div>
              </td>
              <td className="px-3 py-2 text-center">
                <span
                  className="inline-block rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
                  style={{ backgroundColor: levelColor(item.functionality) }}
                >
                  {item.functionality}/{N}
                </span>
              </td>
              <td className="px-3 py-2 text-right">
                <span className={cn(
                  "font-semibold",
                  item.functionalityTime <= 8 ? "text-red-600 dark:text-red-400"
                    : item.functionalityTime <= 24 ? "text-orange-500 dark:text-orange-400"
                    : "text-zinc-600 dark:text-zinc-400",
                )}>
                  {item.functionalityTime}h
                </span>
              </td>
              <td className="px-3 py-2 text-center">
                {item.direct_damage
                  ? <span className="font-bold text-red-500">✕</span>
                  : <span className="text-zinc-300 dark:text-zinc-600">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <Wrench size={40} className="mb-4 text-zinc-300 dark:text-zinc-600" />
      <p className="text-sm font-medium text-zinc-500">Nothing to prioritise</p>
      <p className="mt-1 text-xs text-zinc-400">
        Apply a hazard and run Propagation to generate repair candidates.
      </p>
    </div>
  );
}
