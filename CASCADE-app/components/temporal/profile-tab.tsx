"use client";

import { useMemo } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";
import { useCanvasStore } from "@/store/canvas-store";
import { useTemporalSimulationStore } from "@/store/temporal-simulation-store";
import { planTimeline } from "@/lib/timeline-plan";
import { matchElements } from "@/lib/element-filter";
import { explainProfileOp } from "@/lib/temporal-simulation-explainers";
import type { AttributeOperation } from "@/lib/temporal-simulation-schema";
import type { ProfileEntry } from "@/lib/temporal-simulation-text";
import { FilterEditor } from "./filter-editor";
import { Field, Segmented, SmallButton, TextBackedInput, formatPath, inputCls, parsePath, parseValue } from "./fields";

const OPS: AttributeOperation["op"][] = ["set", "add", "mul", "at_most", "at_least"];

export function ProfileTab() {
  const timeline = useTemporalSimulationStore((s) => s.timeline);
  const entries = useTemporalSimulationStore((s) => s.profile);
  const update = useTemporalSimulationStore((s) => s.updateProfile);
  const explain = useTemporalSimulationStore((s) => s.explain);
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);

  const labels = useMemo(() => planTimeline(timeline).periods.map((p) => p.label), [timeline]);
  const elementOptions = useMemo(
    () => [
      ...Object.values(nodes).map((n) => ({ id: n.id, label: `${n.label || n.id} (node)` })),
      ...Object.values(edges).map((e) => ({ id: e.id, label: `${nodes[e.source]?.label || e.source} → ${nodes[e.target]?.label || e.target} (edge)` })),
    ].sort((a, b) => a.label.localeCompare(b.label)),
    [nodes, edges],
  );

  function describe(entry: ProfileEntry) {
    const matches = entry.op.where ? matchElements(entry.op.where, useCanvasStore.getState()).length : null;
    explain(explainProfileOp(entry.label, entry.op, labels.includes(entry.label), matches));
  }

  function edit(i: number, patch: { label?: string; op?: Partial<AttributeOperation> }) {
    const next: ProfileEntry = { ...entries[i], ...patch, op: { ...entries[i].op, ...patch.op } as AttributeOperation };
    update((rows) => { rows[i] = next; });
    describe(next);
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">
        Each operation applies at the start of its period, to one Element or to every Element a filter selects.
      </p>

      {entries.map((entry, i) => {
        const used = labels.includes(entry.label);
        const mode = entry.op.where ? "filter" : "element";
        return (
          <div key={entry.id} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700" onFocus={() => describe(entry)}>
            <div className="grid grid-cols-[1fr_1.4fr_auto] items-end gap-2">
              <Field label="Period">
                <select className={used ? inputCls : `${inputCls} border-amber-400`} value={entry.label} onChange={(e) => edit(i, { label: e.target.value })}>
                  {!used && <option value={entry.label}>{entry.label} (unused)</option>}
                  {labels.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </Field>
              <Field label="Applies to">
                <Segmented
                  value={mode}
                  options={[{ id: "element", label: "One Element" }, { id: "filter", label: "Filter" }]}
                  onChange={(m) => edit(i, { op: m === "filter" ? { element: undefined, where: { kind: "node" } } : { where: undefined, element: "" } })}
                />
              </Field>
              <div className="flex gap-1 pb-0.5">
                <button
                  type="button"
                  title="Duplicate"
                  className="text-zinc-400 hover:text-blue-600"
                  onClick={() => update((rows) => { rows.splice(i + 1, 0, { ...entry, id: nanoid() }); })}
                >
                  <Copy size={12} />
                </button>
                <button type="button" title="Remove" className="text-zinc-400 hover:text-red-600" onClick={() => update((rows) => { rows.splice(i, 1); })}>
                  <Trash2 size={12} />
                </button>
              </div>
            </div>

            <div className="mt-2">
              {mode === "element" ? (
                <select className={inputCls} value={entry.op.element ?? ""} onChange={(e) => edit(i, { op: { element: e.target.value } })}>
                  <option value="">— choose an Element —</option>
                  {elementOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              ) : (
                <FilterEditor value={entry.op.where ?? { kind: "node" }} onChange={(where) => edit(i, { op: { where } })} />
              )}
            </div>

            <div className="mt-2 grid grid-cols-[2fr_1fr_1fr] gap-2">
              <Field label="Path (comma-separated)">
                <TextBackedInput
                  key={`${entry.id}-path`}
                  initial={formatPath(entry.op.path)}
                  placeholder="supply_capacity, hours, rate"
                  onCommit={(t) => edit(i, { op: { path: parsePath(t) } })}
                />
              </Field>
              <Field label="Op">
                <select className={inputCls} value={entry.op.op} onChange={(e) => edit(i, { op: { op: e.target.value as AttributeOperation["op"] } })}>
                  {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </Field>
              <Field label="Value">
                <TextBackedInput key={`${entry.id}-value`} initial={String(entry.op.value)} onCommit={(t) => edit(i, { op: { value: parseValue(t) } })} />
              </Field>
            </div>
          </div>
        );
      })}

      <SmallButton
        tone="accent"
        onClick={() => {
          const entry: ProfileEntry = {
            id: nanoid(),
            label: labels[0] ?? "",
            op: { where: { kind: "node" }, path: ["supply_capacity", "hours", "rate"], op: "set", value: 0 },
          };
          update((rows) => { rows.push(entry); });
          describe(entry);
        }}
      >
        <Plus size={11} /> Add profile operation
      </SmallButton>
      <p className="text-[11px] text-zinc-400">Many periods or Elements at once? The Text tab takes the whole profile as JSON.</p>
    </div>
  );
}
