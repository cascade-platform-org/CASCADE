/**
 * stock-checks.ts — what a Stock asks of the rest of its Category (ADR-0020 §2).
 *
 * An undeclared edge or throughput capacity defaults, in the engine, to the
 * largest supply in its Category (`_max_source_supply`), and with a Stock that
 * supply includes the draw from its level. So a full stock silently widens
 * every pipe of its Category. Pure; the Inspector reports it.
 */

import type { Edge, Node } from "@/lib/schemas/network";

/** A node is in a Category's flow graph when it supplies, demands or is tagged with it (engine `_in_category`). */
export const inCategory = (node: Node, category: string): boolean =>
  category in (node.supply_capacity ?? {}) ||
  category in (node.category_dependency_profiles ?? {}) ||
  (node.node_categories ?? []).includes(category);

/** Edges and nodes of `category` with no declared capacity. */
export function undeclaredCapacities(
  category: string,
  nodes: Record<string, Node>,
  edges: Record<string, Edge>,
): { edges: number; nodes: number } {
  const members = new Set(Object.values(nodes).filter((n) => inCategory(n, category)).map((n) => n.id));
  return {
    edges: Object.values(edges).filter((e) => members.has(e.source) && members.has(e.target) && e.capacity === undefined).length,
    nodes: [...members].filter((id) => nodes[id].throughput_capacity?.[category] === undefined).length,
  };
}
