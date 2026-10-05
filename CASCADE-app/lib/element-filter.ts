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

/** What `label_contains` reads, and what the window lists. */
export function elementLabel(id: string, model: Pick<FilterableModel, "nodes" | "edges">): string {
  const n = model.nodes[id];
  if (n) return n.label || n.id;
  const e = model.edges[id];
  if (!e) return id;
  return `${model.nodes[e.source]?.label || e.source} → ${model.nodes[e.target]?.label || e.target}`;
}

/** Ids of the Elements `filter` selects, sorted. */
export function matchElements(filter: ElementFilter, model: FilterableModel): string[] {
  const kind = filter.kind ?? "node";
  const members = filter.canvas !== undefined ? canvasMembers(model, filter.canvas, kind) : null;
  if (filter.canvas !== undefined && members === null) return [];
  const excluded = new Set(filter.exclude ?? []);
  const needle = filter.label_contains ? lower(filter.label_contains) : null;

  const common = (id: string) =>
    (!members || members.has(id)) &&
    !excluded.has(id) &&
    (!needle || lower(elementLabel(id, model)).includes(needle));

  if (kind === "node") {
    return Object.values(model.nodes)
      .filter((n) =>
        common(n.id) &&
        (filter.node_type === undefined || lower(n.node_type ?? "") === lower(filter.node_type)) &&
        (filter.category === undefined || nodeCategories(n).has(filter.category)),
      )
      .map((n) => n.id)
      .sort();
  }
  return Object.values(model.edges)
    .filter((e) =>
      common(e.id) &&
      (filter.category === undefined || filter.category in (model.nodes[e.source]?.supply_capacity ?? {})),
    )
    .map((e) => e.id)
    .sort();
}

/** Conditions that cannot apply to the filter's kind — reported, never silently ignored. */
export function filterMisuse(filter: ElementFilter): string[] {
  return (filter.kind ?? "node") === "edge" && filter.node_type !== undefined ? ["node_type applies to nodes only"] : [];
}
