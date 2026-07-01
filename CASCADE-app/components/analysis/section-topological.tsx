"use client";

import React, { useState, useMemo, useCallback } from "react";
import { RefreshCw, BarChart3, Layers } from "lucide-react";
import { useAnalysisStore } from "@/store/analysis-store";
import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore, selectN } from "@/store/config-store";
import { ResultsList } from "./results-list";
import { HeatmapControls } from "./heatmap-controls";
import { PercolationChart } from "./percolation-chart";
import { buildScopedGraph } from "@/lib/analysis-utils";
import {
  computeNodeBetweenness,
  computeEdgeBetweenness,
  computeCloseness,
  computeEigenvector,
  computeDegree,
  computeInDegree,
  computeOutDegree,
  computeKCore,
  computeBridgeEdges,
  computePercolationCurve,
  detectAttributes,
  computeEdgeWeight,
  type AnalysisGraph,
  type AnalysisResult,
} from "@/lib/topological-analysis";
import type { NodeCentralityMetric, EdgeCentralityMetric } from "@/store/analysis-store";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Metric definitions
// ---------------------------------------------------------------------------

interface MetricDef<T extends string> {
  id: T;
  label: string;
  description: string;
  /** How a higher weight value affects this metric's score. Omitted for unweighted metrics. */
  weightMeaning?: string;
  recommended: string[];
  /** true → weight expression has no effect (purely topological) */
  unweighted?: boolean;
}

const NODE_METRICS: MetricDef<NodeCentralityMetric>[] = [
  {
    id: "betweenness", label: "Betweenness",
    description: "Relay nodes that mediate the most paths — bottleneck relay points.",
    weightMeaning: "Higher weight = preferred route (used as 1/weight distance). Nodes on high-weight corridors score higher.",
    recommended: ["SourceToDemands", "global"],
  },
  {
    id: "closeness", label: "Closeness",
    description: "Nodes closest to all others on average.",
    recommended: [], unweighted: true,
  },
  {
    id: "eigenvector", label: "Eigenvector",
    description: "Nodes connected to other high-scoring nodes — influence hubs.",
    weightMeaning: "Higher weight = stronger connection to influential neighbors → higher score propagated back.",
    recommended: ["global"],
  },
  {
    id: "degree", label: "Degree",
    description: "Total connection strength — sum of all edge weights.",
    weightMeaning: "Higher weight = more counted connection strength. Use 1 for a pure hop count.",
    recommended: [],
  },
  {
    id: "in_degree", label: "In-Degree",
    description: "Weighted in-connection strength — how heavily this node depends on its suppliers.",
    weightMeaning: "Higher weight on incoming edges = node is more heavily supplied/dependent.",
    recommended: ["Requisite"],
  },
  {
    id: "out_degree", label: "Out-Degree",
    description: "Weighted out-connection strength — how heavily this node pushes downstream.",
    weightMeaning: "Higher weight on outgoing edges = node has stronger downstream impact.",
    recommended: ["Requisite"],
  },
  {
    id: "k_core", label: "K-Core",
    description: "Maximum shell index — higher = more embedded in the network backbone.",
    recommended: ["global"], unweighted: true,
  },
];

const EDGE_METRICS: MetricDef<EdgeCentralityMetric>[] = [
  {
    id: "edge_betweenness", label: "Edge Betweenness",
    description: "Critical links — edges that mediate the most shortest paths.",
    weightMeaning: "Higher weight = preferred route (1/weight distance). High-weight edges appear on more paths and score higher.",
    recommended: ["SourceToDemands"],
  },
  {
    id: "bridge_edges", label: "Bridge Edges",
    description: "Edges whose removal disconnects the graph — structural single points of failure.",
    recommended: ["global"], unweighted: true,
  },
];

// ---------------------------------------------------------------------------
// Compute dispatchers
// ---------------------------------------------------------------------------

function computeNodeMetric(
  metric: NodeCentralityMetric,
  graph: AnalysisGraph,
  weightExpr: string,
  n: number,
): AnalysisResult {
  switch (metric) {
    case "betweenness": return computeNodeBetweenness(graph, weightExpr, n);
    case "closeness":   return computeCloseness(graph, weightExpr, n);
    case "eigenvector": return computeEigenvector(graph, weightExpr, n);
    case "degree":      return computeDegree(graph, weightExpr, n);
    case "in_degree":   return computeInDegree(graph, weightExpr, n);
    case "out_degree":  return computeOutDegree(graph, weightExpr, n);
    case "k_core":      return computeKCore(graph);
  }
}

function computeEdgeMetric(
  metric: EdgeCentralityMetric,
  graph: AnalysisGraph,
): AnalysisResult {
  switch (metric) {
    case "edge_betweenness": return computeEdgeBetweenness(graph);
    case "bridge_edges":     return computeBridgeEdges(graph);
  }
}

// ---------------------------------------------------------------------------
// Section component
// ---------------------------------------------------------------------------

export function SectionTopological() {
  // Store
  const nodeResult = useAnalysisStore((s) => s.result);
  const edgeResult = useAnalysisStore((s) => s.topologicalEdgeResult);
  const setNodeResult = useAnalysisStore((s) => s.setResult);
  const setEdgeResult = useAnalysisStore((s) => s.setTopologicalEdgeResult);
  const percolationCurve = useAnalysisStore((s) => s.percolationCurve);
  const setPercolationCurve = useAnalysisStore((s) => s.setPercolationCurve);
  const scope = useAnalysisStore((s) => s.scope);
  const weightExpr = useAnalysisStore((s) => s.weightExpression);
  const setWeightExpr = useAnalysisStore((s) => s.setWeightExpression);

  const n = useConfigStore(selectN);
  const activeCanvasId = useCanvasStore((s) => s.activeCanvasId);

  // Local active metric selections
  const [activeNodeMetric, setActiveNodeMetric] = useState<NodeCentralityMetric>("betweenness");
  const [activeEdgeMetric, setActiveEdgeMetric] = useState<EdgeCentralityMetric>("edge_betweenness");
  const [computingNode, setComputingNode] = useState(false);
  const [computingEdge, setComputingEdge] = useState(false);
  const [exprInput, setExprInput] = useState(weightExpr);

  // Attribute picker: detect available attrs from the live graph
  const attrCtx = useMemo(() => {
    const graph = buildScopedGraph(scope, activeCanvasId);
    return detectAttributes(graph);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, activeCanvasId]);

  // Preview the weight of the first edge for the current expression
  const exprPreview = useMemo(() => {
    const graph = buildScopedGraph(scope, activeCanvasId);
    const firstEdge = Object.values(graph.edges)[0];
    if (!firstEdge) return null;
    try {
      const w = computeEdgeWeight(exprInput, firstEdge, graph.nodes, n);
      return w.toFixed(3);
    } catch {
      return "error";
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exprInput, scope, activeCanvasId, n]);

  const commitExpr = useCallback(() => {
    const trimmed = exprInput.trim() || "capacity";
    setExprInput(trimmed);
    setWeightExpr(trimmed);
  }, [exprInput, setWeightExpr]);

  function insertToken(token: string) {
    setExprInput((prev) => (prev ? prev + " " + token : token));
  }

  async function handleComputeNode() {
    setComputingNode(true);
    setNodeResult(null);
    setPercolationCurve(null);
    try {
      const graph = buildScopedGraph(scope, activeCanvasId);
      const r = computeNodeMetric(activeNodeMetric, graph, weightExpr, n);
      setNodeResult(r);
      const orderedIds = r.ranked.filter((e) => e.kind === "node").map((e) => e.id);
      setPercolationCurve(computePercolationCurve(graph, orderedIds));
    } finally {
      setComputingNode(false);
    }
  }

  async function handleComputeEdge() {
    setComputingEdge(true);
    setEdgeResult(null);
    try {
      const graph = buildScopedGraph(scope, activeCanvasId);
      setEdgeResult(computeEdgeMetric(activeEdgeMetric, graph));
    } finally {
      setComputingEdge(false);
    }
  }

  async function handleComputeBoth() {
    setComputingNode(true);
    setComputingEdge(true);
    setNodeResult(null);
    setEdgeResult(null);
    setPercolationCurve(null);
    try {
      const graph = buildScopedGraph(scope, activeCanvasId);
      const [nr, er] = [
        computeNodeMetric(activeNodeMetric, graph, weightExpr, n),
        computeEdgeMetric(activeEdgeMetric, graph),
      ];
      setNodeResult(nr);
      setEdgeResult(er);
      const orderedIds = nr.ranked.filter((e) => e.kind === "node").map((e) => e.id);
      setPercolationCurve(computePercolationCurve(graph, orderedIds));
    } finally {
      setComputingNode(false);
      setComputingEdge(false);
    }
  }

  const activeNodeDef = NODE_METRICS.find((m) => m.id === activeNodeMetric);
  const activeEdgeDef = EDGE_METRICS.find((m) => m.id === activeEdgeMetric);
  const activeNodeUnweighted = activeNodeDef?.unweighted ?? false;
  const computing = computingNode || computingEdge;

  return (
    <div className="space-y-5">
      {/* ── Node metrics ── */}
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">Node Metrics</p>
        <div className="space-y-0.5">
          {NODE_METRICS.map((m) => (
            <button
              key={m.id}
              onClick={() => setActiveNodeMetric(m.id)}
              className={cn(
                "flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors",
                activeNodeMetric === m.id
                  ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300"
                  : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-medium">{m.label}</span>
                  {m.recommended.length > 0 && (
                    <span className="text-[9px] text-amber-500">★ {m.recommended.join(", ")}</span>
                  )}
                  {m.unweighted && (
                    <span className="text-[9px] text-zinc-400">(topology only)</span>
                  )}
                </div>
                <div className="mt-0.5 text-[10px] text-zinc-400">{m.description}</div>
                {activeNodeMetric === m.id && m.weightMeaning && (
                  <div className="mt-1 text-[10px] italic text-indigo-400 dark:text-indigo-500">
                    Weight: {m.weightMeaning}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Edge metrics ── */}
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">Edge Metrics</p>
        <div className="space-y-0.5">
          {EDGE_METRICS.map((m) => (
            <button
              key={m.id}
              onClick={() => setActiveEdgeMetric(m.id)}
              className={cn(
                "flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors",
                activeEdgeMetric === m.id
                  ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300"
                  : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-medium">{m.label}</span>
                  {m.recommended.length > 0 && (
                    <span className="text-[9px] text-amber-500">★ {m.recommended.join(", ")}</span>
                  )}
                  {m.unweighted && (
                    <span className="text-[9px] text-zinc-400">(topology only)</span>
                  )}
                </div>
                <div className="mt-0.5 text-[10px] text-zinc-400">{m.description}</div>
                {activeEdgeMetric === m.id && m.weightMeaning && (
                  <div className="mt-1 text-[10px] italic text-indigo-400 dark:text-indigo-500">
                    Weight: {m.weightMeaning}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Weight expression ── */}
      <div className="space-y-2 rounded-lg border border-zinc-100 p-3 dark:border-zinc-800">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
          Weight expression
          {activeNodeUnweighted && (
            <span className="ml-2 normal-case font-normal text-zinc-400">(ignored for selected node metric)</span>
          )}
        </p>

        {/* Expression input */}
        <div className="flex items-center gap-1.5">
          <input
            value={exprInput}
            onChange={(e) => setExprInput(e.target.value)}
            onBlur={commitExpr}
            onKeyDown={(e) => { if (e.key === "Enter") { e.currentTarget.blur(); } }}
            placeholder="e.g. capacity * n_importance"
            className="flex-1 rounded border border-zinc-200 bg-white px-2 py-1 text-xs font-mono text-zinc-700 focus:outline-none focus:ring-1 focus:ring-indigo-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
          />
          {exprPreview !== null && (
            <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-mono text-zinc-500 dark:bg-zinc-800">
              ={exprPreview}
            </span>
          )}
        </div>

        {/* Attribute chips */}
        {(attrCtx.edgeAttrs.length > 0 || attrCtx.nodeAttrs.length > 0) && (
          <div className="space-y-1.5">
            {attrCtx.edgeAttrs.length > 0 && (
              <div className="flex flex-wrap gap-1">
                <span className="text-[10px] text-zinc-400 self-center">edge:</span>
                {attrCtx.edgeAttrs.map((a) => (
                  <button key={a} onClick={() => insertToken(a)}
                    className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-mono text-zinc-600 hover:bg-indigo-50 hover:text-indigo-700 dark:bg-zinc-700 dark:text-zinc-300 dark:hover:bg-indigo-900/30">
                    {a}
                  </button>
                ))}
              </div>
            )}
            {attrCtx.nodeAttrs.length > 0 && (
              <div className="flex flex-wrap gap-1">
                <span className="text-[10px] text-zinc-400 self-center">node (target):</span>
                {attrCtx.nodeAttrs.map((a) => (
                  <button key={a} onClick={() => insertToken(`n_${a}`)}
                    className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-mono text-violet-600 hover:bg-violet-50 dark:bg-zinc-700 dark:text-violet-300 dark:hover:bg-violet-900/30">
                    n_{a}
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-1">
              <span className="text-[10px] text-zinc-400 self-center">ops:</span>
              {["+", "-", "*", "/", "(", ")"].map((op) => (
                <button key={op} onClick={() => insertToken(op)}
                  className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-mono text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-700 dark:text-zinc-300">
                  {op}
                </button>
              ))}
              <button onClick={() => setExprInput("1")}
                className="ml-1 rounded border border-zinc-200 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
                uniform
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Compute buttons ── */}
      <div className="flex gap-2">
        <button
          onClick={handleComputeNode}
          disabled={computingNode}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-2 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-300"
        >
          {computingNode ? <RefreshCw size={12} className="animate-spin" /> : <BarChart3 size={12} />}
          {computingNode ? "…" : "Node"}
        </button>
        <button
          onClick={handleComputeEdge}
          disabled={computingEdge}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-2 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-300"
        >
          {computingEdge ? <RefreshCw size={12} className="animate-spin" /> : <BarChart3 size={12} />}
          {computingEdge ? "…" : "Edge"}
        </button>
        <button
          onClick={handleComputeBoth}
          disabled={computing}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-2 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {computing ? <RefreshCw size={12} className="animate-spin" /> : <Layers size={12} />}
          {computing ? "…" : "Both"}
        </button>
      </div>

      {/* ── Heatmap (merged node + edge) ── */}
      {(nodeResult || edgeResult) && (
        <HeatmapControls result={nodeResult ?? undefined} edgeResult={edgeResult ?? undefined} />
      )}

      {/* ── Results panels ── */}
      <div className={cn("space-y-4", nodeResult && edgeResult && "grid grid-cols-1 gap-4 space-y-0")}>
        {nodeResult && (
          <div className="space-y-2">
            {nodeResult && edgeResult && (
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
                Node — {activeNodeDef?.label}
              </p>
            )}
            <ResultsList result={nodeResult} />
          </div>
        )}
        {edgeResult && (
          <div className="space-y-2">
            {nodeResult && edgeResult && (
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
                Edge — {activeEdgeDef?.label}
              </p>
            )}
            <ResultsList result={edgeResult} />
          </div>
        )}
      </div>

      {/* ── Percolation curve (node metric) ── */}
      {percolationCurve && percolationCurve.length > 1 && nodeResult && (
        <div className="rounded-lg border border-zinc-100 p-3 dark:border-zinc-800">
          <PercolationChart
            curve={percolationCurve}
            title={`Percolation — ${activeNodeDef?.label}`}
          />
          <p className="mt-1 text-[10px] text-zinc-400">
            Targeted attack: nodes removed highest→lowest by {activeNodeDef?.label}.
          </p>
        </div>
      )}

      {!nodeResult && !edgeResult && !computing && (
        <div className="py-8 text-center text-xs text-zinc-400">
          <BarChart3 className="mx-auto mb-2 opacity-30" size={28} />
          Select metrics and click Node, Edge, or Both.
        </div>
      )}
    </div>
  );
}
