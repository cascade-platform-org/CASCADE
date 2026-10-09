"use client";

import { useMemo, useState } from "react";
import { Download, GitCompare, Square } from "lucide-react";
import { useTemporalSimulationStore } from "@/store/temporal-simulation-store";
import { useAuthStore } from "@/store/auth-store";
import { useUiStore } from "@/store/ui-store";
import { brandColor } from "@/lib/brand";
import { CATEGORY_COLORS } from "@/lib/colors";
import { formatMetric } from "@/lib/temporal-metrics";
import { STATISTICS, compareRuns, type Comparison, type Statistic } from "@/lib/temporal-comparison";
import { cancelComparison, exportComparisonCsv, startComparison } from "@/lib/temporal-simulation-run";
import { EXPLAIN_COMPARE, explainStatistic } from "@/lib/temporal-simulation-explainers";
import { Notices, Segmented, SmallButton } from "./fields";

const STATISTIC_LABEL: Record<Statistic, string> = { end: "End", mean: "Mean", min: "Min", max: "Max", total: "Total" };
// Three hues apart (the palette is ten even hues), so neighbouring rows never get neighbouring colours.
const colorOf = (i: number) => CATEGORY_COLORS[(i * 3) % CATEGORY_COLORS.length];

/** The first column whose values differ somewhere: a flat one makes an empty-looking chart. */
function firstVarying(c: Comparison): string | null {
  const varies = (col: string) => new Set(c.rows.flatMap((r) => (r.series[col] ?? []).filter((v) => v !== null))).size > 1;
  return c.columns.find(varies) ?? c.columns[0] ?? null;
}

/**
 * Several Temporal Simulations side by side: tick them, run them all (each on
 * its own Reset copy, as Run does, without the Run View), then read one
 * statistic per Metric in a table and one Metric over time in a chart.
 */
export function CompareTab() {
  const simulations = useTemporalSimulationStore((s) => s.simulations);
  const progress = useTemporalSimulationStore((s) => s.compareProgress);
  const runBusy = useTemporalSimulationStore((s) => s.runProgress !== null);
  const result = useTemporalSimulationStore((s) => s.comparison);
  const canPropagate = useAuthStore((s) => s.hasPermission("can_propagate"));
  const serverReachable = useUiStore((s) => s.serverReachable);
  const { explain } = useTemporalSimulationStore.getState();

  // Unticked Simulations; every saved one starts ticked.
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set());
  const ticked = simulations.filter((x) => !unticked.has(x.id)).map((x) => x.id);
  const [statistic, setStatistic] = useState<Statistic>("mean");
  const comparison = useMemo(() => (result ? compareRuns(result.runs) : null), [result]);
  const [chosen, setChosen] = useState<string | null>(null);
  const metric = comparison && chosen && comparison.columns.includes(chosen) ? chosen : comparison ? firstVarying(comparison) : null;
  const stale = result !== null && result.from !== simulations;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Temporal Simulations to compare</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {simulations.map((x) => (
            <label key={x.id} className="flex items-center gap-1.5 text-xs text-zinc-700 dark:text-zinc-200">
              <input
                type="checkbox"
                checked={!unticked.has(x.id)}
                onChange={(e) => setUnticked((prev) => {
                  const next = new Set(prev);
                  if (e.target.checked) next.delete(x.id); else next.add(x.id);
                  return next;
                })}
              />
              {x.timeline.name || x.id}
            </label>
          ))}
          {simulations.length === 0 && <span className="text-xs text-zinc-400">This project has no saved Temporal Simulation yet.</span>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SmallButton
          tone="accent"
          disabled={ticked.length < 2 || progress !== null || runBusy || !canPropagate || !serverReachable}
          title={!canPropagate ? "Comparing needs an account allowed to Propagate" : !serverReachable ? "Server unreachable" : ticked.length < 2 ? "Tick at least two" : undefined}
          onClick={() => { explain(EXPLAIN_COMPARE); void startComparison(ticked); }}
        >
          <GitCompare size={11} /> Compare {ticked.length}
        </SmallButton>
        <span className="text-xs text-zinc-500">Each runs from the Reset model at the shared scope; the Run View and the model are untouched.</span>
      </div>

      {progress && (
        <div role="status" className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 p-2 text-xs text-blue-800 dark:border-blue-900 dark:bg-blue-900/20 dark:text-blue-300">
          <span className="min-w-0 shrink truncate">Comparing {progress.label && `· ${progress.label}`}</span>
          <progress className="h-1.5 flex-1" max={Math.max(1, progress.total)} value={progress.done} />
          <span className="shrink-0 tabular-nums">{progress.done} / {progress.total} Propagations</span>
          <SmallButton onClick={cancelComparison}><Square size={10} /> Cancel</SmallButton>
        </div>
      )}

      {stale && <Notices tone="warning" items={["The Temporal Simulations changed since this comparison. Compare again to update it."]} />}

      {comparison && comparison.rows.length > 0 && (
        <>
          <Notices tone="error" items={comparison.rows.filter((r) => r.error).map((r) => `${r.name}: ${r.error}`)} />
          <Notices tone="warning" items={comparison.rows.filter((r) => r.warnings.length > 0).map((r) => `${r.name}: ${r.warnings.length} warning${r.warnings.length > 1 ? "s" : ""}, first: ${r.warnings[0]}`)} />
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Each cell is the run&apos;s</span>
            <Segmented
              value={statistic}
              options={STATISTICS.map((id) => ({ id, label: STATISTIC_LABEL[id] }))}
              onChange={(v) => { setStatistic(v); explain(explainStatistic(v)); }}
            />
            <span className="flex-1" />
            <SmallButton onClick={() => void exportComparisonCsv(comparison)}><Download size={11} /> Export CSV</SmallButton>
          </div>
          <SummaryTable comparison={comparison} statistic={statistic} metric={metric} onPick={setChosen} />
          {metric && <ComparisonChart comparison={comparison} metric={metric} />}
        </>
      )}
    </div>
  );
}

function SummaryTable({ comparison, statistic, metric, onPick }: { comparison: Comparison; statistic: Statistic; metric: string | null; onPick: (m: string) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-zinc-200 text-left text-[10px] uppercase tracking-wider text-zinc-400 dark:border-zinc-700">
            <th className="py-1 pr-2 font-semibold">Temporal Simulation</th>
            {comparison.columns.map((c) => (
              <th key={c} className="py-1 pr-2 text-right font-semibold">
                <button
                  type="button"
                  title="Show this Metric over time in the chart"
                  onClick={() => onPick(c)}
                  className={c === metric ? "text-blue-700 underline dark:text-blue-300" : "hover:text-zinc-600 dark:hover:text-zinc-200"}
                >
                  {c}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {comparison.rows.map((row, i) => (
            <tr key={row.id} className="border-b border-zinc-100 dark:border-zinc-800">
              <td className="min-w-[14rem] py-1 pr-2 font-medium text-zinc-700 dark:text-zinc-200">
                <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ backgroundColor: colorOf(i) }} />
                {row.name}
              </td>
              {comparison.columns.map((c) => (
                <td key={c} className="py-1 pr-2 text-right tabular-nums text-zinc-700 dark:text-zinc-200">
                  {row.stats[c] ? formatMetric(row.stats[c][statistic]) : <span className="text-zinc-300">—</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[11px] text-zinc-400">Click a Metric&apos;s name to chart it. A Metric a Temporal Simulation does not define shows —.</p>
    </div>
  );
}

const W = 600;
const H = 160;
const PAD = 4;

/** One Metric over time, a line per Temporal Simulation, on a shared scale. */
function ComparisonChart({ comparison, metric }: { comparison: Comparison; metric: string }) {
  const lines = comparison.rows.map((row, i) => ({ row, color: colorOf(i), values: row.series[metric] ?? [] }));
  const all = lines.flatMap((l) => l.values.filter((v): v is number => v !== null));
  if (all.length === 0) return null;
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  // A flat Metric draws mid-height.
  const span = hi - lo || 1;
  const flat = hi === lo;
  const longest = Math.max(...lines.map((l) => l.values.length));
  const x = (i: number) => (longest > 1 ? (i / (longest - 1)) * W : W / 2);
  const y = (v: number) => (flat ? H / 2 : H - PAD - ((v - lo) / span) * (H - 2 * PAD));
  const periods = lines.find((l) => l.values.length === longest)?.row.periods ?? [];
  const zero = lo < 0 && hi > 0 ? y(0) : null;

  return (
    <figure className="rounded-md border border-zinc-200 p-2 dark:border-zinc-700">
      <figcaption className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-300">{metric}</figcaption>
      <div className="flex gap-2">
        <div className="flex w-16 shrink-0 flex-col justify-between text-right text-[10px] tabular-nums text-zinc-400">
          <span>{formatMetric(hi)}</span>
          <span>{formatMetric(lo)}</span>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-40 w-full" role="img" aria-label={`${metric} over time, one line per Temporal Simulation`}>
          {zero !== null && <line x1={0} x2={W} y1={zero} y2={zero} stroke={brandColor("neutral", 300)} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />}
          {lines.map(({ row, color, values }) => {
            const segments: string[] = [];
            let current: string[] = [];
            values.forEach((v, i) => {
              if (v === null) { if (current.length) segments.push(current.join(" ")); current = []; return; }
              current.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
            });
            if (current.length) segments.push(current.join(" "));
            return segments.map((points, k) => (
              <polyline key={`${row.id}-${k}`} points={points} fill="none" stroke={color} strokeWidth={1.75} vectorEffect="non-scaling-stroke" />
            ));
          })}
        </svg>
      </div>
      <div className="ml-[4.5rem] flex justify-between text-[10px] text-zinc-400">
        <span>{periods[0]}</span>
        <span>{periods[periods.length - 1]}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
        {lines.map(({ row, color }) => (
          <span key={row.id} className="flex items-center gap-1 text-[10px] text-zinc-500">
            <span className="h-0.5 w-3" style={{ backgroundColor: color }} />{row.name}
          </span>
        ))}
      </div>
    </figure>
  );
}
