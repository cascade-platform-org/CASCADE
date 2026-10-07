/**
 * stock-integration.ts — every Stock's level after a period (ADR-0020 §1b, §1c, §2).
 *
 * Run by the step operator once per period, right after its last propagating
 * Phase, on the run's own copy. Pure: it reads the Propagation's `served_ratio`
 * and `stored`, writes each Stock's `level` copy-on-write, and reports what the
 * clamps removed. The engine never reads or writes a Stock.
 *
 * What a Stock delivered (D):
 *   - storage: the engine says what it `filled` and `drew` (§1c);
 *   - a node Stock: every consumer's delivery of its Category, less what storage
 *     drew there — its own outflow only while it is the Category's one source,
 *     so with a second source its integration is skipped with a warning (§2, §5);
 *   - an edge Stock: what its target received, canonical only when the target
 *     has one incoming edge of that Category (§1b).
 */

import { capacityShare, integrateStock, integrateStorage, isStorage, type StockIntegration } from "@/lib/stock-math";
import { inCategory } from "@/lib/stock-checks";
import type { Edge, GraphSnapshot, Node, Stock } from "@/lib/schemas/network";
import type { PropagationResult } from "@/lib/schemas/propagation";

export interface StockOutcome {
  element: string;
  /** Absent for an edge Stock. */
  category?: string;
  level: number;
  spilled: number;
  unmet: number;
  /** An edge Stock whose rate exceeds its inflow: capacity lent by others reached D, so the balance is not attributable (§1b). */
  attributionInvalid?: true;
}

export interface Integration {
  snapshot: GraphSnapshot;
  outcomes: StockOutcome[];
  warnings: string[];
}

type Flow = Pick<PropagationResult, "served_ratio" | "stored">;

const demandOf = (node: Node | undefined, category: string): number =>
  node?.category_dependency_profiles?.[category]?.demand ?? 0;

/** What every consumer of `category` received in this Propagation. */
function deliveredIn(category: string, nodes: Record<string, Node>, flow: Flow): number {
  let total = 0;
  for (const [id, ratios] of Object.entries(flow.served_ratio)) {
    const ratio = ratios[category];
    if (ratio !== undefined) total += ratio * demandOf(nodes[id], category);
  }
  return total;
}

export function integrateStocks(snapshot: GraphSnapshot, flow: Flow, n: number): Integration {
  const outcomes: StockOutcome[] = [];
  const warnings: string[] = [];
  let nodes = snapshot.nodes;
  let edges = snapshot.edges;
  const label = (el: Node | Edge) => ("label" in el && el.label) || el.id;

  const writeNode = (node: Node, category: string, stock: Stock, result: StockIntegration) => {
    if (nodes === snapshot.nodes) nodes = { ...snapshot.nodes };
    const current = nodes[node.id];
    nodes[node.id] = { ...current, supply_capacity: { ...current.supply_capacity, [category]: { ...stock, level: result.level } } };
    outcomes.push({ element: node.id, category, ...result });
  };

  // Sources per Category that are not storage: a node Stock integrates only as the one source.
  const sources = new Map<string, string[]>();
  for (const node of Object.values(snapshot.nodes)) {
    for (const [category, value] of Object.entries(node.supply_capacity ?? {})) {
      if (typeof value === "number" || !isStorage(value)) sources.set(category, [...(sources.get(category) ?? []), node.id]);
    }
  }
  const drawnIn = (category: string) =>
    Object.values(flow.stored).reduce((sum, byCategory) => sum + (byCategory[category]?.drawn ?? 0), 0);

  for (const node of Object.values(snapshot.nodes)) {
    for (const [category, stock] of Object.entries(node.supply_capacity ?? {})) {
      if (typeof stock === "number") continue;
      const phi = capacityShare(node.functionality, n);
      if (isStorage(stock)) {
        const exchanged = flow.stored[node.id]?.[category] ?? { filled: 0, drawn: 0 };
        writeNode(node, category, stock, integrateStorage(stock, exchanged.filled, exchanged.drawn, phi));
        continue;
      }
      const others = (sources.get(category) ?? []).filter((id) => id !== node.id);
      if (others.length > 0) {
        warnings.push(`${label(node)} (${category}): not integrated, ${others.length} other source${others.length > 1 ? "s" : ""} supply ${category}, so its own outflow is not determined.`);
        continue;
      }
      const delivered = Math.max(0, deliveredIn(category, snapshot.nodes, flow) - drawnIn(category));
      writeNode(node, category, stock, integrateStock(stock, delivered, phi));
    }
  }

  for (const edge of Object.values(snapshot.edges)) {
    const stock = edge.capacity;
    if (stock === undefined || typeof stock === "number") continue;
    const target = snapshot.nodes[edge.target];
    const categories = Object.keys(flow.served_ratio[edge.target] ?? {}).filter((c) => demandOf(target, c) > 0);
    if (categories.length !== 1) {
      warnings.push(`${label(edge)}: not integrated, its target ${categories.length === 0 ? "receives no flow" : "receives several Categories"}.`);
      continue;
    }
    const [category] = categories;
    const incoming = Object.values(snapshot.edges).filter(
      (e) => e.target === edge.target && snapshot.nodes[e.source] !== undefined && inCategory(snapshot.nodes[e.source], category),
    );
    if (incoming.length > 1) {
      warnings.push(`${label(edge)}: not integrated, its target has ${incoming.length} incoming ${category} edges.`);
      continue;
    }
    const delivered = flow.served_ratio[edge.target][category] * demandOf(target, category);
    const result = integrateStock(stock, delivered, capacityShare(edge.functionality, n));
    if (edges === snapshot.edges) edges = { ...snapshot.edges };
    edges[edge.id] = { ...edge, capacity: { ...stock, level: result.level } };
    outcomes.push({ element: edge.id, ...result, ...(stock.rate > (stock.inflow ?? stock.rate) ? { attributionInvalid: true as const } : {}) });
  }

  const changed = nodes !== snapshot.nodes || edges !== snapshot.edges;
  return { snapshot: changed ? { ...snapshot, nodes, edges } : snapshot, outcomes, warnings };
}
