"use client";

import React, { useRef, useState } from "react";
import { RefreshCw, Zap, X } from "lucide-react";
import { nanoid } from "nanoid";
import { useAnalysisStore } from "@/store/analysis-store";
import { useCanvasStore } from "@/store/canvas-store";
import { useConfigStore, selectN } from "@/store/config-store";
import { useUiStore } from "@/store/ui-store";
import { useScorecardStore } from "@/store/scorecard-store";
import { ResultsList } from "./results-list";
import { HeatmapControls } from "./heatmap-controls";
import { buildScopedGraph } from "@/lib/analysis-utils";
import { runEphemeralPropagation } from "@/lib/ephemeral-propagation";
import { computeOperativityScore } from "@/lib/scorecard-utils";
import { buildOiWeightOptions } from "@/lib/oi-weight-attrs";
import type { ElementScore } from "@/lib/topological-analysis";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Upper bound on unique engine calls with caching: 1 (baseline) + Σ C(N,j) for j=1..kMax. */
function maxUniqueCoalitions(n: number, kMax: number): number {
  let total = 1;
  let binom = 1;
  for (let k = 1; k <= Math.min(kMax, n); k++) {
    binom = binom * (n - k + 1) / k;
    total += Math.round(binom);
    if (total > 1e9) return Math.round(total);
  }
  return total;
}

/**
 * C(N, min(⌊N/2⌋, k)) — the number of unordered subsets at the hardest size to saturate.
 * C(N,j) is maximised at j=⌊N/2⌋; for k ≤ N/2 the bottleneck is C(N,k).
 * Beyond this many samples, every new draw is very likely a full cache hit.
 */
function maxUsefulSamples(n: number, kMax: number): number {
  const k = Math.min(Math.floor(n / 2), kMax);
  let binom = 1;
  for (let i = 0; i < k; i++) {
    binom = binom * (n - i) / (i + 1);
    if (binom > 1e9) return Math.round(binom);
  }
  return Math.round(binom);
}


// ---------------------------------------------------------------------------
// Worst-coalition display
// ---------------------------------------------------------------------------

function elementLabel(
  id: string,
  nodes: Record<string, { label?: string }>,
  edges: Record<string, { source: string; target: string }>,
  allNodes: Record<string, { label?: string }>,
): string {
  if (nodes[id]) return nodes[id].label ?? id;
  const e = edges[id];
  if (e) {
    const src = allNodes[e.source]?.label ?? e.source;
    const tgt = allNodes[e.target]?.label ?? e.target;
    return `${src} → ${tgt}`;
  }
  return id;
}

function WorstCoalitionsPanel({
  worst,
  nodes,
  edges,
}: {
  worst: { single: { ids: string[]; loss: number } | null; pair: { ids: string[]; loss: number } | null; triple: { ids: string[]; loss: number } | null };
  nodes: Record<string, { label?: string }>;
  edges: Record<string, { source: string; target: string }>;
}) {
  const allNodes = useCanvasStore((s) => s.nodes);
  const rows = [
    { label: "Worst single", entry: worst.single },
    { label: "Worst pair",   entry: worst.pair },
    { label: "Worst triplet", entry: worst.triple },
  ].filter((r) => r.entry !== null) as { label: string; entry: { ids: string[]; loss: number } }[];

  if (rows.length === 0) return null;

  return (
    <div className="space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-600 dark:text-amber-400">
        Neuralgic Coalitions
      </p>
      {rows.map(({ label, entry }) => (
        <div key={label} className="space-y-0.5">
          <p className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">{label}</p>
          <p className="text-xs font-medium text-zinc-800 dark:text-zinc-200">
            {entry.ids.map((id) => elementLabel(id, nodes, edges, allNodes)).join(", ")}
          </p>
          <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
            OI loss: {(entry.loss * 100).toFixed(1)}%
          </p>
        </div>
      ))}
    </div>
  );
}

export function SectionModelBased() {
  const activeMetric = useAnalysisStore((s) => s.activeMetric) as "vitality" | "shapley";
  const shapleyWorst = useAnalysisStore((s) => s.shapleyWorst);
  const setActiveMetric = useAnalysisStore((s) => s.setActiveMetric);
  const result = useAnalysisStore((s) => s.result);
  const setResult = useAnalysisStore((s) => s.setResult);
  const progress = useAnalysisStore((s) => s.modelBasedProgress);
  const setProgress = useAnalysisStore((s) => s.setModelBasedProgress);
  const recordCall = useAnalysisStore((s) => s.recordCallCompletion);
  const shapleyParams = useAnalysisStore((s) => s.shapleyParams);
  const setShapleyParams = useAnalysisStore((s) => s.setShapleyParams);
  const oiWeightAttr = useAnalysisStore((s) => s.oiWeightAttr);
  const setOiWeightAttr = useAnalysisStore((s) => s.setOiWeightAttr);
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
    const weightAttr = useAnalysisStore.getState().oiWeightAttr;
    const baselineScore = computeOperativityScore(baseline, n, weightAttr) / 100;

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
        const afterScore = computeOperativityScore(afterSnap, n, weightAttr) / 100;
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
    const setShapleyWorst = useAnalysisStore.getState().setShapleyWorst;
    setShapleyWorst(null);

    const { nodes, edges } = getElements();
    const allIds: { id: string; kind: "node" | "edge" }[] = shapleyParams.nodesOnly
      ? Object.keys(nodes).map((id) => ({ id, kind: "node" as const }))
      : [
          ...Object.keys(nodes).map((id) => ({ id, kind: "node" as const })),
          ...Object.keys(edges).map((id) => ({ id, kind: "edge" as const })),
        ];

    if (allIds.length === 0) return;

    const effectiveK = Math.min(shapleyParams.kMax, allIds.length);
    // Perfect estimate: we cache evaluations, so unique calls ≤ Σ C(N,k) for k=1..effectiveK.
    const uniqueCap = maxUniqueCoalitions(allIds.length, effectiveK);
    const upperBound = 1 + shapleyParams.samples * effectiveK;
    const totalCalls = Math.min(upperBound, uniqueCap);

    const startedAt = Date.now();
    setProgress({ total: totalCalls, completed: 0, firstCallMs: null, avgCallMs: null, startedAt });
    cancelRef.current = false;
    setWallSecs(null);

    // φ[i] accumulates marginal contributions; normalised by actualSamples at the end.
    const phi: Record<string, number> = {};
    for (const { id } of allIds) phi[id] = 0;

    // Coalition OI cache: key = sorted IDs joined by ','. Avoids re-running the engine
    // for the same coalition that appears in multiple permutations.
    const coalitionCache = new Map<string, number>();

    // Track worst coalition (highest operativity loss) for sizes 1, 2, 3.
    type WorstEntry = { ids: string[]; loss: number } | null;
    let worst1: WorstEntry = null;
    let worst2: WorstEntry = null;
    let worst3: WorstEntry = null;

    // Baseline: propagate from current state (may already be partially degraded).
    const baseline = useCanvasStore.getState().toGraphSnapshot();
    const weightAttr = useAnalysisStore.getState().oiWeightAttr;
    let baselineOI: number;
    try {
      const baseSnap = await runEphemeralPropagation(baseline);
      baselineOI = computeOperativityScore(baseSnap, n, weightAttr) / 100;
    } catch {
      baselineOI = computeOperativityScore(baseline, n, weightAttr) / 100;
    }
    recordCall(0);

    let actualSamples = 0;

    for (let s = 0; s < shapleyParams.samples; s++) {
      if (cancelRef.current) break;
      if ((Date.now() - startedAt) / 1000 > shapleyParams.maxTimeSecs) break;

      actualSamples++;
      // Draw a random ordered k-subset: shuffle all elements, take the first effectiveK.
      const order = [...allIds].sort(() => Math.random() - 0.5);
      const failedIds = new Set<string>();
      let prevOI = baselineOI;

      for (const { id } of order) {
        if (cancelRef.current) break;
        if (failedIds.size + 1 > effectiveK) break;

        failedIds.add(id);
        const cacheKey = [...failedIds].sort().join(",");
        const callStart = Date.now();
        let curOI: number;
        let fromCache = false;

        if (coalitionCache.has(cacheKey)) {
          curOI = coalitionCache.get(cacheKey)!;
          fromCache = true;
        } else {
          try {
            const snapNodes = { ...baseline.nodes };
            const snapEdges = { ...baseline.edges };
            for (const fid of failedIds) {
              if (fid in snapNodes) snapNodes[fid] = { ...snapNodes[fid], functionality: 1 };
              else if (fid in snapEdges) snapEdges[fid] = { ...snapEdges[fid], functionality: 1 };
            }
            const afterSnap = await runEphemeralPropagation({ ...baseline, nodes: snapNodes, edges: snapEdges });
            curOI = computeOperativityScore(afterSnap, n, weightAttr) / 100;
            coalitionCache.set(cacheKey, curOI);
          } catch {
            curOI = prevOI; // treat failed call as no additional loss
            coalitionCache.set(cacheKey, curOI);
          }
        }

        if (!fromCache) {
          recordCall(Date.now() - callStart);
          if ((Date.now() - startedAt) / 1000 > 10) setWallSecs((Date.now() - startedAt) / 1000);
        }

        // Track worst coalition per size.
        const loss = baselineOI - curOI;
        const sz = failedIds.size;
        if (sz === 1 && (!worst1 || loss > worst1.loss)) worst1 = { ids: [...failedIds], loss };
        if (sz === 2 && (!worst2 || loss > worst2.loss)) worst2 = { ids: [...failedIds], loss };
        if (sz === 3 && (!worst3 || loss > worst3.loss)) worst3 = { ids: [...failedIds], loss };

        // Marginal contribution: prevOI - curOI.
        phi[id] += prevOI - curOI;
        prevOI = curOI;
      }
    }

    // Normalise by actualSamples — correct for the truncated Shapley formula.
    // Elements that never appeared in a sampled k-chain get φ = 0 (correctly zero contribution
    // under the k_max truncation). This matches φ̂_i = (1/T) Σ_t Δᵢᵗ from the paper.
    const shapleyValues: Record<string, number> = {};
    for (const { id } of allIds) {
      shapleyValues[id] = actualSamples > 0 ? phi[id] / actualSamples : 0;
    }

    const sampledEntries = Object.entries(shapleyValues)
      .sort(([, a], [, b]) => b - a);
    const values = sampledEntries.map(([, v]) => v);
    if (values.length === 0) { setProgress(null); setWallSecs(null); return; }

    const minV = Math.min(...values);
    const maxV = Math.max(...values);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const ranked: ElementScore[] = sampledEntries.map(([id, score], i) => ({
      id, kind: id in nodes ? "node" as const : "edge" as const, score, rank: i + 1,
    }));

    setResult({ metric: "shapley", scores: shapleyValues, ranked, min: minV, max: maxV, avg });
    setShapleyWorst({ single: worst1, pair: worst2, triple: worst3 });

    // Save worst scenarios to scorecard if requested.
    if (shapleyParams.saveWorstToScorecard) {
      const toSave = [
        { entry: worst1, label: "Neuralgic single" },
        { entry: worst2, label: "Neuralgic pair" },
        { entry: worst3, label: "Neuralgic triplet" },
      ].filter((x) => x.entry !== null) as { entry: { ids: string[]; loss: number }; label: string }[];

      for (const { entry, label } of toSave) {
        const elementNames = entry.ids.map((id) => {
          const nd = baseline.nodes[id];
          if (nd) return nd.label ?? id;
          const ed = baseline.edges[id];
          if (ed) {
            const src = baseline.nodes[ed.source]?.label ?? ed.source;
            const tgt = baseline.nodes[ed.target]?.label ?? ed.target;
            return `${src}→${tgt}`;
          }
          return id;
        });

        const snapNodes = { ...baseline.nodes };
        const snapEdges = { ...baseline.edges };
        for (const fid of entry.ids) {
          if (fid in snapNodes) snapNodes[fid] = { ...snapNodes[fid], functionality: 1 };
          else if (fid in snapEdges) snapEdges[fid] = { ...snapEdges[fid], functionality: 1 };
        }
        const beforeSnap = { ...baseline, nodes: snapNodes, edges: snapEdges };
        let afterSnap: typeof baseline | undefined;
        try { afterSnap = await runEphemeralPropagation(beforeSnap); } catch { /* skip */ }

        useScorecardStore.getState().addScorecardEntry({
          type: "propagation",
          id: nanoid(),
          label: `${label}: ${elementNames.join(", ")}`,
          created_at: new Date().toISOString(),
          before_propagation: beforeSnap,
          after_propagation: afterSnap,
        });
      }
    }

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
        const nEl = Object.keys(el.nodes).length + (shapleyParams.nodesOnly ? 0 : Object.keys(el.edges).length);
        const effectiveK = Math.min(shapleyParams.kMax, nEl);
        const upper = 1 + shapleyParams.samples * effectiveK;
        const uniqueCap = maxUniqueCoalitions(nEl, effectiveK);
        return Math.min(upper, uniqueCap);
      })();

  const estRemaining = progress?.avgCallMs != null && progress.total > 0
    ? ((progress.total - progress.completed) * progress.avgCallMs / 1000).toFixed(0)
    : null;

  const oiWeightOptions = buildOiWeightOptions(useCanvasStore.getState().nodes);

  return (
    <div className="space-y-4">
      {/* OI weight selector */}
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-zinc-500 shrink-0">OI node weight</span>
        <select
          value={oiWeightAttr}
          onChange={(e) => setOiWeightAttr(e.target.value)}
          className="rounded border border-zinc-200 bg-white px-2 py-0.5 text-xs text-zinc-700 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
        >
          {oiWeightOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

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
          <div className="flex items-center justify-between gap-2 text-xs text-zinc-600 dark:text-zinc-400">
            <div>
              <span>Samples (T)</span>
              {(() => {
                const el = getElements();
                const nEl = Object.keys(el.nodes).length + (shapleyParams.nodesOnly ? 0 : Object.keys(el.edges).length);
                const maxT = maxUsefulSamples(nEl, shapleyParams.kMax);
                return maxT <= 1e6
                  ? <span className="ml-1 text-[10px] text-zinc-400">sat. ≈ {maxT.toLocaleString()}</span>
                  : null;
              })()}
            </div>
            <input
              type="number" min={10} max={100000} step={10}
              value={shapleyParams.samples}
              onChange={(e) => setShapleyParams({ samples: parseInt(e.target.value) || 200 })}
              className="w-20 rounded border border-zinc-200 bg-white px-2 py-0.5 text-right text-xs dark:border-zinc-700 dark:bg-zinc-800"
            />
          </div>
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
          <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
            <input type="checkbox" checked={shapleyParams.saveWorstToScorecard} onChange={(e) => setShapleyParams({ saveWorstToScorecard: e.target.checked })} />
            Save worst single / pair / triplet to scorecard
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

      {/* Worst coalition summary — only shown after a Shapley run */}
      {activeMetric === "shapley" && shapleyWorst && (
        <WorstCoalitionsPanel worst={shapleyWorst} nodes={getElements().nodes} edges={getElements().edges} />
      )}
    </div>
  );
}
