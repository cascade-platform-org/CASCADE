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

import { useEffect } from "react";
import { X, Plus, Trash2, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { useConfigStore } from "@/store/config-store";
import { useUiStore } from "@/store/ui-store";
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 5 — Node Defaults
// ---------------------------------------------------------------------------

function TabNodeDefaults() {
  return (
    <div>
      <p className="text-xs text-zinc-400 italic">
        Node default templates will pre-fill the Inspector when you place a new node.
        This tab will be expanded in a future update.
      </p>
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
