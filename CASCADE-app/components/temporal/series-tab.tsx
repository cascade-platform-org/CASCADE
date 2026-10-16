"use client";

/**
 * SeriesTab — the project's Series (ADR-0019, revised 2026-10-12): tables of
 * numbers by Element and period label that operations read as a factor. They
 * belong to the project, so every Temporal Simulation reads the same ones; the
 * columns shown are the selected Simulation's periods and any label a Series
 * already holds. A cell a run would read but that is empty is marked.
 */

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useProjectDataStore } from "@/store/project-data-store";
import { useTemporalSimulationStore } from "@/store/temporal-simulation-store";
import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore } from "@/store/config-store";
import { elementLabel } from "@/lib/coalition";
import { orphanRows, parseBlock, seriesGaps, seriesLabels, seriesReaders, withoutRows, writeBlock } from "@/lib/series-edit";
import { ALL_ELEMENTS, type Series } from "@/lib/schemas/series";
import { EXPLAIN_TAB } from "@/lib/temporal-simulation-explainers";
import { cn } from "@/lib/utils";
import { Field, Notices, SmallButton, TextBackedInput, inputCls, usePlan } from "./fields";

export function SeriesTab() {
  const series = useProjectDataStore((s) => s.series);
  const simulations = useTemporalSimulationStore((s) => s.simulations);
  const events = useConfigStore((s) => s.config.events);
  const { addSeries, removeSeries } = useProjectDataStore.getState();
  const [chosen, setChosen] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const selected = series.find((x) => x.name === chosen) ?? series[0] ?? null;
  const readers = useMemo(() => (selected ? seriesReaders(selected.name, simulations, events) : null), [selected, simulations, events]);

  return (
    <div className="space-y-3" onFocus={() => useTemporalSimulationStore.getState().explain(EXPLAIN_TAB.series)}>
      <p className="text-[11px] text-zinc-500">
        Series belong to the project: every Temporal Simulation reads the same ones. A profile row or an Event operation reads one with
        <em> × Series</em>, at this Element&apos;s row (or the <code>*</code> row) and the label of the period being run.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select className={cn(inputCls, "w-auto")} value={selected?.name ?? ""} onChange={(e) => setChosen(e.target.value)} disabled={series.length === 0}>
          {series.length === 0 && <option value="">No Series yet</option>}
          {series.map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}
        </select>
        <SmallButton onClick={() => { const name = addSeries(); if (name) setChosen(name); }}>
          <Plus size={11} /> New Series
        </SmallButton>
        {selected && (
          <SmallButton tone="danger" onClick={() => { setProblem(removeSeries(selected.name)); setChosen(null); }}>
            <Trash2 size={11} /> Delete
          </SmallButton>
        )}
      </div>
      <Notices tone="error" items={problem ? [problem] : []} />
      {selected && readers && <SeriesEditor key={selected.name} series={selected} readers={readers} onProblem={setProblem} onRenamed={setChosen} />}
    </div>
  );
}

function SeriesEditor({
  series,
  readers,
  onProblem,
  onRenamed,
}: {
  series: Series;
  readers: ReturnType<typeof seriesReaders>;
  onProblem: (p: string | null) => void;
  onRenamed: (name: string) => void;
}) {
  const { setSeries, renameSeries } = useProjectDataStore.getState();
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const plan = usePlan();
  const [adding, setAdding] = useState("");

  const planLabels = useMemo(() => plan.periods.map((p) => p.label), [plan]);
  const inPlan = useMemo(() => new Set(planLabels), [planLabels]);
  const labels = useMemo(() => [...planLabels, ...seriesLabels(series).filter((l) => !inPlan.has(l)).sort()], [series, planLabels, inPlan]);
  const rowKeys = Object.keys(series.rows);
  // Row key → the labels a run would read but the row has no value for.
  const gaps = useMemo(() => new Map([...seriesGaps(series, planLabels)].map(([k, ls]) => [k, new Set(ls)])), [series, planLabels]);
  const orphans = useMemo(() => orphanRows(series, (id) => id in nodes || id in edges), [series, nodes, edges]);
  const orphanSet = useMemo(() => new Set(orphans), [orphans]);
  const name = (key: string) => (key === ALL_ELEMENTS ? "* (every other Element)" : elementLabel({ nodes, edges }, key));
  const save = (next: Series) => onProblem(setSeries(series.name, next));

  const write = (rowIndex: number, labelIndex: number, text: string) => {
    const block = parseBlock(text);
    if ("error" in block) return onProblem(block.error);
    save(writeBlock(series, rowKeys.slice(rowIndex), labels.slice(labelIndex), block.cells));
  };

  const candidates = useMemo(() => [...Object.keys(nodes), ...Object.keys(edges)].filter((id) => !(id in series.rows)), [nodes, edges, series]);
  const readBy = [
    ...readers.simulations.map(([n, k]) => `${n} (${k} operation${k === 1 ? "" : "s"})`),
    ...readers.events.map(([n, k]) => `Event ${n} (${k})`),
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[1fr_0.6fr_2fr] gap-2">
        <Field label="Name">
          <TextBackedInput
            initial={series.name}
            className={cn(inputCls, "font-mono")}
            onCommit={(t) => {
              const next = t.trim();
              const why = renameSeries(series.name, next);
              onProblem(why);
              if (!why) onRenamed(next);
            }}
          />
        </Field>
        <Field label="Unit">
          <TextBackedInput initial={series.unit ?? ""} placeholder="h" onCommit={(t) => save({ ...series, unit: t.trim() || undefined })} />
        </Field>
        <Field label="Description">
          <TextBackedInput initial={series.description ?? ""} placeholder="where the numbers come from" onCommit={(t) => save({ ...series, description: t.trim() || undefined })} />
        </Field>
      </div>

      <p className="text-[11px] text-zinc-500">
        {readBy.length ? `Read by ${readBy.join(", ")}.` : "Nothing reads it yet: choose it as × Series on a profile row or an Event operation."}
        {readers.events.length > 0 && " A rename follows into the Temporal Simulations; rename it in those Events in Config → Events."}
      </p>

      {orphans.length > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          <span className="flex-1">{orphans.length} row{orphans.length === 1 ? "" : "s"} for Elements no longer in the model ({orphans.slice(0, 3).join(", ")}{orphans.length > 3 ? "…" : ""}). An undo of their deletion brings them back.</span>
          <SmallButton onClick={() => save(withoutRows(series, orphans))}>Remove those rows</SmallButton>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
        <table className="text-[11px]">
          <thead>
            <tr className="text-left text-[10px] text-zinc-400">
              <th className="sticky left-0 z-10 bg-white px-2 py-1 font-semibold dark:bg-zinc-900">Element</th>
              {labels.map((l) => (
                <th key={l} className={cn("px-1 py-1 font-medium", !inPlan.has(l) && "italic text-zinc-300")} title={inPlan.has(l) ? "A period of this Simulation" : "Not a period of this Simulation"}>
                  {l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowKeys.map((key, ri) => (
              <tr key={key} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className={cn("sticky left-0 z-10 max-w-[12rem] truncate bg-white px-2 dark:bg-zinc-900", orphanSet.has(key) && "text-amber-600")} title={key}>
                  {name(key)}
                  <button type="button" title="Remove row" className="ml-1 text-zinc-300 hover:text-red-600" onClick={() => save(withoutRows(series, [key]))}>×</button>
                </td>
                {labels.map((l, li) => {
                  const value = series.rows[key][l];
                  const gap = value === undefined && gaps.get(key)?.has(l);
                  return (
                    <td key={l} className="p-px">
                      <input
                        key={`${key}-${l}-${value ?? ""}`}
                        defaultValue={value ?? ""}
                        className={cn("h-6 w-16 rounded-sm border border-zinc-200 bg-white px-1 text-right tabular-nums focus:border-blue-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900", gap && "border-amber-300 bg-amber-50 dark:bg-amber-900/20")}
                        title={gap ? "No value: an operation reading this Series for this Element in this period is refused" : undefined}
                        onBlur={(e) => { if (e.target.value !== String(value ?? "")) write(ri, li, e.target.value); }}
                        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                        onPaste={(e) => {
                          const text = e.clipboardData.getData("text");
                          if (!/[\t\n;]/.test(text.replace(/\r?\n$/, ""))) return;
                          e.preventDefault();
                          write(ri, li, text);
                        }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {rowKeys.length === 0 && <p className="p-2 text-[11px] text-zinc-400">No rows yet: add one per Element, or a * row for every Element without its own.</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select className={cn(inputCls, "w-auto")} value={adding} onChange={(e) => setAdding(e.target.value)}>
          <option value="">Add a row for…</option>
          {!(ALL_ELEMENTS in series.rows) && <option value={ALL_ELEMENTS}>* (every Element without its own row)</option>}
          {candidates.map((id) => <option key={id} value={id}>{name(id)}</option>)}
        </select>
        <SmallButton disabled={!adding} onClick={() => { save({ ...series, rows: { ...series.rows, [adding]: {} } }); setAdding(""); }}>
          <Plus size={11} /> Add row
        </SmallButton>
        <span className="text-[10px] text-zinc-400">Paste a block copied from a spreadsheet into a cell: it fills the rows below and the periods after.</span>
      </div>
    </div>
  );
}
