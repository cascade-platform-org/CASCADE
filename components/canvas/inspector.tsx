"use client";

/**
 * Inspector (F7) — right-side panel, 320px wide.
 *
 * States:
 *   - Nothing selected → Canvas meta (label, graph_type, georef toggle, counts)
 *   - Single node selected → 7 collapsible sections
 *   - Single edge selected → Identity, Functionality, Capacity, Vulnerability, Rules, Properties
 *   - Multi-select → count breakdown + batch delete
 */

import { useState, useCallback } from "react";
import { ChevronDown, ChevronRight, X, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCanvasStore, selectActiveCanvas } from "@/store/canvas-store";
import { useNetworkStore } from "@/store/network-store";
import { useConfigStore, selectN, selectScaleLevels } from "@/store/config-store";
import { useUiStore } from "@/store/ui-store";
import { useShallow } from "zustand/react/shallow";
import { nanoid } from "nanoid";
import type { Node, Edge } from "@/lib/schemas/network";
import type { CategoryDependencyProfile } from "@/lib/schemas/network";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function Section({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-zinc-100 dark:border-zinc-800">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 px-3 py-2 text-left text-xs font-semibold uppercase tracking-widest text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {title}
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-2">
      <label className="mb-0.5 block text-xs text-zinc-500 dark:text-zinc-400">{label}</label>
      {children}
    </div>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-800 focus:border-blue-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
    />
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
}: {
  value: number | undefined;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <input
      type="number"
      value={value ?? ""}
      min={min}
      max={max}
      step={step ?? 1}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-800 focus:border-blue-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
    />
  );
}

function Toggle({
  value,
  onChange,
  label,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 rounded border-zinc-300 accent-blue-500"
      />
      {label}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Node inspector
// ---------------------------------------------------------------------------

function NodeInspector({ node }: { node: Node }) {
  const updateNode = useCanvasStore((s) => s.updateNode);
  const toGraphSnapshot = useCanvasStore((s) => s.toGraphSnapshot);
  const pushUpdateEntry = useCanvasStore((s) => s.pushUpdateEntry);
  const activeCanvas = useCanvasStore(selectActiveCanvas);
  const n = useConfigStore(selectN);
  const scaleLevels = useConfigStore(useShallow(selectScaleLevels));
  const categories = useConfigStore(useShallow((s) => s.config.categories));
  const events = useConfigStore(useShallow((s) => s.config.events));

  const patch = useCallback(
    (partial: Partial<Node>) => {
      updateNode(node.id, partial);
    },
    [node.id, updateNode],
  );

  const patchWithHistory = useCallback(
    (partial: Partial<Node>, label: string) => {
      const before = toGraphSnapshot();
      updateNode(node.id, partial);
      pushUpdateEntry({
        id: nanoid(),
        timestamp: new Date().toISOString(),
        update_type: "manual_functionality_update",
        label,
        canvas_id: activeCanvas?.id ?? "",
        before,
        after: toGraphSnapshot(),
      });
    },
    [node.id, updateNode, toGraphSnapshot, pushUpdateEntry, activeCanvas],
  );

  const nodeTypes = ["Source", "Infrastructure", "Service", "Personnel"];

  return (
    <div className="overflow-y-auto">
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
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </Field>
        <Field label="Categories">
          <div className="flex flex-wrap gap-1">
            {(node.node_categories ?? []).map((cat) => (
              <span
                key={cat}
                className="flex items-center gap-0.5 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
              >
                {cat}
                <button
                  onClick={() =>
                    patch({
                      node_categories: (node.node_categories ?? []).filter((c) => c !== cat),
                    })
                  }
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
                  const current = node.node_categories ?? [];
                  if (!current.includes(e.target.value)) {
                    patch({ node_categories: [...current, e.target.value] });
                  }
                }}
                className="rounded border border-zinc-200 bg-white px-1 py-0.5 text-xs text-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800"
              >
                <option value="">+ add</option>
                {categories
                  .filter((c) => !(node.node_categories ?? []).includes(c.name))
                  .map((c) => (
                    <option key={c.name} value={c.name}>{c.name}</option>
                  ))}
              </select>
            )}
          </div>
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
          <Field label="Supply capacity per category">
            {Object.entries(node.supply_capacity ?? {}).map(([cat, cap]) => (
              <div key={cat} className="mb-1 flex items-center gap-2">
                <span className="w-20 truncate text-xs text-zinc-500">{cat}</span>
                <input
                  type="number"
                  min={0}
                  value={cap}
                  onChange={(e) =>
                    patch({
                      supply_capacity: {
                        ...(node.supply_capacity ?? {}),
                        [cat]: Number(e.target.value),
                      },
                    })
                  }
                  className="flex-1 rounded border border-zinc-200 bg-white px-2 py-0.5 text-xs focus:border-blue-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                />
              </div>
            ))}
            <button
              onClick={() => {
                if (!categories.length) return;
                const unused = categories.find(
                  (c) => !(node.supply_capacity ?? {})[c.name],
                );
                if (unused) {
                  patch({
                    supply_capacity: { ...(node.supply_capacity ?? {}), [unused.name]: 0 },
                  });
                }
              }}
              className="mt-1 flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700"
            >
              <Plus size={10} /> Add supply
            </button>
          </Field>
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
      {(node.node_categories ?? []).length > 0 && (
        <Section title="Category Dependency Profiles">
          {(node.node_categories ?? []).map((cat) => {
            const profile: CategoryDependencyProfile = node.category_dependency_profiles?.[cat] ?? { dependency_level: n };
            const catDef = categories.find((c) => c.name === cat);
            const isStd = catDef?.category_type === "SourceToDemands";
            return (
              <div key={cat} className="mb-3">
                <div className="mb-1 text-xs font-semibold text-zinc-600 dark:text-zinc-400">{cat}</div>
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

      {/* 6. Vulnerability Levels */}
      {events.length > 0 && (
        <Section title="Vulnerability Levels">
          {events.map((ev) => (
            <Field key={ev.id} label={ev.label}>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={1}
                  max={n}
                  value={node.vulnerability_levels?.[ev.id] ?? 1}
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
                  {node.vulnerability_levels?.[ev.id] ?? 1}
                </span>
              </div>
            </Field>
          ))}
        </Section>
      )}

      {/* 7. Rules */}
      <Section title="Rules">
        <RulesEditor
          rules={node.rules ?? []}
          onChange={(rules) => patch({ rules })}
        />
      </Section>

      {/* 8. Properties */}
      <Section title="Properties">
        <PropertiesEditor
          properties={node.properties ?? {}}
          onChange={(properties) => patch({ properties })}
        />
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edge inspector
// ---------------------------------------------------------------------------

function EdgeInspector({ edge }: { edge: Edge }) {
  const updateEdge = useCanvasStore((s) => s.updateEdge);
  const toGraphSnapshot = useCanvasStore((s) => s.toGraphSnapshot);
  const pushUpdateEntry = useCanvasStore((s) => s.pushUpdateEntry);
  const activeCanvas = useCanvasStore(selectActiveCanvas);
  const allNodes = useCanvasStore((s) => s.nodes);
  const n = useConfigStore(selectN);
  const scaleLevels = useConfigStore(useShallow(selectScaleLevels));
  const events = useConfigStore(useShallow((s) => s.config.events));

  const patch = useCallback(
    (partial: Partial<Edge>) => updateEdge(edge.id, partial),
    [edge.id, updateEdge],
  );

  const patchWithHistory = useCallback(
    (partial: Partial<Edge>, label: string) => {
      const before = toGraphSnapshot();
      updateEdge(edge.id, partial);
      pushUpdateEntry({
        id: nanoid(),
        timestamp: new Date().toISOString(),
        update_type: "manual_functionality_update",
        label,
        canvas_id: activeCanvas?.id ?? "",
        before,
        after: toGraphSnapshot(),
      });
    },
    [edge.id, updateEdge, toGraphSnapshot, pushUpdateEntry, activeCanvas],
  );

  const srcLabel = allNodes[edge.source]?.label ?? edge.source;
  const tgtLabel = allNodes[edge.target]?.label ?? edge.target;

  return (
    <div className="overflow-y-auto">
      <Section title="Identity" defaultOpen>
        <div className="text-xs text-zinc-600 dark:text-zinc-400">
          <span className="font-medium">{srcLabel}</span>
          <span className="mx-1 text-zinc-400">→</span>
          <span className="font-medium">{tgtLabel}</span>
        </div>
      </Section>

      <Section title="Functionality" defaultOpen>
        <Field label={`Functionality (1–${n})`}>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={1}
              max={n}
              value={edge.functionality}
              onChange={(e) =>
                patchWithHistory(
                  { functionality: Number(e.target.value) },
                  "Manual edge functionality edit",
                )
              }
              className="flex-1 accent-blue-500"
            />
            <span
              className="min-w-[2rem] rounded px-1.5 py-0.5 text-center text-xs font-medium text-white"
              style={{
                backgroundColor:
                  scaleLevels.find((l) => l.level === edge.functionality)?.color ?? "#94a3b8",
              }}
            >
              {edge.functionality}
            </span>
          </div>
        </Field>
        <Field label="Functionality Time (hours)">
          <NumberInput
            value={edge.functionality_time}
            min={0}
            onChange={(v) =>
              patchWithHistory({ functionality_time: v }, "Manual edge functionality_time edit")
            }
          />
        </Field>
        <div className="mb-2">
          <Toggle
            value={edge.direct_damage ?? false}
            onChange={(v) => patch({ direct_damage: v })}
            label="Direct damage"
          />
        </div>
        {edge.direct_damage && (
          <Field label="Expected repair time (hours)">
            <NumberInput
              value={edge.expected_repair_time}
              min={0}
              onChange={(v) => patch({ expected_repair_time: v })}
            />
          </Field>
        )}
      </Section>

      <Section title="Capacity">
        <Field label="Capacity">
          <NumberInput
            value={edge.capacity}
            min={0}
            onChange={(v) => patch({ capacity: v })}
          />
        </Field>
      </Section>

      {events.length > 0 && (
        <Section title="Vulnerability Levels">
          {events.map((ev) => (
            <Field key={ev.id} label={ev.label}>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={1}
                  max={n}
                  value={edge.vulnerability_levels?.[ev.id] ?? 1}
                  onChange={(e) =>
                    patch({
                      vulnerability_levels: {
                        ...(edge.vulnerability_levels ?? {}),
                        [ev.id]: Number(e.target.value),
                      },
                    })
                  }
                  className="flex-1 accent-orange-500"
                />
                <span className="min-w-[1.5rem] text-right text-xs text-zinc-600">
                  {edge.vulnerability_levels?.[ev.id] ?? 1}
                </span>
              </div>
            </Field>
          ))}
        </Section>
      )}

      <Section title="Rules">
        <RulesEditor
          rules={edge.rules ?? []}
          onChange={(rules) => patch({ rules })}
        />
      </Section>

      <Section title="Properties">
        <PropertiesEditor
          properties={edge.properties ?? {}}
          onChange={(properties) => patch({ properties })}
        />
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rules editor (inline, shared by node + edge)
// ---------------------------------------------------------------------------

function RulesEditor({
  rules,
  onChange,
}: {
  rules: string[];
  onChange: (rules: string[]) => void;
}) {
  return (
    <div className="space-y-1">
      {rules.map((rule, i) => (
        <div key={i} className="flex items-start gap-1">
          <textarea
            value={rule}
            rows={2}
            onChange={(e) => {
              const next = [...rules];
              next[i] = e.target.value;
              onChange(next);
            }}
            className="flex-1 resize-none rounded border border-zinc-200 bg-white px-2 py-1 font-mono text-xs text-zinc-800 focus:border-blue-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
          />
          <button
            onClick={() => onChange(rules.filter((_, j) => j !== i))}
            className="mt-1 text-zinc-300 hover:text-red-500"
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      <button
        onClick={() => onChange([...rules, ""])}
        className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700"
      >
        <Plus size={10} /> Add rule
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Properties editor (key-value)
// ---------------------------------------------------------------------------

function PropertiesEditor({
  properties,
  onChange,
}: {
  properties: Record<string, unknown>;
  onChange: (p: Record<string, unknown>) => void;
}) {
  const entries = Object.entries(properties);
  return (
    <div className="space-y-1">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-center gap-1">
          <input
            type="text"
            value={k}
            onChange={(e) => {
              const next = { ...properties };
              delete next[k];
              next[e.target.value] = v;
              onChange(next);
            }}
            className="w-1/3 rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-xs focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
            placeholder="key"
          />
          <input
            type="text"
            value={String(v ?? "")}
            onChange={(e) => onChange({ ...properties, [k]: e.target.value })}
            className="flex-1 rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-xs focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
            placeholder="value"
          />
          <button
            onClick={() => {
              const next = { ...properties };
              delete next[k];
              onChange(next);
            }}
            className="text-zinc-300 hover:text-red-500"
          >
            <X size={12} />
          </button>
        </div>
      ))}
      <button
        onClick={() => onChange({ ...properties, "": "" })}
        className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700"
      >
        <Plus size={10} /> Add property
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Canvas meta panel (nothing selected)
// ---------------------------------------------------------------------------

const CANVAS_PALETTE = [
  "#3b82f6", "#22c55e", "#eab308", "#f97316",
  "#ef4444", "#a855f7", "#06b6d4", "#ec4899",
];

function CanvasMeta() {
  const activeCanvas = useCanvasStore(selectActiveCanvas);
  const updateCanvasMeta = useCanvasStore((s) => s.updateCanvasMeta);
  const setGraphType = useCanvasStore((s) => s.setGraphType);
  const graphTypes = useConfigStore(useShallow((s) => s.config.graph_types));

  if (!activeCanvas) return null;

  const nodeCount = activeCanvas.graph.node_ids.length;
  const edgeCount = activeCanvas.graph.edge_ids.length;

  return (
    <div className="p-3">
      <Field label="Canvas name">
        <TextInput
          value={activeCanvas.label ?? ""}
          onChange={(v) => updateCanvasMeta(activeCanvas.id, { label: v })}
        />
      </Field>

      <Field label="Color">
        <div className="flex flex-wrap gap-1.5">
          {CANVAS_PALETTE.map((c) => (
            <button
              key={c}
              title={c}
              onClick={() => updateCanvasMeta(activeCanvas.id, { color: c })}
              className={cn(
                "h-5 w-5 rounded-full border-2 transition-transform hover:scale-110",
                activeCanvas.color === c
                  ? "scale-110 border-zinc-900 dark:border-white"
                  : "border-transparent",
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </Field>

      <Field label="Graph type">
        <select
          value={activeCanvas.graph.graph_type ?? ""}
          onChange={(e) => setGraphType(e.target.value, activeCanvas.id)}
          className="w-full rounded border border-zinc-200 bg-white px-2 py-1 text-xs focus:border-blue-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
        >
          <option value="">— none —</option>
          {graphTypes.map((gt) => (
            <option key={gt.name} value={gt.name}>{gt.name}</option>
          ))}
        </select>
      </Field>

      <div className="mb-2">
        <Toggle
          value={activeCanvas.georeferenced ?? false}
          onChange={(v) => updateCanvasMeta(activeCanvas.id, { georeferenced: v })}
          label="Georeferenced canvas"
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-md bg-zinc-50 p-2 text-center dark:bg-zinc-800">
          <div className="text-lg font-semibold text-zinc-700 dark:text-zinc-200">{nodeCount}</div>
          <div className="text-xs text-zinc-400">nodes</div>
        </div>
        <div className="rounded-md bg-zinc-50 p-2 text-center dark:bg-zinc-800">
          <div className="text-lg font-semibold text-zinc-700 dark:text-zinc-200">{edgeCount}</div>
          <div className="text-xs text-zinc-400">edges</div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Multi-select panel — summary + batch attribute editing
// ---------------------------------------------------------------------------

function MultiSelectPanel({
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
  const toGraphSnapshot = useCanvasStore((s) => s.toGraphSnapshot);
  const pushUpdateEntry = useCanvasStore((s) => s.pushUpdateEntry);
  const activeCanvas = useCanvasStore(selectActiveCanvas);
  const n = useConfigStore(selectN);
  const scaleLevels = useConfigStore(useShallow(selectScaleLevels));

  const total = nodeIds.length + edgeIds.length;
  const isNodesOnly = nodeIds.length > 0 && edgeIds.length === 0;
  const isEdgesOnly = edgeIds.length > 0 && nodeIds.length === 0;

  // Derive a "common" functionality value for the slider starting position.
  // If all selected elements share the same value, show it; otherwise show N.
  const commonFunc = (() => {
    const vals = [
      ...nodeIds.map((id) => allNodes[id]?.functionality),
      ...edgeIds.map((id) => allEdges[id]?.functionality),
    ].filter((v): v is number => v !== undefined);
    if (vals.length === 0) return n;
    return vals.every((v) => v === vals[0]) ? vals[0] : n;
  })();

  const [funcValue, setFuncValue] = useState<number>(commonFunc);

  function applyFunctionality() {
    const before = toGraphSnapshot();
    nodeIds.forEach((id) => updateNode(id, { functionality: funcValue }));
    edgeIds.forEach((id) => updateEdge(id, { functionality: funcValue }));
    pushUpdateEntry({
      id: nanoid(),
      timestamp: new Date().toISOString(),
      update_type: "manual_functionality_update",
      label: `Batch functionality → ${funcValue} (${total} elements)`,
      canvas_id: activeCanvas?.id ?? "",
      before,
      after: toGraphSnapshot(),
    });
  }

  function applyDirectDamage(value: boolean) {
    const before = toGraphSnapshot();
    nodeIds.forEach((id) => updateNode(id, { direct_damage: value }));
    edgeIds.forEach((id) => updateEdge(id, { direct_damage: value }));
    pushUpdateEntry({
      id: nanoid(),
      timestamp: new Date().toISOString(),
      update_type: "manual_functionality_update",
      label: `Batch direct damage → ${value} (${total} elements)`,
      canvas_id: activeCanvas?.id ?? "",
      before,
      after: toGraphSnapshot(),
    });
  }

  function applyNodeType(nodeType: string) {
    if (!isNodesOnly) return;
    const before = toGraphSnapshot();
    nodeIds.forEach((id) => updateNode(id, { node_type: nodeType }));
    pushUpdateEntry({
      id: nanoid(),
      timestamp: new Date().toISOString(),
      update_type: "graph_update",
      label: `Batch node type → ${nodeType} (${nodeIds.length} nodes)`,
      canvas_id: activeCanvas?.id ?? "",
      before,
      after: toGraphSnapshot(),
    });
  }

  function handleBatchDelete() {
    if (!window.confirm(`Delete ${total} selected elements?`)) return;
    const before = toGraphSnapshot();
    nodeIds.forEach(removeNode);
    edgeIds.forEach(removeEdge);
    clearSelection();
    setInspectorOpen(false);
    pushUpdateEntry({
      id: nanoid(),
      timestamp: new Date().toISOString(),
      update_type: "graph_update",
      label: `Delete ${total} elements`,
      canvas_id: activeCanvas?.id ?? "",
      before,
      after: toGraphSnapshot(),
    });
  }

  const currentLevel = scaleLevels.find((l) => l.level === funcValue);

  return (
    <div className="overflow-y-auto">
      {/* Summary header */}
      <div className="border-b border-zinc-100 px-3 py-2.5 dark:border-zinc-800">
        <div className="text-xs text-zinc-500">
          <span className="font-semibold text-zinc-700 dark:text-zinc-300">{total}</span>
          {" "}elements selected
          <span className="ml-1 text-zinc-400">
            ({isNodesOnly ? `${nodeIds.length} nodes` : isEdgesOnly ? `${edgeIds.length} edges` : `${nodeIds.length} nodes, ${edgeIds.length} edges`})
          </span>
        </div>
        <p className="mt-0.5 text-[10px] text-zinc-400">
          Changes below apply to all selected elements.
        </p>
      </div>

      {/* Batch: Functionality */}
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
          className="mt-1 w-full rounded-md bg-blue-50 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-300 dark:hover:bg-blue-900/40"
        >
          Apply to {total} element{total > 1 ? "s" : ""}
        </button>
      </Section>

      {/* Batch: Direct damage */}
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

      {/* Batch: Node type (nodes only) */}
      {isNodesOnly && (
        <Section title="Node Type">
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
        </Section>
      )}

      {/* Delete */}
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

// ---------------------------------------------------------------------------
// Inspector root
// ---------------------------------------------------------------------------

export function Inspector() {
  const inspectorOpen = useUiStore((s) => s.inspectorOpen);

  const selectedNodeIds = useNetworkStore((s) => s.selectedNodeIds);
  const selectedEdgeIds = useNetworkStore((s) => s.selectedEdgeIds);

  const allNodes = useCanvasStore((s) => s.nodes);
  const allEdges = useCanvasStore((s) => s.edges);

  const nodeIdArr = [...selectedNodeIds];
  const edgeIdArr = [...selectedEdgeIds];
  const totalSelected = nodeIdArr.length + edgeIdArr.length;

  const singleNode =
    totalSelected === 1 && nodeIdArr.length === 1 ? allNodes[nodeIdArr[0]] : null;
  const singleEdge =
    totalSelected === 1 && edgeIdArr.length === 1 ? allEdges[edgeIdArr[0]] : null;
  const isMulti = totalSelected > 1;

  function handleDeleteSelected() {
    const s = useCanvasStore.getState();
    const before = s.toGraphSnapshot();
    let label = "";
    if (singleNode) {
      s.removeNode(singleNode.id);
      label = `Delete node "${singleNode.label ?? singleNode.id}"`;
    } else if (singleEdge) {
      s.removeEdge(singleEdge.id);
      label = "Delete edge";
    } else {
      return;
    }
    s.pushUpdateEntry({
      id: nanoid(),
      timestamp: new Date().toISOString(),
      update_type: "graph_update",
      label,
      canvas_id: s.activeCanvasId ?? "",
      before,
      after: s.toGraphSnapshot(),
    });
    useNetworkStore.getState().clearSelection();
    useUiStore.getState().setInspectorOpen(false);
  }

  const headerLabel = singleNode
    ? "Node"
    : singleEdge
    ? "Edge"
    : isMulti
    ? "Selection"
    : "Canvas";

  const canDelete = !!(singleNode || singleEdge);

  return (
    <div
      className={cn(
        "flex shrink-0 flex-col border-l border-zinc-200 bg-white transition-all dark:border-zinc-800 dark:bg-zinc-900",
        inspectorOpen ? "w-80" : "w-0 overflow-hidden",
      )}
    >
      {inspectorOpen && (
        <>
          <div className="flex h-10 shrink-0 items-center justify-between border-b border-zinc-100 px-4 dark:border-zinc-800">
            <span className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
              {headerLabel}
            </span>
            {canDelete && (
              <button
                onClick={handleDeleteSelected}
                title={`Delete ${headerLabel.toLowerCase()}`}
                className="rounded p-1 text-zinc-300 transition-colors hover:bg-red-50 hover:text-red-500 dark:text-zinc-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>

          {singleNode ? (
            <NodeInspector key={singleNode.id} node={singleNode} />
          ) : singleEdge ? (
            <EdgeInspector key={singleEdge.id} edge={singleEdge} />
          ) : isMulti ? (
            <MultiSelectPanel nodeIds={nodeIdArr} edgeIds={edgeIdArr} />
          ) : (
            <CanvasMeta />
          )}
        </>
      )}
    </div>
  );
}
