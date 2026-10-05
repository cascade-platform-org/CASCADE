"use client";

import { Plus, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";
import { useTemporalSimulationStore, type MetricDraft } from "@/store/temporal-simulation-store";
import { explainMetric } from "@/lib/temporal-simulation-explainers";
import { Field, SmallButton, inputCls } from "./fields";

const TARGETS = ["all", "Source", "Infrastructure", "Service", "Personnel"];
const AGGREGATES: MetricDraft["aggregate"][] = ["sum", "mean", "min", "max", "count", "share_where", "percentile"];

export function MetricsTab() {
  const metrics = useTemporalSimulationStore((s) => s.metrics);
  const update = useTemporalSimulationStore((s) => s.updateMetrics);
  const explain = useTemporalSimulationStore((s) => s.explain);

  function edit(i: number, patch: Partial<MetricDraft>) {
    update((m) => { Object.assign(m[i], patch); });
    explain(explainMetric({ ...metrics[i], ...patch }));
  }

  return (
    <div className="space-y-3">
      {metrics.map((m, i) => (
        <div key={m.id} className="grid grid-cols-4 gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700" onFocus={() => explain(explainMetric(m))}>
          <Field label="Name" className="col-span-2">
            <input className={inputCls} value={m.name} onChange={(e) => edit(i, { name: e.target.value })} />
          </Field>
          <Field label="Target nodes">
            <select className={inputCls} value={m.target} onChange={(e) => edit(i, { target: e.target.value })}>
              {TARGETS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Attribute">
            <input className={inputCls} placeholder="e.g. supply_capacity.hours.level" value={m.attribute} onChange={(e) => edit(i, { attribute: e.target.value })} />
          </Field>
          <Field label="Read">
            <select className={inputCls} value={m.read} onChange={(e) => edit(i, { read: e.target.value as MetricDraft["read"] })}>
              <option value="state">state (end of period)</option>
              <option value="change">change (after − before)</option>
            </select>
          </Field>
          <Field label="Phase (change only)">
            <input className={inputCls} disabled={m.read !== "change"} placeholder="whole period" value={m.phase} onChange={(e) => edit(i, { phase: e.target.value })} />
          </Field>
          <Field label="Aggregate">
            <select className={inputCls} value={m.aggregate} onChange={(e) => edit(i, { aggregate: e.target.value as MetricDraft["aggregate"] })}>
              {AGGREGATES.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </Field>
          <Field label="Filter (optional)">
            <input className={inputCls} placeholder="e.g. < 0" value={m.filter} onChange={(e) => edit(i, { filter: e.target.value })} />
          </Field>
          <div className="col-span-4 flex justify-end">
            <SmallButton tone="danger" onClick={() => update((ms) => { ms.splice(i, 1); })}><Trash2 size={11} /> Remove</SmallButton>
          </div>
        </div>
      ))}
      <SmallButton
        tone="accent"
        onClick={() => {
          const m: MetricDraft = { id: nanoid(), name: "", target: "all", attribute: "", read: "state", phase: "", aggregate: "sum", filter: "" };
          update((ms) => { ms.push(m); });
          explain(explainMetric(m));
        }}
      >
        <Plus size={11} /> Add Metric
      </SmallButton>
      <p className="text-[11px] text-zinc-400">Each Metric becomes a column of the Run table.</p>
    </div>
  );
}
