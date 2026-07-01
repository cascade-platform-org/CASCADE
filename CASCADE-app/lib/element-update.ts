/**
 * element-update.ts — the single place that knows how to apply an engine
 * ElementUpdate onto a Node or Edge.
 *
 * Two consumers with different mutation models share the same field logic:
 * - canvas-store.applyPropagationResult mutates immer drafts in place
 *   (assignElementUpdate) so immer records only the 2–6 fields the engine
 *   actually changed instead of finalising a full spread-copy per element;
 * - runEphemeralPropagation merges onto plain snapshots without touching any
 *   store (mergeUpdatesIntoSnapshot).
 * A new engine output field only has to be handled in assignElementUpdate.
 */
import type { Node, Edge, GraphSnapshot } from "@/lib/schemas/network";
import type { ElementUpdate } from "@/lib/schemas/propagation";

/**
 * Apply one engine update onto an element IN PLACE (immer-draft friendly).
 * Only fields present on the update are touched.
 */
export function assignElementUpdate(target: Node | Edge, update: ElementUpdate): void {
  target.functionality = update.functionality;
  if (update.functionality_time !== undefined) target.functionality_time = update.functionality_time;
  if (update.direct_damage !== undefined) target.direct_damage = update.direct_damage;
  if (update.expected_repair_time !== undefined) target.expected_repair_time = update.expected_repair_time;
  if (update.responsibility_share !== undefined) target.responsibility_share = update.responsibility_share;
  if (update.properties !== undefined) {
    target.properties = { ...(target.properties ?? {}), ...update.properties };
  }
}

/** Apply one engine update onto an element. Pure — returns a new object. */
export function applyElementUpdate<T extends Node | Edge>(element: T, update: ElementUpdate): T {
  const copy = { ...element };
  assignElementUpdate(copy, update);
  return copy;
}

/**
 * Apply ElementUpdate[] onto a GraphSnapshot. Pure — does not mutate input.
 * Registries are cloned lazily (only the touched one), and a no-op update list
 * returns the input snapshot unchanged so referential equality is preserved
 * for memoised consumers.
 */
export function mergeUpdatesIntoSnapshot(
  snapshot: GraphSnapshot,
  updates: ElementUpdate[],
): GraphSnapshot {
  if (updates.length === 0) return snapshot;

  let nodes = snapshot.nodes;
  let edges = snapshot.edges;
  let nodesCloned = false;
  let edgesCloned = false;

  for (const update of updates) {
    if (nodes[update.id]) {
      if (!nodesCloned) {
        nodes = { ...nodes };
        nodesCloned = true;
      }
      nodes[update.id] = applyElementUpdate(nodes[update.id], update);
    } else if (edges[update.id]) {
      if (!edgesCloned) {
        edges = { ...edges };
        edgesCloned = true;
      }
      edges[update.id] = applyElementUpdate(edges[update.id], update);
    }
    // Unknown id: update for an element not in this snapshot — skip.
  }

  if (!nodesCloned && !edgesCloned) return snapshot;
  return { ...snapshot, nodes, edges };
}
