"use client";

import { useTemporalSimulationStore, type StockPreview } from "@/store/temporal-simulation-store";
import { integrateStock, stockSupply } from "@/lib/stock-math";
import { explainStockField } from "@/lib/temporal-simulation-explainers";
import { Field, inputCls, numOrUndef } from "./fields";

type NumKey = keyof StockPreview;

const FIELDS: { key: NumKey; label: string; optional: boolean; placeholder?: string }[] = [
  { key: "rate", label: "rate", optional: false },
  { key: "inflow", label: "inflow", optional: true, placeholder: "= rate" },
  { key: "level", label: "level (positive = available to draw)", optional: false },
  { key: "min", label: "min", optional: true, placeholder: "0" },
  { key: "max", label: "max", optional: true, placeholder: "none" },
  { key: "max_draw", label: "max_draw", optional: true, placeholder: "no limit" },
  { key: "retention", label: "retention", optional: true, placeholder: "1" },
  { key: "efficiency", label: "efficiency", optional: true, placeholder: "1" },
];

const fmt = (x: number) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : "∞");

export function StockTab() {
  const stock = useTemporalSimulationStore((s) => s.stock);
  const updateStock = useTemporalSimulationStore((s) => s.updateStock);
  const explain = useTemporalSimulationStore((s) => s.explain);

  const { supply, draw } = stockSupply(stock);
  const offered = supply * stock.phi;
  const result = integrateStock(stock, stock.delivered, stock.phi);
  const overDelivered = stock.delivered > offered + 1e-9;

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-500">
        A sample Stock under one category of <code>supply_capacity</code>. Edit the fields and the delivery to see what the step operator would send and integrate.
        The default is a banca ore balance in its stored sign: workers are owed 20 h, the cap is 50 h.
      </p>
      <div className="grid grid-cols-4 gap-2">
        {FIELDS.map((f) => (
          <Field key={f.key} label={f.label} className={f.key === "level" ? "col-span-2" : undefined}>
            <input
              type="number"
              className={inputCls}
              placeholder={f.placeholder}
              value={stock[f.key] ?? ""}
              onFocus={() => explain(explainStockField(f.key))}
              onChange={(e) => {
                const v = numOrUndef(e.target.value);
                updateStock({ [f.key]: f.optional ? v : (v ?? 0) });
              }}
            />
          </Field>
        ))}
      </div>

      <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3 dark:border-blue-900 dark:bg-blue-900/10">
        <p className="mb-1 text-xs font-semibold text-blue-800 dark:text-blue-300">Before each propagating Phase</p>
        <p className="font-mono text-xs text-zinc-700 dark:text-zinc-300">
          supply = rate + min(max_draw, max(0, a·L + n·R − rate − m)) = {fmt(stock.rate)} + {fmt(draw)} = <b>{fmt(supply)}</b>
        </p>
        <p className="mt-1 text-[11px] text-zinc-500">
          This number replaces the Stock in the engine request. The engine applies φ to it: offered = {fmt(offered)}.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="D — delivered by the last propagating Phase">
          <input type="number" className={inputCls} value={stock.delivered} onFocus={() => explain(explainStockField("delivered"))} onChange={(e) => updateStock({ delivered: Number(e.target.value) || 0 })} />
        </Field>
        <Field label="φ — Functionality-to-capacity ratio">
          <input type="number" step={0.125} min={0} max={1} className={inputCls} value={stock.phi} onFocus={() => explain(explainStockField("phi"))} onChange={(e) => updateStock({ phi: Math.min(1, Math.max(0, Number(e.target.value) || 0)) })} />
        </Field>
      </div>
      {overDelivered && <p className="text-[11px] text-amber-700 dark:text-amber-400">D exceeds what was offered ({fmt(offered)}); the engine could not deliver that much.</p>}

      <div className="rounded-lg border border-green-200 bg-green-50/50 p-3 dark:border-green-900 dark:bg-green-900/10">
        <p className="mb-1 text-xs font-semibold text-green-800 dark:text-green-300">After the period&apos;s last propagating Phase</p>
        <p className="font-mono text-xs text-zinc-700 dark:text-zinc-300">
          L&apos; = clamp(a·L + n·φ·R − D, m, M) = <b>{fmt(result.level)}</b>
        </p>
        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
          spilled {fmt(result.spilled)} · unmet {fmt(result.unmet)}
          {(result.spilled > 0 || result.unmet > 0) && " — a clamp fired; the amount is recorded in the run, never absorbed silently."}
        </p>
      </div>
    </div>
  );
}
