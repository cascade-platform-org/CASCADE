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
import { scoredMetricById, scoredMetricsFor } from "@/lib/analysis-metrics";
import {
  computePercolationCurve,
  detectAttributes,
  computeEdgeWeight,
} from "@/lib/topological-analysis";
import type { NodeCentralityMetric, EdgeCentralityMetric } from "@/store/analysis-store";
import { cn } from "@/lib/utils";

// Both selectors read the one registry, so a metric offered here is a metric
// that is fully defined — label, description, weight behaviour and all.
const NODE_METRICS = scoredMetricsFor("topological", "node");
const EDGE_METRICS = scoredMetricsFor("topological", "edge");

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

  // Resolved once; the compute handlers close over them.
  const activeNodeDef = scoredMetricById(activeNodeMetric);
  const activeEdgeDef = scoredMetricById(activeEdgeMetric);

  // Attribute picker: detect available attrs from the live graph
  const attrCtx = useMemo(() => {
    const graph = buildScopedGraph(scope, activeCanvasId);
    return detectAttributes(graph);
   
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
    if (!activeNodeDef) return;
    setComputingNode(true);
    setNodeResult(null);
    setPercolationCurve(null);
    try {
      const graph = buildScopedGraph(scope, activeCanvasId);
      const r = activeNodeDef.run({ graph, weightExpr, n });
      setNodeResult(r);
      const orderedIds = r.ranked.filter((e) => e.kind === "node").map((e) => e.id);
      setPercolationCurve(computePercolationCurve(graph, orderedIds));
    } finally {
      setComputingNode(false);
    }
  }

  async function handleComputeEdge() {
    if (!activeEdgeDef) return;
    setComputingEdge(true);
    setEdgeResult(null);
    try {
      const graph = buildScopedGraph(scope, activeCanvasId);
      setEdgeResult(activeEdgeDef.run({ graph, weightExpr, n }));
    } finally {
      setComputingEdge(false);
    }
  }

  async function handleComputeBoth() {
    if (!activeNodeDef || !activeEdgeDef) return;
    setComputingNode(true);
    setComputingEdge(true);
    setNodeResult(null);
    setEdgeResult(null);
    setPercolationCurve(null);
    try {
      const graph = buildScopedGraph(scope, activeCanvasId);
      const nr = activeNodeDef.run({ graph, weightExpr, n });
      const er = activeEdgeDef.run({ graph, weightExpr, n });
      setNodeResult(nr);
      setEdgeResult(er);
      const orderedIds = nr.ranked.filter((e) => e.kind === "node").map((e) => e.id);
      setPercolationCurve(computePercolationCurve(graph, orderedIds));
    } finally {
      setComputingNode(false);
      setComputingEdge(false);
    }
  }

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
              onClick={() => setActiveNodeMetric(m.id as NodeCentralityMetric)}
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
              onClick={() => setActiveEdgeMetric(m.id as EdgeCentralityMetric)}
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
        <HeatmapControls
          // Named from the metric the RESULT carries, not from the selector: the
          // user can change the selection without recomputing, and the legend must
          // describe the colours actually on screen.
          title={[
            nodeResult && (NODE_METRICS.find((m) => m.id === nodeResult.metric)?.label ?? nodeResult.metric),
            edgeResult && (EDGE_METRICS.find((m) => m.id === edgeResult.metric)?.label ?? edgeResult.metric),
          ].filter(Boolean).join(" · ")}
          result={nodeResult ?? undefined}
          edgeResult={edgeResult ?? undefined}
        />
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
