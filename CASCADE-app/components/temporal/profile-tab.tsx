"use client";

import { useMemo } from "react";
import { Plus, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";
import { useCanvasStore } from "@/store/canvas-store";
import { useTemporalSimulationStore, type ProfileRowDraft } from "@/store/temporal-simulation-store";
import { planTimeline } from "@/lib/timeline-plan";
import { explainProfileRow } from "@/lib/temporal-simulation-explainers";
import { SmallButton, inputCls } from "./fields";

const OPS: ProfileRowDraft["op"][] = ["set", "add", "mul", "at_most", "at_least"];

export function ProfileTab() {
  const timeline = useTemporalSimulationStore((s) => s.timeline);
  const rows = useTemporalSimulationStore((s) => s.profile);
  const update = useTemporalSimulationStore((s) => s.updateProfile);
  const explain = useTemporalSimulationStore((s) => s.explain);
  const nodes = useCanvasStore((s) => s.nodes);

  const labels = useMemo(() => planTimeline(timeline).periods.map((p) => p.label), [timeline]);
  const nodeList = useMemo(
    () => Object.values(nodes).map((n) => ({ id: n.id, label: n.label || n.id })).sort((a, b) => a.label.localeCompare(b.label)),
    [nodes],
  );

  function edit(i: number, patch: Partial<ProfileRowDraft>) {
    update((r) => { Object.assign(r[i], patch); });
    const row = { ...rows[i], ...patch };
    explain(explainProfileRow(row.op, row.path, labels.includes(row.label)));
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">
        One row per operation: at the start of period <em>label</em>, apply <em>op value</em> to the field at <em>path</em> of <em>element</em>.
      </p>
      {rows.length > 0 && (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-400">
              <th className="pb-1 font-semibold">Period</th>
              <th className="pb-1 font-semibold">Element</th>
              <th className="pb-1 font-semibold">Path</th>
              <th className="pb-1 font-semibold">Op</th>
              <th className="pb-1 font-semibold">Value</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const used = labels.includes(row.label);
              return (
                <tr key={row.id} className="align-top">
                  <td className="pr-1 pb-1">
                    <select className={used ? inputCls : `${inputCls} border-amber-400`} value={row.label} onChange={(e) => edit(i, { label: e.target.value })}>
                      {!used && <option value={row.label}>{row.label} (unused)</option>}
                      {labels.map((l) => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </td>
                  <td className="pr-1 pb-1">
                    <select className={inputCls} value={row.element} onChange={(e) => edit(i, { element: e.target.value })}>
                      <option value="">—</option>
                      {nodeList.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
                    </select>
                  </td>
                  <td className="pr-1 pb-1">
                    <input className={inputCls} value={row.path} onChange={(e) => edit(i, { path: e.target.value })} onFocus={() => explain(explainProfileRow(row.op, row.path, used))} />
                  </td>
                  <td className="pr-1 pb-1">
                    <select className={inputCls} value={row.op} onChange={(e) => edit(i, { op: e.target.value as ProfileRowDraft["op"] })}>
                      {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </td>
                  <td className="pr-1 pb-1">
                    <input className={inputCls} value={row.value} onChange={(e) => edit(i, { value: e.target.value })} onFocus={() => explain(explainProfileRow(row.op, row.path, used))} />
                  </td>
                  <td className="pb-1">
                    <button type="button" className="mt-1 text-zinc-400 hover:text-red-600" onClick={() => update((r) => { r.splice(i, 1); })}>
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <SmallButton
        tone="accent"
        onClick={() => {
          const row: ProfileRowDraft = { id: nanoid(), label: labels[0] ?? "", element: "", path: "supply_capacity, hours, rate", op: "set", value: "" };
          update((r) => { r.push(row); });
          explain(explainProfileRow(row.op, row.path, labels.includes(row.label)));
        }}
      >
        <Plus size={11} /> Add profile operation
      </SmallButton>
    </div>
  );
}
