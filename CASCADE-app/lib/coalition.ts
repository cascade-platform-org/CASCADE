/**
 * coalition.ts — a set of Elements failed together, read against a Scenario.
 *
 * A **Coalition** is the unit both model-based Analysis Metrics are defined
 * over: Vitality Centrality fails one Element, a Shapley Value averages over
 * coalitions of up to `k_max`. "Failed" has exactly one meaning — driven to
 * Functionality 1, the worst level on any scale — and that one meaning was
 * written out by hand in three places, twice inside one 648-line component.
 *
 * Naming an Element lives here too: the only reason this app renders an id as
 * prose is to describe a coalition or a ranked analysis result, and that had
 * four copies of its own.
 *
 * Pure — no store, no network. `runEphemeralPropagation` is what turns the
 * Scenario these functions build into a propagated one.
 */

import type { GraphSnapshot } from "@/lib/schemas/network";

/**
 * The Scenario in which every Element of `ids` has failed.
 *
 * Copy-on-write per Element, so untouched Elements keep their object identity
 * and `countChangedElements` still works over the result. Ids naming nothing are
 * skipped rather than throwing: a coalition can outlive an Element the user
 * deleted mid-run.
 */
export function applyCoalition(
  snapshot: GraphSnapshot,
  ids: Iterable<string>,
): GraphSnapshot {
  const nodes = { ...snapshot.nodes };
  const edges = { ...snapshot.edges };
  let changed = false;
  for (const id of ids) {
    if (id in nodes) { nodes[id] = { ...nodes[id], functionality: 1 }; changed = true; }
    else if (id in edges) { edges[id] = { ...edges[id], functionality: 1 }; changed = true; }
  }
  // The Scenario itself comes back by reference when nothing was written, as it
  // does from mergeUpdatesIntoSnapshot, forceOperational and applyBaselineEntries.
  // The empty coalition is the Shapley baseline and is evaluated once per
  // permutation, so this is the common case, not an edge one.
  if (!changed) return snapshot;
  return { ...snapshot, nodes, edges };
}

/**
 * Label an Element as the Analysis page shows it: a node's own label, an edge as
 * its two endpoints' labels joined. Falls back to the id at every step, so a
 * partially-labelled network still reads.
 *
 * `separator` exists because the **Shapley Export** is a published contract
 * (`scripts/paper_shapley_vs_centrality.py` reads it) and joins with a bare
 * arrow, while the on-screen panels space it out. One formatting knob, one
 * implementation — rather than one implementation per caller, which is what
 * there was.
 */
export function elementLabel(
  // The minimum this needs, so a component holding a narrowed projection of the
  // registries can call it without widening back to a whole GraphSnapshot.
  snapshot: {
    nodes: Readonly<Record<string, { label?: string }>>;
    edges: Readonly<Record<string, { source: string; target: string }>>;
  },
  id: string,
  separator = "→",
): string {
  const node = snapshot.nodes[id];
  if (node) return node.label ?? id;
  const edge = snapshot.edges[id];
  if (edge) {
    const src = snapshot.nodes[edge.source]?.label ?? edge.source;
    const tgt = snapshot.nodes[edge.target]?.label ?? edge.target;
    return `${src}${separator}${tgt}`;
  }
  return id;
}
