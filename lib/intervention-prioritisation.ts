/**
 * Intervention prioritisation — ranked repair list from a post-propagation GraphSnapshot.
 *
 * Open/auditable client-side computation. Never touches the engine boundary.
 *
 * Each candidate carries three recovery values, each computed by running the same
 * transitive blame-chain distribution with a different weight function W(el, N):
 *
 *   recoveryValue        W = cost_of_disservice_per_day ?? importance ?? 1  (combined)
 *   recoveryByImportance W = importance ?? 0
 *   recoveryByValue      W = cost_of_disservice_per_day ?? 0
 *
 * Loss formula for each degraded element:  L = W × (N − f) / (N − 1)
 * Edges always contribute W = 0 (a broken pipe costs nothing in isolation;
 * the hospital it starves carries the cost — edges participate as blame
 * intermediaries only).
 *
 * Losses are distributed backward along transitive responsibility_share chains
 * until reaching:
 *   • direct_damage=true elements → repair terminal, mass attributed here
 *   • EventId keys (not present in nodes/edges registry) → non-repairable bucket
 *   • Elements with no responsibility_share → non-repairable bucket
 *   • Cycle or depth limit → unattributed bucket
 *
 * Conservation: Σ recoveryValues + nonRepairableLoss + unattributedLoss ≈ totalLoss
 * (exact when responsibility_share sums to 1 on each element, approximate otherwise)
 */

import type { GraphSnapshot, Node, Edge } from "@/lib/schemas/network";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RepairCandidate {
  id: string;
  kind: "node" | "edge";
  /** Current functionality level (1..N). */
  functionality: number;
  /** Element's own weighted loss using the combined formula. Always 0 for edges. */
  directLoss: number;
  /**
   * Transitive recovery value — combined weight (cost_of_disservice_per_day ?? importance ?? 1).
   * The primary ranking metric.
   */
  recoveryValue: number;
  /**
   * Transitive recovery value weighted by importance only (importance ?? 0).
   * Zero for edges and nodes without an importance value.
   */
  recoveryByImportance: number;
  /**
   * Transitive recovery value weighted by cost_of_disservice_per_day only (cost ?? 0).
   * Zero for edges and nodes without a cost value.
   */
  recoveryByValue: number;
  /** From element.expected_repair_time. undefined = no estimate provided. */
  expectedRepairTime: number | undefined;
  /**
   * recoveryValue / expectedRepairTime.
   * Infinity  — repairTime is 0 (instantaneous repair; sorts first in efficiency mode).
   * undefined — repairTime is absent (no estimate; sorts last in efficiency mode).
   */
  valuePerHour: number | undefined;
}

export interface AtRiskElement {
  id: string;
  kind: "node" | "edge";
  functionality: number;
  /** Remaining hours before a deferred functionality drop (backup countdown). */
  functionalityTime: number;
  direct_damage: boolean;
}

export interface InterventionSummary {
  /** Max functionality scale level N (from ModelConfiguration). */
  N: number;
  /** direct_damage=true elements ranked by recoveryValue descending. */
  byValue: RepairCandidate[];
  /**
   * direct_damage=true elements ranked by valuePerHour descending.
   * Candidates with no repair estimate appear after all ranked candidates.
   */
  byEfficiency: RepairCandidate[];
  /** Ranked by recoveryByImportance descending. */
  byImportance: RepairCandidate[];
  /** Ranked by recoveryByValue (economic cost) descending. */
  byCostOfDisservice: RepairCandidate[];
  /** Elements with functionality_time > 0, ascending (most urgent first). */
  atRisk: AtRiskElement[];
  /** Σ L(D) across all degraded elements (combined weight). */
  totalLoss: number;
  /** Loss mass terminated on EventId keys or non-repairable natural roots. */
  nonRepairableLoss: number;
  /**
   * Loss mass cut by cycle detection or depth cap.
   * recoveryValues Σ + nonRepairableLoss + unattributedLoss ≈ totalLoss.
   */
  unattributedLoss: number;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const MAX_CHAIN_DEPTH = 50;

function isEdge(el: Node | Edge): el is Edge {
  return "source" in el;
}

type WeightFn = (el: Node | Edge, N: number) => number;

const combinedWeight: WeightFn = (el, N) => {
  if (N <= 1 || isEdge(el)) return 0;
  const W = el.cost_of_disservice_per_day ?? el.importance ?? 1;
  return W * (N - el.functionality) / (N - 1);
};

const importanceWeight: WeightFn = (el, N) => {
  if (N <= 1 || isEdge(el)) return 0;
  return (el.importance ?? 0) * (N - el.functionality) / (N - 1);
};

const economicWeight: WeightFn = (el, N) => {
  if (N <= 1 || isEdge(el)) return 0;
  return (el.cost_of_disservice_per_day ?? 0) * (N - el.functionality) / (N - 1);
};

/**
 * Recursively distribute `mass` of blame backward from `elementId`.
 * Terminates at direct_damage=true elements, EventId keys, natural roots, or depth/cycle cap.
 */
function distribute(
  elementId: string,
  mass: number,
  allElements: Record<string, Node | Edge>,
  recoveryValues: Map<string, number>,
  acc: { nonRepairable: number; unattributed: number },
  chain: ReadonlySet<string>,
  depth: number,
): void {
  if (mass <= 0) return;

  if (depth >= MAX_CHAIN_DEPTH || chain.has(elementId)) {
    acc.unattributed += mass;
    return;
  }

  const el = allElements[elementId];
  if (!el) {
    acc.unattributed += mass;
    return;
  }

  if (el.direct_damage === true) {
    recoveryValues.set(elementId, (recoveryValues.get(elementId) ?? 0) + mass);
    return;
  }

  const share = el.responsibility_share;
  if (!share || Object.keys(share).length === 0) {
    acc.nonRepairable += mass;
    return;
  }

  const nextChain = new Set(chain);
  nextChain.add(elementId);

  for (const [causeId, fraction] of Object.entries(share)) {
    if (causeId in allElements) {
      distribute(causeId, mass * fraction, allElements, recoveryValues, acc, nextChain, depth + 1);
    } else {
      acc.nonRepairable += mass * fraction;
    }
  }
}

/**
 * Run the full blame-chain distribution for a given weight function.
 * Returns per-element recovery values plus mass conservation totals.
 */
function runDistribution(
  allElements: Record<string, Node | Edge>,
  N: number,
  weight: WeightFn,
): { recoveryValues: Map<string, number>; totalLoss: number; nonRepairable: number; unattributed: number } {
  const recoveryValues = new Map<string, number>();
  let totalLoss = 0;
  const acc = { nonRepairable: 0, unattributed: 0 };

  for (const el of Object.values(allElements)) {
    if (el.functionality >= N) continue;

    const L = weight(el, N);
    totalLoss += L;

    if (el.direct_damage === true) {
      recoveryValues.set(el.id, (recoveryValues.get(el.id) ?? 0) + L);
      continue;
    }

    const share = el.responsibility_share;
    if (!share || Object.keys(share).length === 0) {
      acc.nonRepairable += L;
      continue;
    }

    const initChain = new Set([el.id]);
    for (const [causeId, fraction] of Object.entries(share)) {
      if (causeId in allElements) {
        distribute(causeId, L * fraction, allElements, recoveryValues, acc, initChain, 0);
      } else {
        acc.nonRepairable += L * fraction;
      }
    }
  }

  return { recoveryValues, totalLoss, nonRepairable: acc.nonRepairable, unattributed: acc.unattributed };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute intervention prioritisation from a post-propagation graph snapshot.
 *
 * @param snapshot  Graph state where degraded elements carry responsibility_share
 *                  from the most recent propagation run.
 * @param N         Max functionality scale level — max(level for l in functionality_scale).
 */
export function computeInterventionPrioritisation(
  snapshot: GraphSnapshot,
  N: number,
): InterventionSummary {
  const { nodes, edges } = snapshot;
  const allElements: Record<string, Node | Edge> = { ...nodes, ...edges };

  // Three independent distributions — same blame-chain graph, different weight functions.
  const {
    recoveryValues,
    totalLoss,
    nonRepairable,
    unattributed,
  } = runDistribution(allElements, N, combinedWeight);
  const { recoveryValues: importanceValues } = runDistribution(allElements, N, importanceWeight);
  const { recoveryValues: economicValues }   = runDistribution(allElements, N, economicWeight);

  // Build candidate list: all direct_damage=true elements.
  const candidates: RepairCandidate[] = [];
  for (const el of Object.values(allElements)) {
    if (el.direct_damage !== true) continue;

    const rv          = recoveryValues.get(el.id) ?? 0;
    const repairTime  = el.expected_repair_time;
    const directLoss  = combinedWeight(el, N);

    const valuePerHour: number | undefined =
      repairTime === undefined
        ? undefined
        : repairTime === 0
          ? Infinity
          : rv / repairTime;

    candidates.push({
      id: el.id,
      kind: isEdge(el) ? "edge" : "node",
      functionality: el.functionality,
      directLoss,
      recoveryValue:        rv,
      recoveryByImportance: importanceValues.get(el.id) ?? 0,
      recoveryByValue:      economicValues.get(el.id) ?? 0,
      expectedRepairTime:   repairTime,
      valuePerHour,
    });
  }

  const byValue = [...candidates].sort((a, b) => b.recoveryValue - a.recoveryValue);

  const byEfficiency = [...candidates].sort((a, b) => {
    if (a.valuePerHour === undefined && b.valuePerHour === undefined) return 0;
    if (a.valuePerHour === undefined) return 1;
    if (b.valuePerHour === undefined) return -1;
    if (a.valuePerHour === Infinity && b.valuePerHour === Infinity) return 0;
    return b.valuePerHour - a.valuePerHour;
  });

  const byImportance      = [...candidates].sort((a, b) => b.recoveryByImportance - a.recoveryByImportance);
  const byCostOfDisservice = [...candidates].sort((a, b) => b.recoveryByValue      - a.recoveryByValue);

  const atRisk: AtRiskElement[] = Object.values(allElements)
    .filter((el) => (el.functionality_time ?? 0) > 0)
    .map((el) => ({
      id: el.id,
      kind: isEdge(el) ? "edge" as const : "node" as const,
      functionality: el.functionality,
      functionalityTime: el.functionality_time!,
      direct_damage: el.direct_damage ?? false,
    }))
    .sort((a, b) => a.functionalityTime - b.functionalityTime);

  return {
    N,
    byValue,
    byEfficiency,
    byImportance,
    byCostOfDisservice,
    atRisk,
    totalLoss,
    nonRepairableLoss: nonRepairable,
    unattributedLoss:  unattributed,
  };
}
