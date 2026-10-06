"use client";

import { Plus, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";
import { useCanvasStore } from "@/store/canvas-store";
import { useTemporalSimulationStore } from "@/store/temporal-simulation-store";
import { matchElements } from "@/lib/element-filter";
import { explainMetric } from "@/lib/temporal-simulation-explainers";
import { AggregateSchema, ComparisonSchema, type Metric } from "@/lib/temporal-simulation-schema";
import type { MetricEntry } from "@/lib/temporal-simulation-text";
import { NumberInput } from "@/components/ui/number-input";
import { FilterEditor } from "./filter-editor";
import { Field, SmallButton, TextBackedInput, formatPath, inputCls, numOrUndef, parsePath } from "./fields";

export function MetricsTab() {
  const metrics = useTemporalSimulationStore((s) => s.metrics);
  const update = useTemporalSimulationStore((s) => s.updateMetrics);
  const explain = useTemporalSimulationStore((s) => s.explain);

  const describe = (m: Metric) => explain(explainMetric(m, matchElements(m.target, useCanvasStore.getState()).length));

  function edit(i: number, patch: Partial<Metric>) {
    const next = { ...metrics[i].metric, ...patch };
    update((ms) => { ms[i].metric = next; });
    describe(next);
  }

  return (
    <div className="space-y-3">
      {metrics.map(({ id, metric: m }, i) => (
        <div key={id} className="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700" onFocus={() => describe(m)}>
          <div className="grid grid-cols-[2fr_2fr_auto] items-end gap-2">
            <Field label="Name">
              <input className={inputCls} value={m.name} onChange={(e) => edit(i, { name: e.target.value })} />
            </Field>
            <Field label="Path (comma-separated)">
              <TextBackedInput key={`${id}-path`} initial={formatPath(m.path)} placeholder="supply_capacity, hours, level" onCommit={(t) => edit(i, { path: parsePath(t) })} />
            </Field>
            <SmallButton tone="danger" onClick={() => update((ms) => { ms.splice(i, 1); })}><Trash2 size={11} /></SmallButton>
          </div>
          {/* FilterEditor explains its own change, so this skips `describe`. */}
          <FilterEditor onExplain={explain} value={m.target} onChange={(target) => update((ms) => { ms[i].metric.target = target; })} />
          <div className="grid grid-cols-4 gap-2">
            <Field label="Read">
              <select className={inputCls} value={m.read} onChange={(e) => edit(i, { read: e.target.value as Metric["read"], phase: undefined })}>
                <option value="state">state (end of period)</option>
                <option value="change">change (after − before)</option>
              </select>
            </Field>
            <Field label="Phase (change only)">
              <input
                type="number"
                min={1}
                className={inputCls}
                disabled={m.read !== "change"}
                placeholder="whole period"
                value={m.phase ?? ""}
                onChange={(e) => edit(i, { phase: numOrUndef(e.target.value) })}
              />
            </Field>
            <Field label="Aggregate">
              <select className={inputCls} value={m.aggregate} onChange={(e) => edit(i, { aggregate: e.target.value as Metric["aggregate"] })}>
                {AggregateSchema.options.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </Field>
            {m.aggregate === "percentile" ? (
              <Field label="Percentile">
                <NumberInput min={0} max={100} className={inputCls} value={m.percentile ?? 50} onChange={(v) => edit(i, { percentile: v })} />
              </Field>
            ) : <span />}
            <Field label="Keep values (optional)" className="col-span-2">
              <div className="flex gap-1">
                <select
                  className={`${inputCls} w-16`}
                  value={m.value_filter?.cmp ?? ""}
                  onChange={(e) => edit(i, { value_filter: e.target.value ? { cmp: ComparisonSchema.parse(e.target.value), value: m.value_filter?.value ?? 0 } : undefined })}
                >
                  <option value="">all</option>
                  {ComparisonSchema.options.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <NumberInput
                  className={inputCls}
                  disabled={!m.value_filter}
                  value={m.value_filter?.value}
                  onChange={(v) => m.value_filter && edit(i, { value_filter: { cmp: m.value_filter.cmp, value: v } })}
                />
              </div>
            </Field>
          </div>
        </div>
      ))}
      <SmallButton
        tone="accent"
        onClick={() => {
          const entry: MetricEntry = {
            id: nanoid(),
            metric: { name: "", target: { kind: "node" }, path: ["functionality"], read: "state", aggregate: "mean" },
          };
          update((ms) => { ms.push(entry); });
          describe(entry.metric);
        }}
      >
        <Plus size={11} /> Add Metric
      </SmallButton>
      <p className="text-[11px] text-zinc-400">Each Metric becomes a column of the Run table.</p>
    </div>
  );
}
