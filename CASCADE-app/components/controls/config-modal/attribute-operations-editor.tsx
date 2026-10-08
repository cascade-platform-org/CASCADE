"use client";

/**
 * AttributeOperationsEditor — an Event's `attribute_operations` (ADR-0021):
 * ordered `op(current, value)` writes at a field path, each on one Element or
 * on every Element a filter selects. They run last, in this order, so the
 * order is editable.
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

export function AttributeOperationsEditor({
  operations,
  onChange,
}: {
  operations: AttributeOperation[];
  onChange: (next: AttributeOperation[]) => void;
}) {
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
    </div>
  );
}
