/**
 * analysis-store.ts — Ephemeral state for the Topological Analysis page.
 *
 * Not persisted to the project file. All state resets on page close.
 * The heatmap colour map is applied to nodes/edges in flow-canvas.tsx via
 * the `analysisHeatmapColors` selector.
 */

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { AnalysisResult, NofNMetrics, PercolationPoint } from "@/lib/topological-analysis";
import type { LabelField } from "@/lib/analysis-legend";
import type { HeatmapLegend } from "@/lib/analysis-legend";

// ---------------------------------------------------------------------------
// Section and metric types
// ---------------------------------------------------------------------------

export type AnalysisSection =
  | "topological"
  | "reachability"
  | "structural"
  | "model-based";

export type NodeCentralityMetric =
  | "betweenness"
  | "closeness"
  | "eigenvector"
  | "degree"
  | "in_degree"
  | "out_degree"
  | "k_core";

export type EdgeCentralityMetric =
  | "edge_betweenness"
  | "bridge_edges";

export type TopologicalMetric = NodeCentralityMetric | EdgeCentralityMetric;

export type ReachabilityMetric =
  | "downstream_reach_count"
  | "upstream_reach_count"
  | "downstream_cone"
  | "upstream_cone";

export type StructuralMetric =
  | "articulation_points"
  | "community"
  | "nofn";

export type ModelBasedMetric = "vitality" | "shapley";

export type AnyMetric =
  | TopologicalMetric
  | ReachabilityMetric
  | StructuralMetric
  | ModelBasedMetric;

// ---------------------------------------------------------------------------
// Model-based progress
// ---------------------------------------------------------------------------

export interface ModelBasedProgress {
  total: number;
  completed: number;
  /** Wall-clock time of first call completion (ms). Null until first call done. */
  firstCallMs: number | null;
  /** Running average ms per call after the first completes. */
  avgCallMs: number | null;
  startedAt: number; // Date.now()
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface AnalysisState {
  /** Whether the full-page analysis layout is open. */
  analysisPageOpen: boolean;

  /** Active sidebar section. */
  activeSection: AnalysisSection;

  /** Active metric within each section. */
  /**
   * The metric currently SELECTED in the Reachability, Structural and
   * Model-based sections. Selector state only — `section-topological.tsx`
   * deliberately keeps its own selection in local React state and never writes
   * here, so this does NOT tell you what produced `result`. Read
   * `result.metric` for that; it is stamped by the analysis function itself and
   * cannot disagree with the scores beside it (see lib/analysis-entry.ts).
   */
  activeMetric: AnyMetric;

  /** Analysis scope — mirrors propagation scope concept. */
  scope: "local" | "global";

  /** Latest computed result for the active metric. Null = not yet computed. */
  result: AnalysisResult | null;

  /** NofN structural metrics (section "structural" → metric "nofn"). */
  nofnMetrics: NofNMetrics | null;

  /** Percolation curve computed after a centrality run. */
  percolationCurve: PercolationPoint[] | null;

  /** Colour map applied to canvas elements as the Analysis Heatmap. */
  heatmapColors: Record<string, string>;

  /** True when the heatmap is applied to the live canvas. */
  heatmapActive: boolean;

  /**
   * What those colours mean, built at apply time from the Analysis Result that
   * produced them. Written and cleared together with `heatmapColors`, so the
   * canvas legend can never explain a different Analysis Metric than the one on
   * screen. Null whenever no heatmap is applied.
   */
  heatmapLegend: HeatmapLegend | null;

  /** Model-based computation progress. Null = not running. */
  modelBasedProgress: ModelBasedProgress | null;

  /**
   * For reachability cone metrics: the node whose cone is currently highlighted.
   * Null = all-node aggregate mode.
   */
  reachabilitySourceId: string | null;

  /** Which attribute to show as the secondary label in the results list. */
  labelField: LabelField;

  /**
   * Arithmetic expression string used as edge weight for centrality metrics.
   * Edge attrs by bare name (e.g. `capacity`); node (target) attrs prefixed `n_`
   * (e.g. `n_importance`). Use `1` for purely topological (uniform).
   */
  weightExpression: string;

  /** Secondary result slot for the topological section's edge metrics panel. */
  topologicalEdgeResult: AnalysisResult | null;

  /**
   * Node attribute used as weight in the Operativity Index for model-based metrics.
   * "constant" = uniform; any other string = that numeric node attribute (falls back
   * to uniform if all values are zero or absent).
   */
  oiWeightAttr: string;

  /** Shapley parameters. */
  shapleyParams: {
    /**
     * Permutations to draw — $M$ in the IJDRR paper. Each is a random failure
     * ORDER over the whole Element set, truncated to its first kMax entries.
     * Not a set of k-subsets: order is what makes a marginal contribution
     * well defined.
     */
    samples: number;
    /** Maximum coalition size k_max. Only coalitions |S| ≤ k_max are explored. */
    kMax: number;
    nodesOnly: boolean;
    maxTimeSecs: number;
    /** When true, save worst single/pair/triplet scenarios to the scorecard after the run. */
    saveWorstToScorecard: boolean;
  };

  /** Worst coalitions of size 1, 2, 3 found during the last Shapley run. Null until computed. */
  shapleyWorst: {
    single: { ids: string[]; loss: number } | null;
    pair:   { ids: string[]; loss: number } | null;
    triple: { ids: string[]; loss: number } | null;
  } | null;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export interface AnalysisActions {
  openAnalysisPage: () => void;
  closeAnalysisPage: () => void;

  setActiveSection: (section: AnalysisSection) => void;
  setActiveMetric: (metric: AnyMetric) => void;
  setScope: (scope: "local" | "global") => void;

  setResult: (result: AnalysisResult | null) => void;
  setNofNMetrics: (metrics: NofNMetrics | null) => void;
  setPercolationCurve: (curve: PercolationPoint[] | null) => void;

  applyHeatmap: (colors: Record<string, string>, legend: HeatmapLegend) => void;
  clearHeatmap: () => void;

  setModelBasedProgress: (progress: ModelBasedProgress | null) => void;
  recordCallCompletion: (callMs: number) => void;

  setReachabilitySourceId: (id: string | null) => void;
  setLabelField: (field: LabelField) => void;
  setWeightExpression: (expr: string) => void;
  setTopologicalEdgeResult: (result: AnalysisResult | null) => void;
  setShapleyParams: (params: Partial<AnalysisState["shapleyParams"]>) => void;
  setShapleyWorst: (worst: AnalysisState["shapleyWorst"]) => void;
  setOiWeightAttr: (attr: string) => void;

  reset: () => void;
}

export type AnalysisStore = AnalysisState & AnalysisActions;

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const initialState: AnalysisState = {
  analysisPageOpen: false,
  activeSection: "topological",
  activeMetric: "betweenness",
  scope: "global",
  result: null,
  nofnMetrics: null,
  percolationCurve: null,
  heatmapColors: {},
  heatmapActive: false,
  heatmapLegend: null,
  modelBasedProgress: null,
  reachabilitySourceId: null,
  labelField: "name",
  weightExpression: "capacity",
  oiWeightAttr: "constant",
  topologicalEdgeResult: null,
  shapleyParams: {
    samples: 200,
    kMax: 3,
    nodesOnly: false,
    maxTimeSecs: 60,
    saveWorstToScorecard: false,
  },
  shapleyWorst: null,
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useAnalysisStore = create<AnalysisStore>()(
  immer((set) => ({
    ...initialState,

    openAnalysisPage() {
      set((s) => { s.analysisPageOpen = true; });
    },

    closeAnalysisPage() {
      set((s) => { s.analysisPageOpen = false; });
    },

    setActiveSection(section) {
      set((s) => {
        s.activeSection = section;
        // Set a sensible default metric when switching sections
        const defaults: Record<AnalysisSection, AnyMetric> = {
          topological: "betweenness",
          reachability: "downstream_reach_count",
          structural: "articulation_points",
          "model-based": "vitality",
        };
        s.activeMetric = defaults[section];
        s.result = null;
      });
    },

    setActiveMetric(metric) {
      set((s) => { s.activeMetric = metric; s.result = null; });
    },

    setScope(scope) {
      set((s) => { s.scope = scope; s.result = null; s.topologicalEdgeResult = null; });
    },

    setResult(result) {
      set((s) => { s.result = result; });
    },

    setNofNMetrics(metrics) {
      set((s) => { s.nofnMetrics = metrics; });
    },

    setPercolationCurve(curve) {
      set((s) => { s.percolationCurve = curve; });
    },

    applyHeatmap(colors, legend) {
      set((s) => {
        s.heatmapColors = colors;
        s.heatmapLegend = legend;
        s.heatmapActive = true;
      });
    },

    clearHeatmap() {
      set((s) => {
        s.heatmapColors = {};
        s.heatmapLegend = null;
        s.heatmapActive = false;
      });
    },

    setModelBasedProgress(progress) {
      set((s) => { s.modelBasedProgress = progress; });
    },

    recordCallCompletion(callMs) {
      set((s) => {
        if (!s.modelBasedProgress) return;
        s.modelBasedProgress.completed += 1;
        if (s.modelBasedProgress.firstCallMs === null) {
          s.modelBasedProgress.firstCallMs = callMs;
          s.modelBasedProgress.avgCallMs = callMs;
        } else {
          const completed = s.modelBasedProgress.completed;
          const prev = s.modelBasedProgress.avgCallMs ?? callMs;
          s.modelBasedProgress.avgCallMs = (prev * (completed - 1) + callMs) / completed;
        }
      });
    },

    setReachabilitySourceId(id) {
      set((s) => { s.reachabilitySourceId = id; });
    },

    setLabelField(field) {
      set((s) => { s.labelField = field; });
    },

    setWeightExpression(expr) {
      set((s) => { s.weightExpression = expr; s.result = null; s.topologicalEdgeResult = null; });
    },

    setTopologicalEdgeResult(result) {
      set((s) => { s.topologicalEdgeResult = result; });
    },

    setShapleyParams(params) {
      set((s) => { Object.assign(s.shapleyParams, params); });
    },

    setShapleyWorst(worst) {
      set((s) => { s.shapleyWorst = worst; });
    },

    setOiWeightAttr(attr) {
      set((s) => { s.oiWeightAttr = attr; s.result = null; });
    },

    reset() {
      set(() => ({ ...initialState }));
    },
  })),
);

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export const selectHeatmapActive = (s: AnalysisStore) => s.heatmapActive;
export const selectHeatmapColors = (s: AnalysisStore) => s.heatmapColors;
export const selectAnalysisPageOpen = (s: AnalysisStore) => s.analysisPageOpen;
