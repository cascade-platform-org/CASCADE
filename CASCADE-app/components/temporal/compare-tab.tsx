"use client";

import { useMemo, useState } from "react";
import { Download, GitCompare, Plus, Square, X } from "lucide-react";
import { useTemporalSimulationStore } from "@/store/temporal-simulation-store";
import { usePropagationGate } from "@/hooks/usePropagate";
import { brandColor } from "@/lib/brand";
import { CATEGORY_COLORS } from "@/lib/colors";
import { formatMetric } from "@/lib/temporal-metrics";
import { STATISTICS, compareRuns, sweptParameters, type Comparison, type Statistic } from "@/lib/temporal-comparison";
import { cancelComparison, exportComparisonCsv, startComparison } from "@/lib/temporal-simulation-run";
import { MAX_SWEEP_RUNS, compareRequests, parameterReads, parseSweepValues, pointLabel, sweepSize, type SweepAxis } from "@/lib/temporal-sweep";
import { useConfigStore } from "@/store/config-store";
import { cn } from "@/lib/utils";
import type { StoredTemporalSimulation } from "@/lib/schemas/temporal-simulation";
import { EXPLAIN_COMPARE, explainStatistic } from "@/lib/temporal-simulation-explainers";
import { Notices, Segmented, SmallButton, inputCls } from "./fields";
import { SweepMap } from "./sweep-map";

const STATISTIC_LABEL: Record<Statistic, string> = { end: "End", mean: "Mean", min: "Min", max: "Max", total: "Total" };
// Three hues apart (the palette is ten even hues), so neighbouring rows never get neighbouring colours.
const colorOf = (i: number) => CATEGORY_COLORS[(i * 3) % CATEGORY_COLORS.length];

/** The first column whose values differ somewhere: a flat one makes an empty-looking chart. */
function firstVarying(c: Comparison): string | null {
  const varies = (col: string) => new Set(c.rows.flatMap((r) => (r.values[col] ?? []).filter((v) => v !== null))).size > 1;
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
  const blocked = usePropagationGate();
  const { explain } = useTemporalSimulationStore.getState();

  // Unticked Simulations; every saved one starts ticked.
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set());
  const ticked = simulations.filter((x) => !unticked.has(x.id)).map((x) => x.id);
  const [statistic, setStatistic] = useState<Statistic>("mean");
  const comparison = useMemo(() => (result ? compareRuns(result.runs) : null), [result]);
  const [sweep, setSweep] = useState<SweepDraft | null>(null);
  const axes = sweep ? parsedAxes(sweep) : null;
  const requests = compareRequests(simulations, ticked, sweep && axes ? { simulationId: sweep.simulationId, axes } : undefined);
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

      <SweepRow simulations={simulations} sweep={sweep} onChange={setSweep} />

      <div className="flex flex-wrap items-center gap-2">
        <SmallButton
          tone="accent"
          disabled={requests.length < 2 || progress !== null || runBusy || blocked !== null}
          title={blocked ?? (requests.length < 2 ? "Tick at least two, or sweep a Parameter" : undefined)}
          onClick={() => { explain(EXPLAIN_COMPARE); void startComparison(requests); }}
        >
          <GitCompare size={11} /> Compare {requests.length}
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
          {metric && comparison.rows.some((r) => r.sweep) && <SweepChart comparison={comparison} metric={metric} statistic={statistic} />}
          {metric && sweptParameters(comparison).length >= 2 && <SweepMap comparison={comparison} metric={metric} statistic={statistic} statisticLabel={STATISTIC_LABEL[statistic]} />}
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
            <tr key={`${i}-${row.id}`} className="border-b border-zinc-100 dark:border-zinc-800">
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

/** The y of a value on a chart from `lo` to `hi`; a flat range draws mid-height. */
const yScale = (lo: number, hi: number) => (v: number) => (hi === lo ? H / 2 : H - PAD - ((v - lo) / (hi - lo)) * (H - 2 * PAD));

/** A chart's frame: the caption, the y range on the left, the plot, and the x ends below. */
function ChartFrame({ caption, lo, hi, from, to, children, footer }: { caption: React.ReactNode; lo: number; hi: number; from: React.ReactNode; to: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <figure className="rounded-md border border-zinc-200 p-2 dark:border-zinc-700">
      <figcaption className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-300">{caption}</figcaption>
      <div className="flex gap-2">
        <div className="flex w-16 shrink-0 flex-col justify-between text-right text-[10px] tabular-nums text-zinc-400">
          <span>{formatMetric(hi)}</span>
          <span>{formatMetric(lo)}</span>
        </div>
        {children}
      </div>
      <div className="ml-[4.5rem] flex justify-between text-[10px] tabular-nums text-zinc-400">
        <span>{from}</span>
        <span>{to}</span>
      </div>
      {footer}
    </figure>
  );
}

/** One Metric over time, a line per Temporal Simulation, on a shared scale. */
function ComparisonChart({ comparison, metric }: { comparison: Comparison; metric: string }) {
  const lines = comparison.rows.map((row, i) => ({ key: `${i}-${row.id}`, row, color: colorOf(i), values: row.values[metric] ?? [] }));
  const all = lines.flatMap((l) => l.values.filter((v): v is number => v !== null));
  if (all.length === 0) return null;
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const longest = Math.max(...lines.map((l) => l.values.length));
  const x = (i: number) => (longest > 1 ? (i / (longest - 1)) * W : W / 2);
  const y = yScale(lo, hi);
  const periods = lines.find((l) => l.values.length === longest)?.row.periods ?? [];
  const zero = lo < 0 && hi > 0 ? y(0) : null;

  return (
    <ChartFrame
      caption={metric}
      lo={lo}
      hi={hi}
      from={periods[0]}
      to={periods[periods.length - 1]}
      footer={
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
          {lines.map(({ key, row, color }) => (
            <span key={key} className="flex items-center gap-1 text-[10px] text-zinc-500">
              <span className="h-0.5 w-3" style={{ backgroundColor: color }} />{row.name}
            </span>
          ))}
        </div>
      }
    >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-40 w-full" role="img" aria-label={`${metric} over time, one line per Temporal Simulation`}>
          {zero !== null && <line x1={0} x2={W} y1={zero} y2={zero} stroke={brandColor("neutral", 300)} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />}
          {lines.map(({ key, color, values }) => {
            const segments: string[] = [];
            let current: string[] = [];
            values.forEach((v, i) => {
              if (v === null) { if (current.length) segments.push(current.join(" ")); current = []; return; }
              current.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
            });
            if (current.length) segments.push(current.join(" "));
            return segments.map((points, k) => (
              <polyline key={`${key}-${k}`} points={points} fill="none" stroke={color} strokeWidth={1.75} vectorEffect="non-scaling-stroke" />
            ));
          })}
        </svg>
    </ChartFrame>
  );
}

/** The sweep as typed: a Simulation and, per swept Parameter, the text of its values. */
interface SweepDraft {
  simulationId: string;
  axes: { parameter: string; text: string }[];
}

/** The draft's axes when every one reads as values, else null. */
function parsedAxes(draft: SweepDraft): SweepAxis[] | null {
  const axes: SweepAxis[] = [];
  for (const axis of draft.axes) {
    const read = parseSweepValues(axis.text);
    if (!("values" in read)) return null;
    axes.push({ parameter: axis.parameter, values: read.values });
  }
  return axes.length > 0 ? axes : null;
}

/**
 * Sweep Parameters: one Simulation (one with Parameters), one or more of its
 * Parameters and the values to run each at; every combination is one more run.
 */
function SweepRow({
  simulations,
  sweep,
  onChange,
}: {
  simulations: readonly StoredTemporalSimulation[];
  sweep: SweepDraft | null;
  onChange: (s: SweepDraft | null) => void;
}) {
  const events = useConfigStore((s) => s.config.events);
  const withParameters = simulations.filter((x) => x.parameters.length > 0);
  if (withParameters.length === 0) {
    return <p className="text-[11px] text-zinc-400">To sweep a Parameter, declare one in a Temporal Simulation (Timeline tab → Parameters).</p>;
  }
  const chosen = withParameters.find((x) => x.id === sweep?.simulationId);
  const pick = (simulationId: string) => {
    const x = withParameters.find((y) => y.id === simulationId);
    onChange(x ? { simulationId, axes: [{ parameter: x.parameters[0].name, text: sweep?.axes[0]?.text ?? "" }] } : null);
  };
  const setAxis = (i: number, change: Partial<SweepDraft["axes"][number]>) =>
    sweep && onChange({ ...sweep, axes: sweep.axes.map((a, k) => (k === i ? { ...a, ...change } : a)) });
  const used = new Set(sweep?.axes.map((a) => a.parameter));
  const free = chosen?.parameters.filter((p) => !used.has(p.name)) ?? [];
  const axes = sweep ? parsedAxes(sweep) : null;
  const runs = axes ? sweepSize(axes) : 0;
  return (
    <div className="space-y-1 rounded-md border border-zinc-200 p-2 dark:border-zinc-700">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium text-zinc-600 dark:text-zinc-300">Sweep Parameters</span>
        <select className={cn(inputCls, "w-auto")} value={sweep?.simulationId ?? ""} onChange={(e) => pick(e.target.value)}>
          <option value="">none</option>
          {withParameters.map((x) => <option key={x.id} value={x.id}>{x.timeline.name || x.id}</option>)}
        </select>
        {axes && (
          <span className={runs > MAX_SWEEP_RUNS ? "text-red-600 dark:text-red-400" : "text-zinc-500"}>
            {runs} run{runs === 1 ? "" : "s"}{runs > MAX_SWEEP_RUNS && ` — at most ${MAX_SWEEP_RUNS}`}
          </span>
        )}
      </div>
      {chosen && sweep && sweep.axes.map((axis, i) => {
        const read = axis.text ? parseSweepValues(axis.text) : null;
        const reads = parameterReads(Object.values(chosen.profile).flat(), chosen.timeline.steps, axis.parameter, (id) => events.find((e) => e.id === id)?.attribute_operations ?? []);
        return (
          <div key={i} className="space-y-0.5">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <select className={cn(inputCls, "w-auto font-mono")} value={axis.parameter} onChange={(e) => setAxis(i, { parameter: e.target.value })}>
                {chosen.parameters.filter((p) => p.name === axis.parameter || !used.has(p.name)).map((p) => (
                  <option key={p.name} value={p.name}>{p.name} ({p.value})</option>
                ))}
              </select>
              <input
                className={cn(inputCls, "w-64")}
                value={axis.text}
                placeholder="0.10, 0.15, 0.20 — or 0.1 to 0.3 step 0.05"
                onChange={(e) => setAxis(i, { text: e.target.value })}
              />
              {read && "values" in read && <span className="text-zinc-500">{read.values.length} value{read.values.length === 1 ? "" : "s"}</span>}
              {sweep.axes.length > 1 && (
                <SmallButton title="Stop sweeping this Parameter" onClick={() => onChange({ ...sweep, axes: sweep.axes.filter((_, k) => k !== i) })}>
                  <X size={10} />
                </SmallButton>
              )}
            </div>
            {read && "error" in read && <p className="text-[11px] text-red-600 dark:text-red-400">{read.error}</p>}
            {reads === 0 && <p className="text-[11px] text-amber-700 dark:text-amber-400">Nothing in this Simulation reads {axis.parameter}: its values would give the same runs.</p>}
          </div>
        );
      })}
      {chosen && sweep && free.length > 0 && (
        <SmallButton title="Sweep another Parameter too: every combination of the values is one run" onClick={() => onChange({ ...sweep, axes: [...sweep.axes, { parameter: free[0].name, text: "" }] })}>
          <Plus size={10} /> Parameter
        </SmallButton>
      )}
    </div>
  );
}

/**
 * A statistic of one Metric against one swept Parameter: one point per run, and
 * one line per combination of the other swept Parameters' values.
 */
function SweepChart({ comparison, metric, statistic }: { comparison: Comparison; metric: string; statistic: Statistic }) {
  const swept = sweptParameters(comparison);
  const [picked, setPicked] = useState<string | null>(null);
  const along = picked && swept.includes(picked) ? picked : swept[0];
  const groups = new Map<string, { x: number; y: number }[]>();
  for (const r of comparison.rows) {
    const y = r.stats[metric]?.[statistic];
    const x = r.sweep?.find((p) => p.parameter === along)?.value;
    if (!r.sweep || x === undefined || y === null || y === undefined) continue;
    const key = pointLabel(r.sweep.filter((p) => p.parameter !== along));
    groups.set(key, [...(groups.get(key) ?? []), { x, y }]);
  }
  const lines = [...groups.entries()].map(([key, points], i) => ({
    key, color: groups.size === 1 ? brandColor("accent", 600) : colorOf(i), points: points.sort((a, b) => a.x - b.x),
  }));
  const all = lines.flatMap((l) => l.points);
  if (all.length === 0) return null;
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const [xl, xh] = [Math.min(...xs), Math.max(...xs)];
  const [yl, yh] = [Math.min(...ys), Math.max(...ys)];
  const px = (v: number) => (xh === xl ? W / 2 : ((v - xl) / (xh - xl)) * (W - 2 * PAD) + PAD);
  const py = yScale(yl, yh);
  const caption = (
    <span className="flex flex-wrap items-center gap-2">
      {metric} — {STATISTIC_LABEL[statistic].toLowerCase()} of the run, against
      {swept.length > 1 ? (
        <select className={cn(inputCls, "w-auto font-mono")} value={along} onChange={(e) => setPicked(e.target.value)}>
          {swept.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      ) : along}
    </span>
  );
  return (
    <ChartFrame
      caption={caption}
      lo={yl}
      hi={yh}
      from={`${along} = ${xl}`}
      to={xh}
      footer={lines.length > 1 && (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
          {lines.map(({ key, color }) => (
            <span key={key} className="flex items-center gap-1 text-[10px] text-zinc-500">
              <span className="h-0.5 w-3" style={{ backgroundColor: color }} />{key}
            </span>
          ))}
        </div>
      )}
    >
        <div className="relative h-40 w-full">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full" role="img" aria-label={`${metric} against ${along}`}>
            {lines.map(({ key, color, points }) => (
              <polyline key={key} points={points.map((p) => `${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`).join(" ")} fill="none" stroke={color} strokeWidth={1.75} vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
          {/* Markers outside the stretched SVG, so they stay round. */}
          {lines.flatMap(({ key, color, points }) => points.map((p) => (
            <span
              key={`${key}-${p.x}`}
              title={`${along} = ${p.x}${key ? `, ${key}` : ""}: ${formatMetric(p.y)}`}
              className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{ left: `${(px(p.x) / W) * 100}%`, top: `${(py(p.y) / H) * 100}%`, backgroundColor: color }}
            />
          )))}
        </div>
    </ChartFrame>
  );
}
