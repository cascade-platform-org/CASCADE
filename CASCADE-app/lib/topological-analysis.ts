/**
 * topological-analysis.ts
 *
 * Pure client-side graph analysis using graphology.
 * All functions are side-effect-free — they take graph data and return scores.
 * No Zustand store access here; callers build the input from store state.
 */

import Graph from "graphology";
import { betweenness, edgeBetweenness, closeness, eigenvector } from "graphology-metrics/centrality";
import louvain from "graphology-communities-louvain";
import { singleSource } from "graphology-shortest-path/unweighted";

import type { Node, Edge, Canvas } from "@/lib/schemas/network";

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface AnalysisGraph {
  nodes: Record<string, Node>;
  edges: Record<string, Edge>;
  /** All canvases — used to derive canvas membership for NofN metrics. */
  canvases: Canvas[];
}

// ---------------------------------------------------------------------------
// Scored result
// ---------------------------------------------------------------------------

export interface ElementScore {
  id: string;
  kind: "node" | "edge";
  score: number;
  rank: number;
}

export interface AnalysisResult {
  metric: string;
  scores: Record<string, number>;
  ranked: ElementScore[];
  min: number;
  max: number;
  avg: number;
}

// ---------------------------------------------------------------------------
// NofN structural metrics
// ---------------------------------------------------------------------------

export interface NofNMetrics {
  /** canvas_id → fraction of that canvas's nodes with ≥1 inter-canvas edge */
  interdependencyRatio: Record<string, number>;
  /** "canvasA|canvasB" → inter-canvas edges / (all edges for that pair) */
  couplingStrength: Record<string, number>;
  /** Cycle of canvas ids detected in the inter-canvas dependency graph */
  feedbackLoops: string[][];
  /** meta-graph: Canvas nodes + inter-canvas edge counts */
  metaGraph: { nodes: string[]; edges: Array<{ source: string; target: string; count: number }> };
}

// ---------------------------------------------------------------------------
// Percolation robustness
// ---------------------------------------------------------------------------

export interface PercolationPoint {
  fractionRemoved: number;
  giantComponentFraction: number;
}

// ---------------------------------------------------------------------------
// Weight expression
// ---------------------------------------------------------------------------

/**
 * The available attribute names for the weight expression builder.
 * Edge attributes are referenced by their bare name (e.g. `capacity`).
 * Node (target) attributes are referenced with the `n_` prefix (e.g. `n_importance`).
 */
export interface WeightExpressionContext {
  edgeAttrs: string[];
  nodeAttrs: string[]; // raw names — prefix n_ in expressions
}

/** Node/edge keys that are never useful as numeric weights. */
const NON_WEIGHT_KEYS = new Set([
  "id", "source", "target", "type", "label", "canvas_id",
  "node_categories", "icon", "direct_damage", "functionality_time",
  "time_restored", "x", "y", "positionAbsolute",
]);

/**
 * Schema-defined numeric attributes that are always offered as weight chips
 * even when absent from the current graph data (the expression evaluator
 * defaults missing attributes to 1, so they are safe to reference).
 */
const SCHEMA_EDGE_ATTRS: string[] = ["functionality", "capacity", "expected_repair_time"];
const SCHEMA_NODE_ATTRS: string[] = [
  "functionality", "importance", "cost_of_disservice_per_day", "expected_repair_time",
];

/**
 * Return the numeric attribute names available for weight expressions.
 * Schema-known attrs always appear first; custom attrs discovered in the
 * live graph data are appended afterwards.
 */
export function detectAttributes(data: AnalysisGraph): WeightExpressionContext {
  const edgeSet = new Set<string>(SCHEMA_EDGE_ATTRS);
  const nodeSet = new Set<string>(SCHEMA_NODE_ATTRS);
  // Append any custom numeric attrs found in the live data
  for (const edge of Object.values(data.edges).slice(0, 10)) {
    for (const [k, v] of Object.entries(edge as Record<string, unknown>)) {
      if (typeof v === "number" && !NON_WEIGHT_KEYS.has(k)) edgeSet.add(k);
    }
    // Numeric values inside the `properties` bag
    const props = (edge as Record<string, unknown>)["properties"];
    if (props && typeof props === "object") {
      for (const [k, v] of Object.entries(props as Record<string, unknown>)) {
        if (typeof v === "number") edgeSet.add(k);
      }
    }
  }
  for (const node of Object.values(data.nodes).slice(0, 10)) {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (typeof v === "number" && !NON_WEIGHT_KEYS.has(k)) nodeSet.add(k);
    }
    const props = (node as Record<string, unknown>)["properties"];
    if (props && typeof props === "object") {
      for (const [k, v] of Object.entries(props as Record<string, unknown>)) {
        if (typeof v === "number") nodeSet.add(k);
      }
    }
  }
  return { edgeAttrs: [...edgeSet], nodeAttrs: [...nodeSet] };
}

// ---------------------------------------------------------------------------
// Arithmetic expression evaluator (recursive descent, no eval/Function)
// ---------------------------------------------------------------------------

/**
 * Evaluate a simple arithmetic expression string.
 * Supported: +  −  *  /  parentheses  numeric literals  identifiers.
 * Unknown identifiers default to 1 (treats missing attributes as neutral).
 */
function evalArithExpr(expr: string, scope: Record<string, number>): number {
  let pos = 0;

  function skipWs() { while (pos < expr.length && expr[pos] === " ") pos++; }

  function parseAtom(): number {
    skipWs();
    if (pos < expr.length && expr[pos] === "(") {
      pos++;
      const v = parseAddSub();
      skipWs();
      if (pos < expr.length && expr[pos] === ")") pos++;
      return v;
    }
    if (pos < expr.length && /[\d.]/.test(expr[pos])) {
      let s = "";
      while (pos < expr.length && /[\d.]/.test(expr[pos])) s += expr[pos++];
      return parseFloat(s) || 0;
    }
    let ident = "";
    while (pos < expr.length && /[a-zA-Z0-9_]/.test(expr[pos])) ident += expr[pos++];
    return ident in scope ? scope[ident] : 1;
  }

  function parseUnary(): number {
    skipWs();
    if (pos < expr.length && expr[pos] === "-") { pos++; return -parseAtom(); }
    return parseAtom();
  }

  function parseMulDiv(): number {
    let left = parseUnary();
    skipWs();
    while (pos < expr.length && (expr[pos] === "*" || expr[pos] === "/")) {
      const op = expr[pos++];
      const right = parseUnary();
      left = op === "*" ? left * right : (right !== 0 ? left / right : 0);
      skipWs();
    }
    return left;
  }

  function parseAddSub(): number {
    let left = parseMulDiv();
    skipWs();
    while (pos < expr.length && (expr[pos] === "+" || expr[pos] === "-")) {
      const op = expr[pos++];
      const right = parseMulDiv();
      left = op === "+" ? left + right : left - right;
      skipWs();
    }
    return left;
  }

  try {
    const result = parseAddSub();
    return isFinite(result) ? Math.max(result, 0.01) : 1;
  } catch {
    return 1;
  }
}

/**
 * Compute the weight for an edge using an arithmetic expression string.
 *
 * Scope:
 *   - All numeric edge attributes → bare name  (e.g. `capacity`)
 *   - All numeric target-node attributes → `n_<name>`  (e.g. `n_importance`)
 *   - `n` → functionality scale length
 *
 * Target-node direction was chosen by the project owner; this makes "cost of
 * arriving at the destination" the natural framing for directed networks.
 */
export function computeEdgeWeight(
  expr: string,
  edge: Edge,
  nodes: Record<string, Node>,
  n: number,
): number {
  const scope: Record<string, number> = { n };
  for (const [k, v] of Object.entries(edge as Record<string, unknown>)) {
    if (typeof v === "number") scope[k] = v;
  }
  const edgeProps = (edge as Record<string, unknown>)["properties"];
  if (edgeProps && typeof edgeProps === "object") {
    for (const [k, v] of Object.entries(edgeProps as Record<string, unknown>)) {
      if (typeof v === "number") scope[k] = v;
    }
  }
  const targetNode = nodes[edge.target];
  if (targetNode) {
    for (const [k, v] of Object.entries(targetNode as Record<string, unknown>)) {
      if (typeof v === "number") scope[`n_${k}`] = v;
    }
    const nodeProps = (targetNode as Record<string, unknown>)["properties"];
    if (nodeProps && typeof nodeProps === "object") {
      for (const [k, v] of Object.entries(nodeProps as Record<string, unknown>)) {
        if (typeof v === "number") scope[`n_${k}`] = v;
      }
    }
  }
  return evalArithExpr(expr, scope);
}

// ---------------------------------------------------------------------------
// Categorical colour
// ---------------------------------------------------------------------------

/** Metrics that produce discrete values — use categorical/binary colour maps. */
export const CATEGORICAL_METRICS = new Set([
  "community",
  "articulation_points",
  "bridge_edges",
  "downstream_reachability",
  "upstream_reachability",
  "k_core",
]);

const CATEGORY_COLORS = [
  "#6366f1", "#ec4899", "#f59e0b", "#10b981",
  "#3b82f6", "#ef4444", "#8b5cf6", "#14b8a6",
  "#f97316", "#84cc16",
];

/** Maps a normalised value [0,1] to a light→dark indigo gradient. */
export function scoreToColor(normalised: number): string {
  const r = Math.round(224 + normalised * (49 - 224));
  const g = Math.round(231 + normalised * (46 - 231));
  const b = Math.round(255 + normalised * (129 - 255));
  return `rgb(${r},${g},${b})`;
}

function buildCategoricalColorMap(result: AnalysisResult): Record<string, string> {
  const map: Record<string, string> = {};
  const { scores, metric } = result;

  if (metric === "community") {
    const uniqueVals = [...new Set(Object.values(scores))].sort((a, b) => a - b);
    for (const [id, score] of Object.entries(scores)) {
      const idx = uniqueVals.indexOf(score);
      map[id] = CATEGORY_COLORS[idx % CATEGORY_COLORS.length];
    }
  } else if (metric === "articulation_points" || metric === "bridge_edges") {
    for (const [id, score] of Object.entries(scores)) {
      map[id] = score === 1 ? "#ef4444" : "#94a3b8";
    }
  } else if (metric === "downstream_reachability" || metric === "upstream_reachability") {
    for (const [id, score] of Object.entries(scores)) {
      if (score === 2) map[id] = "#4338ca";
      else if (score === 1) map[id] = "#818cf8";
      else map[id] = "#e2e8f0";
    }
  } else if (metric === "k_core") {
    const vals = Object.values(scores);
    const maxK = Math.max(...vals, 1);
    for (const [id, score] of Object.entries(scores)) {
      map[id] = scoreToColor(score / maxK);
    }
  }
  return map;
}

/** Build a colour map. Categorical metrics use discrete palettes; others use the indigo gradient. */
export function buildColorMap(result: AnalysisResult): Record<string, string> {
  if (CATEGORICAL_METRICS.has(result.metric)) return buildCategoricalColorMap(result);
  const { min, max, scores } = result;
  const range = max - min || 1;
  const map: Record<string, string> = {};
  for (const [id, score] of Object.entries(scores)) {
    map[id] = scoreToColor((score - min) / range);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Graph builders
// ---------------------------------------------------------------------------

/**
 * Build a directed graphology graph.
 *
 * Edge attributes added:
 *   `weight`   — connection strength  (for eigenvector; higher = stronger)
 *   `distance` — 1/strength           (for betweenness; lower = shorter path)
 */
function buildDirectedGraph(
  nodes: Record<string, Node>,
  edges: Record<string, Edge>,
  weightExpr: string = "capacity",
  n: number = 5,
): Graph {
  const G = new Graph({ type: "directed", multi: false, allowSelfLoops: false });
  for (const id of Object.keys(nodes)) G.addNode(id, { ...nodes[id] });
  for (const [id, edge] of Object.entries(edges)) {
    if (G.hasNode(edge.source) && G.hasNode(edge.target) && edge.source !== edge.target) {
      if (!G.hasEdge(edge.source, edge.target)) {
        const w = computeEdgeWeight(weightExpr, edge, nodes, n);
        G.addEdgeWithKey(id, edge.source, edge.target, { ...edge, weight: w, distance: 1 / w });
      }
    }
  }
  return G;
}

/**
 * Build an undirected graphology graph.
 * Parallel logical edges are collapsed to the first one encountered.
 */
function buildUndirectedGraph(
  nodes: Record<string, Node>,
  edges: Record<string, Edge>,
  weightExpr: string = "capacity",
  n: number = 5,
): Graph {
  const G = new Graph({ type: "undirected", multi: false, allowSelfLoops: false });
  for (const id of Object.keys(nodes)) G.addNode(id, { ...nodes[id] });
  for (const [id, edge] of Object.entries(edges)) {
    if (G.hasNode(edge.source) && G.hasNode(edge.target) && edge.source !== edge.target) {
      const key = [edge.source, edge.target].sort().join("__");
      if (!G.hasEdge(key)) {
        const w = computeEdgeWeight(weightExpr, edge, nodes, n);
        G.addEdgeWithKey(key, edge.source, edge.target, { weight: w, distance: 1 / w, originalEdgeId: id });
      }
    }
  }
  return G;
}

// ---------------------------------------------------------------------------
// Post-processing helpers
// ---------------------------------------------------------------------------

function toResult(metric: string, rawScores: Record<string, number>): AnalysisResult {
  const entries = Object.entries(rawScores);
  if (entries.length === 0) return { metric, scores: {}, ranked: [], min: 0, max: 0, avg: 0 };
  const values = entries.map(([, v]) => v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const ranked = entries
    .map(([id, score]) => ({ id, kind: "node" as const, score, rank: 0 }))
    .sort((a, b) => b.score - a.score);
  ranked.forEach((r, i) => (r.rank = i + 1));
  return { metric, scores: rawScores, ranked, min, max, avg };
}

function edgeScoresToResult(metric: string, rawScores: Record<string, number>): AnalysisResult {
  const entries = Object.entries(rawScores);
  if (entries.length === 0) return { metric, scores: {}, ranked: [], min: 0, max: 0, avg: 0 };
  const values = entries.map(([, v]) => v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const ranked = entries
    .map(([id, score]) => ({ id, kind: "edge" as const, score, rank: 0 }))
    .sort((a, b) => b.score - a.score);
  ranked.forEach((r, i) => (r.rank = i + 1));
  return { metric, scores: rawScores, ranked, min, max, avg };
}

// ---------------------------------------------------------------------------
// Node centrality metrics
// ---------------------------------------------------------------------------

export function computeNodeBetweenness(
  data: AnalysisGraph,
  weightExpr: string = "capacity",
  n: number = 5,
): AnalysisResult {
  const G = buildDirectedGraph(data.nodes, data.edges, weightExpr, n);
  const opts = weightExpr === "1"
    ? { normalized: true }
    : { normalized: true, getEdgeWeight: "distance" as const };
  const raw = betweenness(G, opts);
  return toResult("betweenness", raw as Record<string, number>);
}

export function computeCloseness(
  data: AnalysisGraph,
  _weightExpr: string = "capacity",
  n: number = 5,
): AnalysisResult {
  // graphology-metrics closeness is BFS-only (no getEdgeWeight support in this version).
  const G = buildDirectedGraph(data.nodes, data.edges, "1", n);
  const raw = closeness(G) as Record<string, number>;
  return toResult("closeness", raw);
}

export function computeEigenvector(
  data: AnalysisGraph,
  weightExpr: string = "capacity",
  n: number = 5,
): AnalysisResult {
  const G = buildDirectedGraph(data.nodes, data.edges, weightExpr, n);
  let raw: Record<string, number>;
  try {
    const opts = weightExpr === "1" ? {} : { getEdgeWeight: "weight" as const };
    raw = eigenvector(G, opts) as Record<string, number>;
  } catch {
    raw = {};
  }
  return toResult("eigenvector", raw);
}

/** Weighted degree = sum of edge strengths for all incident edges. */
export function computeDegree(
  data: AnalysisGraph,
  weightExpr: string = "capacity",
  n: number = 5,
): AnalysisResult {
  const G = buildDirectedGraph(data.nodes, data.edges, weightExpr, n);
  const scores: Record<string, number> = {};
  for (const id of Object.keys(data.nodes)) {
    if (!G.hasNode(id)) { scores[id] = 0; continue; }
    if (weightExpr === "1") {
      scores[id] = G.degree(id);
    } else {
      let total = 0;
      G.edges(id).forEach((e) => { total += G.getEdgeAttribute(e, "weight") as number; });
      scores[id] = total;
    }
  }
  return toResult("degree", scores);
}

export function computeInDegree(
  data: AnalysisGraph,
  weightExpr: string = "capacity",
  n: number = 5,
): AnalysisResult {
  const G = buildDirectedGraph(data.nodes, data.edges, weightExpr, n);
  const scores: Record<string, number> = {};
  for (const id of Object.keys(data.nodes)) {
    if (!G.hasNode(id)) { scores[id] = 0; continue; }
    if (weightExpr === "1") {
      scores[id] = G.inDegree(id);
    } else {
      let total = 0;
      G.inEdges(id).forEach((e) => { total += G.getEdgeAttribute(e, "weight") as number; });
      scores[id] = total;
    }
  }
  return toResult("in_degree", scores);
}

export function computeOutDegree(
  data: AnalysisGraph,
  weightExpr: string = "capacity",
  n: number = 5,
): AnalysisResult {
  const G = buildDirectedGraph(data.nodes, data.edges, weightExpr, n);
  const scores: Record<string, number> = {};
  for (const id of Object.keys(data.nodes)) {
    if (!G.hasNode(id)) { scores[id] = 0; continue; }
    if (weightExpr === "1") {
      scores[id] = G.outDegree(id);
    } else {
      let total = 0;
      G.outEdges(id).forEach((e) => { total += G.getEdgeAttribute(e, "weight") as number; });
      scores[id] = total;
    }
  }
  return toResult("out_degree", scores);
}

/**
 * K-Core decomposition.
 *
 * Each node is assigned its maximum k-core index: the largest k for which it
 * belongs to the subgraph where every node has degree ≥ k. Higher index =
 * more embedded in the network backbone.
 *
 * Uses the standard peeling algorithm (always topological, weight-independent).
 */
export function computeKCore(data: AnalysisGraph): AnalysisResult {
  const G = buildUndirectedGraph(data.nodes, data.edges, "1");
  const mutableDeg: Record<string, number> = {};
  for (const v of G.nodes()) mutableDeg[v] = G.degree(v);
  const kcore: Record<string, number> = {};
  const active = new Set(G.nodes());

  for (let k = 1; active.size > 0; k++) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const v of [...active]) {
        if (mutableDeg[v] < k) {
          kcore[v] = k - 1;
          active.delete(v);
          G.neighbors(v).forEach((u) => { if (active.has(u)) mutableDeg[u]--; });
          changed = true;
        }
      }
    }
  }

  const scores: Record<string, number> = {};
  for (const id of Object.keys(data.nodes)) scores[id] = kcore[id] ?? 0;
  return toResult("k_core", scores);
}

// ---------------------------------------------------------------------------
// Edge centrality metrics
// ---------------------------------------------------------------------------

export function computeEdgeBetweenness(
  data: AnalysisGraph,
  weightExpr: string = "capacity",
  n: number = 5,
): AnalysisResult {
  // buildDirectedGraph keys edges by their original CASCADE edge id, so no
  // originalEdgeId remapping is needed.
  const G = buildDirectedGraph(data.nodes, data.edges, weightExpr, n);
  const rawEdges: Record<string, number> = {};
  try {
    const opts = weightExpr === "1"
      ? { normalized: true }
      : { normalized: true, getEdgeWeight: "distance" as const };
    const scores = edgeBetweenness(G, opts) as Record<string, number>;
    for (const [key, score] of Object.entries(scores)) rawEdges[key] = score;
  } catch {
    // edgeBetweenness may fail on disconnected graphs
  }
  return edgeScoresToResult("edge_betweenness", rawEdges);
}

/**
 * Bridge edges — edges whose removal increases the number of connected
 * components (structural single points of failure for flow).
 * Uses Tarjan's bridge-finding DFS. Always topological (weight-independent).
 */
export function computeBridgeEdges(data: AnalysisGraph): AnalysisResult {
  const G = buildUndirectedGraph(data.nodes, data.edges, "1");

  const visited = new Set<string>();
  const disc: Record<string, number> = {};
  const low: Record<string, number> = {};
  const bridgeGraphKeys = new Set<string>();
  let timer = 0;

  function dfs(u: string, parentEdgeKey: string | null): void {
    visited.add(u);
    disc[u] = low[u] = ++timer;
    G.edges(u).forEach((edgeKey) => {
      if (edgeKey === parentEdgeKey) return;
      const [s, t] = G.extremities(edgeKey);
      const v = s === u ? t : s;
      if (!visited.has(v)) {
        dfs(v, edgeKey);
        low[u] = Math.min(low[u], low[v]);
        if (low[v] > disc[u]) bridgeGraphKeys.add(edgeKey);
      } else {
        low[u] = Math.min(low[u], disc[v]);
      }
    });
  }

  for (const node of G.nodes()) {
    if (!visited.has(node)) dfs(node, null);
  }

  // Map graphology edge keys back to original CASCADE edge IDs
  const bridgeOrigIds = new Set<string>();
  for (const key of bridgeGraphKeys) {
    const origId = G.getEdgeAttribute(key, "originalEdgeId") as string | undefined;
    if (origId) bridgeOrigIds.add(origId);
  }

  const scores: Record<string, number> = {};
  for (const edgeId of Object.keys(data.edges)) {
    scores[edgeId] = bridgeOrigIds.has(edgeId) ? 1 : 0;
  }
  return edgeScoresToResult("bridge_edges", scores);
}

// ---------------------------------------------------------------------------
// Reachability (BFS cones)
// ---------------------------------------------------------------------------

/** Downstream reachability cone: highlights all nodes reachable from `sourceId`. */
export function computeDownstreamReachability(data: AnalysisGraph, sourceId: string): AnalysisResult {
  const G = buildDirectedGraph(data.nodes, data.edges);
  const coneScores: Record<string, number> = {};
  for (const id of Object.keys(data.nodes)) coneScores[id] = 0;

  if (G.hasNode(sourceId)) {
    const coneFromSource = singleSource(G, sourceId);
    for (const id of Object.keys(coneFromSource)) {
      if (id in coneScores) coneScores[id] = 1;
    }
    coneScores[sourceId] = 2;
  }
  return toResult("downstream_reachability", coneScores);
}

/** Upstream reachability cone: highlights all nodes that can reach `targetId`. */
export function computeUpstreamReachability(data: AnalysisGraph, targetId: string): AnalysisResult {
  const G = buildDirectedGraph(data.nodes, data.edges);
  const Greverse = new Graph({ type: "directed", multi: false, allowSelfLoops: false });
  for (const id of Object.keys(data.nodes)) Greverse.addNode(id);
  G.forEachEdge((_key, _attrs, src, tgt) => {
    if (!Greverse.hasEdge(tgt, src)) Greverse.addEdge(tgt, src);
  });

  const coneScores: Record<string, number> = {};
  for (const id of Object.keys(data.nodes)) coneScores[id] = 0;

  if (Greverse.hasNode(targetId)) {
    const paths = singleSource(Greverse, targetId);
    for (const id of Object.keys(paths)) coneScores[id] = 1;
    coneScores[targetId] = 2;
  }
  return toResult("upstream_reachability", coneScores);
}

/** Per-node downstream reachability count (all nodes, no single source). */
export function computeDownstreamReachabilityAll(data: AnalysisGraph): AnalysisResult {
  const G = buildDirectedGraph(data.nodes, data.edges);
  const scores: Record<string, number> = {};
  for (const id of Object.keys(data.nodes)) {
    if (!G.hasNode(id)) { scores[id] = 0; continue; }
    const paths = singleSource(G, id);
    scores[id] = Object.keys(paths).length - 1;
  }
  return toResult("downstream_reach_count", scores);
}

/** Per-node upstream reachability count (all nodes). */
export function computeUpstreamReachabilityAll(data: AnalysisGraph): AnalysisResult {
  const G = buildDirectedGraph(data.nodes, data.edges);
  const Greverse = new Graph({ type: "directed", multi: false, allowSelfLoops: false });
  for (const id of Object.keys(data.nodes)) Greverse.addNode(id);
  G.forEachEdge((_key, _attrs, src, tgt) => {
    if (!Greverse.hasEdge(tgt, src)) Greverse.addEdge(tgt, src);
  });
  const scores: Record<string, number> = {};
  for (const id of Object.keys(data.nodes)) {
    if (!Greverse.hasNode(id)) { scores[id] = 0; continue; }
    const paths = singleSource(Greverse, id);
    scores[id] = Object.keys(paths).length - 1;
  }
  return toResult("upstream_reach_count", scores);
}

// ---------------------------------------------------------------------------
// Structural — articulation points and bridge edges
// ---------------------------------------------------------------------------

function findArticulationPoints(G: Graph): Set<string> {
  const visited = new Set<string>();
  const disc: Record<string, number> = {};
  const low: Record<string, number> = {};
  const parent: Record<string, string | null> = {};
  const ap = new Set<string>();
  let timer = 0;

  function dfs(u: string) {
    visited.add(u);
    disc[u] = low[u] = ++timer;
    let childCount = 0;
    G.neighbors(u).forEach((v) => {
      if (!visited.has(v)) {
        childCount++;
        parent[v] = u;
        dfs(v);
        low[u] = Math.min(low[u], low[v]);
        if (parent[u] === null && childCount > 1) ap.add(u);
        if (parent[u] !== null && low[v] >= disc[u]) ap.add(u);
      } else if (v !== parent[u]) {
        low[u] = Math.min(low[u], disc[v]);
      }
    });
  }

  for (const node of G.nodes()) {
    if (!visited.has(node)) { parent[node] = null; dfs(node); }
  }
  return ap;
}

export function computeArticulationPoints(data: AnalysisGraph): AnalysisResult {
  const G = buildUndirectedGraph(data.nodes, data.edges);
  const ap = findArticulationPoints(G);
  const scores: Record<string, number> = {};
  for (const id of Object.keys(data.nodes)) scores[id] = ap.has(id) ? 1 : 0;
  return toResult("articulation_points", scores);
}

// ---------------------------------------------------------------------------
// Community detection (Louvain)
// ---------------------------------------------------------------------------

export function computeCommunities(data: AnalysisGraph): AnalysisResult {
  const G = buildUndirectedGraph(data.nodes, data.edges);
  let communities: Record<string, number> = {};
  try {
    communities = louvain(G) as Record<string, number>;
  } catch {
    for (const id of Object.keys(data.nodes)) communities[id] = 0;
  }
  return toResult("community", communities);
}

// ---------------------------------------------------------------------------
// Percolation robustness curve
// ---------------------------------------------------------------------------

function giantComponentFraction(G: Graph, excludedNodes: Set<string>): number {
  const visited = new Set<string>();
  let maxSize = 0;
  const allNodes = G.nodes().filter((n) => !excludedNodes.has(n));
  const total = allNodes.length;
  if (total === 0) return 0;

  for (const start of allNodes) {
    if (visited.has(start)) continue;
    const stack = [start];
    let size = 0;
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (visited.has(node)) continue;
      visited.add(node);
      size++;
      G.neighbors(node).forEach((nb) => {
        if (!excludedNodes.has(nb) && !visited.has(nb)) stack.push(nb);
      });
    }
    if (size > maxSize) maxSize = size;
  }
  return maxSize / total;
}

/**
 * Simulates targeted-attack percolation: remove nodes one-by-one in descending
 * order of their score and measure the remaining giant component fraction.
 */
export function computePercolationCurve(
  data: AnalysisGraph,
  orderedNodeIds: string[],
): PercolationPoint[] {
  const G = buildUndirectedGraph(data.nodes, data.edges);
  const excluded = new Set<string>();
  const total = orderedNodeIds.length;
  const curve: PercolationPoint[] = [];

  curve.push({ fractionRemoved: 0, giantComponentFraction: giantComponentFraction(G, excluded) });

  for (let i = 0; i < orderedNodeIds.length; i++) {
    excluded.add(orderedNodeIds[i]);
    const fractionRemoved = (i + 1) / total;
    if ((i + 1) % Math.max(1, Math.floor(total * 0.05)) === 0 || i === total - 1) {
      curve.push({ fractionRemoved, giantComponentFraction: giantComponentFraction(G, excluded) });
    }
  }
  return curve;
}

// ---------------------------------------------------------------------------
// Network-of-Networks structural metrics
// ---------------------------------------------------------------------------

export function computeNofNMetrics(data: AnalysisGraph): NofNMetrics {
  const { edges, canvases } = data;

  const canvasNodeIds: Record<string, Set<string>> = {};
  for (const canvas of canvases) canvasNodeIds[canvas.id] = new Set(canvas.graph.node_ids);

  const nodeToCanvases: Record<string, string[]> = {};
  for (const [canvasId, nodeSet] of Object.entries(canvasNodeIds)) {
    for (const nodeId of nodeSet) {
      if (!nodeToCanvases[nodeId]) nodeToCanvases[nodeId] = [];
      nodeToCanvases[nodeId].push(canvasId);
    }
  }

  const interCanvasEdges: Array<{ id: string; sourceCanvas: string; targetCanvas: string }> = [];
  for (const [edgeId, edge] of Object.entries(edges)) {
    const srcCanvases = nodeToCanvases[edge.source] ?? [];
    const tgtCanvases = nodeToCanvases[edge.target] ?? [];
    const srcSet = new Set(srcCanvases);
    const shared = tgtCanvases.some((c) => srcSet.has(c));
    if (!shared && srcCanvases.length > 0 && tgtCanvases.length > 0) {
      interCanvasEdges.push({ id: edgeId, sourceCanvas: srcCanvases[0], targetCanvas: tgtCanvases[0] });
    }
  }

  const interdependencyRatio: Record<string, number> = {};
  for (const canvas of canvases) {
    const nodeSet = canvasNodeIds[canvas.id];
    if (nodeSet.size === 0) { interdependencyRatio[canvas.id] = 0; continue; }
    const nodesWithInterCanvas = new Set<string>();
    for (const ice of interCanvasEdges) {
      const edge = edges[ice.id];
      if (nodeSet.has(edge.source)) nodesWithInterCanvas.add(edge.source);
      if (nodeSet.has(edge.target)) nodesWithInterCanvas.add(edge.target);
    }
    interdependencyRatio[canvas.id] = nodesWithInterCanvas.size / nodeSet.size;
  }

  const pairEdgeCounts: Record<string, { inter: number; total: number }> = {};
  for (const canvas of canvases) {
    const nodeSet = canvasNodeIds[canvas.id];
    let totalEdges = 0;
    for (const edge of Object.values(edges)) {
      if (nodeSet.has(edge.source) || nodeSet.has(edge.target)) totalEdges++;
    }
    for (const ice of interCanvasEdges) {
      if (ice.sourceCanvas === canvas.id || ice.targetCanvas === canvas.id) {
        const pairKey = [ice.sourceCanvas, ice.targetCanvas].sort().join("|");
        if (!pairEdgeCounts[pairKey]) pairEdgeCounts[pairKey] = { inter: 0, total: 0 };
        pairEdgeCounts[pairKey].inter++;
      }
    }
    for (const key of Object.keys(pairEdgeCounts)) {
      if (key.includes(canvas.id)) pairEdgeCounts[key].total += totalEdges;
    }
  }
  const couplingStrength: Record<string, number> = {};
  for (const [key, { inter, total }] of Object.entries(pairEdgeCounts)) {
    couplingStrength[key] = total > 0 ? inter / total : 0;
  }

  const canvasIds = canvases.map((c) => c.id);
  const metaAdj: Record<string, Set<string>> = {};
  for (const id of canvasIds) metaAdj[id] = new Set();
  for (const ice of interCanvasEdges) metaAdj[ice.sourceCanvas]?.add(ice.targetCanvas);

  const feedbackLoops: string[][] = [];
  const recStack = new Set<string>();
  const globalVisited = new Set<string>();
  const path: string[] = [];

  function dfsCycle(node: string): void {
    globalVisited.add(node);
    recStack.add(node);
    path.push(node);
    for (const neighbor of (metaAdj[node] ?? [])) {
      if (!globalVisited.has(neighbor)) dfsCycle(neighbor);
      else if (recStack.has(neighbor)) {
        const cycleStart = path.indexOf(neighbor);
        if (cycleStart !== -1) feedbackLoops.push([...path.slice(cycleStart)]);
      }
    }
    path.pop();
    recStack.delete(node);
  }

  for (const id of canvasIds) { if (!globalVisited.has(id)) dfsCycle(id); }

  const metaEdgeCounts: Record<string, number> = {};
  for (const ice of interCanvasEdges) {
    const key = `${ice.sourceCanvas}→${ice.targetCanvas}`;
    metaEdgeCounts[key] = (metaEdgeCounts[key] ?? 0) + 1;
  }
  const metaEdges = Object.entries(metaEdgeCounts).map(([key, count]) => {
    const [source, target] = key.split("→");
    return { source, target, count };
  });

  return { interdependencyRatio, couplingStrength, feedbackLoops, metaGraph: { nodes: canvasIds, edges: metaEdges } };
}

// ---------------------------------------------------------------------------
// Label field computation (for results list)
// ---------------------------------------------------------------------------

export type LabelField = "name" | "importance" | "cost" | "weighted_loss" | "functionality";

export function getElementLabel(
  id: string,
  kind: "node" | "edge",
  nodes: Record<string, Node>,
  edges: Record<string, Edge>,
  field: LabelField,
  n: number,
): string {
  if (kind === "edge") {
    const edge = edges[id];
    if (!edge) return id;
    return `${edge.source} → ${edge.target}`;
  }
  const node = nodes[id];
  if (!node) return id;
  switch (field) {
    case "name": return node.label || id;
    case "importance": return node.importance != null ? `importance: ${node.importance}` : "—";
    case "cost": return node.cost_of_disservice_per_day != null ? `cost: ${node.cost_of_disservice_per_day}/day` : "—";
    case "weighted_loss": {
      const imp = node.importance ?? 1;
      const loss = imp * ((n - node.functionality) / Math.max(n - 1, 1));
      return `loss: ${loss.toFixed(2)}`;
    }
    case "functionality": return `func: ${node.functionality}/${n}`;
    default: return node.label || id;
  }
}
