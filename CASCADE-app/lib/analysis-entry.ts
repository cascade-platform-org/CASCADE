/**
 * analysis-entry.ts — building an Analysis Scorecard entry from a finished run.
 *
 * WHY THIS IS NOT INLINE IN THE SAVE DIALOG. The dialog used to stamp the entry
 * with the analysis store's `activeMetric`, which is *selector* state. Only
 * three of the four Analysis sections write it — `section-topological.tsx`
 * keeps its selection in local React state and never touches the store — so
 * every topological entry was saved as whatever metric had last been selected
 * elsewhere, defaulting to "betweenness". The label is user-visible on the
 * Scorecard card and is persisted in the project file, so the record was wrong
 * for good.
 *
 * The Analysis Result already carries the metric it was computed with: the
 * analysis functions stamp `metric` when they build it, so it cannot disagree
 * with the scores beside it. This module takes the Result and nothing else that
 * could drift, which is what makes the old bug unrepresentable rather than
 * merely fixed.
 */

import type { AnalysisResult } from "@/lib/topological-analysis";
import type { AnalysisScorecardEntry, GraphSnapshot } from "@/lib/schemas/network";

export interface AnalysisEntryInput {
  /** The finished run. Supplies BOTH the metric name and the scores. */
  result: AnalysisResult;
  label: string;
  scope: "local" | "global";
  /** The Canvas the run covered. Recorded only for a local-scope run. */
  activeCanvasId: string | null;
  snapshot: GraphSnapshot;
  /** Injectable so a test does not depend on the clock or on crypto. */
  id: string;
  now?: () => Date;
}

/**
 * Assemble the entry. Pure.
 *
 * `canvas_id` is omitted for a global run rather than set to the Canvas that
 * happened to be active: a global Analysis covers the whole registry, and
 * naming one Canvas would imply a scope the scores do not have.
 */
export function buildAnalysisEntry(input: AnalysisEntryInput): AnalysisScorecardEntry {
  const { result, scope, now = () => new Date() } = input;
  return {
    type: "analysis",
    id: input.id,
    label: input.label.trim(),
    created_at: now().toISOString(),
    metric: result.metric,
    scope,
    ...(scope === "local" && input.activeCanvasId ? { canvas_id: input.activeCanvasId } : {}),
    scores: result.scores,
    snapshot: input.snapshot,
  };
}
