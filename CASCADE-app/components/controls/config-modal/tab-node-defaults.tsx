"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useConfigStore } from "@/store/config-store";
import { useShallow } from "zustand/react/shallow";
import { cn, NumberInput, ColBtn } from "./primitives";
import type { Node, CategoryDependencyProfiles, CategoryDependencyProfile } from "@/lib/schemas/network";

const NODE_TYPE_OPTIONS = ["Source", "Infrastructure", "Service", "Personnel"];

export function TabNodeDefaults() {
  const nodeDefaults = useConfigStore(useShallow((s) => s.draft.node_defaults ?? {}));
  const categories = useConfigStore(useShallow((s) => s.draft.categories));
  const events = useConfigStore(useShallow((s) => s.draft.events));
  const n = useConfigStore((s) => s.draft.functionality_scale.length);
  const addNodeDefault = useConfigStore((s) => s.addNodeDefault);
  const removeNodeDefault = useConfigStore((s) => s.removeNodeDefault);
  const renameNodeDefault = useConfigStore((s) => s.renameNodeDefault);
  const updateNodeDefault = useConfigStore((s) => s.updateNodeDefault);
  const [newName, setNewName] = useState("");

  function handleAdd() {
    const name = newName.trim();
    if (!name || nodeDefaults[name]) return;
    addNodeDefault(name);
    setNewName("");
  }

  function toggleCategory(tplName: string, tpl: Partial<Node>, catName: string) {
    const current = tpl.node_categories ?? [];
    const active = current.includes(catName);
    const next = active ? current.filter((c) => c !== catName) : [...current, catName];
    const profiles = { ...(tpl.category_dependency_profiles ?? {}) } as CategoryDependencyProfiles;
    if (active) delete profiles[catName];
    else if (!profiles[catName]) profiles[catName] = { dependency_level: 1 };
    updateNodeDefault(tplName, { node_categories: next, category_dependency_profiles: profiles });
  }

  function updateProfile(
    tplName: string,
    tpl: Partial<Node>,
    catName: string,
    patch: Partial<CategoryDependencyProfile>,
  ) {
    const profiles = { ...(tpl.category_dependency_profiles ?? {}) } as CategoryDependencyProfiles;
    profiles[catName] = { ...profiles[catName], ...patch } as CategoryDependencyProfile;
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
