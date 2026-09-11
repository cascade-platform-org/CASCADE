/**
 * operativity-basis — what an Engine Evaluation leaves behind so its
 * Operativity Score can be re-derived under a different weighting.
 *
 * Why this exists: a model-based Analysis Metric (Vitality, Shapley) turns each
 * propagated Scenario straight into one number and throws the Scenario away.
 * That made the Operativity weighting a *run* parameter — change it and the
 * result had to be discarded, paying for the whole run again. But the weighting
 * only enters at the very last step, in `computeOperativityScore`. Keep just
 * enough of each propagated Scenario and the same run re-scores under any
 * weighting for free, which is how the Scorecard has always behaved: it stores
 * snapshots and derives the score at render time.
 *
 * "Just enough" is a delta, not a snapshot. A cascade moves the Functionality of
 * a handful of Elements; every other field — including the node attributes the
 * weighting reads — is the baseline's. Storing whole snapshots for every
 * evaluation of a Shapley run would be hundreds of megabytes; storing the
 * changed Functionality values is a few kilobytes.
 */

import type { GraphSnapshot } from "@/lib/schemas/network";
import { computeOperativityScore } from "@/lib/scorecard-utils";

export interface EvaluationOutcome {
  /** nodeId → post-cascade Functionality, only where it differs from baseline. */
  changed: Record<string, number>;
  /** Nodes absent from the evaluated Scenario (the removed Elements). */
  removed: string[];
}

/**
 * Reduce a propagated Scenario to its difference from the baseline. Only node
 * Functionality is kept: it is the sole thing `computeOperativityScore` reads
 * that a Propagation moves.
 */
export function captureOutcome(baseline: GraphSnapshot, after: GraphSnapshot): EvaluationOutcome {
  const changed: Record<string, number> = {};
  const removed: string[] = [];

  for (const [id, node] of Object.entries(baseline.nodes)) {
    const post = after.nodes[id];
    if (!post) {
      removed.push(id);
      continue;
    }
    if (post.functionality !== node.functionality) changed[id] = post.functionality as number;
  }
  return { changed, removed };
}

/**
 * Rebuild the scoreable Scenario. Node objects are shared with the baseline
 * wherever nothing changed, so this costs one shallow map rather than a deep
 * clone. Edges are untouched — the Operativity Score does not read them.
 */
export function rebuildSnapshot(baseline: GraphSnapshot, outcome: EvaluationOutcome): GraphSnapshot {
  const gone = new Set(outcome.removed);
  const nodes: GraphSnapshot["nodes"] = {};
  for (const [id, node] of Object.entries(baseline.nodes)) {
    if (gone.has(id)) continue;
    const fn = outcome.changed[id];
    nodes[id] = fn === undefined ? node : { ...node, functionality: fn };
  }
  return { ...baseline, nodes };
}

/** The Operativity Score this evaluation would yield under `weightAttr`. */
export function scoreOutcome(
  baseline: GraphSnapshot,
  outcome: EvaluationOutcome,
  n: number,
  weightAttr: string,
): number {
  return computeOperativityScore(rebuildSnapshot(baseline, outcome), n, weightAttr);
}
