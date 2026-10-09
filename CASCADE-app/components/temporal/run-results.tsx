"use client";

import { brandColor } from "@/lib/brand";
import { formatMetric, type ColumnSummary, type RunTable } from "@/lib/temporal-metrics";

/**
 * A finished run's Metrics, one card each: the value at the selected period,
 * the minimum, mean and maximum across the run, and the run as a sparkline.
 * Clicking a sparkline selects the period under the pointer, as a table row does.
 */
export function RunResults({
  table,
  summaries,
  selected,
  onSelect,
}: {
  table: RunTable;
  summaries: readonly ColumnSummary[];
  /** 1-based period shown on the canvas. */
  selected: number;
  onSelect: (period: number) => void;
}) {
  const label = table.rows[selected - 1]?.label ?? "";
  return (
    <section aria-label="Run results" className="rounded-md border border-zinc-200 p-2 dark:border-zinc-700">
      <p className="mb-2 text-xs font-medium text-zinc-600 dark:text-zinc-300">
        Results at <span className="text-zinc-900 dark:text-zinc-100">{label}</span>
        <span className="ml-2 font-normal text-zinc-400">click a period row or a sparkline to move</span>
      </p>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2">
        {table.columns.map((c, i) => {
          const s = summaries[i];
          return (
            <div key={c.key} className="rounded border border-zinc-100 bg-zinc-50 px-2 py-1.5 dark:border-zinc-800 dark:bg-zinc-800/40">
              <p className="truncate text-[11px] text-zinc-500" title={c.label}>{c.label}</p>
              <p className="text-base font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{formatMetric(s.values[selected - 1] ?? null)}</p>
              <Sparkline values={s.values} selected={selected} onSelect={onSelect} />
              <p className="text-[10px] tabular-nums text-zinc-400">
                min {formatMetric(s.min)} · mean {formatMetric(s.mean)} · max {formatMetric(s.max)}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

const W = 100;
const H = 24;

function Sparkline({ values, selected, onSelect }: { values: readonly (number | null)[]; selected: number; onSelect: (period: number) => void }) {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return <div className="h-6" />;
  const lo = Math.min(...present);
  const span = Math.max(...present) - lo || 1;
  const x = (i: number) => (values.length > 1 ? (i / (values.length - 1)) * W : W / 2);
  const y = (v: number) => H - 2 - ((v - lo) / span) * (H - 4);
  // A gap (no value) breaks the line.
  const segments: string[] = [];
  let current: string[] = [];
  values.forEach((v, i) => {
    if (v === null) { if (current.length) segments.push(current.join(" ")); current = []; return; }
    current.push(`${x(i).toFixed(2)},${y(v).toFixed(2)}`);
  });
  if (current.length) segments.push(current.join(" "));
  const at = values[selected - 1];
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="h-6 w-full cursor-pointer"
      role="img"
      aria-label="The Metric across the run"
      onClick={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        const ratio = (e.clientX - box.left) / Math.max(1, box.width);
        onSelect(Math.min(values.length, Math.max(1, Math.round(ratio * (values.length - 1)) + 1)));
      }}
    >
      {segments.map((points, i) => (
        <polyline key={i} points={points} fill="none" stroke={brandColor("accent", 500)} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      ))}
      <line x1={x(selected - 1)} x2={x(selected - 1)} y1={0} y2={H} stroke={brandColor("neutral", 400)} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      {at !== null && at !== undefined && <circle cx={x(selected - 1)} cy={y(at)} r={1.8} fill={brandColor("accent", 700)} />}
    </svg>
  );
}
