/**
 * analysis-metrics.ts — the registry of client-side Analysis Metrics.
 *
 * An Analysis Metric used to have no single definition. Adding one meant editing
 * places that nothing connected: an id union in `analysis-store.ts`, a `METRICS`
 * array inside whichever section component owned it, and a `switch` dispatching
 * that id to a compute function. A metric missing from any one of them failed at
 * runtime.
 *
 * Here a metric is ONE object: what it is called, what it explains, what it
 * needs before it can run, and how to run it. The section components read this
 * list instead of carrying their own, so the Analysis page can only ever offer a
 * metric that is fully defined.
 *
 * The legend side is NOT yet folded in: `analysis-legend.ts` still keys
 * `buildColorMap` / `buildLegend` on `result.metric` string literals, and for
 * the two cone metrics that string (`"downstream_reachability"`) differs from
 * this registry's `id` (`"downstream_cone"`) and from the store union — a third
 * namespace. Unifying the three is a follow-up; until then a new metric that
 * wants a non-gradient palette must also be added to `analysis-legend.ts`.
 *
 * **What is deliberately NOT here**: the model-based metrics (Vitality
 * Centrality, Shapley Values). They are engine calls — async, metered against
 * the Engine Evaluation budget, with progress, sampling parameters, a seed and
 * an export. Folding them in would mean every field above becoming optional to
 * accommodate one of the two families, which is the shallow shape this module
 * exists to remove. They stay in `lib/model-based-analysis.ts`, which already
 * has a good interface of its own.
 */

import {
  computeArticulationPoints,
  computeBridgeEdges,
  computeCloseness,
  computeCommunities,
  computeDegree,
  computeDownstreamReachability,
  computeDownstreamReachabilityAll,
  computeEdgeBetweenness,
  computeEigenvector,
  computeInDegree,
  computeKCore,
  computeNodeBetweenness,
  computeNofNMetrics,
  computeOutDegree,
  computeUpstreamReachability,
  computeUpstreamReachabilityAll,
  type AnalysisGraph,
  type AnalysisResult,
  type NofNMetrics,
} from "@/lib/topological-analysis";

// ---------------------------------------------------------------------------
// What a run is given
// ---------------------------------------------------------------------------

/**
 * Everything any metric here can ask for. Only `graph` is always needed — the
 * rest are read by one family each, so a caller running a structural or
 * reachability metric passes just the graph. Each `run` supplies its own default
 * for a field it reads (`{ weightExpr = "capacity" }`), so an absent field is
 * never a bug, only a metric that does not care.
 */
interface MetricRunContext {
  graph: AnalysisGraph;
  /** The edge-weight expression the user typed; only the topological node metrics read it. */
  weightExpr?: string;
  /** Functionality scale maximum — only weights that read `functionality` need it. */
  n?: number;
  /** The Element a cone metric is drawn from; only the two cone metrics read it. */
  sourceId?: string | null;
}

/** Which panel of the Analysis page offers a metric. */
export type MetricSection = "topological" | "reachability" | "structural";

interface MetricCommon {
  id: string;
  label: string;
  description: string;
  section: MetricSection;
  /**
   * Forced scope. Network-of-Networks compares inter-canvas edges, so it is
   * meaningless on one Canvas and always runs over the full multi-canvas —
   * previously a `metric === "nofn"` branch inside the structural section.
   */
  scope?: "global";
}

/**
 * A metric that scores Elements. `slot` says whether the scores are node- or
 * edge-shaped, which is also which result the Analysis page stores them in —
 * the topological section shows one of each at a time.
 */
export interface ScoredMetric extends MetricCommon {
  kind: "scored";
  slot: "node" | "edge";
  /** True when the weight expression cannot change the answer (purely topological). */
  unweighted?: boolean;
  /** How a higher weight moves this metric's score, for the weight-expression help. */
  weightMeaning?: string;
  /** The metric cannot run until the user picks the Element to draw the cone from. */
  needsSourceId?: boolean;
  run(ctx: MetricRunContext): AnalysisResult;
}

/**
 * A metric that describes the multi-canvas rather than scoring its Elements.
 * There is exactly one, and it is why this is a union: giving `ScoredMetric` an
 * optional "…or maybe it returns something else entirely" would make every
 * consumer handle a case only one metric can produce.
 */
interface StructureMetric extends MetricCommon {
  kind: "structure";
  run(ctx: MetricRunContext): NofNMetrics;
}

export type MetricDefinition = ScoredMetric | StructureMetric;

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

export const ANALYSIS_METRICS: readonly MetricDefinition[] = [
  // --- Topological: node centrality ----------------------------------------
  {
    kind: "scored", section: "topological", slot: "node",
    id: "betweenness", label: "Betweenness",
    description: "Relay nodes that mediate the most paths — bottleneck relay points.",
    weightMeaning:
      "Higher weight = preferred route (used as 1/weight distance). Nodes on high-weight corridors score higher.",
    run: ({ graph, weightExpr = "capacity", n = 5 }) => computeNodeBetweenness(graph, weightExpr, n),
  },
  {
    kind: "scored", section: "topological", slot: "node",
    id: "closeness", label: "Closeness",
    description: "Nodes closest to all others on average.",
    unweighted: true,
    run: ({ graph, weightExpr = "capacity", n = 5 }) => computeCloseness(graph, weightExpr, n),
  },
  {
    kind: "scored", section: "topological", slot: "node",
    id: "eigenvector", label: "Eigenvector",
    description: "Nodes connected to other high-scoring nodes — influence hubs.",
    weightMeaning:
      "Higher weight = stronger connection to influential neighbors → higher score propagated back.",
    run: ({ graph, weightExpr = "capacity", n = 5 }) => computeEigenvector(graph, weightExpr, n),
  },
  {
    kind: "scored", section: "topological", slot: "node",
    id: "degree", label: "Degree",
    description: "Total connection strength — sum of all edge weights.",
    weightMeaning: "Higher weight = more counted connection strength. Use 1 for a pure hop count.",
    run: ({ graph, weightExpr = "capacity", n = 5 }) => computeDegree(graph, weightExpr, n),
  },
  {
    kind: "scored", section: "topological", slot: "node",
    id: "in_degree", label: "In-Degree",
    description:
      "Weighted in-connection strength — how heavily this node depends on its suppliers.",
    weightMeaning: "Higher weight on incoming edges = node is more heavily supplied/dependent.",
    run: ({ graph, weightExpr = "capacity", n = 5 }) => computeInDegree(graph, weightExpr, n),
  },
  {
    kind: "scored", section: "topological", slot: "node",
    id: "out_degree", label: "Out-Degree",
    description:
      "Weighted out-connection strength — how heavily this node pushes downstream.",
    weightMeaning: "Higher weight on outgoing edges = node has stronger downstream impact.",
    run: ({ graph, weightExpr = "capacity", n = 5 }) => computeOutDegree(graph, weightExpr, n),
  },
  {
    kind: "scored", section: "topological", slot: "node",
    id: "k_core", label: "K-Core",
    description: "Maximum shell index — higher = more embedded in the network backbone.",
    unweighted: true,
    run: ({ graph }) => computeKCore(graph),
  },

  // --- Topological: edge centrality ----------------------------------------
  {
    kind: "scored", section: "topological", slot: "edge",
    id: "edge_betweenness", label: "Edge Betweenness",
    description: "Critical links — edges that mediate the most shortest paths.",
    weightMeaning:
      "Higher weight = preferred route (1/weight distance). High-weight edges appear on more paths and score higher.",
    run: ({ graph }) => computeEdgeBetweenness(graph),
  },
  {
    kind: "scored", section: "topological", slot: "edge",
    id: "bridge_edges", label: "Bridge Edges",
    description:
      "Edges whose removal disconnects the graph — structural single points of failure.",
    unweighted: true,
    run: ({ graph }) => computeBridgeEdges(graph),
  },

  // --- Reachability --------------------------------------------------------
  {
    kind: "scored", section: "reachability", slot: "node",
    id: "downstream_reach_count", label: "Downstream Reach (all)",
    description:
      "Per-node count of nodes reachable downstream. High = large cascade impact if this node fails.",
    run: ({ graph }) => computeDownstreamReachabilityAll(graph),
  },
  {
    kind: "scored", section: "reachability", slot: "node",
    id: "upstream_reach_count", label: "Upstream Reach (all)",
    description:
      "Per-node count of nodes that must be healthy upstream. High = many dependencies.",
    run: ({ graph }) => computeUpstreamReachabilityAll(graph),
  },
  {
    kind: "scored", section: "reachability", slot: "node",
    id: "downstream_cone", label: "Downstream Cone",
    description:
      "Highlights all nodes reachable from a selected source — its cascade footprint.",
    needsSourceId: true,
    run: ({ graph, sourceId }) => computeDownstreamReachability(graph, sourceId ?? ""),
  },
  {
    kind: "scored", section: "reachability", slot: "node",
    id: "upstream_cone", label: "Upstream Cone",
    description:
      "Highlights all nodes that a selected target depends on — its dependency footprint.",
    needsSourceId: true,
    run: ({ graph, sourceId }) => computeUpstreamReachability(graph, sourceId ?? ""),
  },

  // --- Structural ----------------------------------------------------------
  {
    kind: "scored", section: "structural", slot: "node",
    id: "articulation_points", label: "Articulation Points",
    description:
      "Nodes whose removal disconnects the graph — structural single points of failure.",
    run: ({ graph }) => computeArticulationPoints(graph),
  },
  {
    kind: "scored", section: "structural", slot: "node",
    id: "community", label: "Community Detection",
    description:
      "Louvain clustering: nodes grouped by connection density. Reveals hidden sub-systems.",
    run: ({ graph }) => computeCommunities(graph),
  },
  {
    kind: "structure", section: "structural",
    id: "nofn", label: "Network-of-Networks",
    description:
      "Coupling strength, interdependency ratio, feedback loops, and meta-graph across all Canvases.",
    scope: "global",
    run: ({ graph }) => computeNofNMetrics(graph),
  },
];

// ---------------------------------------------------------------------------
// Reading the registry
// ---------------------------------------------------------------------------

const BY_ID = new Map(ANALYSIS_METRICS.map((m) => [m.id, m]));

/** The definition for one metric id, or undefined for an id nothing defines. */
export function metricById(id: string): MetricDefinition | undefined {
  return BY_ID.get(id);
}

/**
 * A scored metric by id, or undefined. Distinct from `metricById` only in the
 * return type: the section components hold a store id typed as the wide
 * `AnyMetric` union, and the alternative to this accessor is an `as ScoredMetric`
 * cast at every call site.
 */
export function scoredMetricById(id: string): ScoredMetric | undefined {
  const m = BY_ID.get(id);
  return m?.kind === "scored" ? m : undefined;
}

/** Every metric one panel offers, in the order it lists them. */
export function metricsForSection(section: MetricSection): MetricDefinition[] {
  return ANALYSIS_METRICS.filter((m) => m.section === section);
}

/** Every metric a panel offers that writes one result slot. */
export function scoredMetricsFor(section: MetricSection, slot: "node" | "edge"): ScoredMetric[] {
  return ANALYSIS_METRICS.filter(
    (m): m is ScoredMetric => m.kind === "scored" && m.section === section && m.slot === slot,
  );
}

/**
 * The scope a metric actually runs at: its own, when it insists, otherwise the
 * one the user selected. One place decides, rather than a branch per section.
 */
export function effectiveScope(
  metric: MetricDefinition | undefined,
  selected: "local" | "global",
): "local" | "global" {
  return metric?.scope ?? selected;
}

/** Whether a metric can run yet — the cone metrics need an Element picked first. */
export function canRun(metric: MetricDefinition | undefined, sourceId: string | null): boolean {
  if (!metric) return false;
  if (metric.kind === "scored" && metric.needsSourceId) return Boolean(sourceId);
  return true;
}
