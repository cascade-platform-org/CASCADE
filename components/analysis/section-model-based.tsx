"use client";

import React, { useRef, useState } from "react";
import { RefreshCw, Zap, X } from "lucide-react";
import { useAnalysisStore } from "@/store/analysis-store";
import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore, selectN } from "@/store/config-store";
import { useUiStore } from "@/store/ui-store";
import { ResultsList } from "./results-list";
import { HeatmapControls } from "./heatmap-controls";
import { buildScopedGraph } from "@/lib/analysis-utils";
import { runEphemeralPropagation } from "@/lib/ephemeral-propagation";
import { computeOperativityScore } from "@/lib/scorecard-utils";
import type { ElementScore } from "@/lib/topological-analysis";
import { cn } from "@/lib/utils";


export function SectionModelBased() {
  const activeMetric = useAnalysisStore((s) => s.activeMetric) as "vitality" | "shapley";
  const setActiveMetric = useAnalysisStore((s) => s.setActiveMetric);
  const result = useAnalysisStore((s) => s.result);
  const setResult = useAnalysisStore((s) => s.setResult);
  const progress = useAnalysisStore((s) => s.modelBasedProgress);
  const setProgress = useAnalysisStore((s) => s.setModelBasedProgress);
  const recordCall = useAnalysisStore((s) => s.recordCallCompletion);
  const shapleyParams = useAnalysisStore((s) => s.shapleyParams);
  const setShapleyParams = useAnalysisStore((s) => s.setShapleyParams);
  const scope = useAnalysisStore((s) => s.scope);
  const serverReachable = useUiStore((s) => s.serverReachable);
  const n = useConfigStore(selectN);

  const cancelRef = useRef(false);
  const [wallSecs, setWallSecs] = useState<number | null>(null);

  const activeCanvasId = useCanvasStore((s) => s.activeCanvasId);

  function getElements() {
    const { nodes, edges } = buildScopedGraph(scope, activeCanvasId);
    return { nodes, edges };
  }

  async function runVitality() {
    const { nodes, edges } = getElements();
    const baseline = useCanvasStore.getState().toGraphSnapshot();
    const baselineScore = computeOperativityScore(baseline, n) / 100;

    const allIds = [
      ...Object.keys(nodes).map((id) => ({ id, kind: "node" as const })),
      ...Object.keys(edges).map((id) => ({ id, kind: "edge" as const })),
    ];

    const loopStart = Date.now();
    setProgress({ total: allIds.length, completed: 0, firstCallMs: null, avgCallMs: null, startedAt: loopStart });
    cancelRef.current = false;

    const scores: Record<string, number> = {};
    const ranked: ElementScore[] = [];
    let min = Infinity, max = -Infinity, sum = 0;

    for (const { id, kind } of allIds) {
      if (cancelRef.current) break;

      const callStart = Date.now();
      try {
        // Build snapshot with this element removed
        const snap = { ...baseline };
        if (kind === "node") {
          const { [id]: _, ...rest } = snap.nodes;
          snap.nodes = rest;
        } else {
          const { [id]: _, ...rest } = snap.edges;
          snap.edges = rest;
        }
        const afterSnap = await runEphemeralPropagation(snap);
        const afterScore = computeOperativityScore(afterSnap, n) / 100;
        const vitality = baselineScore - afterScore;
        scores[id] = vitality;
        min = Math.min(min, vitality);
        max = Math.max(max, vitality);
        sum += vitality;
      } catch {
        scores[id] = 0;
      }

      const callMs = Date.now() - callStart;
      recordCall(callMs);

      // Show live progress after 10s
      const elapsed = (Date.now() - loopStart) / 1000;
      if (elapsed > 10) setWallSecs(elapsed);
    }

    if (Object.keys(scores).length === 0) return;

    const avg = sum / Object.keys(scores).length;
    const sortedEntries = Object.entries(scores).sort(([, a], [, b]) => b - a);
    sortedEntries.forEach(([id, score], i) => {
      const kind = id in nodes ? "node" as const : "edge" as const;
      ranked.push({ id, kind, score, rank: i + 1 });
    });

    setResult({ metric: "vitality", scores, ranked, min, max, avg });
    setProgress(null);
    setWallSecs(null);
  }

  async function runShapley() {
    const { nodes, edges } = getElements();
    const allIds: { id: string; kind: "node" | "edge" }[] = shapleyParams.nodesOnly
      ? Object.keys(nodes).map((id) => ({ id, kind: "node" as const }))
      : [
          ...Object.keys(nodes).map((id) => ({ id, kind: "node" as const })),
          ...Object.keys(edges).map((id) => ({ id, kind: "edge" as const })),
        ];

    if (allIds.length === 0) return;

    const effectiveK = Math.min(shapleyParams.kMax, allIds.length);
    // Each permutation makes at most effectiveK engine calls, plus 1 for baseline.
    const totalCalls = 1 + shapleyParams.permutations * effectiveK;
    const startedAt = Date.now();
    setProgress({ total: totalCalls, completed: 0, firstCallMs: null, avgCallMs: null, startedAt });
    cancelRef.current = false;
    setWallSecs(null);

    // φ[i] accumulates marginal contributions; count[i] = times element i was reached.
    const phi: Record<string, number> = {};
    const sampleCount: Record<string, number> = {};
    for (const { id } of allIds) { phi[id] = 0; sampleCount[id] = 0; }

    // Baseline: propagate from current state (may already be partially degraded).
    const baseline = useCanvasStore.getState().toGraphSnapshot();
    let baselineOI: number;
    try {
      const baseSnap = await runEphemeralPropagation(baseline);
      baselineOI = computeOperativityScore(baseSnap, n) / 100;
    } catch {
      baselineOI = computeOperativityScore(baseline, n) / 100;
    }
    recordCall(0);

    for (let perm = 0; perm < shapleyParams.permutations; perm++) {
      if (cancelRef.current) break;
      if ((Date.now() - startedAt) / 1000 > shapleyParams.maxTimeSecs) break;

      const order = [...allIds].sort(() => Math.random() - 0.5);
      // S = set of failed element IDs in this permutation so far.
      const failedIds = new Set<string>();
      let prevOI = baselineOI;

      for (const { id } of order) {
        if (cancelRef.current) break;
        // k_max cap: stop when adding i would exceed coalition size limit.
        if (failedIds.size + 1 > effectiveK) break;

        failedIds.add(id);
        const callStart = Date.now();
        try {
          // Coalition S∪{i}: set all failed elements to functionality=1 (critical).
          const snapNodes = { ...baseline.nodes };
          const snapEdges = { ...baseline.edges };
          for (const fid of failedIds) {
            if (fid in snapNodes) snapNodes[fid] = { ...snapNodes[fid], functionality: 1 };
            else if (fid in snapEdges) snapEdges[fid] = { ...snapEdges[fid], functionality: 1 };
          }
          const afterSnap = await runEphemeralPropagation({ ...baseline, nodes: snapNodes, edges: snapEdges });
          const curOI = computeOperativityScore(afterSnap, n) / 100;
          // Marginal contribution: Δ = v(S∪{i}) - v(S) = (baseline-curOI) - (baseline-prevOI) = prevOI - curOI
          phi[id] += prevOI - curOI;
          sampleCount[id] += 1;
          prevOI = curOI;
        } catch {
          sampleCount[id] += 1; // count the attempt; contribution stays 0
        }
        recordCall(Date.now() - callStart);
        if ((Date.now() - startedAt) / 1000 > 10) setWallSecs((Date.now() - startedAt) / 1000);
      }
    }

    // Normalise by sample count (not by M — elements beyond k_max are never sampled).
    const shapleyValues: Record<string, number> = {};
    for (const { id } of allIds) {
      shapleyValues[id] = sampleCount[id] > 0 ? phi[id] / sampleCount[id] : 0;
    }

    const sampledEntries = Object.entries(shapleyValues)
      .filter(([id]) => sampleCount[id] > 0)
      .sort(([, a], [, b]) => b - a);
    const values = sampledEntries.map(([, v]) => v);
    if (values.length === 0) { setProgress(null); setWallSecs(null); return; }

    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const ranked: ElementScore[] = sampledEntries.map(([id, score], i) => ({
      id, kind: id in nodes ? "node" as const : "edge" as const, score, rank: i + 1,
    }));

    setResult({ metric: "shapley", scores: shapleyValues, ranked, min, max, avg });
    setProgress(null);
    setWallSecs(null);
  }

  async function handleCompute() {
    setResult(null);
    if (activeMetric === "vitality") await runVitality();
    else await runShapley();
  }

  const isRunning = progress !== null;
  const totalCalls = activeMetric === "vitality"
    ? Object.keys(getElements().nodes).length + Object.keys(getElements().edges).length
    : (() => {
        const el = getElements();
        const n = Object.keys(el.nodes).length + (shapleyParams.nodesOnly ? 0 : Object.keys(el.edges).length);
        return 1 + shapleyParams.permutations * Math.min(shapleyParams.kMax, n);
      })();

  const estRemaining = progress?.avgCallMs != null && progress.total > 0
    ? ((progress.total - progress.completed) * progress.avgCallMs / 1000).toFixed(0)
    : null;

  return (
    <div className="space-y-4">
      {/* Metric selector */}
      <div className="space-y-1">
        {([
          { id: "vitality" as const, label: "Vitality Centrality", description: "Drop in Operativity Score when each element is removed. Requires one engine call per element.", recommended: ["SourceToDemands", "Requisite"] },
          { id: "shapley" as const, label: "Shapley Values", description: "Fair attribution of network value. Monte Carlo approximation — many engine calls.", recommended: ["global"] },
        ] as const).map((m) => (
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
                <span className="text-[9px] text-amber-500">★ {m.recommended.join(", ")}</span>
              </div>
              <div className="mt-0.5 text-[10px] text-zinc-400">{m.description}</div>
            </div>
          </button>
        ))}
      </div>

      {/* Shapley params */}
      {activeMetric === "shapley" && (
        <div className="space-y-2 rounded-lg border border-zinc-100 p-3 dark:border-zinc-800">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">Parameters</p>
          <label className="flex items-center justify-between gap-2 text-xs text-zinc-600 dark:text-zinc-400">
            <span>Permutations (M)</span>
            <input
              type="number" min={10} max={1000} step={10}
              value={shapleyParams.permutations}
              onChange={(e) => setShapleyParams({ permutations: parseInt(e.target.value) || 100 })}
              className="w-20 rounded border border-zinc-200 bg-white px-2 py-0.5 text-right text-xs dark:border-zinc-700 dark:bg-zinc-800"
            />
          </label>
          <label className="flex items-center justify-between gap-2 text-xs text-zinc-600 dark:text-zinc-400">
            <span>Coalition size (k_max)</span>
            <input
              type="number" min={1} max={20}
              value={shapleyParams.kMax}
              onChange={(e) => setShapleyParams({ kMax: parseInt(e.target.value) || 5 })}
              className="w-20 rounded border border-zinc-200 bg-white px-2 py-0.5 text-right text-xs dark:border-zinc-700 dark:bg-zinc-800"
            />
          </label>
          <label className="flex items-center justify-between gap-2 text-xs text-zinc-600 dark:text-zinc-400">
            <span>Max time (s)</span>
            <input
              type="number" min={5} max={600}
              value={shapleyParams.maxTimeSecs}
              onChange={(e) => setShapleyParams({ maxTimeSecs: parseInt(e.target.value) || 60 })}
              className="w-20 rounded border border-zinc-200 bg-white px-2 py-0.5 text-right text-xs dark:border-zinc-700 dark:bg-zinc-800"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
            <input type="checkbox" checked={shapleyParams.nodesOnly} onChange={(e) => setShapleyParams({ nodesOnly: e.target.checked })} />
            Nodes only (faster)
          </label>
        </div>
      )}

      {/* Cost warning */}
      {!serverReachable && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-700 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-400">
          Server unreachable — model-based analysis requires the propagation engine.
        </div>
      )}
      {serverReachable && !isRunning && (
        <p className="text-[10px] text-zinc-400">
          Will make ~{totalCalls} engine calls.
        </p>
      )}

      {/* Run / cancel */}
      {!isRunning ? (
        <button
          onClick={handleCompute}
          disabled={!serverReachable}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          <Zap size={13} />
          Compute {activeMetric === "vitality" ? "Vitality" : "Shapley Values"}
        </button>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span className="flex items-center gap-1">
              <RefreshCw size={11} className="animate-spin" />
              {progress.completed}/{progress.total} calls
            </span>
            {wallSecs != null && estRemaining != null && (
              <span>~{estRemaining}s remaining</span>
            )}
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
            <div
              className="h-full rounded-full bg-indigo-500 transition-all"
              style={{ width: `${(progress.completed / progress.total) * 100}%` }}
            />
          </div>
          <button
            onClick={() => { cancelRef.current = true; }}
            className="flex w-full items-center justify-center gap-1 rounded-lg border border-red-200 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400"
          >
            <X size={11} /> Cancel
          </button>
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <HeatmapControls result={result} />
          <ResultsList result={result} />
        </div>
      )}
    </div>
  );
}
