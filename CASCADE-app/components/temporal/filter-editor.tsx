"use client";

/**
 * FilterEditor — narrows Elements by Kind, Canvas, Category, Node Type and
 * label, then lists every match with a tick box. Unticking adds the Element to
 * `exclude`, so the filter stays live: an Element that starts matching later
 * is included. Shared by profile operations and Metric targets.
 */

import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore } from "@/store/config-store";
import { useTemporalSimulationStore } from "@/store/temporal-simulation-store";
import { filterLabel, filterMisuse, matchElements } from "@/lib/element-filter";
import { explainFilter } from "@/lib/temporal-simulation-explainers";
import type { ElementFilter } from "@/lib/temporal-simulation-schema";
import { NODE_TYPES } from "@/lib/schemas/primitives";
import { Field, inputCls } from "./fields";

/** Drop emptied fields so they stop constraining. */
function clean(f: ElementFilter): ElementFilter {
  const out: ElementFilter = { kind: f.kind };
  if (f.canvas) out.canvas = f.canvas;
  if (f.category) out.category = f.category;
  if (f.node_type && out.kind === "node") out.node_type = f.node_type;
  if (f.label_contains) out.label_contains = f.label_contains;
  if (f.exclude && f.exclude.length > 0) out.exclude = f.exclude;
  return out;
}

export function FilterEditor({ value, onChange }: { value: ElementFilter; onChange: (f: ElementFilter) => void }) {
  const explain = useTemporalSimulationStore((s) => s.explain);
  const { nodes, edges, canvases } = useCanvasStore(useShallow((s) => ({ nodes: s.nodes, edges: s.edges, canvases: s.canvases })));
  const categories = useConfigStore(useShallow((s) => s.config.categories.map((c) => c.name)));
  const { kind } = value;
  const excluded = useMemo(() => new Set(value.exclude ?? []), [value.exclude]);
  // The built-in Node Types plus any custom one the model uses.
  const nodeTypes = useMemo(
    () => [...new Set([...NODE_TYPES, ...Object.values(nodes).flatMap((n) => (n.node_type ? [n.node_type] : []))])],
    [nodes],
  );

  // Every match of the conditions, ticked or not — the list the user picks from.
  const candidates = useMemo(
    () => matchElements({ ...value, exclude: undefined }, { nodes, edges, canvases }),
    [value, nodes, edges, canvases],
  );
  const selected = useMemo(() => candidates.filter((id) => !excluded.has(id)), [candidates, excluded]);

  const commit = (patch: Partial<ElementFilter>) => {
    const next = clean({ ...value, ...patch });
    onChange(next);
    // One scan: the candidates, then the ticked ones among them.
    const all = matchElements({ ...next, exclude: undefined }, useCanvasStore.getState());
    const out = new Set(next.exclude ?? []);
    explain(explainFilter(next, all.filter((id) => !out.has(id)).length, all.length, filterMisuse(next)));
  };
  const showExplain = () => explain(explainFilter(value, selected.length, candidates.length, filterMisuse(value)));
  const toggle = (id: string) =>
    commit({ exclude: excluded.has(id) ? [...excluded].filter((x) => x !== id) : [...excluded, id] });

  return (
    <div className="rounded-md border border-dashed border-zinc-300 p-2 dark:border-zinc-600" onFocus={showExplain}>
      <div className="grid grid-cols-5 gap-2">
        <Field label="Kind">
          <select className={inputCls} value={kind} onChange={(e) => commit({ kind: e.target.value as "node" | "edge", exclude: undefined })}>
            <option value="node">nodes</option>
            <option value="edge">edges</option>
          </select>
        </Field>
        <Field label="Canvas">
          <select className={inputCls} value={value.canvas ?? ""} onChange={(e) => commit({ canvas: e.target.value })}>
            <option value="">any</option>
            {Object.values(canvases).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </Field>
        <Field label="Category">
          <select className={inputCls} value={value.category ?? ""} onChange={(e) => commit({ category: e.target.value })}>
            <option value="">any</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Node Type">
          <select className={inputCls} disabled={kind === "edge"} value={value.node_type ?? ""} onChange={(e) => commit({ node_type: e.target.value })}>
            <option value="">any</option>
            {nodeTypes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Label contains">
          <input className={inputCls} value={value.label_contains ?? ""} onChange={(e) => commit({ label_contains: e.target.value })} />
        </Field>
      </div>

      <div className="mt-2 flex items-center gap-2 text-[11px]">
        <button type="button" onClick={showExplain} className="font-medium text-blue-700 hover:underline dark:text-blue-400">
          {selected.length} of {candidates.length} {kind}{candidates.length === 1 ? "" : "s"} selected
        </button>
        <span className="flex-1" />
        <button type="button" className="text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200" onClick={() => commit({ exclude: undefined })}>All</button>
        <button type="button" className="text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200" onClick={() => commit({ exclude: candidates })}>None</button>
      </div>
      {candidates.length > 0 && (
        <div className="mt-1 grid max-h-36 grid-cols-2 gap-x-3 overflow-y-auto rounded bg-zinc-50 p-1.5 dark:bg-zinc-800/60">
          {candidates.map((id) => (
            <label key={id} className="flex min-w-0 items-center gap-1.5 py-0.5 text-[11px] text-zinc-700 dark:text-zinc-300">
              <input type="checkbox" checked={!excluded.has(id)} onChange={() => toggle(id)} />
              <span className="truncate" title={id}>{filterLabel(id, { nodes, edges })}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
