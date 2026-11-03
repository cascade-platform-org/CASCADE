"use client";

import { useState } from "react";
import { scoreToColor } from "@/lib/colors";
import { formatMetric } from "@/lib/temporal-metrics";
import { sweepMap, sweptParameters, sweptValues, type Comparison, type Statistic } from "@/lib/temporal-comparison";
import { cn } from "@/lib/utils";
import { inputCls } from "./fields";

const GRADIENT = [0, 0.25, 0.5, 0.75, 1].map(scoreToColor).join(", ");

/**
 * The Sweep Map: a statistic of one Metric over two swept Parameters, one cell
 * per run, the other swept Parameters held at a chosen value (ADR-0019,
 * revision 2026-11-03). Colours run light to dark from the lowest value to the
 * highest; hovering a cell gives its values.
 */
export function SweepMap({ comparison, metric, statistic, statisticLabel }: { comparison: Comparison; metric: string; statistic: Statistic; statisticLabel: string }) {
  const swept = sweptParameters(comparison);
  const [pickedX, setX] = useState<string | null>(null);
  const [pickedY, setY] = useState<string | null>(null);
  const [held, setHeld] = useState<Record<string, number>>({});
  const x = pickedX && swept.includes(pickedX) ? pickedX : swept[0];
  const y = pickedY && swept.includes(pickedY) && pickedY !== x ? pickedY : swept.find((p) => p !== x);
  if (y === undefined) return null;
  const others = swept.filter((p) => p !== x && p !== y);
  const fixed = Object.fromEntries(others.map((p) => {
    const values = sweptValues(comparison, p);
    return [p, values.includes(held[p]) ? held[p] : values[0]];
  }));
  const map = sweepMap(comparison, metric, statistic, x, y, fixed);
  if (map.lo === null || map.hi === null) return null;
  const { lo, hi } = map;
  const color = (v: number) => scoreToColor(hi === lo ? 1 : (v - lo) / (hi - lo));
  // Picking the other axis's Parameter swaps the two.
  const pickX = (p: string) => { if (p === y) setY(x); setX(p); };
  const pickY = (p: string) => { if (p === x) setX(y); setY(p); };
  const select = (value: string, onChange: (p: string) => void) => (
    <select className={cn(inputCls, "w-auto font-mono")} value={value} onChange={(e) => onChange(e.target.value)}>
      {swept.map((p) => <option key={p} value={p}>{p}</option>)}
    </select>
  );

  return (
    <figure className="rounded-md border border-zinc-200 p-2 dark:border-zinc-700">
      <figcaption className="mb-1 flex flex-wrap items-center gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-300">
        {metric} — {statisticLabel.toLowerCase()} of the run, over {select(x, pickX)} across and {select(y, pickY)} up
        {others.map((p) => (
          <span key={p} className="flex items-center gap-1">
            at <span className="font-mono">{p}</span> =
            <select className={cn(inputCls, "w-auto font-mono")} value={fixed[p]} onChange={(e) => setHeld({ ...held, [p]: Number(e.target.value) })}>
              {sweptValues(comparison, p).map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </span>
        ))}
      </figcaption>
      <div className="flex gap-2">
        <div className="flex w-16 shrink-0 flex-col justify-between text-right text-[10px] tabular-nums text-zinc-400">
          <span>{y} = {map.ys[map.ys.length - 1]}</span>
          <span>{map.ys[0]}</span>
        </div>
        <div
          className="grid h-48 flex-1 gap-px"
          style={{ gridTemplateColumns: `repeat(${map.xs.length}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${map.ys.length}, minmax(0, 1fr))` }}
          role="img"
          aria-label={`${metric} over ${x} and ${y}`}
        >
          {/* The highest value of y on top. */}
          {[...map.cells].reverse().flatMap((row, r) => row.map((v, j) => {
            const at = `${x} = ${map.xs[j]}, ${y} = ${map.ys[map.ys.length - 1 - r]}`;
            return (
              <span
                key={`${r}-${j}`}
                title={`${at}: ${v === null ? "no value" : formatMetric(v)}`}
                className={cn("rounded-[1px]", v === null && "bg-zinc-100 dark:bg-zinc-800")}
                style={v === null ? undefined : { backgroundColor: color(v) }}
              />
            );
          }))}
        </div>
      </div>
      <div className="ml-[4.5rem] flex justify-between text-[10px] tabular-nums text-zinc-400">
        <span>{x} = {map.xs[0]}</span>
        <span>{map.xs[map.xs.length - 1]}</span>
      </div>
      <div className="ml-[4.5rem] mt-1 flex items-center gap-2 text-[10px] tabular-nums text-zinc-400">
        <span>{formatMetric(lo)}</span>
        <span className="h-2 w-32 rounded-sm" style={{ backgroundImage: `linear-gradient(to right, ${GRADIENT})` }} />
        <span>{formatMetric(hi)}</span>
      </div>
    </figure>
  );
}
