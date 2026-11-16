/**
 * useFloatingPath — the live path of an edge between two nodes on the canvas.
 *
 * Reads both nodes' current absolute positions from React Flow (so the edge
 * follows a node while it is being dragged, and inside the All view's Canvas
 * regions) and asks lib/floating-edge.ts for the border-to-border path. The
 * edge bows only when the opposite edge (target → source) is drawn too.
 */

import { useInternalNode, useStore, type InternalNode } from "@xyflow/react";
import { nodeOutline, type Outline } from "@/lib/node-outline";
import { floatingPath, type FloatingPath } from "@/lib/floating-edge";

/** The drawn outline of a React Flow node, at its absolute position. */
export function outlineOf(node: InternalNode): Outline {
  return nodeOutline({
    type: node.type,
    position: node.internals.positionAbsolute,
    data: node.data,
    measured: node.measured,
  });
}

export function useFloatingPath(source: string, target: string): FloatingPath | null {
  const s = useInternalNode(source);
  const t = useInternalNode(target);
  // The reverse edge, if any, is among the edges arriving at this edge's source.
  // React Flow's per-node index (key `source`) files a → b and b → a under the
  // same pair key, so one hides the other; the per-direction index does not.
  const hasReverse = useStore((st) => {
    const incoming = st.connectionLookup.get(`${source}-target`);
    if (!incoming) return false;
    for (const c of incoming.values()) if (c.source === target) return true;
    return false;
  });
  if (!s || !t) return null;
  return floatingPath(outlineOf(s), outlineOf(t), hasReverse);
}
