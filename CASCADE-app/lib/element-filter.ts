/**
 * element-filter.ts — resolve an ElementFilter to the Elements it selects
 * (ADR-0021: an Attribute Operation's `where`; ADR-0019 §4: a Metric's target).
 *
 * Pure. Every condition the filter gives must hold; an absent one does not
 * constrain. The result is sorted by id, which is the order operations apply in.
 */

import type { Canvas, Edge, Node } from "@/lib/schemas/network";
import { elementLabel } from "@/lib/coalition";
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

/** What `label_contains` reads, and what the window lists: an edge reads "source → target". */
export const filterLabel = (id: string, model: Pick<FilterableModel, "nodes" | "edges">): string =>
  elementLabel(model, id, " → ");

/** Ids of the Elements `filter` selects, sorted. */
export function matchElements(filter: ElementFilter, model: FilterableModel): string[] {
  const { kind } = filter;
  const members = filter.canvas !== undefined ? canvasMembers(model, filter.canvas, kind) : null;
  if (filter.canvas !== undefined && members === null) return [];
  const excluded = new Set(filter.exclude ?? []);
  const needle = filter.label_contains ? lower(filter.label_contains) : null;

  const common = (id: string) =>
    (!members || members.has(id)) &&
    !excluded.has(id) &&
    (!needle || lower(filterLabel(id, model)).includes(needle));

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
  return filter.kind === "edge" && filter.node_type !== undefined ? ["node_type applies to nodes only"] : [];
}

/** A filter's conditions in words, shared by the profile grid's row label and the filter explanation. */
export function filterConditions(filter: ElementFilter, canvases: FilterableModel["canvases"]): string[] {
  return [
    filter.node_type && `of type ${filter.node_type}`,
    filter.category && (filter.kind === "node" ? `in Category ${filter.category}` : `carrying ${filter.category}`),
    filter.canvas && `on canvas ${canvases[filter.canvas]?.label ?? filter.canvas}`,
    filter.label_contains && `whose label contains “${filter.label_contains}”`,
  ].filter((c): c is string => Boolean(c));
}

/** How many Elements an operation acts on: its filter's matches, or null for one Element. */
export function countTargets(op: { where?: ElementFilter }, model: FilterableModel): number | null {
  return op.where ? matchElements(op.where, model).length : null;
}
