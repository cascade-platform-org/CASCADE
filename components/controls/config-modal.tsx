"use client";

/**
 * Config Modal (F3) — 5-tab editor for the ModelConfiguration.
 *
 * Operates on config-store's draft. Commits or discards on close.
 * Dirty-state guard: closing with unsaved edits shows a confirmation dialog.
 *
 * Tabs:
 *   1. Functionality Scale
 *   2. Categories
 *   3. Events
 *   4. Graph Types
 *   5. Node Defaults
 */

import { useEffect, useState, useMemo } from "react";
import { X, Plus, Trash2, GripVertical, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useConfigStore } from "@/store/config-store";
import { useUiStore } from "@/store/ui-store";
import { useCanvasStore, selectOrderedCanvases } from "@/store/canvas-store";
import { useShallow } from "zustand/react/shallow";
import type { ConfigModalTab } from "@/store/ui-store";

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

function TextInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={cn(
        "rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-800 focus:border-blue-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
        className,
      )}
    />
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  className,
}: {
  value: number | undefined;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
}) {
  return (
    <input
      type="number"
      value={value ?? ""}
      min={min}
      max={max}
      step={step ?? 1}
      onChange={(e) => onChange(Number(e.target.value))}
      className={cn(
        "rounded border border-zinc-200 bg-white px-2 py-1 text-xs focus:border-blue-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
        className,
      )}
    />
  );
}

function ColBtn({
  onClick,
  children,
  variant = "ghost",
}: {
  onClick: () => void;
  children: React.ReactNode;
  variant?: "ghost" | "danger";
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors",
        variant === "danger"
          ? "text-red-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
          : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300",
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Tab 1 — Functionality Scale
// ---------------------------------------------------------------------------

function TabFunctionalityScale() {
  const levels = useConfigStore(useShallow((s) => s.draft.functionality_scale));
  const addScaleLevel = useConfigStore((s) => s.addScaleLevel);
  const removeScaleLevel = useConfigStore((s) => s.removeScaleLevel);
  const updateScaleLevel = useConfigStore((s) => s.updateScaleLevel);

  return (
    <div>
      <p className="mb-3 text-xs text-zinc-500">
        Ordered levels: 1 = worst (critical), N = fully operational. Min 2 levels.
      </p>

      {/* Preview strip */}
      <div className="mb-4 flex h-6 overflow-hidden rounded-md">
        {[...levels].sort((a, b) => a.level - b.level).map((l) => (
          <div
            key={l.level}
            title={l.label}
            className="flex-1"
            style={{ backgroundColor: l.color }}
          />
        ))}
      </div>

      <div className="space-y-2">
        {[...levels].sort((a, b) => a.level - b.level).map((l) => (
          <div key={l.level} className="flex items-center gap-2">
            <span className="w-5 text-right text-xs font-mono text-zinc-400">{l.level}</span>
            <TextInput
              value={l.label}
              onChange={(v) => updateScaleLevel(l.level, { label: v })}
              className="flex-1"
              placeholder="label"
            />
            <input
              type="color"
              value={l.color}
              onChange={(e) => updateScaleLevel(l.level, { color: e.target.value })}
              className="h-7 w-7 cursor-pointer rounded border-0 bg-transparent p-0"
            />
            <ColBtn
              variant="danger"
              onClick={() => removeScaleLevel(l.level)}
            >
              <Trash2 size={12} />
            </ColBtn>
          </div>
        ))}
      </div>

      <button
        onClick={addScaleLevel}
        className="mt-3 flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700"
      >
        <Plus size={12} /> Add level
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 2 — Categories
// ---------------------------------------------------------------------------

function TabCategories() {
  const categories = useConfigStore(useShallow((s) => s.draft.categories));
  const addCategory = useConfigStore((s) => s.addCategory);
  const removeCategoryAt = useConfigStore((s) => s.removeCategoryAt);
  const updateCategoryAt = useConfigStore((s) => s.updateCategoryAt);

  return (
    <div>
      <p className="mb-3 text-xs text-zinc-500">
        Categories define resource types. <code className="font-mono">category_type</code> determines the engine heuristic.
      </p>

      {categories.length === 0 && (
        <p className="mb-3 text-xs text-zinc-400 italic">No categories defined yet.</p>
      )}

      <div className="space-y-2">
        {categories.map((cat, i) => (
          <div key={i} className="flex items-center gap-2 rounded-md border border-zinc-100 p-2 dark:border-zinc-800">
            <TextInput
              value={cat.name}
              onChange={(v) => updateCategoryAt(i, { name: v })}
              className="w-28"
              placeholder="name"
            />
            <select
              value={cat.category_type}
              onChange={(e) => updateCategoryAt(i, { category_type: e.target.value })}
              className="flex-1 rounded border border-zinc-200 bg-white px-2 py-1 text-xs focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
            >
              <option value="SourceToDemands">SourceToDemands</option>
              <option value="Requisite">Requisite</option>
            </select>
            <input
              type="color"
              value={cat.color ?? "#94a3b8"}
              onChange={(e) => updateCategoryAt(i, { color: e.target.value })}
              className="h-7 w-7 cursor-pointer rounded border-0 bg-transparent p-0"
            />
            <ColBtn variant="danger" onClick={() => removeCategoryAt(i)}>
              <Trash2 size={12} />
            </ColBtn>
          </div>
        ))}
      </div>

      <button
        onClick={() =>
          addCategory({ name: `category_${categories.length + 1}`, category_type: "SourceToDemands" })
        }
        className="mt-3 flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700"
      >
        <Plus size={12} /> Add category
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 3 — Events
// ---------------------------------------------------------------------------

function TabEvents() {
  const events = useConfigStore(useShallow((s) => s.draft.events));
  const addEvent = useConfigStore((s) => s.addEvent);
  const removeEvent = useConfigStore((s) => s.removeEvent);
  const updateEvent = useConfigStore((s) => s.updateEvent);

  return (
    <div>
      <p className="mb-3 text-xs text-zinc-500">
        First 5 events appear in the Action Bar. Events 6+ appear in "More ▼".
      </p>

      {events.length === 0 && (
        <p className="mb-3 text-xs text-zinc-400 italic">No events defined yet.</p>
      )}

      <div className="space-y-3">
        {events.map((ev, idx) => (
          <div key={ev.id} className="rounded-md border border-zinc-100 p-3 dark:border-zinc-800">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-500">#{idx + 1}</span>
              <ColBtn variant="danger" onClick={() => removeEvent(ev.id)}>
                <Trash2 size={12} />
              </ColBtn>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-0.5 block text-xs text-zinc-400">Label</label>
                <TextInput
                  value={ev.label}
                  onChange={(v) => updateEvent(ev.id, { label: v })}
                  className="w-full"
                />
              </div>
              <div>
                <label className="mb-0.5 block text-xs text-zinc-400">Type</label>
                <select
                  value={ev.type}
                  onChange={(e) =>
                    updateEvent(ev.id, { type: e.target.value as "hazard" | "disservice" })
                  }
                  className="w-full rounded border border-zinc-200 bg-white px-2 py-1 text-xs focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                >
                  <option value="hazard">Hazard</option>
                  <option value="disservice">Disservice</option>
                </select>
              </div>
              <div>
                <label className="mb-0.5 block text-xs text-zinc-400">Frequency / 10y</label>
                <NumberInput
                  value={ev.frequency_per_10y}
                  min={0}
                  step={0.1}
                  className="w-full"
                  onChange={(v) => updateEvent(ev.id, { frequency_per_10y: v })}
                />
              </div>
              {ev.type === "disservice" && (
                <div>
                  <label className="mb-0.5 block text-xs text-zinc-400">Recovery time (h)</label>
                  <NumberInput
                    value={ev.expected_recovery_time}
                    min={0}
                    className="w-full"
                    onChange={(v) => updateEvent(ev.id, { expected_recovery_time: v })}
                  />
                </div>
              )}
            </div>

            {ev.type === "hazard" && (
              <DirectDamageEditor
                defaultRepairTime={ev.default_repair_time}
                effects={ev.direct_damage_effects ?? {}}
                onChangeDefault={(v) => updateEvent(ev.id, { default_repair_time: v })}
                onChangeEffects={(next) => updateEvent(ev.id, { direct_damage_effects: next })}
              />
            )}

            <AttributeMutationsEditor
              mutations={ev.attribute_mutations ?? {}}
              onChange={(next) => updateEvent(ev.id, { attribute_mutations: next })}
            />
          </div>
        ))}
      </div>

      <button
        onClick={() =>
          addEvent({
            label: "New Event",
            type: "hazard",
            frequency_per_10y: 0,
            attribute_mutations: {},
          })
        }
        className="mt-3 flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700"
      >
        <Plus size={12} /> Add event
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Direct Damage Editor (hazard events only)
// ---------------------------------------------------------------------------

interface DirectDamageEditorProps {
  defaultRepairTime: number | undefined;
  effects: Record<string, { expected_repair_time: number }>;
  onChangeDefault: (v: number | undefined) => void;
  onChangeEffects: (next: Record<string, { expected_repair_time: number }>) => void;
}

function DirectDamageEditor({ defaultRepairTime, effects, onChangeDefault, onChangeEffects }: DirectDamageEditorProps) {
  const allNodes = useCanvasStore((s) => s.nodes);
  const allEdges = useCanvasStore((s) => s.edges);
  const categories = useConfigStore(useShallow((s) => s.draft.categories));

  const [filterName, setFilterName] = useState("");
  const [filterType, setFilterType] = useState<"all" | "nodes" | "edges">("all");
  const [filterCat, setFilterCat] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkValue, setBulkValue] = useState("");

  const NODE_TYPE_OPTIONS = ["Source", "Infrastructure", "Service", "Personnel"];

  const allElements = useMemo(() => [
    ...Object.values(allNodes).map((n) => ({
      id: n.id,
      label: n.label ?? n.id,
      kind: "node" as const,
      node_type: n.node_type,
      categories: n.node_categories ?? [],
    })),
    ...Object.values(allEdges).map((e) => ({
      id: e.id,
      label: `${allNodes[e.source]?.label ?? e.source} → ${allNodes[e.target]?.label ?? e.target}`,
      kind: "edge" as const,
      node_type: undefined,
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
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
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
    <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
      <p className="mb-2 text-xs font-medium text-zinc-600 dark:text-zinc-400">Direct damage</p>

      {/* Default repair time */}
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

      {/* Filters */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {/* Nodes / Edges toggle */}
        {(["all", "nodes", "edges"] as const).map((opt) => (
          <button key={opt} onClick={() => setFilterType(opt)}
            className={cn("rounded px-2 py-0.5 text-xs transition-colors",
              filterType === opt ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
            )}>
            {opt === "all" ? "All" : opt === "nodes" ? "Nodes" : "Edges"}
          </button>
        ))}
        {/* Category filter */}
        {categories.map((cat) => (
          <button key={cat.name} onClick={() => setFilterCat(filterCat === cat.name ? null : cat.name)}
            className={cn("rounded px-2 py-0.5 text-xs transition-colors",
              filterCat === cat.name ? "text-white" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
            )}
            style={filterCat === cat.name ? { backgroundColor: cat.color ?? "#6b7280" } : undefined}>
            {cat.name}
          </button>
        ))}
        {/* Name search */}
        <input type="text" value={filterName} onChange={(e) => setFilterName(e.target.value)}
          placeholder="name…"
          className="w-24 rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-xs focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200" />
      </div>

      {/* Bulk edit bar — shown when something is selected */}
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

      {/* Element list */}
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
// Attribute Mutations Editor
// ---------------------------------------------------------------------------

/**
 * Known fields offered as quick-pick shortcuts in the field name dropdown.
 * Users can still type any custom field name.
 */
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
  const n = Number(raw);
  if (!isNaN(n) && raw.trim() !== "") return n;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return raw;
}

interface AttributeMutationsEditorProps {
  /** Current attribute_mutations map: `"<elementId>.<field>"` → value */
  mutations: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

/**
 * Groups the flat `"<elementId>.<field>"` map by element so the user
 * sees one expandable row per element rather than raw dot-notation keys.
 */
function AttributeMutationsEditor({ mutations, onChange }: AttributeMutationsEditorProps) {
  const allNodes = useCanvasStore((s) => s.nodes);
  const allEdges = useCanvasStore((s) => s.edges);
  // Elements added via the picker but with no mutations saved yet
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
      const dot = key.indexOf(".");
      if (dot === -1) continue;
      const elemId = key.slice(0, dot);
      const field = key.slice(dot + 1);
      if (!groups[elemId]) groups[elemId] = {};
      groups[elemId][field] = val;
    }
    return groups;
  }, [mutations]);

  // All element ids to render: those with saved mutations + those just opened
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
    <div className="mt-4 border-t border-zinc-100 pt-3 dark:border-zinc-800">
      <p className="mb-2 text-xs font-medium text-zinc-600 dark:text-zinc-400">
        Element overrides
      </p>

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
              {/* Element header */}
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
                {/* Saved fields */}
                {Object.entries(fields).map(([field, val]) => (
                  <div key={field} className="mb-1.5 flex items-center gap-2 text-xs">
                    <span className="w-40 shrink-0 font-mono text-zinc-500">{field}</span>
                    <span className="flex-1 text-zinc-700 dark:text-zinc-200">{String(val)}</span>
                    <button onClick={() => removeField(elemId, field)} className="text-zinc-300 hover:text-red-500">
                      <Trash2 size={10} />
                    </button>
                  </div>
                ))}

                {/* Add field row */}
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

      {/* Element picker */}
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

// ---------------------------------------------------------------------------
// Tab 4 — Graph Types
// ---------------------------------------------------------------------------

function TabGraphTypes() {
  const graphTypes = useConfigStore(useShallow((s) => s.draft.graph_types));
  const engineAlgorithms = useConfigStore((s) => s.engineAlgorithms);
  const engineAlgorithmsStatus = useConfigStore((s) => s.engineAlgorithmsStatus);
  const fetchEngineAlgorithms = useConfigStore((s) => s.fetchEngineAlgorithms);
  const addGraphType = useConfigStore((s) => s.addGraphType);
  const removeGraphType = useConfigStore((s) => s.removeGraphType);
  const addAlgorithm = useConfigStore((s) => s.addAlgorithm);
  const removeAlgorithm = useConfigStore((s) => s.removeAlgorithm);
  const updateAlgorithm = useConfigStore((s) => s.updateAlgorithm);

  const canvases = useCanvasStore(useShallow(selectOrderedCanvases));
  const setGraphType = useCanvasStore((s) => s.setGraphType);
  const globalGraphType = useCanvasStore((s) => s.projectMeta.global_graph_type);
  const setGlobalGraphType = useCanvasStore((s) => s.setGlobalGraphType);

  useEffect(() => {
    fetchEngineAlgorithms();
  }, [fetchEngineAlgorithms]);

  const availableHeuristics = engineAlgorithms?.heuristics ?? [];

  return (
    <div>
      {engineAlgorithmsStatus === "error" && (
        <div className="mb-3 rounded bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
          Server unreachable — algorithm list unavailable. You can still type heuristic IDs manually.
        </div>
      )}

      {graphTypes.length === 0 && (
        <p className="mb-3 text-xs text-zinc-400 italic">No graph types defined yet.</p>
      )}

      <div className="space-y-4">
        {graphTypes.map((gt) => (
          <div key={gt.name} className="rounded-md border border-zinc-100 p-3 dark:border-zinc-800">
            <div className="mb-2 flex items-center justify-between gap-2">
              <TextInput
                value={gt.name}
                onChange={() => {}} // rename handled via updateGraphTypeName
                className="flex-1 font-semibold"
                placeholder="graph type name"
              />
              <ColBtn variant="danger" onClick={() => removeGraphType(gt.name)}>
                <Trash2 size={12} />
              </ColBtn>
            </div>

            <div className="space-y-1">
              {gt.heuristics.map((h) => (
                <div key={h.id} className="flex items-center gap-2">
                  <GripVertical size={12} className="text-zinc-300" />
                  <input
                    type="checkbox"
                    checked={h.enabled}
                    onChange={(e) =>
                      updateAlgorithm(gt.name, h.id, { enabled: e.target.checked })
                    }
                    className="accent-blue-500"
                  />
                  <span className="flex-1 font-mono text-xs text-zinc-700 dark:text-zinc-300">
                    {h.id}
                  </span>
                  <ColBtn variant="danger" onClick={() => removeAlgorithm(gt.name, h.id)}>
                    <Trash2 size={12} />
                  </ColBtn>
                </div>
              ))}
            </div>

            <div className="mt-2 flex items-center gap-2">
              {availableHeuristics.length > 0 ? (
                <select
                  value=""
                  onChange={(e) => {
                    if (!e.target.value) return;
                    addAlgorithm(gt.name, { id: e.target.value, enabled: true });
                  }}
                  className="flex-1 rounded border border-zinc-200 bg-white px-2 py-0.5 text-xs focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                >
                  <option value="">+ add heuristic…</option>
                  {availableHeuristics.map((h) => (
                    <option key={h.id} value={h.id}>{h.id}</option>
                  ))}
                </select>
              ) : (
                <button
                  onClick={() =>
                    addAlgorithm(gt.name, { id: "new-heuristic", enabled: true })
                  }
                  className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700"
                >
                  <Plus size={10} /> Add heuristic
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={() => addGraphType(`graph_type_${graphTypes.length + 1}`)}
        className="mt-3 flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700"
      >
        <Plus size={12} /> Add graph type
      </button>

      {/* Canvas assignments — live canvas-store writes, outside the config draft */}
      {(canvases.length > 0) && (
        <div className="mt-5 border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <p className="mb-2 text-xs font-semibold text-zinc-500 uppercase tracking-wide dark:text-zinc-400">
            Canvas assignments
          </p>
          <p className="mb-3 text-xs text-zinc-400 dark:text-zinc-500">
            Assign a graph type to each canvas. Changes apply immediately — they are not part of the config draft.
          </p>
          <div className="space-y-1.5">
            {canvases.map((canvas) => (
              <div key={canvas.id} className="flex items-center gap-2">
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ background: canvas.color ?? "#71717a" }}
                />
                <span className="flex-1 truncate text-xs text-zinc-700 dark:text-zinc-300">
                  {canvas.label ?? canvas.id}
                </span>
                <select
                  value={canvas.graph.graph_type ?? ""}
                  onChange={(e) => setGraphType(e.target.value || "", canvas.id)}
                  className="rounded border border-zinc-200 bg-white px-2 py-0.5 text-xs focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                >
                  <option value="">— none —</option>
                  {graphTypes.map((gt) => (
                    <option key={gt.name} value={gt.name}>{gt.name}</option>
                  ))}
                </select>
              </div>
            ))}

            {/* Global view row */}
            <div className="flex items-center gap-2 border-t border-zinc-100 pt-1.5 dark:border-zinc-800">
              <span className="h-2 w-2 rounded-full shrink-0 bg-zinc-400" />
              <span className="flex-1 text-xs text-zinc-500 dark:text-zinc-400 italic">
                Global view (all canvases)
              </span>
              <select
                value={globalGraphType ?? ""}
                onChange={(e) => setGlobalGraphType(e.target.value || null)}
                className="rounded border border-zinc-200 bg-white px-2 py-0.5 text-xs focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
              >
                <option value="">— none —</option>
                {graphTypes.map((gt) => (
                  <option key={gt.name} value={gt.name}>{gt.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 5 — Node Defaults
// ---------------------------------------------------------------------------

function TabNodeDefaults() {
  const nodeDefaults = useConfigStore(useShallow((s) => s.draft.node_defaults ?? {}));
  const categories = useConfigStore(useShallow((s) => s.draft.categories));
  const events = useConfigStore(useShallow((s) => s.draft.events));
  const n = useConfigStore((s) => s.draft.functionality_scale.length);
  const addNodeDefault = useConfigStore((s) => s.addNodeDefault);
  const removeNodeDefault = useConfigStore((s) => s.removeNodeDefault);
  const renameNodeDefault = useConfigStore((s) => s.renameNodeDefault);
  const updateNodeDefault = useConfigStore((s) => s.updateNodeDefault);
  const [newName, setNewName] = useState("");

  const NODE_TYPE_OPTIONS = ["Source", "Infrastructure", "Service", "Personnel"];

  function handleAdd() {
    const name = newName.trim();
    if (!name || nodeDefaults[name]) return;
    addNodeDefault(name);
    setNewName("");
  }

  function toggleCategory(tplName: string, tpl: Partial<import("@/lib/schemas/network").Node>, catName: string) {
    const current = tpl.node_categories ?? [];
    const active = current.includes(catName);
    const next = active ? current.filter((c) => c !== catName) : [...current, catName];
    const profiles = { ...(tpl.category_dependency_profiles ?? {}) } as import("@/lib/schemas/network").CategoryDependencyProfiles;
    if (active) delete profiles[catName];
    else if (!profiles[catName]) profiles[catName] = { dependency_level: 1 };
    updateNodeDefault(tplName, { node_categories: next, category_dependency_profiles: profiles });
  }

  function updateProfile(
    tplName: string,
    tpl: Partial<import("@/lib/schemas/network").Node>,
    catName: string,
    patch: Partial<import("@/lib/schemas/network").CategoryDependencyProfile>,
  ) {
    const profiles = { ...(tpl.category_dependency_profiles ?? {}) } as import("@/lib/schemas/network").CategoryDependencyProfiles;
    profiles[catName] = { ...profiles[catName], ...patch } as import("@/lib/schemas/network").CategoryDependencyProfile;
    updateNodeDefault(tplName, { category_dependency_profiles: profiles });
  }

  return (
    <div>
      <p className="mb-3 text-xs text-zinc-500">
        Named templates pre-fill new nodes at placement time. Pick one by hovering the <strong>+</strong> tool.
      </p>

      {Object.keys(nodeDefaults).length === 0 && (
        <p className="mb-3 text-xs text-zinc-400 italic">No templates yet.</p>
      )}

      <div className="space-y-3">
        {Object.entries(nodeDefaults).map(([name, tpl]) => {
          const selectedCats = tpl.node_categories ?? [];
          return (
            <div key={name} className="rounded-md border border-zinc-100 p-3 dark:border-zinc-800">

              {/* Name + delete */}
              <div className="mb-3 flex items-center gap-2">
                <input
                  type="text"
                  defaultValue={name}
                  onBlur={(e) => renameNodeDefault(name, e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                  className="flex-1 rounded border border-zinc-200 bg-white px-2 py-1 text-xs font-semibold focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />
                <ColBtn variant="danger" onClick={() => removeNodeDefault(name)}>
                  <Trash2 size={12} />
                </ColBtn>
              </div>

              {/* Node type + base fields */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-0.5 block text-xs text-zinc-400">Node type</label>
                  <select
                    value={tpl.node_type ?? ""}
                    onChange={(e) => updateNodeDefault(name, { node_type: e.target.value || undefined })}
                    className="w-full rounded border border-zinc-200 bg-white px-2 py-1 text-xs focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                  >
                    <option value="">— any —</option>
                    {NODE_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-0.5 block text-xs text-zinc-400">Importance</label>
                  <NumberInput value={tpl.importance} min={0} className="w-full"
                    onChange={(v) => updateNodeDefault(name, { importance: v })} />
                </div>
                <div>
                  <label className="mb-0.5 block text-xs text-zinc-400">Cost / day (€)</label>
                  <NumberInput value={tpl.cost_of_disservice_per_day} min={0} className="w-full"
                    onChange={(v) => updateNodeDefault(name, { cost_of_disservice_per_day: v })} />
                </div>
              </div>

              {/* Categories */}
              {categories.length > 0 && (
                <div className="mt-3">
                  <label className="mb-1 block text-xs text-zinc-400">Categories</label>
                  <div className="flex flex-wrap gap-1">
                    {categories.map((cat) => {
                      const active = selectedCats.includes(cat.name);
                      return (
                        <button
                          key={cat.name}
                          onClick={() => toggleCategory(name, tpl, cat.name)}
                          className={cn(
                            "rounded px-2 py-0.5 text-xs transition-colors",
                            active ? "text-white" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
                          )}
                          style={active ? { backgroundColor: cat.color ?? "#6b7280" } : undefined}
                        >
                          {cat.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Category dependency profiles — one block per selected category */}
              {selectedCats.length > 0 && (
                <div className="mt-3 space-y-2">
                  <label className="block text-xs text-zinc-400">Category dependency profiles</label>
                  {selectedCats.map((catName) => {
                    const prof = tpl.category_dependency_profiles?.[catName] ?? { dependency_level: 1 };
                    return (
                      <div key={catName} className="rounded border border-zinc-100 p-2 dark:border-zinc-800">
                        <p className="mb-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400">{catName}</p>
                        <div className="grid grid-cols-2 gap-1.5">
                          <div>
                            <label className="mb-0.5 block text-xs text-zinc-400">Dependency level</label>
                            <NumberInput value={prof.dependency_level} min={1} max={n} className="w-full"
                              onChange={(v) => updateProfile(name, tpl, catName, { dependency_level: v })} />
                          </div>
                          <div>
                            <label className="mb-0.5 block text-xs text-zinc-400">Demand</label>
                            <NumberInput value={prof.demand} min={0} className="w-full"
                              onChange={(v) => updateProfile(name, tpl, catName, { demand: v })} />
                          </div>
                          <div>
                            <label className="mb-0.5 block text-xs text-zinc-400">Priority (1–10)</label>
                            <NumberInput value={prof.priority} min={1} max={10} className="w-full"
                              onChange={(v) => updateProfile(name, tpl, catName, { priority: v })} />
                          </div>
                          <div>
                            <label className="mb-0.5 block text-xs text-zinc-400">Backup duration (h)</label>
                            <NumberInput value={prof.backup_duration} min={0} className="w-full"
                              onChange={(v) => updateProfile(name, tpl, catName, { backup_duration: v })} />
                          </div>
                          <div className="flex items-center gap-2 pt-1">
                            <input
                              type="checkbox"
                              id={`backup-${name}-${catName}`}
                              checked={prof.backup ?? false}
                              onChange={(e) => updateProfile(name, tpl, catName, { backup: e.target.checked })}
                              className="h-3 w-3"
                            />
                            <label htmlFor={`backup-${name}-${catName}`} className="text-xs text-zinc-400">
                              Has backup
                            </label>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Vulnerability levels per event */}
              {events.length > 0 && (
                <div className="mt-3">
                  <label className="mb-1 block text-xs text-zinc-400">Vulnerability levels</label>
                  <div className="space-y-1">
                    {events.map((ev) => (
                      <div key={ev.id} className="flex items-center gap-2">
                        <span className="w-28 truncate text-xs text-zinc-500">{ev.label}</span>
                        <NumberInput
                          value={tpl.vulnerability_levels?.[ev.id]}
                          min={1}
                          max={n}
                          className="w-16"
                          onChange={(v) => updateNodeDefault(name, {
                            vulnerability_levels: { ...tpl.vulnerability_levels, [ev.id]: v },
                          })}
                        />
                        <span className="text-xs text-zinc-400">/ {n}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>
          );
        })}
      </div>

      {/* Add template */}
      <div className="mt-3 flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
          placeholder="template name…"
          className="flex-1 rounded border border-zinc-200 bg-white px-2 py-1 text-xs focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
        />
        <button
          onClick={handleAdd}
          disabled={!newName.trim() || !!nodeDefaults[newName.trim()]}
          className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 disabled:opacity-40"
        >
          <Plus size={12} /> Add
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal shell
// ---------------------------------------------------------------------------

const TABS: { id: ConfigModalTab; label: string }[] = [
  { id: "functionality-scale", label: "Functionality Scale" },
  { id: "categories",          label: "Categories" },
  { id: "events",              label: "Events" },
  { id: "graph-types",         label: "Graph Types" },
  { id: "node-defaults",       label: "Node Defaults" },
];

export function ConfigModal() {
  const tab = useUiStore((s) => s.configModalTab);
  const setTab = useUiStore((s) => s.setConfigModalTab);
  const closeConfigModal = useUiStore((s) => s.closeConfigModal);

  const isDirty = useConfigStore((s) => s.isDirty);
  const openDraft = useConfigStore((s) => s.openDraft);
  const commitDraft = useConfigStore((s) => s.commitDraft);
  const discardDraft = useConfigStore((s) => s.discardDraft);

  // Open a fresh draft when the modal mounts
  useEffect(() => {
    openDraft();
  }, [openDraft]);

  function handleClose() {
    if (isDirty) {
      if (!window.confirm("Unsaved changes — discard?")) return;
    }
    discardDraft();
    closeConfigModal();
  }

  function handleSave() {
    commitDraft();
    closeConfigModal();
  }

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="flex h-[80vh] w-[720px] max-w-[95vw] flex-col rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            Model Configuration
          </h2>
          <div className="flex items-center gap-2">
            {isDirty && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                unsaved
              </span>
            )}
            <button
              onClick={handleClose}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex shrink-0 gap-0 border-b border-zinc-100 px-4 dark:border-zinc-800">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "border-b-2 px-3 py-2.5 text-xs font-medium transition-colors",
                tab === t.id
                  ? "border-blue-500 text-blue-600 dark:text-blue-400"
                  : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {tab === "functionality-scale" && <TabFunctionalityScale />}
          {tab === "categories" && <TabCategories />}
          {tab === "events" && <TabEvents />}
          {tab === "graph-types" && <TabGraphTypes />}
          {tab === "node-defaults" && <TabNodeDefaults />}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 justify-end gap-2 border-t border-zinc-100 px-5 py-3 dark:border-zinc-800">
          <button
            onClick={handleClose}
            className="rounded px-4 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="rounded bg-blue-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
