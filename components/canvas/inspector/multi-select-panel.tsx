"use client";

/**
 * inspector/multi-select-panel.tsx — Inspector panel for multi-element selection.
 *
 * Provides batch editing across all selected nodes and/or edges.
 * Sections shown depend on whether nodes only, edges only, or a mix is selected.
 */

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { X } from "lucide-react";
import { useCanvasStore } from "@/store/canvas-store";
import { useNetworkStore } from "@/store/network-store";
import { useConfigStore, selectN, selectScaleLevels } from "@/store/config-store";
import { useUiStore } from "@/store/ui-store";
import { useShallow } from "zustand/react/shallow";
import { useHistoryAction } from "@/hooks/useHistoryAction";
import type { CategoryDependencyProfile } from "@/lib/schemas/network";
import {
  Section, Field, NumberInput, Toggle,
  SkipWarning, vulnHint, isDefined,
} from "./primitives";
import { CanvasMembershipSection } from "./canvas-membership";

// ---------------------------------------------------------------------------
// VulnerabilityBatchRow — per-event row with local slider + apply button
// ---------------------------------------------------------------------------

function VulnerabilityBatchRow({
  event,
  n,
  onApply,
}: {
  event: { id: string; label: string };
  n: number;
  onApply: (level: number) => void;
}) {
  const [level, setLevel] = useState(0);
  return (
    <Field label={event.label}>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={0}
          max={n - 1}
          value={level}
          onChange={(e) => setLevel(Number(e.target.value))}
          className="flex-1 accent-orange-500"
        />
        <span className="min-w-[1.5rem] text-right text-xs text-zinc-600 dark:text-zinc-400">
          {level}
        </span>
        <button
          onClick={() => onApply(level)}
          className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-300"
        >
          Apply
        </button>
      </div>
      <div className="mt-0.5 text-[10px] text-zinc-400">{vulnHint(level, n)}</div>
    </Field>
  );
}

// ---------------------------------------------------------------------------
// MultiSelectPanel
// ---------------------------------------------------------------------------

export function MultiSelectPanel({
  nodeIds,
  edgeIds,
}: {
  nodeIds: string[];
  edgeIds: string[];
}) {
  const allNodes = useCanvasStore((s) => s.nodes);
  const allEdges = useCanvasStore((s) => s.edges);
  const updateNode = useCanvasStore((s) => s.updateNode);
  const updateEdge = useCanvasStore((s) => s.updateEdge);
  const removeNode = useCanvasStore((s) => s.removeNode);
  const removeEdge = useCanvasStore((s) => s.removeEdge);
  const clearSelection = useNetworkStore((s) => s.clearSelection);
  const setInspectorOpen = useUiStore((s) => s.setInspectorOpen);
  const n = useConfigStore(selectN);
  const scaleLevels = useConfigStore(useShallow(selectScaleLevels));
  const events = useConfigStore(useShallow((s) => s.config.events));
  const categories = useConfigStore(useShallow((s) => s.config.categories));
  const historyAction = useHistoryAction();

  const total = nodeIds.length + edgeIds.length;
  const isNodesOnly = nodeIds.length > 0 && edgeIds.length === 0;
  const isEdgesOnly = edgeIds.length > 0 && nodeIds.length === 0;

  const nodes = nodeIds.map((id) => allNodes[id]).filter(isDefined);
  const edges = edgeIds.map((id) => allEdges[id]).filter(isDefined);

  function batchOp(
    updateFn: () => void,
    label: string,
    type: "manual_functionality_update" | "graph_update" = "manual_functionality_update",
  ) {
    historyAction(updateFn, label, type);
  }

  // ── Form state ──
  const firstFunc = nodes[0]?.functionality ?? edges[0]?.functionality ?? n;
  const [funcValue, setFuncValue]             = useState(firstFunc);
  const [funcTimeValue, setFuncTimeValue]     = useState(0);
  const [repairTimeValue, setRepairTimeValue] = useState(0);
  const [importanceValue, setImportanceValue] = useState(0.5);
  const [costValue, setCostValue]             = useState(0);
  const [capacityValue, setCapacityValue]     = useState(0);
  const [labelValue, setLabelValue]           = useState("");

  const [batchCat, setBatchCat]                       = useState("");
  const [batchDepLevel, setBatchDepLevel]             = useState(n);
  const [batchBackup, setBatchBackup]                 = useState(false);
  const [batchBackupDuration, setBatchBackupDuration] = useState(0);
  const [batchDemand, setBatchDemand]                 = useState(0);
  const [batchPriority, setBatchPriority]             = useState(1);

  const allCatNames = categories.map((c) => c.name);
  const commonCategories = allCatNames.filter((name) =>
    nodes.length > 0 && nodes.every((nd) => (nd.node_categories ?? []).includes(name)),
  );
  const partialCategories = allCatNames.filter(
    (name) =>
      !commonCategories.includes(name) &&
      nodes.some((nd) => (nd.node_categories ?? []).includes(name)),
  );

  const noDamageCount =
    nodes.filter((nd) => !nd.direct_damage).length +
    edges.filter((e) => !e.direct_damage).length;

  const currentLevel = scaleLevels.find((l) => l.level === funcValue);

  // ── Batch helpers ──
  function applyFunctionality() {
    batchOp(() => {
      nodeIds.forEach((id) => updateNode(id, { functionality: funcValue }));
      edgeIds.forEach((id) => updateEdge(id, { functionality: funcValue }));
    }, `Batch functionality → ${funcValue} (${total} elements)`);
  }

  function applyFuncTime() {
    batchOp(() => {
      nodeIds.forEach((id) => updateNode(id, { functionality_time: funcTimeValue }));
      edgeIds.forEach((id) => updateEdge(id, { functionality_time: funcTimeValue }));
    }, `Batch functionality_time → ${funcTimeValue}h`);
  }

  function applyLabel() {
    if (!labelValue.trim()) return;
    batchOp(
      () => nodeIds.forEach((id) => updateNode(id, { label: labelValue.trim() })),
      `Batch label → "${labelValue.trim()}" (${nodeIds.length} nodes)`,
      "graph_update",
    );
  }

  function applyDirectDamage(value: boolean) {
    batchOp(() => {
      nodeIds.forEach((id) => updateNode(id, { direct_damage: value }));
      edgeIds.forEach((id) => updateEdge(id, { direct_damage: value }));
    }, `Batch direct damage → ${value}`);
  }

  function applyRepairTime() {
    const targets = [...nodes, ...edges].filter((el) => el.direct_damage);
    batchOp(() => {
      targets.forEach((el) => {
        if ("node_categories" in el) updateNode(el.id, { expected_repair_time: repairTimeValue });
        else updateEdge(el.id, { expected_repair_time: repairTimeValue });
      });
    }, `Batch repair time → ${repairTimeValue}h (${targets.length} damaged elements)`);
  }

  function applyImportance() {
    batchOp(
      () => nodeIds.forEach((id) => updateNode(id, { importance: importanceValue })),
      `Batch importance → ${importanceValue} (${nodeIds.length} nodes)`,
    );
  }

  function applyCostOfDisservice() {
    batchOp(
      () =>
        nodeIds.forEach((id) => updateNode(id, { cost_of_disservice_per_day: costValue })),
      `Batch cost of disservice → ${costValue} (${nodeIds.length} nodes)`,
    );
  }

  function applyNodeType(nodeType: string) {
    batchOp(
      () => nodeIds.forEach((id) => updateNode(id, { node_type: nodeType })),
      `Batch node type → ${nodeType} (${nodeIds.length} nodes)`,
      "graph_update",
    );
  }

  function applyAddCategory(cat: string) {
    batchOp(
      () =>
        nodeIds.forEach((id) => {
          const node = allNodes[id];
          if (!node) return;
          const current = node.node_categories ?? [];
          if (!current.includes(cat)) updateNode(id, { node_categories: [...current, cat] });
        }),
      `Batch add category "${cat}" (${nodeIds.length} nodes)`,
      "graph_update",
    );
  }

  function applyRemoveCategory(cat: string) {
    batchOp(
      () =>
        nodeIds.forEach((id) => {
          const node = allNodes[id];
          if (!node) return;
          updateNode(id, {
            node_categories: (node.node_categories ?? []).filter((c) => c !== cat),
          });
        }),
      `Batch remove category "${cat}" (${nodeIds.length} nodes)`,
      "graph_update",
    );
  }

  function applyEdgeCapacity() {
    batchOp(
      () => edgeIds.forEach((id) => updateEdge(id, { capacity: capacityValue })),
      `Batch edge capacity → ${capacityValue} (${edgeIds.length} edges)`,
    );
  }

  function applyVulnerabilityLevel(eventId: string, level: number) {
    batchOp(() => {
      nodeIds.forEach((id) =>
        updateNode(id, {
          vulnerability_levels: {
            ...(allNodes[id]?.vulnerability_levels ?? {}),
            [eventId]: level,
          },
        }),
      );
      edgeIds.forEach((id) =>
        updateEdge(id, {
          vulnerability_levels: {
            ...(allEdges[id]?.vulnerability_levels ?? {}),
            [eventId]: level,
          },
        }),
      );
    }, `Batch vulnerability level for event`);
  }

  function applyBatchProfile() {
    if (!batchCat) return;
    batchOp(
      () =>
        nodeIds.forEach((id) => {
          const node = allNodes[id];
          if (!node || !(node.node_categories ?? []).includes(batchCat)) return;
          const existing =
            node.category_dependency_profiles?.[batchCat] ?? { dependency_level: n };
          const updated: CategoryDependencyProfile = {
            ...existing,
            dependency_level: batchDepLevel,
            backup: batchBackup,
            ...(batchBackup ? { backup_duration: batchBackupDuration } : {}),
            demand: batchDemand,
            priority: batchPriority,
          };
          updateNode(id, {
            category_dependency_profiles: {
              ...(node.category_dependency_profiles ?? {}),
              [batchCat]: updated,
            },
          });
        }),
      `Batch profile for "${batchCat}" (${nodeIds.length} nodes)`,
    );
  }

  function handleBatchDelete() {
    if (!window.confirm(`Delete ${total} selected elements?`)) return;
    historyAction(
      () => {
        nodeIds.forEach(removeNode);
        edgeIds.forEach(removeEdge);
      },
      `Delete ${total} elements`,
      "graph_update",
    );
    clearSelection();
    setInspectorOpen(false);
  }


  return (
    <div className="overflow-y-auto">
      {/* ── Header ── */}
      <div className="border-b border-zinc-100 px-3 py-2.5 dark:border-zinc-800">
        <div className="text-xs text-zinc-500">
          <span className="font-semibold text-zinc-700 dark:text-zinc-300">{total}</span>{" "}
          elements selected
          <span className="ml-1 text-zinc-400">
            (
            {isNodesOnly
              ? `${nodeIds.length} nodes`
              : isEdgesOnly
              ? `${edgeIds.length} edges`
              : `${nodeIds.length} nodes, ${edgeIds.length} edges`}
            )
          </span>
        </div>
        <p className="mt-0.5 text-[10px] text-zinc-400">
          Each section applies to all selected elements. Warnings appear when some elements will be
          skipped.
        </p>
      </div>

      {/* ── Identity (nodes only) ── */}
      {isNodesOnly && (
        <Section title="Identity" defaultOpen>
          <Field label="Label (same for all)">
            <div className="flex gap-1">
              <input
                type="text"
                value={labelValue}
                onChange={(e) => setLabelValue(e.target.value)}
                placeholder="Node label…"
                className="flex-1 rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-800 focus:border-blue-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
              />
              <button
                onClick={applyLabel}
                disabled={!labelValue.trim()}
                className="rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-40 dark:bg-blue-900/20 dark:text-blue-300"
              >
                Apply
              </button>
            </div>
          </Field>

          <Field label="Node Type">
            <div className="grid grid-cols-2 gap-1">
              {(["Source", "Infrastructure", "Service", "Personnel"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => applyNodeType(t)}
                  className="rounded-md border border-zinc-200 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  {t}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Categories">
            <div className="mb-1 flex flex-wrap gap-1">
              {commonCategories.map((cat) => (
                <span
                  key={cat}
                  className="flex items-center gap-0.5 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                >
                  {cat}
                  <button
                    onClick={() => applyRemoveCategory(cat)}
                    className="ml-0.5 text-blue-400 hover:text-blue-700"
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
              {categories.length > 0 && (
                <select
                  value=""
                  onChange={(e) => {
                    if (!e.target.value) return;
                    applyAddCategory(e.target.value);
                  }}
                  className="rounded border border-zinc-200 bg-white px-1 py-0.5 text-xs text-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800"
                >
                  <option value="">+ add to all</option>
                  {categories.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {partialCategories.length > 0 && (
              <div className="text-[10px] text-zinc-400">
                On some nodes only: {partialCategories.join(", ")}
              </div>
            )}
          </Field>
        </Section>
      )}

      {/* ── Functionality ── */}
      <Section title="Functionality" defaultOpen>
        <Field label={`Functionality (1–${n})`}>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={1}
              max={n}
              value={funcValue}
              onChange={(e) => setFuncValue(Number(e.target.value))}
              className="flex-1 accent-blue-500"
            />
            <span
              className="min-w-[2rem] rounded px-1.5 py-0.5 text-center text-xs font-medium text-white"
              style={{ backgroundColor: currentLevel?.color ?? "#94a3b8" }}
            >
              {funcValue}
            </span>
          </div>
          {currentLevel && (
            <div className="mt-0.5 text-xs text-zinc-400">{currentLevel.label}</div>
          )}
        </Field>
        <button
          onClick={applyFunctionality}
          className="mt-1 w-full rounded-md bg-blue-50 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-300"
        >
          Apply to {total} element{total > 1 ? "s" : ""}
        </button>
      </Section>

      {/* ── Functionality Time ── */}
      <Section title="Functionality Time">
        <Field label="Hours until degradation (0 = off)">
          <div className="flex gap-1">
            <input
              type="number"
              min={0}
              value={funcTimeValue}
              onChange={(e) => setFuncTimeValue(Number(e.target.value))}
              className="flex-1 rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-800 focus:border-blue-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
            />
            <button
              onClick={applyFuncTime}
              className="rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-300"
            >
              Apply
            </button>
          </div>
        </Field>
      </Section>

      {/* ── Direct Damage ── */}
      <Section title="Direct Damage">
        <div className="flex gap-2">
          <button
            onClick={() => applyDirectDamage(true)}
            className="flex-1 rounded-md bg-red-50 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400"
          >
            Set damaged
          </button>
          <button
            onClick={() => applyDirectDamage(false)}
            className="flex-1 rounded-md bg-zinc-50 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:bg-zinc-800 dark:text-zinc-400"
          >
            Clear damage
          </button>
        </div>
      </Section>

      {/* ── Expected Repair Time ── */}
      <Section title="Expected Repair Time">
        <SkipWarning
          skipped={noDamageCount}
          total={total}
          reason="no direct damage — repair time only applies to physically damaged elements"
        />
        <Field label="Hours">
          <div className="flex gap-1">
            <input
              type="number"
              min={0}
              value={repairTimeValue}
              onChange={(e) => setRepairTimeValue(Number(e.target.value))}
              className="flex-1 rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-800 focus:border-blue-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
            />
            <button
              onClick={applyRepairTime}
              className="rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-40 dark:bg-blue-900/20 dark:text-blue-300"
            >
              Apply
            </button>
          </div>
        </Field>
      </Section>

      {/* ── Socioeconomic Values (nodes only) ── */}
      {isNodesOnly && (
        <Section title="Socioeconomic Values">
          <Field label="Importance (0–1)">
            <div className="flex gap-1">
              <input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={importanceValue}
                onChange={(e) => setImportanceValue(Number(e.target.value))}
                className="flex-1 rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-800 focus:border-blue-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
              />
              <button
                onClick={applyImportance}
                className="rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-300"
              >
                Apply
              </button>
            </div>
          </Field>
          <Field label="Cost of disservice / day">
            <div className="flex gap-1">
              <input
                type="number"
                min={0}
                value={costValue}
                onChange={(e) => setCostValue(Number(e.target.value))}
                className="flex-1 rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-800 focus:border-blue-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
              />
              <button
                onClick={applyCostOfDisservice}
                className="rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-300"
              >
                Apply
              </button>
            </div>
          </Field>
        </Section>
      )}

      {/* ── Category Dependency Profiles (nodes only) ── */}
      {isNodesOnly && categories.length > 0 && (
        <Section title="Category Dependency Profiles">
          <Field label="Category to edit">
            <select
              value={batchCat}
              onChange={(e) => {
                setBatchCat(e.target.value);
                setBatchDepLevel(n);
                setBatchBackup(false);
                setBatchBackupDuration(0);
                setBatchDemand(0);
                setBatchPriority(1);
              }}
              className="w-full rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-800 focus:border-blue-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
            >
              <option value="">— select —</option>
              {categories.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          {batchCat && (
            <>
              <SkipWarning
                skipped={
                  nodes.filter((nd) => !(nd.node_categories ?? []).includes(batchCat)).length
                }
                total={nodeIds.length}
                reason={`not in category "${batchCat}"`}
              />
              <Field label={`Dependency level (1–${n})`}>
                <NumberInput value={batchDepLevel} min={1} max={n} onChange={setBatchDepLevel} />
              </Field>
              <div className="mb-2">
                <Toggle value={batchBackup} onChange={setBatchBackup} label="Has backup" />
              </div>
              {batchBackup && (
                <Field label="Backup duration (hours)">
                  <NumberInput value={batchBackupDuration} min={0} onChange={setBatchBackupDuration} />
                </Field>
              )}
              <Field label="Demand">
                <NumberInput value={batchDemand} min={0} onChange={setBatchDemand} />
              </Field>
              <Field label="Priority (1–10)">
                <NumberInput value={batchPriority} min={1} max={10} onChange={setBatchPriority} />
              </Field>
              <button
                onClick={applyBatchProfile}
                className="mt-1 w-full rounded-md bg-blue-50 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-300"
              >
                Apply profile to all in &quot;{batchCat}&quot;
              </button>
            </>
          )}
        </Section>
      )}

      {/* ── Edge Capacity (edges only) ── */}
      {isEdgesOnly && (
        <Section title="Capacity">
          <Field label="Max throughput">
            <div className="flex gap-1">
              <input
                type="number"
                min={0}
                value={capacityValue}
                onChange={(e) => setCapacityValue(Number(e.target.value))}
                className="flex-1 rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-800 focus:border-blue-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
              />
              <button
                onClick={applyEdgeCapacity}
                className="rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-300"
              >
                Apply
              </button>
            </div>
          </Field>
        </Section>
      )}

      {/* ── Vulnerability Levels (per event) ── */}
      {events.length > 0 && (
        <Section title="Vulnerability Levels">
          {events.map((ev) => (
            <VulnerabilityBatchRow
              key={ev.id}
              event={ev}
              n={n}
              onApply={(value) => applyVulnerabilityLevel(ev.id, value)}
            />
          ))}
        </Section>
      )}

      {/* ── Canvas Membership (nodes only) ── */}
      {isNodesOnly && <CanvasMembershipSection nodeIds={nodeIds} />}

      {/* ── Delete ── */}
      <div className="border-t border-zinc-100 p-3 dark:border-zinc-800">
        <button
          onClick={handleBatchDelete}
          className="flex w-full items-center justify-center gap-1.5 rounded-md bg-red-50 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400"
        >
          <Trash2 size={12} />
          Delete {total} element{total > 1 ? "s" : ""}
        </button>
      </div>
    </div>
  );
}
