"use client";

/**
 * FilterEditor — edits an ElementFilter and shows, live, how many Elements of
 * the current model it selects. Shared by profile operations and Metric targets.
 */

import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore } from "@/store/config-store";
import { useTemporalSimulationStore } from "@/store/temporal-simulation-store";
import { filterMisuse, matchElements } from "@/lib/element-filter";
import { explainFilter } from "@/lib/temporal-simulation-explainers";
import type { ElementFilter } from "@/lib/temporal-simulation-schema";
import { Field, inputCls } from "./fields";

const NODE_TYPES = ["Source", "Infrastructure", "Service", "Personnel"];

/** Drop empty strings so an emptied field stops constraining. */
function clean(f: ElementFilter): ElementFilter {
  const out: ElementFilter = { kind: f.kind ?? "node" };
  for (const [k, v] of Object.entries(f) as [keyof ElementFilter, unknown][]) {
    if (k === "kind" || v === undefined || v === "") continue;
    if (k === "property" && (!v || !(v as { key: string }).key)) continue;
    (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

function useFilterMatches(filter: ElementFilter): string[] {
  const { nodes, edges, canvases } = useCanvasStore(useShallow((s) => ({ nodes: s.nodes, edges: s.edges, canvases: s.canvases })));
  return useMemo(() => matchElements(filter, { nodes, edges, canvases }), [filter, nodes, edges, canvases]);
}

export function FilterEditor({ value, onChange }: { value: ElementFilter; onChange: (f: ElementFilter) => void }) {
  const explain = useTemporalSimulationStore((s) => s.explain);
  const canvases = useCanvasStore((s) => s.canvases);
  const nodes = useCanvasStore((s) => s.nodes);
  const categories = useConfigStore(useShallow((s) => s.config.categories.map((c) => c.name)));
  const matches = useFilterMatches(value);
  const kind = value.kind ?? "node";

  const set = (patch: Partial<ElementFilter>) => {
    const next = clean({ ...value, ...patch });
    onChange(next);
    explain(explainFilter(next, matchElements(next, useCanvasStore.getState()).length, filterMisuse(next)));
  };
  const showExplain = () => explain(explainFilter(value, matches.length, filterMisuse(value)));
  const labelOf = (id: string) => nodes[id]?.label || id;

  return (
    <div className="rounded-md border border-dashed border-zinc-300 p-2 dark:border-zinc-600" onFocus={showExplain}>
      <div className="grid grid-cols-4 gap-2">
        <Field label="Kind">
          <select className={inputCls} value={kind} onChange={(e) => set({ kind: e.target.value as "node" | "edge", node_type: undefined, from: undefined, to: undefined })}>
            <option value="node">nodes</option>
            <option value="edge">edges</option>
          </select>
        </Field>
        <Field label="Canvas">
          <select className={inputCls} value={value.canvas ?? ""} onChange={(e) => set({ canvas: e.target.value })}>
            <option value="">any</option>
            {Object.values(canvases).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </Field>
        <Field label="Category">
          <select className={inputCls} value={value.category ?? ""} onChange={(e) => set({ category: e.target.value })}>
            <option value="">any</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        {kind === "node" ? (
          <Field label="Node Type">
            <select className={inputCls} value={value.node_type ?? ""} onChange={(e) => set({ node_type: e.target.value })}>
              <option value="">any</option>
              {NODE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
        ) : (
          <div className="grid grid-cols-2 gap-1">
            <Field label="From">
              <select className={inputCls} value={value.from ?? ""} onChange={(e) => set({ from: e.target.value })}>
                <option value="">any</option>
                {Object.keys(nodes).map((id) => <option key={id} value={id}>{labelOf(id)}</option>)}
              </select>
            </Field>
            <Field label="To">
              <select className={inputCls} value={value.to ?? ""} onChange={(e) => set({ to: e.target.value })}>
                <option value="">any</option>
                {Object.keys(nodes).map((id) => <option key={id} value={id}>{labelOf(id)}</option>)}
              </select>
            </Field>
          </div>
        )}
        <Field label="Property key">
          <input className={inputCls} value={value.property?.key ?? ""} onChange={(e) => set({ property: e.target.value ? { key: e.target.value, equals: value.property?.equals } : undefined })} />
        </Field>
        <Field label="equals (optional)">
          <input
            className={inputCls}
            disabled={!value.property?.key}
            value={value.property?.equals === undefined ? "" : String(value.property.equals)}
            onChange={(e) => value.property && set({ property: { key: value.property.key, equals: e.target.value === "" ? undefined : e.target.value } })}
          />
        </Field>
        <Field label="Label contains" className="col-span-2">
          <input className={inputCls} value={value.label_contains ?? ""} onChange={(e) => set({ label_contains: e.target.value })} />
        </Field>
      </div>
      <button
        type="button"
        onClick={showExplain}
        title={matches.slice(0, 30).map(labelOf).join(", ")}
        className="mt-1.5 text-[11px] font-medium text-blue-700 hover:underline dark:text-blue-400"
      >
        Matches {matches.length} {kind}{matches.length === 1 ? "" : "s"}
        {matches.length > 0 && `: ${matches.slice(0, 4).map(labelOf).join(", ")}${matches.length > 4 ? ", …" : ""}`}
      </button>
    </div>
  );
}
