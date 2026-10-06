"use client";

/**
 * ProfileRowEditor — what a profile row acts on: one Element or a filter, the
 * field path and the op. The values per period are the row's cells in the
 * Timeline grid.
 */

import { useMemo, useState } from "react";
import { Copy, Trash2, X } from "lucide-react";
import { nanoid } from "nanoid";
import { useShallow } from "zustand/react/shallow";
import { useCanvasStore } from "@/store/canvas-store";
import { useTemporalSimulationStore } from "@/store/temporal-simulation-store";
import { filterLabel } from "@/lib/element-filter";
import { explainProfileWrite } from "@/lib/temporal-simulation-explainers";
import { firesEvery } from "@/lib/timeline-plan";
import { OperationKindSchema, valueFitsOp } from "@/lib/schemas/config";
import type { ProfileRow } from "@/lib/temporal-simulation-text";
import { FilterEditor } from "./filter-editor";
import { NumberInput } from "@/components/ui/number-input";
import { Field, Segmented, SmallButton, TextBackedInput, describeRow, formatPath, inputCls, parsePath, parseValue, usePlan } from "./fields";

export function ProfileRowEditor({ row, onClose, onSelect }: { row: ProfileRow; onClose: () => void; onSelect: (id: string) => void }) {
  const { updateProfile, updateRow } = useTemporalSimulationStore.getState();
  const plan = usePlan();
  const labels = useMemo(() => plan.periods.map((p) => p.label), [plan]);
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
    updateRow(row.id, (r) => { Object.assign(r, patch); });
    describeRow({ ...row, ...patch });
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
            updateProfile((rows) => { rows.splice(rows.findIndex((r) => r.id === row.id) + 1, 0, copy); });
            onSelect(copy.id);
          }}
        >
          <Copy size={12} />
        </button>
        <button
          type="button"
          title="Remove row"
          className="text-zinc-400 hover:text-red-600"
          onClick={() => updateProfile((rows) => { rows.splice(rows.findIndex((r) => r.id === row.id), 1); })}
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

      <ValueWriter row={row} labels={labels} />

      <div className="mt-2">
        {row.where ? (
          // FilterEditor explains its own change, so this skips `describeRow`.
          <FilterEditor
            onExplain={useTemporalSimulationStore.getState().explain}
            value={row.where}
            onChange={(where) => updateRow(row.id, (r) => { r.where = where; })}
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

/**
 * The value the op uses, written into a span of the row's cells: From, To and
 * every N periods (the N-th, 2N-th… of the span, as for a Phase Event). The
 * cells stay the row's values; this only fills them.
 */
function ValueWriter({ row, labels }: { row: ProfileRow; labels: string[] }) {
  const { explain, writeCells } = useTemporalSimulationStore.getState();
  const [value, setValue] = useState("");
  const [chosenFrom, setFrom] = useState(labels[0] ?? "");
  const [chosenTo, setTo] = useState(labels[labels.length - 1] ?? "");
  const [every, setEvery] = useState(1);

  // A choice the Timeline no longer has (a renamed or removed Step) falls back to its end,
  // and the selects show what Write will use.
  const from = labels.includes(chosenFrom) ? chosenFrom : labels[0] ?? "";
  const to = labels.includes(chosenTo) ? chosenTo : labels[labels.length - 1] ?? "";
  const start = Math.max(0, labels.indexOf(from));
  const end = labels.indexOf(to);
  // The From…To periods N, 2N, 3N…, as a Phase Event's every N counts its Step's periods.
  const span = labels.slice(start, end + 1).filter((_, k) => firesEvery(k, every));
  const parsed = value.trim() === "" ? undefined : parseValue(value);
  const problem =
    parsed === undefined ? "Type the value first."
      : !valueFitsOp(row.op, parsed) ? `${row.op} needs a number.`
        : span.length === 0 ? "The span holds no period." : null;
  const describe = () => explain(explainProfileWrite(row.op, value, span));

  return (
    <div className="mt-2 rounded-md bg-zinc-50 p-2 dark:bg-zinc-800/60" onFocus={(e) => { e.stopPropagation(); describe(); }}>
      <div className="grid grid-cols-[1.2fr_1fr_1fr_0.6fr_auto] items-end gap-2">
        <Field label={`Value (${row.op})`}>
          <input className={inputCls} value={value} placeholder={row.op === "mul" ? "1.02" : "120"} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <Field label="From">
          <select className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)}>
            {labels.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </Field>
        <Field label="To">
          <select className={inputCls} value={to} onChange={(e) => setTo(e.target.value)}>
            {labels.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </Field>
        <Field label="Every">
          <NumberInput min={1} className={inputCls} value={every} onChange={(v) => setEvery(Math.max(1, Math.floor(v)))} />
        </Field>
        <div className="flex gap-1 pb-px">
          <SmallButton
            tone="accent"
            disabled={problem !== null}
            title={problem ?? `Write into ${span.length} cell${span.length === 1 ? "" : "s"}`}
            onClick={() => { writeCells(row.id, span.map((l) => [l, parsed])); describe(); }}
          >
            Write
          </SmallButton>
          <SmallButton disabled={span.length === 0} title="Empty these cells" onClick={() => { writeCells(row.id, span.map((l) => [l, undefined])); describe(); }}>
            Clear
          </SmallButton>
        </div>
      </div>
      <p className="mt-1 text-[10px] text-zinc-500">
        {problem ?? `Writes into ${span.length} cell${span.length === 1 ? "" : "s"}: ${span.length <= 6 ? span.join(", ") : `${span.slice(0, 3).join(", ")} … ${span[span.length - 1]}`}${row.op === "set" && span.length > 1 ? ". For set, the first is enough: the value stays until changed" : ""}.`}
      </p>
    </div>
  );
}
