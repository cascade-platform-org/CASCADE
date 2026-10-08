"use client";

/**
 * TimelineGrid — the Timeline at a glance with its profile underneath, on the
 * same period columns.
 *
 * Top: Steps, then per period each Phase's Events above a bar that is filled
 * when the Phase propagates, and the label. Below:
 * one row per profile operation, one cell per period. A write stays until
 * something changes it (ADR-0019 §2), so an empty cell of a `set` row shows the
 * carried value in grey. Built from `planTimeline`, like the Run tab, so the
 * grid and a run cannot disagree.
 */

import { memo, useCallback, useMemo, useState } from "react";
import { Clock, Plus } from "lucide-react";
import { nanoid } from "nanoid";
import { useShallow } from "zustand/react/shallow";
import { cn } from "@/lib/utils";
import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore } from "@/store/config-store";
import { useTemporalSimulationStore } from "@/store/temporal-simulation-store";
import type { PlannedPeriod } from "@/lib/timeline-plan";
import { filterConditions, filterLabel, type FilterableModel } from "@/lib/element-filter";
import type { ProfileRow } from "@/lib/temporal-simulation-text";
import { valueFitsOp, type AttributeOperation } from "@/lib/schemas/attribute-operation";
import { EXPLAIN_STRIP, explainSelectPeriod } from "@/lib/temporal-simulation-explainers";
import type { EventDefinition } from "@/lib/schemas/config";
import { describeCell, describeRow, parseValue, useEventLookup, usePlan } from "./fields";

const MAX_MARKERS = 3;
const LABEL_COL = 150;
const PERIOD_COL = 48;

type Value = AttributeOperation["value"];

/** One Event in the overview and in its legend; an unknown Event is grey. */
function EventMarker({ type }: { type: EventDefinition["type"] | undefined }) {
  if (type === "temporal_jump") return <Clock size={9} className="shrink-0 text-blue-600 dark:text-blue-400" />;
  return (
    <span
      className={cn(
        "h-[7px] w-[7px] shrink-0 rounded-full",
        type === "hazard" ? "bg-red-500" : type === "disservice" ? "bg-amber-500" : type === "restorative" ? "bg-green-500" : "bg-zinc-400",
      )}
    />
  );
}

/** What a row acts on, in a few words; a filter in the words its explanation uses. */
function rowTarget(row: ProfileRow, model: FilterableModel): string {
  if (row.element !== undefined) return row.element ? filterLabel(row.element, model) : "(choose an Element)";
  const f = row.where ?? { kind: "node" as const };
  const conds = filterConditions(f, model.canvases);
  return `All ${f.kind}s${conds.length ? " " + conds.join(", ") : ""}${f.exclude?.length ? ` − ${f.exclude.length}` : ""}`;
}

/** For a `set` row: the value each empty cell carries from an earlier one. */
function carriedValues(row: ProfileRow, labels: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (row.op !== "set") return out;
  let last: string | undefined;
  for (const l of labels) {
    if (l in row.values) last = String(row.values[l]);
    else if (last !== undefined) out[l] = last;
  }
  return out;
}

/**
 * A pasted series. Tab, newline or ; separate cells and an empty one is kept
 * (a blank spreadsheet cell empties its period); else spaces separate. A comma
 * is a decimal point ("1,5" from a decimal-comma spreadsheet), never a separator.
 */
function splitSeries(text: string): string[] {
  const t = text.replace(/\r?\n$/, "");
  const parts = /[\t\n;]/.test(t) ? t.split(/\r?\n|\t|;/) : t.trim().split(/\s+/);
  return parts.map((p) => p.trim());
}

/** A cell's text as a value; empty is no value. */
const cellValue = (text: string): Value | undefined => (text.trim() === "" ? undefined : parseValue(text));

const periodTitle = (p: PlannedPeriod, eventLabel: (id: string) => string) =>
  `${p.label}: ${p.phases.map((ph) => `P${ph.index + 1} ${ph.events.map(eventLabel).join(", ") || "no Events"}${ph.propagate ? " → Propagate" : ""}`).join(" · ")}`;

/**
 * One cell. Memoised with stable handlers, so editing a cell re-renders only
 * its row (immer keeps the other rows' identity).
 */
const ProfileCell = memo(function ProfileCell({
  row,
  label,
  carried,
  stepStart,
  onWrite,
  onFill,
}: {
  row: ProfileRow;
  label: string;
  carried: string | undefined;
  stepStart: boolean;
  /** Write values into `row` from `label` onward; undefined empties a cell. */
  onWrite: (rowId: string, label: string, values: (Value | undefined)[]) => void;
  /** Write `value` here and repeat it into the empty cells after, up to the next filled one. */
  onFill: (row: ProfileRow, label: string, value: Value) => void;
}) {
  const has = label in row.values;
  const shown = has ? String(row.values[label]) : "";
  /** What is being typed; null = show the stored value. */
  const [draft, setDraft] = useState<string | null>(null);
  const invalid = has && !valueFitsOp(row.op, row.values[label]);

  function commit() {
    if (draft !== null && draft !== shown) onWrite(row.id, label, [cellValue(draft)]);
    setDraft(null);
  }

  return (
    <div className={cn("group relative h-7", stepStart ? "border-l-2 border-zinc-300 dark:border-zinc-600" : "border-l border-zinc-100 dark:border-zinc-800")}>
      <input
        aria-label={`${label} value`}
        value={draft ?? shown}
        placeholder={carried ?? "·"}
        title={invalid ? `${row.op} needs a number` : undefined}
        onFocus={() => { setDraft(shown); describeCell(row, label, carried); }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        onPaste={(e) => {
          const parts = splitSeries(e.clipboardData.getData("text"));
          if (parts.length < 2) return;
          e.preventDefault();
          setDraft(null);
          onWrite(row.id, label, parts.map(cellValue));
        }}
        className={cn(
          "m-px h-[calc(100%-2px)] w-[calc(100%-2px)] rounded-sm border border-zinc-200 bg-white px-1 text-right text-[11px] tabular-nums text-zinc-800 placeholder:text-zinc-300 hover:border-blue-300 focus:border-blue-400 focus:bg-blue-50 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-600 dark:focus:bg-blue-900/30",
          invalid && "text-red-600 dark:text-red-400",
        )}
      />
      {(has || (draft !== null && draft.trim() !== "")) && (
        <button
          type="button"
          title="Repeat this value into the following empty cells"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            // The value being typed wins over the stored one, and is committed with the fill.
            const value = draft !== null ? cellValue(draft) : row.values[label];
            setDraft(null);
            if (value !== undefined) onFill(row, label, value);
          }}
          className="absolute -top-1 right-0 hidden rounded bg-white px-0.5 text-[9px] leading-3 text-blue-600 shadow-sm group-hover:block dark:bg-zinc-800"
        >
          →
        </button>
      )}
    </div>
  );
});

export function TimelineGrid({ selectedRow, onSelectRow }: { selectedRow: string | null; onSelectRow: (id: string | null) => void }) {
  const rows = useTemporalSimulationStore((s) => s.profile);
  const { updateProfile, writeCells, explain } = useTemporalSimulationStore.getState();
  // Only the row labels read the model, so only a change to them re-renders the grid.
  const targets = useCanvasStore(useShallow((s) => rows.map((r) => rowTarget(r, s))));
  const { byId, eventLabel } = useEventLookup();
  const plan = usePlan();
  const labels = useMemo(() => plan.periods.map((p) => p.label), [plan]);

  const jumps = plan.periods.flatMap((p) => p.phases.flatMap((ph) => ph.events)).filter((id) => byId.get(id)?.type === "temporal_jump").length;
  const columns = { gridTemplateColumns: `${LABEL_COL}px repeat(${plan.periods.length}, ${PERIOD_COL}px)` };
  const stepStarts = new Set(plan.periods.filter((p) => p.repetition === 0).map((p) => p.label));
  const known = new Set(labels);
  const outside = [...new Set(rows.flatMap((r) => Object.keys(r.values).filter((l) => !known.has(l))))];

  // Consecutive periods of one Step form one group.
  const groups: { stepIndex: number; periods: PlannedPeriod[] }[] = [];
  for (const p of plan.periods) {
    const last = groups[groups.length - 1];
    if (last && last.stepIndex === p.stepIndex) last.periods.push(p);
    else groups.push({ stepIndex: p.stepIndex, periods: [p] });
  }

  // Stable while the Steps stay the same, so the memoised cells skip re-rendering.
  const write = useCallback((rowId: string, label: string, values: (Value | undefined)[]) => {
    const start = labels.indexOf(label);
    writeCells(rowId, values.flatMap((v, k): [string, Value | undefined][] => (labels[start + k] === undefined ? [] : [[labels[start + k], v]])));
  }, [labels, writeCells]);

  const fill = useCallback((row: ProfileRow, label: string, value: Value) => {
    const after = labels.slice(labels.indexOf(label) + 1);
    const end = after.findIndex((l) => l in row.values);
    const targetsAfter = end < 0 ? after : after.slice(0, end);
    writeCells(row.id, [label, ...targetsAfter].map((l): [string, Value] => [l, value]));
  }, [labels, writeCells]);

  function addRow() {
    const category = useConfigStore.getState().config.categories[0]?.name;
    const row: ProfileRow = {
      id: nanoid(),
      where: { kind: "node" },
      path: category ? ["supply_capacity", category] : ["functionality"],
      op: "set",
      values: {},
    };
    updateProfile((rs) => { rs.push(row); });
    onSelectRow(row.id);
    describeRow(row);
  }

  if (plan.periods.length === 0) {
    return <p className="rounded-md border border-dashed border-zinc-300 p-3 text-xs text-zinc-400 dark:border-zinc-600">No periods yet — add a Step.</p>;
  }

  const labelCell = "sticky left-0 z-10 bg-white pr-2 dark:bg-zinc-900";

  return (
    <div className="rounded-lg border border-zinc-200 p-2 dark:border-zinc-700">
      <button type="button" onClick={() => explain(EXPLAIN_STRIP)} className="mb-1.5 text-left text-[11px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
        <span className="font-semibold text-zinc-700 dark:text-zinc-200">At a glance</span> — {plan.periods.length} periods ·{" "}
        {plan.engineCalls} Propagations · {jumps} time jump{jumps === 1 ? "" : "s"} · {rows.length} profile row{rows.length === 1 ? "" : "s"}
      </button>

      <div className="overflow-x-auto pb-1">
        <div className="w-max">
          {/* Steps */}
          <div className="grid" style={columns}>
            <span className={cn(labelCell, "text-[10px] font-medium text-zinc-400")}>Step</span>
            {groups.map((g) => (
              <span
                key={`${g.stepIndex}-${g.periods[0].number}`}
                style={{ gridColumn: `span ${g.periods.length}` }}
                className="truncate border-l-2 border-zinc-300 pl-1 text-[10px] font-medium text-zinc-500 dark:border-zinc-600"
              >
                Step {g.stepIndex + 1}{g.periods.length > 1 ? ` ×${g.periods.length}` : ""}
              </span>
            ))}
          </div>

          {/* Events, Phases and label per period */}
          <div className="grid" style={columns}>
            <span className={cn(labelCell, "flex flex-col text-right text-[10px] text-zinc-400")}>
              <span className="flex h-[30px] items-end justify-end">Events</span>
              <span className="mt-0.5 h-2 text-[8px] leading-2">Propagate</span>
              <span className="h-3 text-[9px] leading-3">Period</span>
            </span>
            {plan.periods.map((p) => (
              <button
                key={p.number}
                type="button"
                onClick={() => explain(explainSelectPeriod(p, eventLabel))}
                title={periodTitle(p, eventLabel)}
                className={cn(
                  "flex flex-col items-stretch px-1 hover:bg-zinc-100 dark:hover:bg-zinc-800",
                  stepStarts.has(p.label) ? "border-l-2 border-zinc-300 dark:border-zinc-600" : "border-l border-zinc-100 dark:border-zinc-800",
                )}
              >
                <span className="flex h-[30px] items-end gap-px">
                  {p.phases.map((ph) => (
                    <span key={ph.index} className="flex flex-1 flex-col-reverse items-center gap-px">
                      {ph.events.slice(0, MAX_MARKERS).map((id, i) => <EventMarker key={i} type={byId.get(id)?.type} />)}
                      {ph.events.length > MAX_MARKERS && <span className="text-[8px] leading-none text-zinc-500">+{ph.events.length - MAX_MARKERS}</span>}
                    </span>
                  ))}
                </span>
                <span className="mt-0.5 flex h-2 gap-px">
                  {p.phases.map((ph) => (
                    <span
                      key={ph.index}
                      className={cn("flex-1 rounded-sm", ph.propagate ? "bg-green-500" : "border border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-900")}
                    />
                  ))}
                </span>
                <span className="h-3 truncate text-center text-[9px] leading-3 text-zinc-500">{p.label}</span>
              </button>
            ))}
          </div>

          {/* Profile */}
          <div className="mt-1 grid border-t border-zinc-200 pt-1 dark:border-zinc-700" style={columns}>
            <span className={cn(labelCell, "flex items-center gap-2")}>
              <span className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-200">Profile</span>
              <button type="button" onClick={addRow} className="inline-flex items-center gap-0.5 text-[10px] text-blue-700 hover:underline dark:text-blue-400">
                <Plus size={10} /> row
              </button>
            </span>
            {rows.length === 0 && (
              <span style={{ gridColumn: `span ${plan.periods.length}` }} className="self-center pl-2 text-[10px] text-zinc-400">
                Known inputs that change over time (a monthly rate, a seasonal demand): one row each, a value per period.
              </span>
            )}
          </div>
          {rows.map((row, ri) => {
            const carried = carriedValues(row, labels);
            return (
              <div key={row.id} className="grid border-t border-zinc-100 dark:border-zinc-800" style={columns}>
                <button
                  type="button"
                  onClick={() => { onSelectRow(selectedRow === row.id ? null : row.id); describeRow(row); }}
                  title={`${targets[ri]} — ${row.op} ${row.path.join(" › ")}`}
                  className={cn(
                    labelCell,
                    "flex h-7 min-w-0 flex-col justify-center text-left leading-tight hover:bg-zinc-50 dark:hover:bg-zinc-800",
                    selectedRow === row.id && "bg-blue-50 dark:bg-blue-900/30",
                  )}
                >
                  <span className="truncate text-[11px] text-zinc-700 dark:text-zinc-200">{targets[ri]}</span>
                  <span className="truncate text-[9px] text-zinc-400">
                    {row.op} · {row.path.join(" › ") || "(path)"}
                    {Object.keys(row.values).length === 0 && <span className="text-amber-600 dark:text-amber-400"> · no value yet</span>}
                  </span>
                </button>
                {labels.map((l) => (
                  <ProfileCell
                    key={l}
                    row={row}
                    label={l}
                    carried={carried[l]}
                    stepStart={stepStarts.has(l)}
                    onWrite={write}
                    onFill={fill}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {outside.length > 0 && (
        <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-400">
          Values on periods outside the Timeline never apply: {outside.join(", ")}.{" "}
          <button
            type="button"
            className="underline"
            onClick={() => updateProfile((rs) => { for (const r of rs) for (const l of outside) delete r.values[l]; })}
          >
            Remove them
          </button>
        </p>
      )}

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-zinc-500">
        <span className="flex items-center gap-1"><EventMarker type="hazard" />hazard</span>
        <span className="flex items-center gap-1"><EventMarker type="disservice" />disservice</span>
        <span className="flex items-center gap-1"><EventMarker type="restorative" />restorative</span>
        <span className="flex items-center gap-1"><EventMarker type="temporal_jump" />time jump</span>
        <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-green-500" />Phase + Propagation</span>
        <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm border border-zinc-300 dark:border-zinc-600" />Phase, Events only</span>
        <span className="flex items-center gap-1"><span className="text-zinc-300 dark:text-zinc-600">160</span>value carried from earlier</span>
      </div>
    </div>
  );
}
