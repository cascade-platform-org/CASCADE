"use client";

/**
 * inspector/node-inspector.tsx — Inspector panel for a single selected Node.
 *
 * Sections: Identity · Functionality · Supply Capacity · Socioeconomic Values ·
 *           Category Dependency Profiles · Vulnerability Levels · Rules ·
 *           Properties · Canvas Membership
 */

import { useCallback, useState, useEffect } from "react";
import { X, Plus } from "lucide-react";
import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore, selectN, selectScaleLevels } from "@/store/config-store";
import { useShallow } from "zustand/react/shallow";
import { useHistoryAction } from "@/hooks/useHistoryAction";
import type { Node } from "@/lib/schemas/network";
import type { CategoryDependencyProfile } from "@/lib/schemas/network";
import {
  Section, Field, TextInput, NumberInput, Toggle,
  vulnHint, INLINE_INPUT_CLASS,
} from "./primitives";
import { CauseBanner } from "./cause-banner";
import { RulesEditor, PropertiesEditor } from "./editors";
import { CanvasMembershipSection } from "./canvas-membership";

// ---------------------------------------------------------------------------
// SupplyCapacityEditor — free-text category name, editable value, removable rows
// ---------------------------------------------------------------------------

function SupplyCapacityEditor({
  supply,
  configCats,
  onChange,
}: {
  supply: Record<string, number>;
  configCats: string[];
  onChange: (s: Record<string, number>) => void;
}) {
  const [rows, setRows] = useState<[string, number][]>(() =>
    Object.entries(supply).map(([k, v]) => [k, v]),
  );

  const supplyKey = JSON.stringify(supply);
  useEffect(() => {
    setRows(Object.entries(supply).map(([k, v]) => [k, v]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplyKey]);

  function commit(next: [string, number][]) {
    setRows(next);
    const obj: Record<string, number> = {};
    for (const [k, v] of next) if (k !== "") obj[k] = v;
    onChange(obj);
  }

  return (
    <div className="space-y-1">
      {rows.map(([cat, cap], i) => (
        <div key={i} className="flex items-center gap-1">
          {configCats.length > 0 ? (
            <select
              value={cat}
              onChange={(e) =>
                commit(
                  rows.map((r, j): [string, number] =>
                    j === i ? [e.target.value, r[1]] : r,
                  ),
                )
              }
              className={`w-28 ${INLINE_INPUT_CLASS}`}
            >
              {cat === "" && <option value="">— pick —</option>}
              {configCats.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={cat}
              onChange={(e) =>
                commit(
                  rows.map((r, j): [string, number] =>
                    j === i ? [e.target.value, r[1]] : r,
                  ),
                )
              }
              placeholder="category"
              className={`w-24 ${INLINE_INPUT_CLASS}`}
            />
          )}
          <input
            type="number"
            min={0}
            value={cap}
            onChange={(e) =>
              commit(
                rows.map((r, j): [string, number] =>
                  j === i ? [r[0], Number(e.target.value)] : r,
                ),
              )
            }
            className={`flex-1 ${INLINE_INPUT_CLASS}`}
          />
          <button
            onClick={() => commit(rows.filter((_, j) => j !== i))}
            className="text-zinc-300 hover:text-red-500"
          >
            <X size={12} />
          </button>
        </div>
      ))}
      <button
        onClick={() => commit([...rows, ["", 0]])}
        className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700"
      >
        <Plus size={10} /> Add supply
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CategoriesEditor — chip list with add/remove
// ---------------------------------------------------------------------------

function CategoriesEditor({
  cats,
  configCats,
  onChange,
}: {
  cats: string[];
  configCats: string[];
  onChange: (cats: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {cats.map((cat, i) => (
        <span
          key={i}
          className="flex items-center gap-0.5 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
        >
          {cat}
          <button
            onClick={() => onChange(cats.filter((_, j) => j !== i))}
            className="ml-0.5 text-blue-400 hover:text-blue-700"
          >
            <X size={10} />
          </button>
        </span>
      ))}
      {configCats.length > 0 ? (
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) onChange([...cats, e.target.value]);
          }}
          className="rounded border border-zinc-200 bg-white px-1 py-0.5 text-xs text-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800"
        >
          <option value="">+ add</option>
          {configCats.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      ) : (
        <button
          onClick={() => onChange([...cats, ""])}
          className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700"
        >
          <Plus size={10} /> Add category
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NodeInspector
// ---------------------------------------------------------------------------

export function NodeInspector({ node }: { node: Node }) {
  const updateNode = useCanvasStore((s) => s.updateNode);
  const allNodes = useCanvasStore((s) => s.nodes);
  const allEdges = useCanvasStore((s) => s.edges);
  const n = useConfigStore(selectN);
  const scaleLevels = useConfigStore(useShallow(selectScaleLevels));
  const categories = useConfigStore(useShallow((s) => s.config.categories));
  const events = useConfigStore(useShallow((s) => s.config.events));
  const historyAction = useHistoryAction();

  const ownCategories = new Set(node.node_categories ?? []);
  const inboundCategories = new Set<string>();
  for (const edge of Object.values(allEdges)) {
    if (edge.target !== node.id) continue;
    const sourceNode = allNodes[edge.source];
    if (!sourceNode) continue;
    for (const cat of sourceNode.node_categories ?? []) {
      if (!ownCategories.has(cat)) inboundCategories.add(cat);
    }
  }
  const profileCategories = [...ownCategories, ...inboundCategories];

  const patch = useCallback(
    (partial: Partial<Node>) => updateNode(node.id, partial),
    [node.id, updateNode],
  );

  const patchWithHistory = useCallback(
    (partial: Partial<Node>, label: string) => {
      historyAction(() => updateNode(node.id, partial), label);
    },
    [node.id, updateNode, historyAction],
  );

  const nodeTypes = ["Source", "Infrastructure", "Service", "Personnel"];

  return (
    <div className="overflow-y-auto">
      <CauseBanner element={node} n={n} allNodes={allNodes} allEdges={allEdges} events={events} />

      {/* 1. Identity */}
      <Section title="Identity" defaultOpen>
        <Field label="Label">
          <TextInput
            value={node.label ?? ""}
            onChange={(v) => patch({ label: v })}
            placeholder="Node label"
          />
        </Field>
        <Field label="Node Type">
          <select
            value={node.node_type ?? "Service"}
            onChange={(e) => patch({ node_type: e.target.value })}
            className="w-full rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-800 focus:border-blue-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
          >
            {nodeTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Categories">
          <CategoriesEditor
            cats={node.node_categories ?? []}
            configCats={categories.map((c) => c.name)}
            onChange={(cats) => patch({ node_categories: cats })}
          />
        </Field>
      </Section>

      {/* 2. Functionality */}
      <Section title="Functionality" defaultOpen>
        <Field label={`Functionality (1–${n})`}>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={1}
              max={n}
              value={node.functionality}
              onChange={(e) =>
                patchWithHistory(
                  { functionality: Number(e.target.value) },
                  "Manual functionality edit",
                )
              }
              className="flex-1 accent-blue-500"
            />
            <span
              className="min-w-[2rem] rounded px-1.5 py-0.5 text-center text-xs font-medium text-white"
              style={{
                backgroundColor:
                  scaleLevels.find((l) => l.level === node.functionality)?.color ?? "#94a3b8",
              }}
            >
              {node.functionality}
            </span>
          </div>
          <div className="mt-1 text-xs text-zinc-400">
            {scaleLevels.find((l) => l.level === node.functionality)?.label ?? ""}
          </div>
        </Field>
        <Field label="Functionality Time (hours)">
          <NumberInput
            value={node.functionality_time}
            min={0}
            onChange={(v) =>
              patchWithHistory({ functionality_time: v }, "Manual functionality_time edit")
            }
          />
        </Field>
        <div className="mb-2">
          <Toggle
            value={node.direct_damage ?? false}
            onChange={(v) => patch({ direct_damage: v })}
            label="Direct damage (physical breakage)"
          />
        </div>
        {node.direct_damage && (
          <Field label="Expected repair time (hours)">
            <NumberInput
              value={node.expected_repair_time}
              min={0}
              onChange={(v) => patch({ expected_repair_time: v })}
            />
          </Field>
        )}
      </Section>

      {/* 3. Supply Capacity */}
      {(node.node_type === "Source" || node.node_categories?.length) && (
        <Section title="Supply Capacity">
          <SupplyCapacityEditor
            supply={node.supply_capacity ?? {}}
            configCats={categories.map((c) => c.name)}
            onChange={(s) => patch({ supply_capacity: s })}
          />
        </Section>
      )}

      {/* 4. Socioeconomic Values */}
      <Section title="Socioeconomic Values">
        <Field label="Importance (0–1)">
          <NumberInput
            value={node.importance}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => patch({ importance: v })}
          />
        </Field>
        <Field label="Cost of disservice / day">
          <NumberInput
            value={node.cost_of_disservice_per_day}
            min={0}
            onChange={(v) => patch({ cost_of_disservice_per_day: v })}
          />
        </Field>
      </Section>

      {/* 5. Category Dependency Profiles */}
      {profileCategories.length > 0 && (
        <Section title="Category Dependency Profiles">
          {profileCategories.map((cat) => {
            const profile: CategoryDependencyProfile =
              node.category_dependency_profiles?.[cat] ?? { dependency_level: n };
            const catDef = categories.find((c) => c.name === cat);
            const isStd = catDef?.category_type === "SourceToDemands";
            const isInbound = inboundCategories.has(cat);
            return (
              <div key={cat} className="mb-3">
                <div className="mb-1 flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                    {cat}
                  </span>
                  {isInbound && (
                    <span className="rounded bg-zinc-100 px-1 py-0.5 text-[10px] text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">
                      via parent
                    </span>
                  )}
                </div>
                <Field label={`Dependency level (1–${n})`}>
                  <NumberInput
                    value={profile.dependency_level ?? n}
                    min={1}
                    max={n}
                    onChange={(v) =>
                      patch({
                        category_dependency_profiles: {
                          ...(node.category_dependency_profiles ?? {}),
                          [cat]: { ...profile, dependency_level: v },
                        },
                      })
                    }
                  />
                </Field>
                <div className="mb-2">
                  <Toggle
                    value={profile.backup ?? false}
                    onChange={(v) =>
                      patch({
                        category_dependency_profiles: {
                          ...(node.category_dependency_profiles ?? {}),
                          [cat]: { ...profile, backup: v },
                        },
                      })
                    }
                    label="Has backup"
                  />
                </div>
                {profile.backup && (
                  <Field label="Backup duration (hours)">
                    <NumberInput
                      value={profile.backup_duration}
                      min={0}
                      onChange={(v) =>
                        patch({
                          category_dependency_profiles: {
                            ...(node.category_dependency_profiles ?? {}),
                            [cat]: { ...profile, backup_duration: v },
                          },
                        })
                      }
                    />
                  </Field>
                )}
                {isStd && (
                  <>
                    <Field label="Demand">
                      <NumberInput
                        value={profile.demand}
                        min={0}
                        onChange={(v) =>
                          patch({
                            category_dependency_profiles: {
                              ...(node.category_dependency_profiles ?? {}),
                              [cat]: { ...profile, demand: v },
                            },
                          })
                        }
                      />
                    </Field>
                    <Field label="Priority (1–10)">
                      <NumberInput
                        value={profile.priority}
                        min={1}
                        max={10}
                        onChange={(v) =>
                          patch({
                            category_dependency_profiles: {
                              ...(node.category_dependency_profiles ?? {}),
                              [cat]: { ...profile, priority: v },
                            },
                          })
                        }
                      />
                    </Field>
                  </>
                )}
              </div>
            );
          })}
        </Section>
      )}

      {/* 6. Vulnerability Levels
            Engine formula: result_functionality = N − stored_drop.
            stored_drop=0 → N (immune); stored_drop=N−1 → 1 (maximum damage).
            Range 0…N−1; 0 = immune (default/absent). */}
      {events.length > 0 && (
        <Section title="Vulnerability Levels">
          {events.map((ev) => {
            const level = node.vulnerability_levels?.[ev.id] ?? 0;
            return (
              <Field key={ev.id} label={ev.label}>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={0}
                    max={n - 1}
                    value={level}
                    onChange={(e) =>
                      patch({
                        vulnerability_levels: {
                          ...(node.vulnerability_levels ?? {}),
                          [ev.id]: Number(e.target.value),
                        },
                      })
                    }
                    className="flex-1 accent-orange-500"
                  />
                  <span className="min-w-[1.5rem] text-right text-xs text-zinc-600 dark:text-zinc-400">
                    {level}
                  </span>
                </div>
                <div className="mt-0.5 text-[10px] text-zinc-400">{vulnHint(level, n)}</div>
              </Field>
            );
          })}
        </Section>
      )}

      {/* 7. Rules */}
      <Section title="Rules">
        <RulesEditor rules={node.rules ?? []} onChange={(rules) => patch({ rules })} />
      </Section>

      {/* 8. Properties */}
      <Section title="Properties">
        <PropertiesEditor
          properties={node.properties ?? {}}
          onChange={(properties) => patch({ properties })}
        />
      </Section>

      {/* 9. Canvas Membership */}
      <CanvasMembershipSection nodeIds={[node.id]} />
    </div>
  );
}
