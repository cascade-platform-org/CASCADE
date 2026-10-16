"use client";

/**
 * AttributeOperationsEditor — an Event's `attribute_operations` (ADR-0021):
 * ordered `op(current, value)` writes at a field path, each on one Element or
 * on every Element a filter selects. They run last, in this order, so the
 * order is editable.
 *
 * The operand is the value times each factor an operation names (× of, ×
 * Parameter, × Series; ADR-0021, revised 2026-10-12). An Event declares the
 * defaults its Parameters take when it is fired by hand; inside a run, the
 * Simulation's value wins.
 *
 * Each row states its problem inline. Config's Save refuses while any row is
 * invalid (`operationProblems`): the Model Configuration travels with every
 * Propagation request and the backend validates it, so one half-written
 * operation would fail every Propagation.
 */

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { AttributeOperationSchema, type AttributeOperation } from "@/lib/schemas/attribute-operation";
import type { EventDefinition } from "@/lib/schemas/config";
import { OpSelect, TargetModeToggle, TargetPicker } from "@/components/temporal/operation-target";
import { TextBackedInput, formatPath, parsePath, parseValue } from "@/components/temporal/fields";
import { useTemporalSimulationStore } from "@/store/temporal-simulation-store";
import { useProjectDataStore } from "@/store/project-data-store";

/** Why an operation is invalid, or null. */
function operationProblem(op: AttributeOperation): string | null {
  const parsed = AttributeOperationSchema.safeParse(op);
  if (parsed.success) return null;
  const issue = parsed.error.issues[0];
  if (issue?.path[0] === "element") return "choose an Element";
  if (issue?.path[0] === "path") return "give a field path";
  return issue?.message ?? "invalid";
}

/** Every invalid operation in a set of Events, as "Event: #n — problem". */
export function operationProblems(events: readonly EventDefinition[]): string[] {
  return events.flatMap((ev) =>
    (ev.attribute_operations ?? []).flatMap((op, i) => {
      const problem = operationProblem(op);
      return problem ? [`${ev.label}: operation ${i + 1} — ${problem}`] : [];
    }),
  );
}

/**
 * What firing the Event by hand would refuse: a Parameter with no default, or a
 * Series (it needs a period). Only a note: inside a run both can have values.
 */
export function handFiringNotes(event: Pick<EventDefinition, "attribute_operations" | "parameter_defaults" | "temporal_simulation_only">): string[] {
  if (event.temporal_simulation_only) return [];
  return (event.attribute_operations ?? []).flatMap((op, i) => [
    ...(op.parameter && !Object.hasOwn(event.parameter_defaults ?? {}, op.parameter) ? [`Fired by hand, operation ${i + 1} is refused: Parameter ${op.parameter} has no default here.`] : []),
    ...(op.series ? [`Fired by hand, operation ${i + 1} is refused: Series ${op.series} is read only inside a Temporal Simulation run.`] : []),
  ]);
}

export function AttributeOperationsEditor({
  operations,
  onChange,
  parameterDefaults,
  onChangeDefaults,
  handFireable,
}: {
  operations: AttributeOperation[];
  onChange: (next: AttributeOperation[]) => void;
  parameterDefaults: Record<string, number> | undefined;
  onChangeDefaults: (next: Record<string, number> | undefined) => void;
  /** False for a Temporal-Simulation-only Event, which is never fired by hand. */
  handFireable: boolean;
}) {
  const parameterNames = useTemporalSimulationStore((s) => s.simulations).flatMap((x) => x.parameters.map((p) => p.name));
  const seriesNames = useProjectDataStore((s) => s.series).map((x) => x.name);
  const used = [...new Set(operations.map((op) => op.parameter).filter((n): n is string => !!n))];
  const notes = handFiringNotes({ attribute_operations: operations, parameter_defaults: parameterDefaults, temporal_simulation_only: !handFireable });
  // The text inputs keep their own text, keyed by row position; a move or a removal
  // shifts positions, so it bumps the epoch and the inputs reload from the operations.
  const [epoch, setEpoch] = useState(0);
  const restructure = (next: AttributeOperation[]) => { setEpoch((e) => e + 1); onChange(next); };
  const edit = (i: number, patch: Partial<AttributeOperation>) =>
    onChange(operations.map((op, k) => (k === i ? ({ ...op, ...patch } as AttributeOperation) : op)));
  const move = (i: number, by: -1 | 1) => {
    const next = [...operations];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    restructure(next);
  };

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-zinc-500">
        Each operation writes <code>op(current value, value)</code> at a field path, after the mutations, in this order.
        The value is multiplied by each factor given: <em>× of</em> (what the same Element holds at that path just before), <em>× Parameter</em> (a named number) and <em>× Series</em> (project data at the period being run).
        Arithmetic on an absent value, or a result outside the field&apos;s range, is refused for that Element and reported — never clamped.
      </p>

      {operations.map((op, i) => {
        const problem = operationProblem(op);
        return (
          <div key={`${epoch}-${i}`} className="space-y-1.5 rounded border border-zinc-200 p-2 dark:border-zinc-700">
            <div className="grid grid-cols-[auto_2fr_1fr_1fr_auto] items-center gap-1.5">
              <TargetModeToggle target={op} onChange={(patch) => edit(i, patch)} />
              <TextBackedInput key={`${epoch}-${i}-path`} initial={formatPath(op.path)} placeholder="supply_capacity, water" onCommit={(t) => edit(i, { path: parsePath(t) })} />
              <OpSelect value={op.op} onChange={(kind) => edit(i, { op: kind })} />
              <TextBackedInput key={`${epoch}-${i}-value`} initial={String(op.value)} placeholder="value" onCommit={(t) => edit(i, { value: parseValue(t) })} />
              <div className="flex gap-1 text-zinc-400">
                <button type="button" title="Move up" disabled={i === 0} className="hover:text-zinc-700 disabled:opacity-30" onClick={() => move(i, -1)}><ArrowUp size={12} /></button>
                <button type="button" title="Move down" disabled={i === operations.length - 1} className="hover:text-zinc-700 disabled:opacity-30" onClick={() => move(i, 1)}><ArrowDown size={12} /></button>
                <button type="button" title="Remove" className="hover:text-red-600" onClick={() => restructure(operations.filter((_, k) => k !== i))}><Trash2 size={12} /></button>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                <span className="shrink-0 whitespace-nowrap">× of</span>
                <TextBackedInput key={`${epoch}-${i}-of`} initial={op.of ? formatPath(op.of) : ""} placeholder="the Element's field (optional)" onCommit={(t) => edit(i, { of: parsePath(t).length ? parsePath(t) : undefined })} />
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                <span className="shrink-0 whitespace-nowrap">× Parameter</span>
                <TextBackedInput key={`${epoch}-${i}-parameter`} initial={op.parameter ?? ""} placeholder="name (optional)" list="cascade-parameter-names" onCommit={(t) => edit(i, { parameter: t.trim() || undefined })} />
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                <span className="shrink-0 whitespace-nowrap">× Series</span>
                <TextBackedInput key={`${epoch}-${i}-series`} initial={op.series ?? ""} placeholder="name (optional)" list="cascade-series-names" onCommit={(t) => edit(i, { series: t.trim() || undefined })} />
              </label>
            </div>
            <TargetPicker target={op} onChange={(patch) => edit(i, patch)} />
            {problem && <p className="text-[11px] text-red-600 dark:text-red-400">{problem}</p>}
          </div>
        );
      })}

      <button
        type="button"
        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
        onClick={() => onChange([...operations, { element: "", path: ["supply_capacity"], op: "mul", value: 1 }])}
      >
        <Plus size={12} /> Add operation
      </button>

      {used.length > 0 && (
        <div className="rounded border border-zinc-200 p-2 dark:border-zinc-700">
          <p className="mb-1 text-[11px] text-zinc-500">
            Parameter defaults: the values used when this Event is fired by hand. Inside a Temporal Simulation run, the Simulation&apos;s value wins.
          </p>
          <div className="grid grid-cols-[auto_8rem] items-center gap-x-2 gap-y-1">
            {used.map((name) => (
              <label key={name} className="contents text-[11px]">
                <span className="font-mono text-zinc-600 dark:text-zinc-300">{name}</span>
                <TextBackedInput
                  key={`${epoch}-default-${name}`}
                  initial={parameterDefaults?.[name] === undefined ? "" : String(parameterDefaults[name])}
                  placeholder="no default"
                  onCommit={(t) => {
                    const value = parseValue(t);
                    const next = { ...(parameterDefaults ?? {}) };
                    if (typeof value === "number" && Number.isFinite(value)) next[name] = value;
                    else delete next[name];
                    onChangeDefaults(Object.keys(next).length > 0 ? next : undefined);
                  }}
                />
              </label>
            ))}
          </div>
        </div>
      )}
      {notes.map((n) => <p key={n} className="text-[11px] text-amber-700 dark:text-amber-400">{n}</p>)}

      <datalist id="cascade-parameter-names">{[...new Set(parameterNames)].map((n) => <option key={n} value={n} />)}</datalist>
      <datalist id="cascade-series-names">{seriesNames.map((n) => <option key={n} value={n} />)}</datalist>
    </div>
  );
}
