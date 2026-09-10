/**
 * analysis-export.ts — the Shapley Value export document.
 *
 * WHY THIS EXISTS. The Shapley estimator used to have a second implementation in
 * `CASCADE-backend/scripts/paper_shapley_vs_centrality.py`, so the paper's §4.4
 * table was produced by code that was not the code the product runs. Two
 * implementations of one estimator drift, and a drifted paper number is a wrong
 * paper number. The Python side now consumes this document instead of
 * recomputing: the app runs the estimator once, writes the φ̂ values here, and
 * the script joins them against its networkx centralities.
 *
 * That makes this file a published contract, not an internal shape. The field
 * names below are read by a program in another language that this repository's
 * TypeScript compiler cannot check. Renaming one silently breaks the paper
 * pipeline — `analysis-export.test.ts` pins them for that reason.
 *
 * SCALE. `value` is an Operativity Score FRACTION (0–1), matching
 * `estimateShapley`. The retired Python estimator worked on the 0–100 scale, so
 * φ̂ values recorded before this change are 100× larger. Spearman correlations
 * are rank-based and unaffected; a plotted axis is not. `operativity_scale`
 * states which convention a document uses so a reader never has to guess.
 */

import { saveAs } from "@/lib/file-io";
import type { ShapleyResult, WorstCoalition } from "@/lib/model-based-analysis";
import type { GraphSnapshot } from "@/lib/schemas/network";

export const SHAPLEY_EXPORT_FORMAT = "cascade.shapley-export";
export const SHAPLEY_EXPORT_VERSION = 1;

/**
 * One Element's estimated Shapley Value, with enough identity to join on.
 * Not exported: consumers reach it as `ShapleyExport["shapley"][number]`, which
 * keeps the document the single named thing this module publishes.
 */
interface ShapleyExportEntry {
  id: string;
  kind: "node" | "edge";
  label: string;
  /** φ̂ᵢ, as an Operativity Score fraction (0–1). */
  value: number;
}

export interface ShapleyExport {
  format: typeof SHAPLEY_EXPORT_FORMAT;
  version: typeof SHAPLEY_EXPORT_VERSION;
  generated_at: string;
  /** Always "fraction" at version 1. Present so a consumer can reject a rescale. */
  operativity_scale: "fraction";
  network: {
    name: string;
    n_nodes: number;
    n_edges: number;
  };
  /** Everything needed to re-run this exact estimate from the Analysis page. */
  params: {
    samples_requested: number;
    samples_used: number;
    k_max: number;
    seed: number;
    nodes_only: boolean;
    scope: string;
    oi_weight_attr: string;
    /** Engine calls actually made — cache hits excluded. */
    evaluations: number;
  };
  /** Descending by φ̂, so rank is position + 1 without re-sorting. */
  shapley: ShapleyExportEntry[];
  /** Highest-loss coalition per size. Keys are the coalition sizes, as strings. */
  worst_coalitions: Record<string, { ids: string[]; labels: string[]; loss: number }>;
}

export interface ShapleyExportInput {
  result: ShapleyResult;
  /** The Scenario the estimate was run against — supplies labels and counts. */
  snapshot: GraphSnapshot;
  networkName: string;
  samplesRequested: number;
  kMax: number;
  nodesOnly: boolean;
  scope: string;
  oiWeightAttr: string;
  /** Injectable clock, so the document is testable without freezing time. */
  now?: () => Date;
}

/**
 * Label an Element the way the Analysis page shows it: a node's own label, an
 * edge as "source→target" using its endpoints' labels. Falls back to the id, so
 * a partially-labelled network still joins.
 */
function labelOf(id: string, snapshot: GraphSnapshot): string {
  const node = snapshot.nodes[id];
  if (node) return node.label ?? id;
  const edge = snapshot.edges[id];
  if (edge) {
    const src = snapshot.nodes[edge.source]?.label ?? edge.source;
    const tgt = snapshot.nodes[edge.target]?.label ?? edge.target;
    return `${src}→${tgt}`;
  }
  return id;
}

/** Build the export document. Pure — no clock, no DOM, no store. */
export function buildShapleyExport(input: ShapleyExportInput): ShapleyExport {
  const { result, snapshot, now = () => new Date() } = input;

  const shapley: ShapleyExportEntry[] = Object.entries(result.values)
    .map(([id, value]) => ({
      id,
      kind: (id in snapshot.nodes ? "node" : "edge") as "node" | "edge",
      label: labelOf(id, snapshot),
      value,
    }))
    .sort((a, b) => b.value - a.value);

  const worst_coalitions: ShapleyExport["worst_coalitions"] = {};
  for (const [size, coalition] of Object.entries(result.worstCoalitions) as [
    string,
    WorstCoalition,
  ][]) {
    worst_coalitions[size] = {
      ids: coalition.ids,
      labels: coalition.ids.map((id) => labelOf(id, snapshot)),
      loss: coalition.loss,
    };
  }

  return {
    format: SHAPLEY_EXPORT_FORMAT,
    version: SHAPLEY_EXPORT_VERSION,
    generated_at: now().toISOString(),
    operativity_scale: "fraction",
    network: {
      name: input.networkName,
      n_nodes: Object.keys(snapshot.nodes).length,
      n_edges: Object.keys(snapshot.edges).length,
    },
    params: {
      samples_requested: input.samplesRequested,
      samples_used: result.samplesUsed,
      k_max: input.kMax,
      seed: result.seed,
      nodes_only: input.nodesOnly,
      scope: input.scope,
      oi_weight_attr: input.oiWeightAttr,
      evaluations: result.evaluations,
    },
    shapley,
    worst_coalitions,
  };
}

/** Filename stem the document is offered under. Deterministic, so re-exports overwrite. */
export function shapleyExportFilename(doc: ShapleyExport): string {
  const stem = doc.network.name.replace(/[^a-zA-Z0-9_\-.]+/g, "_").slice(0, 60) || "network";
  return `shapley-${stem}-seed${doc.params.seed}.json`;
}

/** Hand the document to the user through the app's one Save-As path. */
export async function downloadShapleyExport(doc: ShapleyExport): Promise<void> {
  await saveAs(shapleyExportFilename(doc), JSON.stringify(doc, null, 2));
}
