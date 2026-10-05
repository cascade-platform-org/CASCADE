/**
 * element-filter.ts — resolve an ElementFilter to the Elements it selects
 * (ADR-0021: an Attribute Operation's `where`; ADR-0019 §4: a Metric's target).
 *
 * Pure. Every condition the filter gives must hold; an absent one does not
 * constrain. The result is sorted by id, which is the order operations apply in.
 */

import type { Canvas, Edge, Node } from "@/lib/schemas/network";
import type { ElementFilter } from "@/lib/temporal-simulation-schema";

export interface FilterableModel {
  nodes: Record<string, Node>;
  edges: Record<string, Edge>;
  canvases: Record<string, Canvas>;
}

const lower = (s: string) => s.toLowerCase();

function nodeCategories(n: Node): Set<string> {
  return new Set([
    ...(n.node_categories ?? []),
    ...Object.keys(n.supply_capacity ?? {}),
    ...Object.keys(n.category_dependency_profiles ?? {}),
  ]);
}

function canvasMembers(model: FilterableModel, ref: string, kind: "node" | "edge"): Set<string> | null {
  const canvas = model.canvases[ref] ?? Object.values(model.canvases).find((c) => c.label === ref);
  if (!canvas) return null;
  return new Set(kind === "node" ? canvas.graph.node_ids : canvas.graph.edge_ids);
}

function propertyMatches(props: Record<string, unknown> | undefined, f: NonNullable<ElementFilter["property"]>): boolean {
  if (!props || !(f.key in props)) return false;
  return f.equals === undefined || String(props[f.key]) === String(f.equals);
}

/** Ids of the Elements `filter` selects, sorted. */
export function matchElements(filter: ElementFilter, model: FilterableModel): string[] {
  const kind = filter.kind ?? "node";
  const members = filter.canvas !== undefined ? canvasMembers(model, filter.canvas, kind) : null;
  if (filter.canvas !== undefined && members === null) return [];
  const ids = filter.ids ? new Set(filter.ids) : null;
  const needle = filter.label_contains ? lower(filter.label_contains) : null;

  const common = (id: string, label: string | undefined, props: Record<string, unknown> | undefined) =>
    (!members || members.has(id)) &&
    (!ids || ids.has(id)) &&
    (!needle || lower(label ?? id).includes(needle)) &&
    (!filter.property || propertyMatches(props, filter.property));

  if (kind === "node") {
    return Object.values(model.nodes)
      .filter((n) =>
        common(n.id, n.label, n.properties) &&
        (filter.node_type === undefined || lower(n.node_type ?? "") === lower(filter.node_type)) &&
        (filter.category === undefined || nodeCategories(n).has(filter.category)),
      )
      .map((n) => n.id)
      .sort();
  }
  return Object.values(model.edges)
    .filter((e) =>
      common(e.id, undefined, e.properties) &&
      (filter.from === undefined || e.source === filter.from) &&
      (filter.to === undefined || e.target === filter.to) &&
      (filter.category === undefined || filter.category in (model.nodes[e.source]?.supply_capacity ?? {})),
    )
    .map((e) => e.id)
    .sort();
}

/** Conditions that cannot apply to the filter's kind — reported, never silently ignored. */
export function filterMisuse(filter: ElementFilter): string[] {
  const kind = filter.kind ?? "node";
  const out: string[] = [];
  if (kind === "edge" && filter.node_type !== undefined) out.push("node_type applies to nodes only");
  if (kind === "node" && (filter.from !== undefined || filter.to !== undefined)) out.push("from/to apply to edges only");
  return out;
}
