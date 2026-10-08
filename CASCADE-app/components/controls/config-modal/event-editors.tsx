"use client";

/**
 * event-editors.tsx — Heavy sub-editors rendered inside each Event card.
 *
 * DirectDamageEditor      — per-element repair-time overrides for hazard events.
 * VulnerabilityLevelsEditor — per-element vulnerability level table for an event.
 */

import { useState, useMemo } from "react";
import { Trash2 } from "lucide-react";
import { cn } from "./primitives";
import { NumberInput } from "./primitives";
import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore } from "@/store/config-store";
import { useShallow } from "zustand/react/shallow";
import { categoryToIcon } from "@/lib/category-icons";
import { brandColor } from "@/lib/brand";

// ---------------------------------------------------------------------------
// DirectDamageEditor
// ---------------------------------------------------------------------------

interface DirectDamageEditorProps {
  defaultRepairTime: number | undefined;
  effects: Record<string, { expected_repair_time: number }>;
  onChangeDefault: (v: number | undefined) => void;
  onChangeEffects: (next: Record<string, { expected_repair_time: number }>) => void;
}

export function DirectDamageEditor({ defaultRepairTime, effects, onChangeDefault, onChangeEffects }: DirectDamageEditorProps) {
  const allNodes = useCanvasStore((s) => s.nodes);
  const allEdges = useCanvasStore((s) => s.edges);
  const categories = useConfigStore(useShallow((s) => s.draft.categories));

  const [filterName, setFilterName] = useState("");
  const [filterType, setFilterType] = useState<"all" | "nodes" | "edges">("all");
  const [filterCat, setFilterCat] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkValue, setBulkValue] = useState("");

  const allElements = useMemo(() => [
    ...Object.values(allNodes).map((n) => ({
      id: n.id,
      label: n.label ?? n.id,
      kind: "node" as const,
      categories: n.node_categories ?? [],
    })),
    ...Object.values(allEdges).map((e) => ({
      id: e.id,
      label: `${allNodes[e.source]?.label ?? e.source} → ${allNodes[e.target]?.label ?? e.target}`,
      kind: "edge" as const,
      categories: [] as string[],
    })),
  ], [allNodes, allEdges]);

  const filtered = useMemo(() => allElements.filter((el) => {
    if (filterType === "nodes" && el.kind !== "node") return false;
    if (filterType === "edges" && el.kind !== "edge") return false;
    if (filterCat && !el.categories.includes(filterCat)) return false;
    if (filterName.trim() && !el.label.toLowerCase().includes(filterName.toLowerCase())) return false;
    return true;
  }), [allElements, filterType, filterCat, filterName]);

  const allFilteredSelected = filtered.length > 0 && filtered.every((el) => selected.has(el.id));

  function toggleSelect(id: string) {
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  function toggleSelectAll() {
    if (allFilteredSelected) {
      setSelected((s) => { const n = new Set(s); filtered.forEach((el) => n.delete(el.id)); return n; });
    } else {
      setSelected((s) => { const n = new Set(s); filtered.forEach((el) => n.add(el.id)); return n; });
    }
  }

  function applyBulk() {
    const v = parseInt(bulkValue, 10);
    if (isNaN(v) || v < 0) return;
    const next = { ...effects };
    for (const id of selected) next[id] = { expected_repair_time: v };
    onChangeEffects(next);
    setBulkValue("");
  }

  function setElementRepairTime(id: string, v: number | undefined) {
    const next = { ...effects };
    if (v === undefined) delete next[id];
    else next[id] = { expected_repair_time: v };
    onChangeEffects(next);
  }

  function repairTimeFor(id: string): number | undefined {
    return effects[id]?.expected_repair_time;
  }

  if (allElements.length === 0) return (
    <p className="mt-2 text-xs text-zinc-400 italic">No nodes or edges in project yet.</p>
  );

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <label className="text-xs text-zinc-500 w-36 shrink-0">Default repair time</label>
        <NumberInput
          value={defaultRepairTime}
          min={0}
          className="w-20"
          onChange={(v) => onChangeDefault(v)}
        />
        <span className="text-xs text-zinc-400">h &nbsp;(blank = no damage by default)</span>
        {defaultRepairTime !== undefined && (
          <button onClick={() => onChangeDefault(undefined)} className="text-xs text-zinc-400 hover:text-red-500">
            <Trash2 size={11} />
          </button>
        )}
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {(["all", "nodes", "edges"] as const).map((opt) => (
          <button key={opt} onClick={() => setFilterType(opt)}
            className={cn("rounded px-2 py-0.5 text-xs transition-colors",
              filterType === opt ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
            )}>
            {opt === "all" ? "All" : opt === "nodes" ? "Nodes" : "Edges"}
          </button>
        ))}
        {categories.map((cat) => {
          const Icon = categoryToIcon(cat.name, cat.icon);
          const active = filterCat === cat.name;
          return (
            <button key={cat.name} onClick={() => setFilterCat(active ? null : cat.name)}
              className={cn(
                "flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors",
                active
                  ? "bg-zinc-700 text-white dark:bg-zinc-300 dark:text-zinc-900"
                  : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
              )}>
              <Icon size={11} strokeWidth={2} />
              {cat.name}
            </button>
          );
        })}
        <input type="text" value={filterName} onChange={(e) => setFilterName(e.target.value)}
          placeholder="name…"
          className="w-24 rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-xs focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200" />
      </div>

      {selected.size > 0 && (
        <div className="mb-2 flex items-center gap-2 rounded bg-blue-50 px-2 py-1.5 dark:bg-blue-900/20">
          <span className="text-xs text-blue-700 dark:text-blue-300">{selected.size} selected</span>
          <input type="number" min={0} value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") applyBulk(); }}
            placeholder="repair time (h)"
            className="w-28 rounded border border-blue-200 bg-white px-1.5 py-0.5 text-xs focus:outline-none dark:border-blue-800 dark:bg-zinc-800 dark:text-zinc-200" />
          <button onClick={applyBulk} className="text-xs text-blue-600 hover:text-blue-800">Apply</button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-xs text-zinc-400 hover:text-zinc-600">Clear</button>
        </div>
      )}

      <div className="max-h-52 overflow-y-auto rounded border border-zinc-100 dark:border-zinc-800">
        {filtered.length === 0 ? (
          <p className="px-3 py-2 text-xs text-zinc-400 italic">No elements match filter.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/50">
                <th className="w-6 px-2 py-1 text-left">
                  <input type="checkbox" checked={allFilteredSelected} onChange={toggleSelectAll} className="h-3 w-3" />
                </th>
                <th className="px-2 py-1 text-left font-medium text-zinc-500">Element</th>
                <th className="w-28 px-2 py-1 text-left font-medium text-zinc-500">Repair time (h)</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((el) => {
                const override = repairTimeFor(el.id);
                const isSelected = selected.has(el.id);
                return (
                  <tr key={el.id} className={cn("border-b border-zinc-50 dark:border-zinc-800/50", isSelected && "bg-blue-50/50 dark:bg-blue-900/10")}>
                    <td className="px-2 py-1">
                      <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(el.id)} className="h-3 w-3" />
                    </td>
                    <td className="px-2 py-1">
                      <span className="text-zinc-700 dark:text-zinc-300">{el.label}</span>
                      {el.kind === "edge" && <span className="ml-1 text-zinc-400">(edge)</span>}
                    </td>
                    <td className="px-2 py-1">
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={0}
                          value={override !== undefined ? override : (defaultRepairTime ?? "")}
                          onChange={(e) => {
                            const v = e.target.value === "" ? undefined : parseInt(e.target.value, 10);
                            setElementRepairTime(el.id, isNaN(v as number) ? undefined : v);
                          }}
                          className={cn(
                            "w-16 rounded border px-1.5 py-0.5 text-xs focus:outline-none dark:bg-zinc-800 dark:text-zinc-200",
                            override !== undefined
                              ? "border-blue-300 dark:border-blue-700"
                              : "border-zinc-200 text-zinc-400 dark:border-zinc-700",
                          )}
                        />
                        {override !== undefined && (
                          <button onClick={() => setElementRepairTime(el.id, undefined)} className="text-zinc-300 hover:text-red-500">
                            <Trash2 size={10} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// VulnerabilityLevelsEditor
// ---------------------------------------------------------------------------

export function VulnerabilityLevelsEditor({ eventId }: { eventId: string }) {
  const allNodes = useCanvasStore((s) => s.nodes);
  const allEdges = useCanvasStore((s) => s.edges);
  const updateNode = useCanvasStore((s) => s.updateNode);
  const updateEdge = useCanvasStore((s) => s.updateEdge);
  const categories = useConfigStore(useShallow((s) => s.draft.categories));
  const n = useConfigStore((s) => s.draft.functionality_scale.length);

  const [filterName, setFilterName] = useState("");
  const [filterType, setFilterType] = useState<"all" | "nodes" | "edges">("all");
  const [filterCat, setFilterCat] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLevel, setBulkLevel] = useState("");

  const allElements = useMemo(() => [
    ...Object.values(allNodes).map((nd) => ({
      id: nd.id,
      label: nd.label ?? nd.id,
      kind: "node" as const,
      categories: nd.node_categories ?? [],
      level: nd.vulnerability_levels?.[eventId] ?? 0,
    })),
    ...Object.values(allEdges).map((e) => ({
      id: e.id,
      label: `${allNodes[e.source]?.label ?? e.source} → ${allNodes[e.target]?.label ?? e.target}`,
      kind: "edge" as const,
      categories: [] as string[],
      level: e.vulnerability_levels?.[eventId] ?? 0,
    })),
  ], [allNodes, allEdges, eventId]);

  const filtered = useMemo(() => allElements.filter((el) => {
    if (filterType === "nodes" && el.kind !== "node") return false;
    if (filterType === "edges" && el.kind !== "edge") return false;
    if (filterCat && !el.categories.includes(filterCat)) return false;
    if (filterName.trim() && !el.label.toLowerCase().includes(filterName.toLowerCase())) return false;
    return true;
  }), [allElements, filterType, filterCat, filterName]);

  const allFilteredSelected = filtered.length > 0 && filtered.every((el) => selected.has(el.id));

  function toggleSelect(id: string) {
    setSelected((s) => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  function toggleSelectAll() {
    if (allFilteredSelected) {
      setSelected((s) => { const next = new Set(s); filtered.forEach((el) => next.delete(el.id)); return next; });
    } else {
      setSelected((s) => { const next = new Set(s); filtered.forEach((el) => next.add(el.id)); return next; });
    }
  }

  function setLevel(id: string, isNode: boolean, level: number) {
    const clamped = Math.min(n - 1, Math.max(0, Math.round(level)));
    if (isNode) {
      const vulns = { ...(allNodes[id]?.vulnerability_levels ?? {}) };
      if (clamped === 0) delete vulns[eventId]; else vulns[eventId] = clamped;
      updateNode(id, { vulnerability_levels: vulns });
    } else {
      const vulns = { ...(allEdges[id]?.vulnerability_levels ?? {}) };
      if (clamped === 0) delete vulns[eventId]; else vulns[eventId] = clamped;
      updateEdge(id, { vulnerability_levels: vulns });
    }
  }

  function applyBulk() {
    const v = parseInt(bulkLevel, 10);
    if (isNaN(v)) return;
    for (const id of selected) {
      const el = allElements.find((e) => e.id === id);
      if (el) setLevel(id, el.kind === "node", v);
    }
    setBulkLevel("");
  }

  if (allElements.length === 0) return (
    <p className="mt-2 text-xs text-zinc-400 italic">No nodes or edges in project yet.</p>
  );

  return (
    <div>
      <p className="mb-2 text-[10px] text-zinc-400">0 = immune · 1–{n - 1} = progressively more affected</p>

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {(["all", "nodes", "edges"] as const).map((opt) => (
          <button key={opt} onClick={() => setFilterType(opt)}
            className={cn("rounded px-2 py-0.5 text-xs transition-colors",
              filterType === opt ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
            )}>
            {opt === "all" ? "All" : opt === "nodes" ? "Nodes" : "Edges"}
          </button>
        ))}
        {categories.map((cat) => (
          <button key={cat.name} onClick={() => setFilterCat(filterCat === cat.name ? null : cat.name)}
            className={cn("rounded px-2 py-0.5 text-xs transition-colors",
              filterCat === cat.name ? "text-white" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
            )}
            style={filterCat === cat.name ? { backgroundColor: cat.color ?? brandColor("neutral", 500) } : undefined}>
            {cat.name}
          </button>
        ))}
        <input type="text" value={filterName} onChange={(e) => setFilterName(e.target.value)}
          placeholder="name…"
          className="w-24 rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-xs focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200" />
      </div>

      {selected.size > 0 && (
        <div className="mb-2 flex items-center gap-2 rounded bg-blue-50 px-2 py-1.5 dark:bg-blue-900/20">
          <span className="text-xs text-blue-700 dark:text-blue-300">{selected.size} selected</span>
          <input type="number" min={0} max={n - 1} value={bulkLevel} onChange={(e) => setBulkLevel(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") applyBulk(); }}
            placeholder={`0–${n - 1}`}
            className="w-16 rounded border border-blue-200 bg-white px-1.5 py-0.5 text-xs focus:outline-none dark:border-blue-800 dark:bg-zinc-800 dark:text-zinc-200" />
          <button onClick={applyBulk} className="text-xs text-blue-600 hover:text-blue-800">Apply</button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-xs text-zinc-400 hover:text-zinc-600">Clear</button>
        </div>
      )}

      <div className="max-h-52 overflow-y-auto rounded border border-zinc-100 dark:border-zinc-800">
        {filtered.length === 0 ? (
          <p className="px-3 py-2 text-xs text-zinc-400 italic">No elements match filter.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/50">
                <th className="w-6 px-2 py-1 text-left">
                  <input type="checkbox" checked={allFilteredSelected} onChange={toggleSelectAll} className="h-3 w-3" />
                </th>
                <th className="px-2 py-1 text-left font-medium text-zinc-500">Element</th>
                <th className="w-24 px-2 py-1 text-left font-medium text-zinc-500">Level (0–{n - 1})</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((el) => {
                const isSelected = selected.has(el.id);
                const hasLevel = el.level > 0;
                return (
                  <tr key={el.id} className={cn("border-b border-zinc-50 dark:border-zinc-800/50", isSelected && "bg-blue-50/50 dark:bg-blue-900/10")}>
                    <td className="px-2 py-1">
                      <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(el.id)} className="h-3 w-3" />
                    </td>
                    <td className="px-2 py-1">
                      <span className="text-zinc-700 dark:text-zinc-300">{el.label}</span>
                      {el.kind === "edge" && <span className="ml-1 text-zinc-400">(edge)</span>}
                    </td>
                    <td className="px-2 py-1">
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={0}
                          max={n - 1}
                          value={el.level}
                          onChange={(e) => {
                            const v = parseInt(e.target.value, 10);
                            if (!isNaN(v)) setLevel(el.id, el.kind === "node", v);
                          }}
                          className={cn(
                            "w-14 rounded border px-1.5 py-0.5 text-xs focus:outline-none dark:bg-zinc-800 dark:text-zinc-200",
                            hasLevel
                              ? "border-orange-300 dark:border-orange-700"
                              : "border-zinc-200 text-zinc-400 dark:border-zinc-700",
                          )}
                        />
                        {hasLevel && (
                          <button onClick={() => setLevel(el.id, el.kind === "node", 0)} className="text-zinc-300 hover:text-red-500" title="Reset to 0 (immune)">
                            <Trash2 size={10} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
