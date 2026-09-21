"use client";

import { useState } from "react";
import { RefreshCw, Network, AlertTriangle } from "lucide-react";
import { useAnalysisStore } from "@/store/analysis-store";
import { useCanvasStore } from "@/store/canvas-store";
import { ResultsList } from "./results-list";
import { HeatmapControls } from "./heatmap-controls";
import { buildScopedGraph } from "@/lib/analysis-utils";
import { effectiveScope, metricById, metricsForSection } from "@/lib/analysis-metrics";
import type { StructuralMetric } from "@/store/analysis-store";
import { cn } from "@/lib/utils";

const METRICS = metricsForSection("structural");

export function SectionStructural() {
  const activeMetric = useAnalysisStore((s) => s.activeMetric) as StructuralMetric;
  const setActiveMetric = useAnalysisStore((s) => s.setActiveMetric);
  const result = useAnalysisStore((s) => s.result);
  const setResult = useAnalysisStore((s) => s.setResult);
  const nofnMetrics = useAnalysisStore((s) => s.nofnMetrics);
  const setNofNMetrics = useAnalysisStore((s) => s.setNofNMetrics);
  const scope = useAnalysisStore((s) => s.scope);
  const [computing, setComputing] = useState(false);

  const activeCanvasId = useCanvasStore((s) => s.activeCanvasId);
  const canvases = useCanvasStore((s) => s.canvases);

  const currentDef = metricById(activeMetric);

  async function handleCompute() {
    if (!currentDef) return;
    setComputing(true);
    setResult(null);
    setNofNMetrics(null);
    try {
      // Network-of-Networks insists on the full multi-canvas; the rest follow
      // the user's scope toggle. The registry decides, not this component.
      const graph = buildScopedGraph(effectiveScope(currentDef, scope), activeCanvasId);
      if (currentDef.kind === "structure") setNofNMetrics(currentDef.run({ graph }));
      else setResult(currentDef.run({ graph }));
    } finally {
      setComputing(false);
    }
  }

  const canvasList = Object.values(canvases);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        {METRICS.map((m) => (
          <button
            key={m.id}
            onClick={() => { setActiveMetric(m.id as StructuralMetric); setResult(null); setNofNMetrics(null); }}
            className={cn(
              "flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors",
              activeMetric === m.id
                ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800",
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="font-medium">{m.label}</span>
              </div>
              <div className="mt-0.5 text-[10px] text-zinc-400">{m.description}</div>
            </div>
          </button>
        ))}
      </div>

      <button
        onClick={handleCompute}
        disabled={computing}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {computing ? <RefreshCw size={13} className="animate-spin" /> : <Network size={13} />}
        {computing ? "Computing…" : `Compute ${currentDef?.label ?? ""}`}
      </button>

      {/* Standard result (articulation points + communities) */}
      {result && (
        <div className="space-y-4">
          <HeatmapControls
            title={METRICS.find((m) => m.id === result.metric)?.label ?? result.metric}
            result={result}
          />
          <ResultsList result={result} />
        </div>
      )}

      {/* NofN metrics */}
      {nofnMetrics && (
        <div className="space-y-4">
          {/* Interdependency Ratio */}
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-400">Interdependency Ratio per Canvas</p>
            <div className="space-y-1">
              {canvasList.map((canvas) => {
                const ratio = nofnMetrics.interdependencyRatio[canvas.id] ?? 0;
                return (
                  <div key={canvas.id} className="flex items-center gap-2 text-xs">
                    <span className="w-32 truncate text-zinc-600 dark:text-zinc-400">{canvas.label}</span>
                    <div className="flex-1 rounded-full bg-zinc-100 dark:bg-zinc-800" style={{ height: 6 }}>
                      <div className="rounded-full bg-blue-500" style={{ width: `${ratio * 100}%`, height: 6 }} />
                    </div>
                    <span className="w-10 text-right font-mono text-zinc-500">{(ratio * 100).toFixed(0)}%</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Coupling Strength */}
          {Object.keys(nofnMetrics.couplingStrength).length > 0 && (
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-400">Coupling Strength</p>
              <div className="space-y-1">
                {Object.entries(nofnMetrics.couplingStrength).map(([pair, strength]) => (
                  <div key={pair} className="flex items-center gap-2 text-xs">
                    <span className="flex-1 truncate font-mono text-zinc-600 dark:text-zinc-400">{pair}</span>
                    <span className="font-mono font-bold text-blue-600 dark:text-blue-400">{(strength * 100).toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Feedback loops */}
          {nofnMetrics.feedbackLoops.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-900/20">
              <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                <AlertTriangle size={11} /> Feedback Loops Detected
              </p>
              {nofnMetrics.feedbackLoops.map((loop, i) => (
                <p key={i} className="text-[10px] font-mono text-amber-600 dark:text-amber-400">
                  {loop.join(" → ")} → (cycle)
                </p>
              ))}
              <p className="mt-1 text-[10px] text-amber-500">
                Mutually dependent canvas pairs are known to exhibit abrupt collapse at a critical threshold.
              </p>
            </div>
          )}

          {/* Meta-graph summary */}
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-400">Meta-Graph Inter-Canvas Edges</p>
            {nofnMetrics.metaGraph.edges.length === 0 ? (
              <p className="text-xs text-zinc-400">No inter-canvas edges found.</p>
            ) : (
              <div className="space-y-1">
                {nofnMetrics.metaGraph.edges.map((e, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="text-zinc-500">{e.source}</span>
                    <span className="text-zinc-300">→</span>
                    <span className="text-zinc-500">{e.target}</span>
                    <span className="ml-auto rounded bg-blue-50 px-1.5 font-mono text-[10px] text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                      {e.count} edge{e.count !== 1 ? "s" : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {!result && !nofnMetrics && !computing && (
        <div className="py-8 text-center text-xs text-zinc-400">
          <Network className="mx-auto mb-2 opacity-30" size={28} />
          Select a metric and click Compute.
        </div>
      )}
    </div>
  );
}
