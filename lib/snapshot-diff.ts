/**
 * snapshot-diff.ts — Utilities for comparing and patching GraphSnapshots.
 *
 * Two primary use-cases:
 *
 * 1. History panel — show the user *what changed* between two snapshots
 *    without having to diff the entire project structure manually.
 *    `diffGraphSnapshot(before, after)` returns a structured list of changed
 *    elements so the UI can highlight them.
 *
 * 2. Applying propagation results — `applyPropagationUpdates` merges
 *    ElementUpdate[] (from PropagationResult) onto a snapshot, producing a
 *    new snapshot that can be stored as the "after" state in history.
 *    This is the canonical way to build history entries from engine output.
 *
 * Data shape (ADR-0001):
 *   GraphSnapshot.nodes  = Record<id, Node>   ← global element registry
 *   GraphSnapshot.edges  = Record<id, Edge>   ← global element registry
 *   GraphSnapshot.canvases[].graph = { graph_type, node_ids[], edge_ids[] }
 *
 * Elements are compared directly by their global ID — no canvas_id needed.
 * "Inter-canvas edge" is a UI render-time concept only; it is not represented
 * in the data model and does not appear in diffs.
 */

import type { Canvas, Edge, GraphSnapshot, Node } from "@/lib/schemas/network";
import type { ElementUpdate } from "@/lib/schemas/api";

// ---------------------------------------------------------------------------
// Diff types
// ---------------------------------------------------------------------------

export type ElementKind = "node" | "edge";
export type DiffKind = "added" | "removed" | "changed";

export interface NodeDiff {
  kind: DiffKind;
  element_type: "node";
  id: string;
  before: Node | null;
  after: Node | null;
}

export interface EdgeDiff {
  kind: DiffKind;
  element_type: "edge";
  id: string;
  before: Edge | null;
  after: Edge | null;
}

export type ElementDiff = NodeDiff | EdgeDiff;

export interface CanvasMembershipDiff {
  canvas_id: string;
  /** Node ids added to this Canvas's graph.node_ids. */
  added_node_ids: string[];
  /** Node ids removed from this Canvas's graph.node_ids. */
  removed_node_ids: string[];
  /** Edge ids added to this Canvas's graph.edge_ids. */
  added_edge_ids: string[];
  /** Edge ids removed from this Canvas's graph.edge_ids. */
  removed_edge_ids: string[];
}

export interface GraphSnapshotDiff {
  /** All changed, added, or removed elements in the global registry. */
  element_diffs: ElementDiff[];
  /** Per-canvas changes to graph membership (node_ids / edge_ids). */
  canvas_membership_diffs: CanvasMembershipDiff[];
  /** Convenience: ids of elements whose functionality worsened. */
  degraded_ids: string[];
  /** Convenience: ids of elements whose functionality improved. */
  recovered_ids: string[];
}

// ---------------------------------------------------------------------------
// diffGraphSnapshot
// ---------------------------------------------------------------------------

/**
 * Compute a structured diff between two GraphSnapshots.
 *
 * Elements are compared by their global id across the registry records
 * (snapshot.nodes / snapshot.edges). Canvas membership changes (which
 * elements each Canvas includes) are tracked separately.
 *
 * Comparison uses JSON serialisation for deep equality — appropriate for the
 * plain-object shapes of Node/Edge (no circular references, no functions).
 */
export function diffGraphSnapshot(
  before: GraphSnapshot,
  after: GraphSnapshot,
): GraphSnapshotDiff {
  const element_diffs: ElementDiff[] = [];

  // --- Node registry diff ---
  const allNodeIds = new Set([
    ...Object.keys(before.nodes),
    ...Object.keys(after.nodes),
  ]);
  for (const id of allNodeIds) {
    const b = before.nodes[id] ?? null;
    const a = after.nodes[id] ?? null;
    if (!elementsEqual(b, a)) {
      element_diffs.push({ kind: diffKind(b, a), element_type: "node", id, before: b, after: a });
    }
  }

  // --- Edge registry diff ---
  const allEdgeIds = new Set([
    ...Object.keys(before.edges),
    ...Object.keys(after.edges),
  ]);
  for (const id of allEdgeIds) {
    const b = before.edges[id] ?? null;
    const a = after.edges[id] ?? null;
    if (!elementsEqual(b, a)) {
      element_diffs.push({ kind: diffKind(b, a), element_type: "edge", id, before: b, after: a });
    }
  }

  // --- Canvas membership diff ---
  const canvas_membership_diffs: CanvasMembershipDiff[] = [];
  const beforeCanvasMap = indexCanvases(before.canvases);
  const afterCanvasMap = indexCanvases(after.canvases);
  const allCanvasIds = new Set([...Object.keys(beforeCanvasMap), ...Object.keys(afterCanvasMap)]);

  for (const canvas_id of allCanvasIds) {
    const b = beforeCanvasMap[canvas_id];
    const a = afterCanvasMap[canvas_id];
    const bNodeIds = new Set(b?.graph.node_ids ?? []);
    const aNodeIds = new Set(a?.graph.node_ids ?? []);
    const bEdgeIds = new Set(b?.graph.edge_ids ?? []);
    const aEdgeIds = new Set(a?.graph.edge_ids ?? []);

    const added_node_ids = [...aNodeIds].filter((id) => !bNodeIds.has(id));
    const removed_node_ids = [...bNodeIds].filter((id) => !aNodeIds.has(id));
    const added_edge_ids = [...aEdgeIds].filter((id) => !bEdgeIds.has(id));
    const removed_edge_ids = [...bEdgeIds].filter((id) => !aEdgeIds.has(id));

    if (added_node_ids.length || removed_node_ids.length || added_edge_ids.length || removed_edge_ids.length) {
      canvas_membership_diffs.push({ canvas_id, added_node_ids, removed_node_ids, added_edge_ids, removed_edge_ids });
    }
  }

  // --- Convenience indexes ---
  const degraded_ids: string[] = [];
  const recovered_ids: string[] = [];
  for (const diff of element_diffs) {
    if (diff.kind !== "changed") continue;
    const bFunc = (diff.before as Node | Edge)?.functionality ?? null;
    const aFunc = (diff.after as Node | Edge)?.functionality ?? null;
    if (bFunc !== null && aFunc !== null) {
      if (aFunc < bFunc) degraded_ids.push(diff.id);
      else if (aFunc > bFunc) recovered_ids.push(diff.id);
    }
  }

  return { element_diffs, canvas_membership_diffs, degraded_ids, recovered_ids };
}

// ---------------------------------------------------------------------------
// applyPropagationUpdates
// ---------------------------------------------------------------------------

/**
 * Merge engine ElementUpdate[] onto a GraphSnapshot, producing a new snapshot.
 *
 * This is the canonical way to build the "after" state in an AnyUpdateEntry
 * from a PropagationResult without going through the Zustand store.
 *
 * Each update's `id` is looked up directly in the global node/edge registry
 * (ADR-0001). No canvas_id or element_type discriminator is needed.
 *
 * Only the fields explicitly returned by the engine are touched; all other
 * node/edge fields are copied from the base snapshot unchanged.
 *
 * Monotone invariant: propagation can only worsen functionality, never improve
 * it. This function does NOT enforce that invariant — the engine is responsible.
 */
export function applyPropagationUpdates(
  base: GraphSnapshot,
  updates: ElementUpdate[],
): GraphSnapshot {
  // Shallow-clone the registry records so the original is not mutated.
  const nodes: Record<string, Node> = { ...base.nodes };
  const edges: Record<string, Edge> = { ...base.edges };

  for (const update of updates) {
    if (nodes[update.id]) {
      nodes[update.id] = applyUpdateToElement(nodes[update.id], update) as Node;
    } else if (edges[update.id]) {
      edges[update.id] = applyUpdateToElement(edges[update.id], update) as Edge;
    }
    // Unknown id: engine returned an update for an element not in this snapshot — skip.
  }

  return {
    nodes,
    edges,
    // Canvas membership (node_ids / edge_ids) is not changed by propagation.
    canvases: base.canvases,
  };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function applyUpdateToElement(
  element: Node | Edge,
  update: ElementUpdate,
): Node | Edge {
  return {
    ...element,
    functionality: update.functionality,
    ...(update.functionality_time !== undefined && { functionality_time: update.functionality_time }),
    ...(update.direct_damage !== undefined && { direct_damage: update.direct_damage }),
    ...(update.expected_repair_time !== undefined && { expected_repair_time: update.expected_repair_time }),
    ...(update.responsibility_share !== undefined && { responsibility_share: update.responsibility_share }),
    ...(update.properties !== undefined && { properties: { ...(element.properties ?? {}), ...update.properties } }),
  };
}

function indexCanvases(canvases: Canvas[]): Record<string, Canvas> {
  const map: Record<string, Canvas> = {};
  for (const c of canvases) map[c.id] = c;
  return map;
}

function elementsEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

function diffKind(before: unknown, after: unknown): DiffKind {
  if (before === null) return "added";
  if (after === null) return "removed";
  return "changed";
}
