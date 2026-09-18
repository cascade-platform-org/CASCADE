"use client";

/**
 * event-editors.tsx — Heavy sub-editors rendered inside each Event card.
 *
 * DirectDamageEditor      — per-element repair-time overrides for hazard events.
 * VulnerabilityLevelsEditor — per-element vulnerability level table for an event.
 * AttributeMutationsEditor  — dot-notation attribute mutation map for an event.
 */

import React, { useState, useMemo } from "react";
import { Plus, Trash2 } from "lucide-react";
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

// ---------------------------------------------------------------------------
// AttributeMutationsEditor
// ---------------------------------------------------------------------------

const KNOWN_FIELDS = [
  { value: "expected_repair_time", label: "Repair time (h)", kind: "number" },
  { value: "functionality",        label: "Functionality level", kind: "number" },
  { value: "direct_damage",        label: "Direct damage (true/false)", kind: "boolean" },
  { value: "backup_duration",      label: "Backup duration (h)", kind: "number" },
  { value: "importance",           label: "Importance", kind: "number" },
] as const;

function coerceValue(raw: string, fieldName: string): unknown {
  const known = KNOWN_FIELDS.find((f) => f.value === fieldName);
  if (known?.kind === "boolean") return raw === "true";
  if (known?.kind === "number") {
    const n = Number(raw);
    return isNaN(n) ? raw : n;
  }
  // Object/array-valued mutations are legal (schema: "values are any
  // JSON-serialisable type") and some fields require them — e.g. the
  // importer's demand-surge event overrides a whole
  // category_dependency_profiles dict, since the applier (canvas-store)
  // only supports top-level "<elementId>.<field>" keys, not deep paths.
  // Accept JSON text for those; fall through to the scalar rules if it
  // doesn't parse.
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // not valid JSON — treat as a plain string below
    }
  }
  const n = Number(raw);
  if (!isNaN(n) && raw.trim() !== "") return n;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return raw;
}

/** Human-readable rendering for a mutation value: primitives as-is, objects/
 * arrays as compact JSON (String() would render them "[object Object]"). */
function formatMutationValue(val: unknown): string {
  return typeof val === "object" && val !== null ? JSON.stringify(val) : String(val);
}

interface AttributeMutationsEditorProps {
  mutations: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

export function AttributeMutationsEditor({ mutations, onChange }: AttributeMutationsEditorProps) {
  const allNodes = useCanvasStore((s) => s.nodes);
  const allEdges = useCanvasStore((s) => s.edges);
  const [openElements, setOpenElements] = useState<Set<string>>(new Set());
  const [newFieldFor, setNewFieldFor] = useState<Record<string, string>>({});
  const [newValueFor, setNewValueFor] = useState<Record<string, string>>({});
  const [customFieldFor, setCustomFieldFor] = useState<Record<string, string>>({});
  const [nodeSearch, setNodeSearch] = useState("");

  const labelOf = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [id, n] of Object.entries(allNodes)) map[id] = n.label ?? id;
    for (const [id, e] of Object.entries(allEdges)) {
      const src = allNodes[e.source]?.label ?? e.source;
      const tgt = allNodes[e.target]?.label ?? e.target;
      map[id] = `${src} → ${tgt}`;
    }
    return map;
  }, [allNodes, allEdges]);

  const byElement = useMemo(() => {
    const groups: Record<string, Record<string, unknown>> = {};
    for (const [key, val] of Object.entries(mutations)) {
      // Split on the LAST "." — field names never contain a dot, but a
      // free-form element id (e.g. a raw .inp label) can (canvas-store.ts
      // applies the same rule when reading these keys back).
      const dot = key.lastIndexOf(".");
      if (dot === -1) continue;
      const elemId = key.slice(0, dot);
      const field = key.slice(dot + 1);
      if (!groups[elemId]) groups[elemId] = {};
      groups[elemId][field] = val;
    }
    return groups;
  }, [mutations]);

  const allElementIds = useMemo(() => {
    const ids = new Set([...Object.keys(byElement), ...openElements]);
    return [...ids];
  }, [byElement, openElements]);

  const availableElements = useMemo(() => {
    const taken = new Set(allElementIds);
    return [
      ...Object.keys(allNodes).map((id) => ({ id, label: labelOf[id] ?? id, kind: "node" as const })),
      ...Object.keys(allEdges).map((id) => ({ id, label: labelOf[id] ?? id, kind: "edge" as const })),
    ].filter((e) => !taken.has(e.id));
  }, [allNodes, allEdges, allElementIds, labelOf]);

  const filteredAvailable = nodeSearch.trim()
    ? availableElements.filter((e) => e.label.toLowerCase().includes(nodeSearch.toLowerCase()))
    : availableElements;

  function removeField(elemId: string, field: string) {
    const next = { ...mutations };
    delete next[`${elemId}.${field}`];
    onChange(next);
  }

  function resolvedField(elemId: string): string {
    const sel = newFieldFor[elemId] ?? "";
    return sel === "__custom__" ? (customFieldFor[elemId] ?? "").trim() : sel;
  }

  function addField(elemId: string) {
    const field = resolvedField(elemId);
    const rawVal = newValueFor[elemId]?.trim() ?? "";
    if (!field) return;
    onChange({ ...mutations, [`${elemId}.${field}`]: coerceValue(rawVal, field) });
    setNewFieldFor((p) => ({ ...p, [elemId]: "" }));
    setNewValueFor((p) => ({ ...p, [elemId]: "" }));
    setCustomFieldFor((p) => ({ ...p, [elemId]: "" }));
  }

  function addElement(elemId: string) {
    setOpenElements((p) => new Set([...p, elemId]));
    setNodeSearch("");
  }

  function removeElement(elemId: string) {
    const next = { ...mutations };
    for (const key of Object.keys(next)) {
      if (key.startsWith(`${elemId}.`)) delete next[key];
    }
    onChange(next);
    setOpenElements((p) => { const s = new Set(p); s.delete(elemId); return s; });
  }

  return (
    <div>
      {allElementIds.length === 0 && (
        <p className="mb-2 text-xs text-zinc-400 italic">
          No overrides yet. Search for a node or edge below to add one.
        </p>
      )}

      <div className="space-y-2">
        {allElementIds.map((elemId) => {
          const fields = byElement[elemId] ?? {};
          const fieldCount = Object.keys(fields).length;
          const selectedField = newFieldFor[elemId] ?? "";
          return (
            <div key={elemId} className="rounded-md border border-zinc-200 dark:border-zinc-700">
              <div className="flex items-center justify-between bg-zinc-50 px-3 py-2 dark:bg-zinc-800/50">
                <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  {labelOf[elemId] ?? elemId}
                  {fieldCount > 0 && (
                    <span className="ml-1.5 text-zinc-400">
                      ({fieldCount} override{fieldCount !== 1 ? "s" : ""})
                    </span>
                  )}
                </span>
                <button
                  onClick={() => removeElement(elemId)}
                  className="text-zinc-400 hover:text-red-500"
                  title="Remove all overrides for this element"
                >
                  <Trash2 size={11} />
                </button>
              </div>

              <div className="px-3 pb-3 pt-2">
                {Object.entries(fields).map(([field, val]) => (
                  <div key={field} className="mb-1.5 flex items-center gap-2 text-xs">
                    <span className="w-40 shrink-0 font-mono text-zinc-500">{field}</span>
                    <span
                      className="min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-200"
                      title={formatMutationValue(val)}
                    >
                      {formatMutationValue(val)}
                    </span>
                    <button onClick={() => removeField(elemId, field)} className="text-zinc-300 hover:text-red-500">
                      <Trash2 size={10} />
                    </button>
                  </div>
                ))}

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <select
                    value={selectedField}
                    onChange={(e) => setNewFieldFor((p) => ({ ...p, [elemId]: e.target.value }))}
                    className="rounded border border-zinc-200 bg-white px-1.5 py-1 text-xs focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
                  >
                    <option value="">— pick field —</option>
                    {KNOWN_FIELDS.map((f) => (
                      <option key={f.value} value={f.value}>{f.label}</option>
                    ))}
                    <option value="__custom__">custom field…</option>
                  </select>

                  {selectedField === "__custom__" && (
                    <input
                      type="text"
                      placeholder="field name"
                      value={customFieldFor[elemId] ?? ""}
                      onChange={(e) => setCustomFieldFor((p) => ({ ...p, [elemId]: e.target.value }))}
                      className="w-28 rounded border border-zinc-200 bg-white px-1.5 py-1 text-xs focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
                    />
                  )}

                  {selectedField && (
                    <>
                      <input
                        type="text"
                        placeholder="value"
                        value={newValueFor[elemId] ?? ""}
                        onChange={(e) => setNewValueFor((p) => ({ ...p, [elemId]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === "Enter") addField(elemId); }}
                        className="w-20 rounded border border-zinc-200 bg-white px-1.5 py-1 text-xs focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
                      />
                      <button
                        onClick={() => addField(elemId)}
                        className="flex items-center gap-0.5 text-xs text-blue-500 hover:text-blue-700"
                      >
                        <Plus size={11} /> Add
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {availableElements.length > 0 && (
        <div className="relative mt-2">
          <input
            type="text"
            value={nodeSearch}
            onChange={(e) => setNodeSearch(e.target.value)}
            placeholder="+ Add element override…"
            className="w-full rounded border border-dashed border-zinc-300 bg-transparent px-2 py-1.5 text-xs text-zinc-600 placeholder-zinc-400 focus:border-blue-400 focus:outline-none dark:border-zinc-600 dark:text-zinc-300"
          />
          {nodeSearch.trim() && (
            <ul className="absolute z-10 mt-0.5 max-h-36 w-full overflow-y-auto rounded border border-zinc-200 bg-white shadow-md dark:border-zinc-700 dark:bg-zinc-900">
              {filteredAvailable.length === 0 ? (
                <li className="px-3 py-2 text-xs text-zinc-400">No match</li>
              ) : (
                filteredAvailable.slice(0, 8).map((e) => (
                  <li key={e.id}>
                    <button
                      onClick={() => addElement(e.id)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800"
                    >
                      <span className="text-zinc-700 dark:text-zinc-300">{e.label}</span>
                      <span className="text-zinc-400">{e.kind}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
