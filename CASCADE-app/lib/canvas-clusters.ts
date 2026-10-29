/**
 * canvas-clusters.ts — collapsed Canvases in the Global view (display only).
 *
 * A collapsed Canvas is drawn as one cluster node that stands for all its
 * nodes and shows their Operativity. An edge with an end inside a collapsed
 * Canvas is redrawn to its cluster, and the edges that land on the same pair of
 * drawn ends are bundled into one, painted at the worst level among them. The
 * model and the Propagation are untouched: this only decides what is drawn.
 */

import type { Canvas, Edge, Node } from "@/lib/schemas/network";
import { computeOperativityScore } from "@/lib/scorecard-utils";

export const clusterNodeId = (canvasId: string): string => `cluster-${canvasId}`;

/** Each node's home Canvas: the first, in order, that lists it — the Global
 *  view draws a node shared by several Canvases once, in its home. */
export function homeCanvases(canvases: Canvas[], nodes: Record<string, Node>): Map<string, string> {
  const home = new Map<string, string>();
  for (const c of canvases) {
    for (const id of c.graph.node_ids) {
      if (nodes[id] && !home.has(id)) home.set(id, c.id);
    }
  }
  return home;
}

export interface DrawnEdge {
  id: string;
  source: string;
  target: string;
  /** The model edges this drawn edge stands for (one when nothing is bundled). */
  members: string[];
  functionality: number;
  isInterCanvas: boolean;
}

/** The edges to draw, once each, given which Canvases are collapsed. */
export function drawnEdges(
  canvases: Canvas[],
  edges: Record<string, Edge>,
  home: Map<string, string>,
  collapsed: ReadonlySet<string>,
): DrawnEdge[] {
  const end = (nodeId: string) => {
    const c = home.get(nodeId);
    return c !== undefined && collapsed.has(c) ? clusterNodeId(c) : nodeId;
  };
  const drawn = new Map<string, DrawnEdge>();
  const seen = new Set<string>();
  for (const c of canvases) {
    for (const eid of c.graph.edge_ids) {
      const e = edges[eid];
      if (!e || seen.has(eid) || !home.has(e.source) || !home.has(e.target)) continue;
      seen.add(eid);
      const source = end(e.source);
      const target = end(e.target);
      const bundled = source !== e.source || target !== e.target;
      if (bundled && source === target) continue; // inside one collapsed Canvas
      const key = bundled ? `bundle:${source}->${target}` : eid;
      const prior = drawn.get(key);
      if (prior) {
        prior.members.push(eid);
        prior.functionality = Math.min(prior.functionality, e.functionality);
      } else {
        drawn.set(key, {
          id: key, source, target, members: [eid], functionality: e.functionality,
          isInterCanvas: home.get(e.source) !== home.get(e.target),
        });
      }
    }
  }
  return [...drawn.values()];
}

/** What a cluster node shows: the Operativity (0–100) of the Canvas's nodes,
 *  with the same weighting the Analysis page uses, and how many nodes it holds. */
export function clusterSummary(
  c: Canvas,
  nodes: Record<string, Node>,
  n: number,
  weightAttr: string,
): { operativity: number; count: number } {
  const members = Object.fromEntries(
    c.graph.node_ids.filter((id) => nodes[id]).map((id) => [id, nodes[id]]),
  );
  return {
    operativity: Math.round(computeOperativityScore({ nodes: members, edges: {}, canvases: [] }, n, weightAttr)),
    count: Object.keys(members).length,
  };
}
