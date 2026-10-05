"use client";

/**
 * ProfileRowEditor — what a profile row acts on: one Element or a filter, the
 * field path and the op. The values per period are the row's cells in the
 * Timeline grid.
 */

import { useMemo } from "react";
import { Copy, Trash2, X } from "lucide-react";
import { nanoid } from "nanoid";
import { useShallow } from "zustand/react/shallow";
import { useCanvasStore } from "@/store/canvas-store";
import { useTemporalSimulationStore } from "@/store/temporal-simulation-store";
import { filterLabel, matchElements } from "@/lib/element-filter";
import { explainProfileRow } from "@/lib/temporal-simulation-explainers";
import { OperationKindSchema } from "@/lib/temporal-simulation-schema";
import type { ProfileRow } from "@/lib/temporal-simulation-text";
import { FilterEditor } from "./filter-editor";
import { Field, Segmented, TextBackedInput, formatPath, inputCls, parsePath } from "./fields";

export function describeRow(row: ProfileRow): void {
  const matches = row.where ? matchElements(row.where, useCanvasStore.getState()).length : null;
  useTemporalSimulationStore.getState().explain(explainProfileRow(row, matches, Object.keys(row.values).length));
}

export function ProfileRowEditor({ row, onClose, onSelect }: { row: ProfileRow; onClose: () => void; onSelect: (id: string) => void }) {
  const update = useTemporalSimulationStore((s) => s.updateProfile);
  const { nodes, edges } = useCanvasStore(useShallow((s) => ({ nodes: s.nodes, edges: s.edges })));

  // Built once per model change.
  const elementOptions = useMemo(
    () =>
      [...Object.keys(nodes), ...Object.keys(edges)]
        .map((id) => ({ id, label: `${filterLabel(id, { nodes, edges })} (${id in nodes ? "node" : "edge"})` }))
        .sort((a, b) => a.label.localeCompare(b.label))
        .map((o) => <option key={o.id} value={o.id}>{o.label}</option>),
    [nodes, edges],
  );

  function edit(patch: Partial<Omit<ProfileRow, "id" | "values">>) {
    const next = { ...row, ...patch };
    update((rows) => {
      const i = rows.findIndex((r) => r.id === row.id);
      if (i >= 0) rows[i] = next;
    });
    describeRow(next);
  }

  return (
    <div className="rounded-lg border border-blue-200 p-3 dark:border-blue-900" onFocus={() => describeRow(row)}>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">Profile row</span>
        <span className="text-[11px] text-zinc-400">its values are the cells above</span>
        <span className="flex-1" />
        <button
          type="button"
          title="Duplicate"
          className="text-zinc-400 hover:text-blue-600"
          onClick={() => {
            const copy = { ...row, id: nanoid() };
            update((rows) => { rows.splice(rows.findIndex((r) => r.id === row.id) + 1, 0, copy); });
            onSelect(copy.id);
          }}
        >
          <Copy size={12} />
        </button>
        <button
          type="button"
          title="Remove row"
          className="text-zinc-400 hover:text-red-600"
          onClick={() => { update((rows) => { rows.splice(rows.findIndex((r) => r.id === row.id), 1); }); onClose(); }}
        >
          <Trash2 size={12} />
        </button>
        <button type="button" title="Close" className="text-zinc-400 hover:text-zinc-700" onClick={onClose}>
          <X size={12} />
        </button>
      </div>

      <div className="grid grid-cols-[auto_2fr_1fr] items-end gap-2">
        <Field label="Applies to">
          <Segmented
            value={row.where ? "filter" : "element"}
            options={[{ id: "element", label: "One Element" }, { id: "filter", label: "Filter" }]}
            onChange={(m) => edit(m === "filter" ? { element: undefined, where: { kind: "node" } } : { where: undefined, element: "" })}
          />
        </Field>
        <Field label="Path (comma-separated)">
          <TextBackedInput
            key={`${row.id}-path`}
            initial={formatPath(row.path)}
            placeholder="supply_capacity, water"
            onCommit={(t) => edit({ path: parsePath(t) })}
          />
        </Field>
        <Field label="Op">
          <select className={inputCls} value={row.op} onChange={(e) => edit({ op: OperationKindSchema.parse(e.target.value) })}>
            {OperationKindSchema.options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </Field>
      </div>

      <div className="mt-2">
        {row.where ? (
          // FilterEditor explains its own change, so this skips `describeRow`.
          <FilterEditor
            value={row.where}
            onChange={(where) => update((rows) => { const r = rows.find((x) => x.id === row.id); if (r) r.where = where; })}
          />
        ) : (
          <select className={inputCls} value={row.element ?? ""} onChange={(e) => edit({ element: e.target.value })}>
            <option value="">— choose an Element —</option>
            {elementOptions}
          </select>
        )}
      </div>
    </div>
  );
}
