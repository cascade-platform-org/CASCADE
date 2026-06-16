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

import { useState, useCallback, useEffect } from "react";
import { ChevronDown, ChevronRight, X, Plus, Trash2, AlertTriangle, Copy, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { isRuleDisabled, ruleBody, toggleRuleDisabled, setRuleBody } from "@/lib/rule-status";
import { useCanvasStore, selectActiveCanvas, selectOrderedCanvases } from "@/store/canvas-store";
import { useHistoryStore } from "@/store/history-store";
import { useNetworkStore } from "@/store/network-store";
import { useConfigStore, selectN, selectScaleLevels } from "@/store/config-store";
import { useUiStore } from "@/store/ui-store";
import { useShallow } from "zustand/react/shallow";
import { nanoid } from "nanoid";
import type { Node, Edge } from "@/lib/schemas/network";
import type { CategoryDependencyProfile } from "@/lib/schemas/network";

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

/**
 * Wrap an update fn in a before/after snapshot and push one undo entry.
 * Single source of truth for the snapshot-wrap pattern used in every inspector.
 */
function withHistory(
  store: ReturnType<typeof useCanvasStore.getState>,
  updateFn: () => void,
  label: string,
  update_type: "manual_functionality_update" | "graph_update" = "manual_functionality_update",
) {
  const before = store.toGraphSnapshot();
  updateFn();
  // Re-read via getState() after the mutation so the `after` snapshot reflects
  // the committed state, not the object captured before updateFn ran.
  const after = useCanvasStore.getState().toGraphSnapshot();
  useHistoryStore.getState().pushUpdateEntry({
    id: nanoid(),
    timestamp: new Date().toISOString(),
    update_type,
    label,
    canvas_id: store.activeCanvasId ?? "",
    before,
    after,
  });
}

/**
 * Vulnerability level helpers.
 * Range: 0 … N−1. Missing entry treated as 0.
 * Engine formula: imposed_functionality = N − vulnerability_level (clamped 1..N).
 *   0     → N   (immune, no effect)
 *   1     → N−1 (mild degradation)
 *   N−1   → 1   (maximum degradation)
 */
function vulnHint(level: number, n: number): string {
  return level === 0
    ? "Immune — no effect (default)"
    : `Functionality drops to ${n - level}`;
}

/** Type-safe Boolean filter — narrows T | undefined to T. */
function isDefined<T>(v: T | undefined): v is T { return v !== undefined; }

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

// Resolve a responsibility-share key (ElementId or EventId) to a readable label.
function resolveCauseLabel(
  id: string,
  allNodes: Record<string, Node>,
  allEdges: Record<string, Edge> | undefined,
  events: { id: string; label: string }[],
): string {
  if (allNodes[id]) return allNodes[id].label ?? id;
  const edge = allEdges?.[id];
  if (edge) {
    const s = allNodes[edge.source]?.label ?? edge.source;
    const t = allNodes[edge.target]?.label ?? edge.target;
    return `${s} → ${t}`;
  }
  const event = events.find((e) => e.id === id);
  if (event) return `Event: ${event.label}`;
  return id;
}

// Find the most recent history entry that changed this element's Functionality,
// to explain a compromised element that carries no propagation responsibility
// (i.e. it was degraded by an Event or a manual edit, not by the cascade).
function findDirectCause(
  elementId: string,
  history: { update_type: string; event_id?: string; mutation_reversal?: Record<string, unknown>; before: { nodes: Record<string, { functionality?: number }>; edges: Record<string, { functionality?: number }> }; after: { nodes: Record<string, { functionality?: number }>; edges: Record<string, { functionality?: number }> } }[],
): { kind: "event"; eventId?: string } | { kind: "manual" } | null {
  for (const entry of history) {
    if (
      entry.update_type === "event_applied" &&
      entry.mutation_reversal?.[`${elementId}.functionality`] !== undefined
    ) {
      return { kind: "event", eventId: entry.event_id };
    }
    if (entry.update_type === "manual_functionality_update") {
      const before = entry.before.nodes[elementId] ?? entry.before.edges[elementId];
      const after = entry.after.nodes[elementId] ?? entry.after.edges[elementId];
      if (after && before && after.functionality !== before.functionality) {
        return { kind: "manual" };
      }
    }
  }
  return null;
}

// Prominent banner at the top of the Inspector that explains WHY an element's
// Functionality is compromised (functionality < N). Renders nothing when the
// element is at full Functionality. Distinguishes a propagation cascade
// (responsibility_share over upstream elements), an Event, and a manual edit.
function CauseBanner({
  element,
  n,
  allNodes,
  allEdges,
  events,
}: {
  element: Node | Edge;
  n: number;
  allNodes: Record<string, Node>;
  allEdges?: Record<string, Edge>;
  events: { id: string; label: string }[];
}) {
  const history = useHistoryStore((s) => s.updateHistory);
  if ((element.functionality ?? n) >= n) return null; // not compromised

  const share = element.responsibility_share ?? {};
  const entries = Object.entries(share).sort((a, b) => b[1] - a[1]);

  let body: React.ReactNode;
  if (entries.length > 0) {
    body = (
      <div className="space-y-1">
        {entries.map(([id, weight]) => (
          <div key={id} className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-amber-900 dark:text-amber-200">
              {resolveCauseLabel(id, allNodes, allEdges, events)}
            </span>
            <span className="shrink-0 font-medium tabular-nums text-amber-700 dark:text-amber-300">
              {Math.round(weight * 100)}%
            </span>
          </div>
        ))}
      </div>
    );
  } else {
    const direct = findDirectCause(element.id, history);
    if (direct?.kind === "event") {
      const label = direct.eventId
        ? resolveCauseLabel(direct.eventId, allNodes, allEdges, events)
        : "an Event";
      body = <div className="text-xs text-amber-900 dark:text-amber-200">Compromised by {label}</div>;
    } else if (direct?.kind === "manual") {
      body = <div className="text-xs text-amber-900 dark:text-amber-200">Compromised by a manual change</div>;
    } else {
      body = <div className="text-xs text-amber-900 dark:text-amber-200">Compromised (cause not recorded)</div>;
    }
  }

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900/40 dark:bg-amber-950/30">
      <div className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-widest text-amber-700 dark:text-amber-400">
        <AlertTriangle size={12} /> Cause
      </div>
      {body}
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
// Canvas Membership section — shared by single-node and multi-select panels
// ---------------------------------------------------------------------------

function CanvasMembershipSection({ nodeIds }: { nodeIds: string[] }) {
  const copyNodesToCanvas = useCanvasStore((s) => s.copyNodesToCanvas);
  const moveNodesToCanvas = useCanvasStore((s) => s.moveNodesToCanvas);
  const activeCanvasId = useCanvasStore((s) => s.activeCanvasId);
  const orderedCanvases = useCanvasStore(useShallow(selectOrderedCanvases));
  const clearSelection = useNetworkStore((s) => s.clearSelection);

  const [targetCanvasId, setTargetCanvasId] = useState("");
  const otherCanvases = orderedCanvases.filter((c) => c.id !== activeCanvasId);

  if (otherCanvases.length === 0) return null;

  return (
    <Section title="Canvas Membership">
      <p className="mb-2 text-[10px] leading-tight text-zinc-400">
        Copy keeps nodes in this canvas too. Move removes them from this canvas
        (edges crossing the boundary become inter-canvas edges).
      </p>
      <Field label="Target canvas">
        <select
          value={targetCanvasId}
          onChange={(e) => setTargetCanvasId(e.target.value)}
          className="w-full rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-800 focus:border-blue-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
        >
          <option value="">— select —</option>
          {otherCanvases.map((c) => (
            <option key={c.id} value={c.id}>{c.label ?? c.id}</option>
          ))}
        </select>
      </Field>
      <div className="flex gap-2">
        <button
          disabled={!targetCanvasId}
          onClick={() => {
            if (!targetCanvasId) return;
            copyNodesToCanvas(nodeIds, targetCanvasId);
          }}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-blue-50 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-40 dark:bg-blue-900/20 dark:text-blue-300"
        >
          <Copy size={11} />
          Copy
        </button>
        <button
          disabled={!targetCanvasId || !activeCanvasId}
          onClick={() => {
            if (!targetCanvasId || !activeCanvasId) return;
            moveNodesToCanvas(nodeIds, activeCanvasId, targetCanvasId);
            clearSelection();
          }}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-violet-50 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-40 dark:bg-violet-900/20 dark:text-violet-300"
        >
          <ArrowRight size={11} />
          Move
        </button>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Supply Capacity editor — free-text category name, editable value, removable rows
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
  const [rows, setRows] = useState<[string, number][]>(() => Object.entries(supply).map(([k, v]) => [k, v]));

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

  const inputClass = "rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-xs focus:border-blue-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200";

  return (
    <div className="space-y-1">
      {rows.map(([cat, cap], i) => (
        <div key={i} className="flex items-center gap-1">
          {configCats.length > 0 ? (
            <select
              value={cat}
              onChange={(e) => commit(rows.map((r, j): [string, number] => j === i ? [e.target.value, r[1]] : r))}
              className={`w-28 ${inputClass}`}
            >
              {cat === "" && <option value="">— pick —</option>}
              {configCats.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={cat}
              onChange={(e) => commit(rows.map((r, j): [string, number] => j === i ? [e.target.value, r[1]] : r))}
              placeholder="category"
              className={`w-24 ${inputClass}`}
            />
          )}
          <input
            type="number"
            min={0}
            value={cap}
            onChange={(e) => commit(rows.map((r, j): [string, number] => j === i ? [r[0], Number(e.target.value)] : r))}
            className={`flex-1 ${inputClass}`}
          />
          <button onClick={() => commit(rows.filter((_, j) => j !== i))} className="text-zinc-300 hover:text-red-500">
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
// Categories editor — index-stable chips, free-text add, config shortcuts
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
          onChange={(e) => { if (e.target.value) onChange([...cats, e.target.value]); }}
          className="rounded border border-zinc-200 bg-white px-1 py-0.5 text-xs text-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800"
        >
          <option value="">+ add</option>
          {configCats.map((name) => (
            <option key={name} value={name}>{name}</option>
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
// Node inspector
// ---------------------------------------------------------------------------

function NodeInspector({ node }: { node: Node }) {
  const updateNode = useCanvasStore((s) => s.updateNode);
  const allNodes = useCanvasStore((s) => s.nodes);
  const allEdges = useCanvasStore((s) => s.edges);
  const n = useConfigStore(selectN);
  const scaleLevels = useConfigStore(useShallow(selectScaleLevels));
  const categories = useConfigStore(useShallow((s) => s.config.categories));
  const events = useConfigStore(useShallow((s) => s.config.events));

  // Categories for which to show a dependency profile:
  // own categories + categories supplied by any parent node (edge.target === this node).
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
    (partial: Partial<Node>) => {
      updateNode(node.id, partial);
    },
    [node.id, updateNode],
  );

  const patchWithHistory = useCallback(
    (partial: Partial<Node>, label: string) => {
      withHistory(useCanvasStore.getState(), () => updateNode(node.id, partial), label);
    },
    [node.id, updateNode],
  );

  const nodeTypes = ["Source", "Infrastructure", "Service", "Personnel"];

  return (
    <div className="overflow-y-auto">
      {/* Cause — prominent, only when compromised */}
      <CauseBanner
        element={node}
        n={n}
        allNodes={allNodes}
        allEdges={allEdges}
        events={events}
      />

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
            const profile: CategoryDependencyProfile = node.category_dependency_profiles?.[cat] ?? { dependency_level: n };
            const catDef = categories.find((c) => c.name === cat);
            const isStd = catDef?.category_type === "SourceToDemands";
            const isInbound = inboundCategories.has(cat);
            return (
              <div key={cat} className="mb-3">
                <div className="mb-1 flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">{cat}</span>
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
            stored_drop=0 → N (immune); stored_drop=1 → N−1; stored_drop=N−1 → 1.
            UI shows damage tier 1..N (1=immune, N=maximum damage).
            Conversion: stored_drop = display − 1; display = stored_drop + 1.
            Range 0…N−1; 0 = immune (default/absent), N−1 = maximum damage. */}
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

      {/* 9. Canvas Membership */}
      <CanvasMembershipSection nodeIds={[node.id]} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edge inspector
// ---------------------------------------------------------------------------

function EdgeInspector({ edge }: { edge: Edge }) {
  const updateEdge = useCanvasStore((s) => s.updateEdge);
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
      withHistory(useCanvasStore.getState(), () => updateEdge(edge.id, partial), label);
    },
    [edge.id, updateEdge],
  );

  const srcLabel = allNodes[edge.source]?.label ?? edge.source;
  const tgtLabel = allNodes[edge.target]?.label ?? edge.target;

  return (
    <div className="overflow-y-auto">
      {/* Cause — prominent, only when compromised */}
      <CauseBanner element={edge} n={n} allNodes={allNodes} events={events} />

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
          {events.map((ev) => {
            const level = edge.vulnerability_levels?.[ev.id] ?? 0;
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
                          ...(edge.vulnerability_levels ?? {}),
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

/**
 * RulesEditor — inline editor with per-rule enable/disable toggle.
 *
 * The disabled convention (a "// " prefix) lives in lib/rule-status.ts and is
 * shared with the Active Rules panel and the engine. The toggle strips or
 * prepends this prefix without touching the rule text. Disabled rules are
 * displayed in muted style and the textarea is editable but grayed out, giving
 * a clear visual signal without hiding the content.
 */
function RulesEditor({
  rules,
  onChange,
}: {
  rules: string[];
  onChange: (rules: string[]) => void;
}) {
  function toggleRule(i: number) {
    const next = [...rules];
    next[i] = toggleRuleDisabled(next[i]);
    onChange(next);
  }

  function updateText(i: number, text: string) {
    const next = [...rules];
    next[i] = setRuleBody(next[i], text);
    onChange(next);
  }

  return (
    <div className="space-y-1.5">
      {rules.map((rule, i) => {
        const disabled = isRuleDisabled(rule);
        return (
          <div key={i} className="flex items-start gap-1.5">
            {/* Enable / disable toggle */}
            <button
              onClick={() => toggleRule(i)}
              title={disabled ? "Enable rule" : "Disable rule"}
              className={cn(
                "mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                disabled
                  ? "border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-800"
                  : "border-blue-500 bg-blue-500 dark:border-blue-400 dark:bg-blue-400",
              )}
            >
              {!disabled && (
                <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
                  <path d="M1 3L3 5L7 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>

            <textarea
              value={ruleBody(rule)}
              rows={2}
              onChange={(e) => updateText(i, e.target.value)}
              className={cn(
                "flex-1 resize-none rounded border px-2 py-1 font-mono text-xs focus:border-blue-400 focus:outline-none",
                "border-zinc-200 bg-white text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
                disabled && "opacity-40",
              )}
            />

            <button
              onClick={() => onChange(rules.filter((_, j) => j !== i))}
              className="mt-1 text-zinc-300 hover:text-red-500"
            >
              <Trash2 size={12} />
            </button>
          </div>
        );
      })}
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
  // Index-stable rows so duplicate keys don't collapse and React keys stay unique
  const [rows, setRows] = useState<[string, string][]>(() =>
    Object.entries(properties).map(([k, v]) => [k, String(v ?? "")]),
  );

  const propKey = JSON.stringify(properties);
  useEffect(() => {
    setRows(Object.entries(properties).map(([k, v]) => [k, String(v ?? "")]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propKey]);

  function commit(next: [string, string][]) {
    setRows(next);
    const obj: Record<string, unknown> = {};
    for (const [k, v] of next) obj[k] = v;
    onChange(obj);
  }

  return (
    <div className="space-y-1">
      {rows.map(([k, v], i) => (
        <div key={i} className="flex items-center gap-1">
          <input
            type="text"
            value={k}
            onChange={(e) => commit(rows.map((r, j): [string, string] => j === i ? [e.target.value, r[1]] : r))}
            className="w-1/3 rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-xs focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
            placeholder="key"
          />
          <input
            type="text"
            value={v}
            onChange={(e) => commit(rows.map((r, j): [string, string] => j === i ? [r[0], e.target.value] : r))}
            className="flex-1 rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-xs focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
            placeholder="value"
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
        onClick={() => commit([...rows, ["", ""]])}
        className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700"
      >
        <Plus size={10} /> Add property
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// All-canvases meta panel (shown in inspector when global view is active, nothing selected)
// ---------------------------------------------------------------------------

function AllCanvasesMeta() {
  const canvases = useCanvasStore(useShallow(selectOrderedCanvases));
  const allNodes = useCanvasStore((s) => s.nodes);
  const allEdges = useCanvasStore((s) => s.edges);
  const updateCanvasMeta = useCanvasStore((s) => s.updateCanvasMeta);
  const globalViewLayout = useUiStore((s) => s.globalViewLayout);
  const setGlobalViewLayout = useUiStore((s) => s.setGlobalViewLayout);

  const totalNodes = new Set(canvases.flatMap((c) => c.graph.node_ids)).size;
  const totalEdges = new Set(canvases.flatMap((c) => c.graph.edge_ids)).size;

  return (
    <div className="p-3">
      <div className="mb-3 grid grid-cols-2 gap-2">
        <div className="rounded-md bg-zinc-50 p-2 text-center dark:bg-zinc-800">
          <div className="text-lg font-semibold text-zinc-700 dark:text-zinc-200">{totalNodes}</div>
          <div className="text-xs text-zinc-400">total nodes</div>
        </div>
        <div className="rounded-md bg-zinc-50 p-2 text-center dark:bg-zinc-800">
          <div className="text-lg font-semibold text-zinc-700 dark:text-zinc-200">{totalEdges}</div>
          <div className="text-xs text-zinc-400">total edges</div>
        </div>
      </div>

      <Field label="View mode">
        <div className="flex gap-1">
          {(["merged", "grouped"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setGlobalViewLayout(mode)}
              className={cn(
                "flex-1 rounded border px-2 py-1 text-xs capitalize transition-colors",
                globalViewLayout === mode
                  ? "border-blue-500 bg-blue-50 font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                  : "border-zinc-200 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800",
              )}
            >
              {mode}
            </button>
          ))}
        </div>
      </Field>

      <div className="mt-2 space-y-2">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
          Canvases
        </div>
        {canvases.map((c) => {
          const nodeCount = new Set(c.graph.node_ids.filter((id) => allNodes[id])).size;
          const edgeCount = new Set(c.graph.edge_ids.filter((id) => allEdges[id])).size;
          return (
            <div key={c.id} className="rounded-md border border-zinc-100 px-2 py-2 dark:border-zinc-800">
              <div className="mb-1.5 flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: c.color ?? "#94a3b8" }}
                  />
                  <span className="truncate text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    {c.label ?? c.id}
                  </span>
                </div>
                <span className="shrink-0 text-[11px] text-zinc-400 ml-2">
                  {nodeCount}n · {edgeCount}e
                </span>
              </div>

              {/* Geo toggle — same code as CanvasMeta, only available in merged mode */}
              {globalViewLayout === "merged" && (
                <>
                  <Toggle
                    value={c.georeferenced ?? false}
                    onChange={(v) => updateCanvasMeta(c.id, { georeferenced: v })}
                    label="Georeferenced canvas"
                  />
                  {c.georeferenced && (
                    <div className="mt-1 rounded border border-zinc-200 px-2 py-1.5 text-xs dark:border-zinc-700">
                      {c.geo_anchor ? (
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <span className="font-medium text-zinc-700 dark:text-zinc-200">Anchor set</span>
                            <div className="mt-0.5 text-zinc-400">
                              {c.geo_anchor.geo.lat.toFixed(5)}°,{" "}
                              {c.geo_anchor.geo.lng.toFixed(5)}°
                            </div>
                          </div>
                          <button
                            onClick={() => updateCanvasMeta(c.id, { geo_anchor: null })}
                            className="shrink-0 rounded px-2 py-0.5 text-[11px] text-zinc-500 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800"
                          >
                            Reset
                          </button>
                        </div>
                      ) : (
                        <span className="text-zinc-400">
                          No anchor — enable the map background to set one.
                        </span>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

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

      {activeCanvas.georeferenced && (
        <div className="mb-3 rounded-md border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-700">
          {activeCanvas.geo_anchor ? (
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="font-medium text-zinc-700 dark:text-zinc-200">Anchor set</span>
                <div className="mt-0.5 text-zinc-400">
                  {activeCanvas.geo_anchor.geo.lat.toFixed(5)}°,{" "}
                  {activeCanvas.geo_anchor.geo.lng.toFixed(5)}°
                </div>
              </div>
              <button
                onClick={() => updateCanvasMeta(activeCanvas.id, { geo_anchor: null })}
                className="shrink-0 rounded px-2 py-0.5 text-[11px] text-zinc-500 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800"
              >
                Reset
              </button>
            </div>
          ) : (
            <span className="text-zinc-400">
              No anchor — enable the map background to set one.
            </span>
          )}
        </div>
      )}

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

// Small inline warning badge used in batch panels.
function SkipWarning({ skipped, total, reason }: { skipped: number; total: number; reason: string }) {
  if (skipped === 0) return null;
  return (
    <div className="mt-1 flex items-start gap-1 rounded-md bg-amber-50 px-2 py-1 text-[10px] text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
      <AlertTriangle size={10} className="mt-0.5 shrink-0" />
      <span>
        <strong>{skipped}</strong> of {total} {skipped === 1 ? "element" : "elements"} will be skipped — {reason}
      </span>
    </div>
  );
}

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
  const n = useConfigStore(selectN);
  const scaleLevels = useConfigStore(useShallow(selectScaleLevels));
  const events = useConfigStore(useShallow((s) => s.config.events));
  const categories = useConfigStore(useShallow((s) => s.config.categories));

  const total = nodeIds.length + edgeIds.length;
  const isNodesOnly = nodeIds.length > 0 && edgeIds.length === 0;
  const isEdgesOnly = edgeIds.length > 0 && nodeIds.length === 0;

  const nodes = nodeIds.map((id) => allNodes[id]).filter(isDefined);
  const edges = edgeIds.map((id) => allEdges[id]).filter(isDefined);

  // ── Shared helper: push an undoable batch history entry ──
  function batchOp(
    updateFn: () => void,
    label: string,
    type: "manual_functionality_update" | "graph_update" = "manual_functionality_update",
  ) {
    withHistory(useCanvasStore.getState(), updateFn, label, type);
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

  // State for the Category Dependency Profiles batch editor
  const [batchCat, setBatchCat] = useState("");
  const [batchDepLevel, setBatchDepLevel] = useState(n);
  const [batchBackup, setBatchBackup] = useState(false);
  const [batchBackupDuration, setBatchBackupDuration] = useState(0);
  const [batchDemand, setBatchDemand] = useState(0);
  const [batchPriority, setBatchPriority] = useState(1);

  // ── Categories on selected nodes ──
  // "common" = present on EVERY selected node; shown as removable chips.
  // "partial" = present on SOME nodes only; shown as informational text.
  const allCatNames = categories.map((c) => c.name);
  const commonCategories = allCatNames.filter((name) =>
    nodes.length > 0 && nodes.every((nd) => (nd.node_categories ?? []).includes(name)),
  );
  const partialCategories = allCatNames.filter(
    (name) =>
      !commonCategories.includes(name) &&
      nodes.some((nd) => (nd.node_categories ?? []).includes(name)),
  );

  // ── Skip-warning statistics ──
  const noDamageCount = nodes.filter((nd) => !nd.direct_damage).length +
                        edges.filter((e) => !e.direct_damage).length;

  const currentLevel = scaleLevels.find((l) => l.level === funcValue);

  // ── Batch apply helpers ──
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
      () => nodeIds.forEach((id) => updateNode(id, { cost_of_disservice_per_day: costValue })),
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
          if (!current.includes(cat)) {
            updateNode(id, { node_categories: [...current, cat] });
          }
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
        updateNode(id, { vulnerability_levels: { ...(allNodes[id]?.vulnerability_levels ?? {}), [eventId]: level } }),
      );
      edgeIds.forEach((id) =>
        updateEdge(id, { vulnerability_levels: { ...(allEdges[id]?.vulnerability_levels ?? {}), [eventId]: level } }),
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
          const existing = node.category_dependency_profiles?.[batchCat] ?? { dependency_level: n };
          const catDef = categories.find((c) => c.name === batchCat);
          const isStd = catDef?.category_type === "SourceToDemands";
          const updated: CategoryDependencyProfile = {
            ...existing,
            dependency_level: batchDepLevel,
            backup: batchBackup,
            ...(batchBackup ? { backup_duration: batchBackupDuration } : {}),
            ...(isStd ? { demand: batchDemand, priority: batchPriority } : {}),
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
    withHistory(useCanvasStore.getState(), () => {
      nodeIds.forEach(removeNode);
      edgeIds.forEach(removeEdge);
    }, `Delete ${total} elements`, "graph_update");
    clearSelection();
    setInspectorOpen(false);
  }

  const batchCatDef = categories.find((c) => c.name === batchCat);
  const batchCatIsStd = batchCatDef?.category_type === "SourceToDemands";

  return (
    <div className="overflow-y-auto">
      {/* ── Header ── */}
      <div className="border-b border-zinc-100 px-3 py-2.5 dark:border-zinc-800">
        <div className="text-xs text-zinc-500">
          <span className="font-semibold text-zinc-700 dark:text-zinc-300">{total}</span>
          {" "}elements selected
          <span className="ml-1 text-zinc-400">
            ({isNodesOnly
              ? `${nodeIds.length} nodes`
              : isEdgesOnly
              ? `${edgeIds.length} edges`
              : `${nodeIds.length} nodes, ${edgeIds.length} edges`})
          </span>
        </div>
        <p className="mt-0.5 text-[10px] text-zinc-400">
          Each section applies to all selected elements. Warnings appear when some
          elements will be skipped.
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
              >Apply</button>
            </div>
          </Field>

          <Field label="Node Type">
            <div className="grid grid-cols-2 gap-1">
              {(["Source", "Infrastructure", "Service", "Personnel"] as const).map((t) => (
                <button key={t} onClick={() => applyNodeType(t)}
                  className="rounded-md border border-zinc-200 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
                  {t}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Categories">
            <div className="flex flex-wrap gap-1 mb-1">
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
                    <option key={c.name} value={c.name}>{c.name}</option>
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
              type="range" min={1} max={n} value={funcValue}
              onChange={(e) => setFuncValue(Number(e.target.value))}
              className="flex-1 accent-blue-500"
            />
            <span
              className="min-w-[2rem] rounded px-1.5 py-0.5 text-center text-xs font-medium text-white"
              style={{ backgroundColor: currentLevel?.color ?? "#94a3b8" }}
            >{funcValue}</span>
          </div>
          {currentLevel && <div className="mt-0.5 text-xs text-zinc-400">{currentLevel.label}</div>}
        </Field>
        <button onClick={applyFunctionality}
          className="mt-1 w-full rounded-md bg-blue-50 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-300">
          Apply to {total} element{total > 1 ? "s" : ""}
        </button>
      </Section>

      {/* ── Functionality Time ── */}
      <Section title="Functionality Time">
        <Field label="Hours until degradation (0 = off)">
          <div className="flex gap-1">
            <input
              type="number" min={0} value={funcTimeValue}
              onChange={(e) => setFuncTimeValue(Number(e.target.value))}
              className="flex-1 rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-800 focus:border-blue-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
            />
            <button onClick={applyFuncTime}
              className="rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-300">
              Apply
            </button>
          </div>
        </Field>
      </Section>

      {/* ── Direct Damage ── */}
      <Section title="Direct Damage">
        <div className="flex gap-2">
          <button onClick={() => applyDirectDamage(true)}
            className="flex-1 rounded-md bg-red-50 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400">
            Set damaged
          </button>
          <button onClick={() => applyDirectDamage(false)}
            className="flex-1 rounded-md bg-zinc-50 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:bg-zinc-800 dark:text-zinc-400">
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
              type="number" min={0} value={repairTimeValue}
              onChange={(e) => setRepairTimeValue(Number(e.target.value))}
              className="flex-1 rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-800 focus:border-blue-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
            />
            <button onClick={applyRepairTime}
              className="rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-40 dark:bg-blue-900/20 dark:text-blue-300">
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
                type="number" min={0} max={1} step={0.05} value={importanceValue}
                onChange={(e) => setImportanceValue(Number(e.target.value))}
                className="flex-1 rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-800 focus:border-blue-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
              />
              <button onClick={applyImportance}
                className="rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-300">
                Apply
              </button>
            </div>
          </Field>
          <Field label="Cost of disservice / day">
            <div className="flex gap-1">
              <input
                type="number" min={0} value={costValue}
                onChange={(e) => setCostValue(Number(e.target.value))}
                className="flex-1 rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-800 focus:border-blue-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
              />
              <button onClick={applyCostOfDisservice}
                className="rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-300">
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
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>
          </Field>
          {batchCat && (
            <>
              <SkipWarning
                skipped={nodes.filter((nd) => !(nd.node_categories ?? []).includes(batchCat)).length}
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
              {batchCatIsStd && (
                <>
                  <Field label="Demand">
                    <NumberInput value={batchDemand} min={0} onChange={setBatchDemand} />
                  </Field>
                  <Field label="Priority (1–10)">
                    <NumberInput value={batchPriority} min={1} max={10} onChange={setBatchPriority} />
                  </Field>
                </>
              )}
              <button
                onClick={applyBatchProfile}
                className="mt-1 w-full rounded-md bg-blue-50 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-300"
              >
                Apply profile to all in "{batchCat}"
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
                type="number" min={0} value={capacityValue}
                onChange={(e) => setCapacityValue(Number(e.target.value))}
                className="flex-1 rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-800 focus:border-blue-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
              />
              <button onClick={applyEdgeCapacity}
                className="rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-300">
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
        <button onClick={handleBatchDelete}
          className="flex w-full items-center justify-center gap-1.5 rounded-md bg-red-50 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400">
          <Trash2 size={12} />
          Delete {total} element{total > 1 ? "s" : ""}
        </button>
      </div>
    </div>
  );
}

function VulnerabilityBatchRow({
  event, n, onApply,
}: {
  event: { id: string; label: string };
  n: number;
  onApply: (level: number) => void;
}) {
  const [level, setLevel] = useState(0); // 0=immune, N−1=max damage
  return (
    <Field label={event.label}>
      <div className="flex items-center gap-2">
        <input
          type="range" min={0} max={n - 1} value={level}
          onChange={(e) => setLevel(Number(e.target.value))}
          className="flex-1 accent-orange-500"
        />
        <span className="min-w-[1.5rem] text-right text-xs text-zinc-600 dark:text-zinc-400">{level}</span>
        <button onClick={() => onApply(level)}
          className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-300">
          Apply
        </button>
      </div>
      <div className="mt-0.5 text-[10px] text-zinc-400">{vulnHint(level, n)}</div>
    </Field>
  );
}

// ---------------------------------------------------------------------------
// Inspector root
// ---------------------------------------------------------------------------

export function Inspector() {
  const inspectorOpen = useUiStore((s) => s.inspectorOpen);
  const globalViewActive = useUiStore((s) => s.globalViewActive);

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
    if (!singleNode && !singleEdge) return;
    const s = useCanvasStore.getState();
    const label = singleNode
      ? `Delete node "${singleNode.label ?? singleNode.id}"`
      : "Delete edge";
    withHistory(s, () => {
      if (singleNode) s.removeNode(singleNode.id);
      else if (singleEdge) s.removeEdge(singleEdge.id);
    }, label, "graph_update");
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
            <MultiSelectPanel
              key={[...nodeIdArr].sort().join(',') + '|' + [...edgeIdArr].sort().join(',')}
              nodeIds={nodeIdArr}
              edgeIds={edgeIdArr}
            />
          ) : globalViewActive ? (
            <AllCanvasesMeta />
          ) : (
            <CanvasMeta />
          )}
        </>
      )}
    </div>
  );
}
