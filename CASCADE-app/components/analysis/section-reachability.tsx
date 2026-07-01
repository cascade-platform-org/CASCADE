"use client";

import React, { useState } from "react";
import { RefreshCw, Workflow } from "lucide-react";
import { useAnalysisStore } from "@/store/analysis-store";
import { useCanvasStore } from "@/store/canvas-store";
import { ResultsList } from "./results-list";
import { HeatmapControls } from "./heatmap-controls";
import { buildScopedGraph } from "@/lib/analysis-utils";
import {
  computeDownstreamReachabilityAll,
  computeUpstreamReachabilityAll,
  computeDownstreamReachability,
  computeUpstreamReachability,
  type AnalysisGraph,
} from "@/lib/topological-analysis";
import type { ReachabilityMetric } from "@/store/analysis-store";
import { cn } from "@/lib/utils";

const METRICS: { id: ReachabilityMetric; label: string; description: string; recommended: string[] }[] = [
  { id: "downstream_reach_count", label: "Downstream Reach (all)", description: "Per-node count of nodes reachable downstream. High = large cascade impact if this node fails.", recommended: ["Requisite", "global"] },
  { id: "upstream_reach_count", label: "Upstream Reach (all)", description: "Per-node count of nodes that must be healthy upstream. High = many dependencies.", recommended: ["Requisite"] },
  { id: "downstream_cone", label: "Downstream Cone", description: "Highlights all nodes reachable from a selected source — its cascade footprint.", recommended: ["Requisite", "SourceToDemands"] },
  { id: "upstream_cone", label: "Upstream Cone", description: "Highlights all nodes that a selected target depends on — its dependency footprint.", recommended: ["Requisite"] },
];

export function SectionReachability() {
  const activeMetric = useAnalysisStore((s) => s.activeMetric) as ReachabilityMetric;
  const setActiveMetric = useAnalysisStore((s) => s.setActiveMetric);
  const result = useAnalysisStore((s) => s.result);
  const setResult = useAnalysisStore((s) => s.setResult);
  const scope = useAnalysisStore((s) => s.scope);
  const reachabilitySourceId = useAnalysisStore((s) => s.reachabilitySourceId);
  const setReachabilitySourceId = useAnalysisStore((s) => s.setReachabilitySourceId);

  const [computing, setComputing] = useState(false);

  const allNodes = useCanvasStore((s) => s.nodes);
  const activeCanvasId = useCanvasStore((s) => s.activeCanvasId);

  const isConeMetric = activeMetric === "downstream_cone" || activeMetric === "upstream_cone";

  function buildGraph(): AnalysisGraph {
    return buildScopedGraph(scope, activeCanvasId);
  }

  async function handleCompute() {
    if (isConeMetric && !reachabilitySourceId) return;
    setComputing(true);
    setResult(null);
    try {
      const graph = buildGraph();
      let r;
      switch (activeMetric) {
        case "downstream_reach_count": r = computeDownstreamReachabilityAll(graph); break;
        case "upstream_reach_count": r = computeUpstreamReachabilityAll(graph); break;
        case "downstream_cone": r = computeDownstreamReachability(graph, reachabilitySourceId!); break;
        case "upstream_cone": r = computeUpstreamReachability(graph, reachabilitySourceId!); break;
      }
      setResult(r);
    } finally {
      setComputing(false);
    }
  }

  const currentDef = METRICS.find((m) => m.id === activeMetric);
  const nodeList = Object.entries(allNodes).slice(0, 200);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        {METRICS.map((m) => (
          <button
            key={m.id}
            onClick={() => { setActiveMetric(m.id); setResult(null); }}
            className={cn(
              "flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors",
              activeMetric === m.id
                ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300"
                : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800",
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="font-medium">{m.label}</span>
                {m.recommended.length > 0 && (
                  <span className="text-[9px] text-amber-500">★ {m.recommended.join(", ")}</span>
                )}
              </div>
              <div className="mt-0.5 text-[10px] text-zinc-400">{m.description}</div>
            </div>
          </button>
        ))}
      </div>

      {isConeMetric && (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">Source node</p>
          <select
            value={reachabilitySourceId ?? ""}
            onChange={(e) => setReachabilitySourceId(e.target.value || null)}
            className="w-full rounded border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-700 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
          >
            <option value="">— select a node —</option>
            {nodeList.map(([id, node]) => (
              <option key={id} value={id}>{node.label || id}</option>
            ))}
          </select>
        </div>
      )}

      <button
        onClick={handleCompute}
        disabled={computing || (isConeMetric && !reachabilitySourceId)}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {computing ? <RefreshCw size={13} className="animate-spin" /> : <Workflow size={13} />}
        {computing ? "Computing…" : `Compute ${currentDef?.label ?? ""}`}
      </button>

      {result && (
        <div className="space-y-4">
          <HeatmapControls result={result} />
          <ResultsList result={result} />
        </div>
      )}

      {!result && !computing && (
        <div className="py-8 text-center text-xs text-zinc-400">
          <Workflow className="mx-auto mb-2 opacity-30" size={28} />
          Select a metric and click Compute.
        </div>
      )}
    </div>
  );
}
