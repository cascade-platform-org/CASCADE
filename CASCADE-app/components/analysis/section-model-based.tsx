"use client";

import React, { useRef, useState } from "react";
import { RefreshCw, Zap, X, Download } from "lucide-react";
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
import {
  buildShapleyExport,
  downloadShapleyExport,
  type ShapleyExport,
} from "@/lib/analysis-export";
import {
  computeVitality,
  estimateShapley,
  maxUniqueCoalitions,
  maxUsefulSamples,
  type ElementRef,
  type WorstCoalition,
} from "@/lib/model-based-analysis";
import type { ElementScore } from "@/lib/topological-analysis";
import type { GraphSnapshot } from "@/lib/schemas/network";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Adapters between the estimators and the app
//
// These sit at module scope, not in the component: none of them touches React
// state, and keeping them out means the estimators' seam is exercised by plain
// functions rather than by anything that needs a render to run.
// ---------------------------------------------------------------------------

/** The two model-based Analysis Metrics, named once for the selector and the legend. */
const MODEL_METRICS = [
  {
    id: "vitality" as const,
    label: "Vitality Centrality",
    description:
      "Drop in Operativity Score when each element is removed. Requires one engine call per element.",
  },
  {
    id: "shapley" as const,
    label: "Shapley Values",
    description:
      "Fair attribution of network value. Monte Carlo approximation — many engine calls.",
  },
];

/** Adapter: score a Scenario with `failed` Elements driven to Functionality 1. */
function makeCoalitionEvaluator(baseline: GraphSnapshot, weightAttr: string, n: number) {
  return async (failed: ReadonlySet<string>): Promise<number> => {
    const nodes = { ...baseline.nodes };
    const edges = { ...baseline.edges };
    for (const id of failed) {
      if (id in nodes) nodes[id] = { ...nodes[id], functionality: 1 };
      else if (id in edges) edges[id] = { ...edges[id], functionality: 1 };
    }
    const after = await runEphemeralPropagation({ ...baseline, nodes, edges });
    return computeOperativityScore(after, n, weightAttr) / 100;
  };
}


/** Turn a score map into the AnalysisResult shape the shared UI renders. */
function toAnalysisResult(
  metric: string,
  values: Record<string, number>,
  nodes: Record<string, unknown>,
) {
  const entries = Object.entries(values).sort(([, a], [, b]) => b - a);
  const scores = entries.map(([, v]) => v);
  const ranked: ElementScore[] = entries.map(([id, score], i) => ({
    id,
    kind: id in nodes ? ("node" as const) : ("edge" as const),
    score,
    rank: i + 1,
  }));
  return {
    metric,
    scores: values,
    ranked,
    min: Math.min(...scores),
    max: Math.max(...scores),
    avg: scores.reduce((a, b) => a + b, 0) / scores.length,
  };
}


async function saveWorstCoalitions(
  worstCoalitions: Record<number, WorstCoalition>,
  baseline: GraphSnapshot,
) {
  const labels: Record<number, string> = {
    1: "Neuralgic single",
    2: "Neuralgic pair",
    3: "Neuralgic triplet",
  };

  for (const size of [1, 2, 3]) {
    const worst = worstCoalitions[size];
    if (!worst) continue;

    const elementNames = worst.ids.map((id) => {
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
    for (const fid of worst.ids) {
      if (fid in snapNodes) snapNodes[fid] = { ...snapNodes[fid], functionality: 1 };
      else if (fid in snapEdges) snapEdges[fid] = { ...snapEdges[fid], functionality: 1 };
    }
    const beforeSnap = { ...baseline, nodes: snapNodes, edges: snapEdges };
    let afterSnap: GraphSnapshot | undefined;
    try {
      afterSnap = await runEphemeralPropagation(beforeSnap);
    } catch {
      /* the entry is still worth saving without its propagated half */
    }

    useScorecardStore.getState().addScorecardEntry({
      type: "propagation",
      id: nanoid(),
      label: `${labels[size]}: ${elementNames.join(", ")}`,
      created_at: new Date().toISOString(),
      event_ids: [],
      before_propagation: beforeSnap,
      after_propagation: afterSnap,
    });
  }
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
  const pushToast = useUiStore((s) => s.pushToast);
  const n = useConfigStore(selectN);

  const cancelRef = useRef(false);
  const [wallSecs, setWallSecs] = useState<number | null>(null);
  // Held only for the Export button. Component-local because nothing else reads
  // it, and it must not outlive the run it describes.
  const [exportDoc, setExportDoc] = useState<ShapleyExport | null>(null);

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

    const elements: ElementRef[] = [
      ...Object.keys(nodes).map((id) => ({ id, kind: "node" as const })),
      ...Object.keys(edges).map((id) => ({ id, kind: "edge" as const })),
    ];

    const loopStart = Date.now();
    setProgress({ total: elements.length, completed: 0, firstCallMs: null, avgCallMs: null, startedAt: loopStart });
    cancelRef.current = false;

    const { values } = await computeVitality(
      elements,
      baselineScore,
      async ({ id, kind }) => {
        const snap = { ...baseline };
        if (kind === "node") {
          const { [id]: _removed, ...rest } = snap.nodes;
          snap.nodes = rest;
        } else {
          const { [id]: _removed, ...rest } = snap.edges;
          snap.edges = rest;
        }
        const after = await runEphemeralPropagation(snap);
        return computeOperativityScore(after, n, weightAttr) / 100;
      },
      {
        isCancelled: () => cancelRef.current,
        onEvaluation: (ms) => {
          recordCall(ms);
          const elapsed = (Date.now() - loopStart) / 1000;
          if (elapsed > 10) setWallSecs(elapsed);
        },
      },
    );

    if (Object.keys(values).length === 0) return;
    setResult(toAnalysisResult("vitality", values, nodes));
    setProgress(null);
    setWallSecs(null);
  }

  async function runShapley() {
    const setShapleyWorst = useAnalysisStore.getState().setShapleyWorst;
    setShapleyWorst(null);

    const { nodes, edges } = getElements();
    const elements: ElementRef[] = shapleyParams.nodesOnly
      ? Object.keys(nodes).map((id) => ({ id, kind: "node" as const }))
      : [
          ...Object.keys(nodes).map((id) => ({ id, kind: "node" as const })),
          ...Object.keys(edges).map((id) => ({ id, kind: "edge" as const })),
        ];

    if (elements.length === 0) return;

    const effectiveK = Math.min(shapleyParams.kMax, elements.length);
    // Coalitions are cached, so the real cost is bounded by the distinct-coalition
    // count as well as by samples × k.
    const totalCalls = Math.min(
      1 + shapleyParams.samples * effectiveK,
      maxUniqueCoalitions(elements.length, effectiveK),
    );

    const startedAt = Date.now();
    setProgress({ total: totalCalls, completed: 0, firstCallMs: null, avgCallMs: null, startedAt });
    cancelRef.current = false;
    setWallSecs(null);

    const baseline = useCanvasStore.getState().toGraphSnapshot();
    const weightAttr = useAnalysisStore.getState().oiWeightAttr;

    const shapleyResult = await estimateShapley(
      elements,
      makeCoalitionEvaluator(baseline, weightAttr, n),
      {
        samples: shapleyParams.samples,
        kMax: shapleyParams.kMax,
        maxTimeMs: shapleyParams.maxTimeSecs * 1000,
      },
      {
        isCancelled: () => cancelRef.current,
        onEvaluation: (ms) => {
          recordCall(ms);
          const elapsed = (Date.now() - startedAt) / 1000;
          if (elapsed > 10) setWallSecs(elapsed);
        },
      },
    );

    const { values, worstCoalitions } = shapleyResult;

    if (Object.keys(values).length === 0) {
      setProgress(null);
      setWallSecs(null);
      return;
    }

    setResult(toAnalysisResult("shapley", values, nodes));
    setShapleyWorst({
      single: worstCoalitions[1] ?? null,
      pair: worstCoalitions[2] ?? null,
      triple: worstCoalitions[3] ?? null,
    });

    // The paper harness reads this document instead of re-implementing the
    // estimator (docs/papers.md §4.4). Built here, where the run's real seed and
    // sample count are still in hand.
    setExportDoc(
      buildShapleyExport({
        result: shapleyResult,
        snapshot: baseline,
        networkName: useCanvasStore.getState().projectMeta.name,
        samplesRequested: shapleyParams.samples,
        kMax: shapleyParams.kMax,
        nodesOnly: shapleyParams.nodesOnly,
        scope,
        oiWeightAttr: weightAttr,
      }),
    );

    if (shapleyParams.saveWorstToScorecard) {
      await saveWorstCoalitions(worstCoalitions, baseline);
    }

    setProgress(null);
    setWallSecs(null);
  }

  async function handleCompute() {
    setResult(null);
    setExportDoc(null);
    try {
      if (activeMetric === "vitality") await runVitality();
      else await runShapley();
    } catch (err) {
      // An estimator only throws when it cannot establish a baseline, i.e. the
      // engine is unreachable. Clear the progress bar rather than leaving it
      // spinning against a run that already stopped.
      setProgress(null);
      setWallSecs(null);
      pushToast({
        message: err instanceof Error ? err.message : "Analysis failed.",
        variant: "error",
      });
    }
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
        {MODEL_METRICS.map((m) => (
          <button
            key={m.id}
            onClick={() => { setActiveMetric(m.id); setResult(null); setExportDoc(null); }}
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

          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-xs text-zinc-600 dark:text-zinc-400">
              <span>Permutations (M)</span>
              <input
                type="number" min={10} max={100000} step={10}
                value={shapleyParams.samples}
                onChange={(e) => setShapleyParams({ samples: parseInt(e.target.value) || 200 })}
                className="w-20 rounded border border-zinc-200 bg-white px-2 py-0.5 text-right text-xs dark:border-zinc-700 dark:bg-zinc-800"
              />
            </div>
            <p className="text-[10px] leading-snug text-zinc-400">
              Random failure orders to draw. Each one fails the first k_max elements in
              turn and credits each with the Operativity it destroyed on entry. More
              permutations = less noise, proportionally more engine calls.
              {(() => {
                const el = getElements();
                const nEl = Object.keys(el.nodes).length + (shapleyParams.nodesOnly ? 0 : Object.keys(el.edges).length);
                const maxT = maxUsefulSamples(nEl, shapleyParams.kMax);
                return maxT <= 1e6
                  ? <> Past ≈{maxT.toLocaleString()} nearly every draw repeats a coalition already evaluated.</>
                  : null;
              })()}
            </p>
          </div>

          <div className="space-y-1">
            <label className="flex items-center justify-between gap-2 text-xs text-zinc-600 dark:text-zinc-400">
              <span>Coalition size (k_max)</span>
              <input
                type="number" min={1} max={20}
                value={shapleyParams.kMax}
                onChange={(e) => setShapleyParams({ kMax: parseInt(e.target.value) || 5 })}
                className="w-20 rounded border border-zinc-200 bg-white px-2 py-0.5 text-right text-xs dark:border-zinc-700 dark:bg-zinc-800"
              />
            </label>
            <p className="text-[10px] leading-snug text-zinc-400">
              How many simultaneous failures each permutation explores. Truncation is
              what makes the analysis affordable, and it lowers every value: an element
              is credited only when it falls within the first k_max, so scores rank
              elements against each other rather than measuring their full share.
            </p>
          </div>

          <div className="space-y-1">
            <label className="flex items-center justify-between gap-2 text-xs text-zinc-600 dark:text-zinc-400">
              <span>Max time (s)</span>
              <input
                type="number" min={5} max={600}
                value={shapleyParams.maxTimeSecs}
                onChange={(e) => setShapleyParams({ maxTimeSecs: parseInt(e.target.value) || 60 })}
                className="w-20 rounded border border-zinc-200 bg-white px-2 py-0.5 text-right text-xs dark:border-zinc-700 dark:bg-zinc-800"
              />
            </label>
            <p className="text-[10px] leading-snug text-zinc-400">
              Wall-clock budget. The run stops between permutations and reports what it
              has, averaged over the permutations actually drawn.
            </p>
          </div>
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
          <HeatmapControls
            title={MODEL_METRICS.find((m) => m.id === result.metric)?.label ?? result.metric}
            result={result}
          />
          <ResultsList result={result} />
        </div>
      )}

      {/* Export — the paper harness's input (docs/papers.md §4.4) */}
      {exportDoc && (
        <button
          onClick={() => { void downloadShapleyExport(exportDoc); }}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <Download size={13} />
          Export Shapley values (JSON)
        </button>
      )}

      {/* Worst coalition summary — only shown after a Shapley run */}
      {activeMetric === "shapley" && shapleyWorst && (
        <WorstCoalitionsPanel worst={shapleyWorst} nodes={getElements().nodes} edges={getElements().edges} />
      )}
    </div>
  );
}
