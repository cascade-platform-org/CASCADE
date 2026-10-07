"use client";

/**
 * The parts of an Attribute Operation's editor (ADR-0021) shared by an Event's
 * operations (Config → Events) and a profile row (the Timeline grid): what it
 * acts on, one Element or a filter, and its op. Each editor lays them out its
 * own way.
 */

import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useCanvasStore } from "@/store/canvas-store";
import { filterLabel } from "@/lib/element-filter";
import { OperationKindSchema, type AttributeOperation } from "@/lib/schemas/attribute-operation";
import type { Explanation } from "@/lib/temporal-simulation-explainers";
import { FilterEditor } from "./filter-editor";
import { Segmented, inputCls } from "./fields";

type Target = Pick<AttributeOperation, "element" | "where">;

/** One Element or a filter; switching resets the target to an empty one of that kind. */
export function TargetModeToggle({ target, onChange }: { target: Target; onChange: (patch: Target) => void }) {
  return (
    <Segmented
      value={target.where ? "filter" : "element"}
      options={[{ id: "element", label: "One Element" }, { id: "filter", label: "Filter" }]}
      onChange={(m) => onChange(m === "filter" ? { element: undefined, where: { kind: "node" } } : { where: undefined, element: "" })}
    />
  );
}

export function OpSelect({ value, onChange }: { value: AttributeOperation["op"]; onChange: (op: AttributeOperation["op"]) => void }) {
  return (
    <select className={inputCls} value={value} onChange={(e) => onChange(OperationKindSchema.parse(e.target.value))}>
      {OperationKindSchema.options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

/** The target itself: the filter's editor, or a choice of every Element in the model. */
export function TargetPicker({
  target,
  onChange,
  onExplain,
}: {
  target: Target;
  onChange: (patch: Target) => void;
  onExplain?: (e: Explanation) => void;
}) {
  const { nodes, edges } = useCanvasStore(useShallow((s) => ({ nodes: s.nodes, edges: s.edges })));
  // Built once per model change.
  const elementOptions = useMemo(
    () =>
      [...Object.keys(nodes), ...Object.keys(edges)]
        .map((id) => ({ id, label: `${filterLabel(id, { nodes, edges })} (${id in nodes ? "node" : "edge"})` }))
        .sort((a, b) => a.label.localeCompare(b.label))
        .map((o) => <option key={o.id} value={o.id}>{o.label}</option>),
    [nodes, edges],
  );
  if (target.where) return <FilterEditor onExplain={onExplain} value={target.where} onChange={(where) => onChange({ where })} />;
  return (
    <select className={inputCls} value={target.element ?? ""} onChange={(e) => onChange({ element: e.target.value })}>
      <option value="">— choose an Element —</option>
      {elementOptions}
    </select>
  );
}
