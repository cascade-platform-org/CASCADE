/**
 * Intervention prioritisation — ranked repair list from a post-propagation GraphSnapshot.
 *
 * Open/auditable client-side computation. Never touches the engine boundary.
 *
 * Formula: L(D) = W(D) × (N − f_D) / (N − 1)
 *   W = cost_of_disservice_per_day ?? importance ?? 1  (nodes only)
 *   W = 0 for edges (a broken pipe costs nothing in isolation; the hospital it
 *   starves carries the cost — edges participate as blame intermediaries only)
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
  /** Element's own weighted loss: W × (N − f) / (N − 1). Always 0 for edges. */
  directLoss: number;
  /** Sum of all loss portions that terminate at this element via blame chains. */
  recoveryValue: number;
  /** From element.expected_repair_time. undefined = no estimate provided. */
  expectedRepairTime: number | undefined;
  /**
   * recoveryValue / expectedRepairTime.
   * Infinity  — repairTime is 0 (instantaneous repair; sorts first in efficiency mode).
   * undefined — repairTime is absent (no estimate; sorts last in efficiency mode).
   */
  valuePerHour: number | undefined;
  /** From node.importance. undefined for edges and nodes where the field is absent. */
  importance: number | undefined;
  /** From node.cost_of_disservice_per_day. undefined for edges and nodes where the field is absent. */
  cost_of_disservice_per_day: number | undefined;
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
  /** Functionality scale length N (from ModelConfiguration). */
  N: number;
  /** direct_damage=true elements ranked by recoveryValue descending. */
  byValue: RepairCandidate[];
  /**
   * direct_damage=true elements ranked by valuePerHour descending.
   * Candidates with no repair estimate appear after all ranked candidates.
   */
  byEfficiency: RepairCandidate[];
  /**
   * Ranked by importance descending.
   * Candidates without importance (edges, or nodes missing the field) sort last.
   */
  byImportance: RepairCandidate[];
  /**
   * Ranked by cost_of_disservice_per_day descending.
   * Candidates without the field sort last.
   */
  byCostOfDisservice: RepairCandidate[];
  /** Elements with functionality_time > 0, ascending (most urgent first). */
  atRisk: AtRiskElement[];
  /** Σ L(D) across all degraded elements. */
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

/** Weighted loss for a degraded element. Edges always return 0. */
function weightedLoss(el: Node | Edge, N: number): number {
  if (N <= 1 || isEdge(el)) return 0;
  const W = el.cost_of_disservice_per_day ?? el.importance ?? 1;
  return W * (N - el.functionality) / (N - 1);
}

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
    // Dangling reference (element deleted after propagation)
    acc.unattributed += mass;
    return;
  }

  if (el.direct_damage === true) {
    // Repair terminal: repairing this element would unblock the loss mass
    recoveryValues.set(elementId, (recoveryValues.get(elementId) ?? 0) + mass);
    return;
  }

  // Pass-through element: not directly repairable, trace further back
  const share = el.responsibility_share;
  if (!share || Object.keys(share).length === 0) {
    // Natural root with no attribution — loss is non-repairable by a crew
    acc.nonRepairable += mass;
    return;
  }

  const nextChain = new Set(chain);
  nextChain.add(elementId);

  for (const [causeId, fraction] of Object.entries(share)) {
    if (causeId in allElements) {
      distribute(causeId, mass * fraction, allElements, recoveryValues, acc, nextChain, depth + 1);
    } else {
      // causeId is an EventId — externally caused, not repairable by a crew
      acc.nonRepairable += mass * fraction;
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute intervention prioritisation from a post-propagation graph snapshot.
 *
 * @param snapshot  Graph state where degraded elements carry responsibility_share
 *                  from the most recent propagation run.
 * @param N         Functionality scale length — ModelConfiguration.functionality_scale.length.
 */
export function computeInterventionPrioritisation(
  snapshot: GraphSnapshot,
  N: number,
): InterventionSummary {
  const { nodes, edges } = snapshot;
  const allElements: Record<string, Node | Edge> = { ...nodes, ...edges };

  const recoveryValues = new Map<string, number>();
  let totalLoss = 0;
  const acc = { nonRepairable: 0, unattributed: 0 };

  for (const el of Object.values(allElements)) {
    if (el.functionality >= N) continue;  // fully operational, no loss

    const L = weightedLoss(el, N);
    totalLoss += L;

    if (el.direct_damage === true) {
      // Own loss stays at this element: it is the repair terminal for its own degradation.
      // We do NOT trace el's own responsibility_share further — el's damage is the root cause
      // that a crew would fix directly.
      recoveryValues.set(el.id, (recoveryValues.get(el.id) ?? 0) + L);
      continue;
    }

    // Non-direct_damage degraded element: distribute its loss backward.
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
        // EventId key at the top level — loss caused by an external event
        acc.nonRepairable += L * fraction;
      }
    }
  }

  // Build candidate list: all direct_damage=true elements (including those at full
  // functionality — still physically broken, repair crew should know about them).
  const candidates: RepairCandidate[] = [];
  for (const el of Object.values(allElements)) {
    if (el.direct_damage !== true) continue;

    const rv = recoveryValues.get(el.id) ?? 0;
    const repairTime = el.expected_repair_time;
    const directLoss = weightedLoss(el, N);

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
      recoveryValue: rv,
      expectedRepairTime: repairTime,
      valuePerHour,
      importance: isEdge(el) ? undefined : el.importance,
      cost_of_disservice_per_day: isEdge(el) ? undefined : el.cost_of_disservice_per_day,
    });
  }

  const byValue = [...candidates].sort((a, b) => b.recoveryValue - a.recoveryValue);

  const byEfficiency = [...candidates].sort((a, b) => {
    if (a.valuePerHour === undefined && b.valuePerHour === undefined) return 0;
    if (a.valuePerHour === undefined) return 1;   // no-estimate sorts last
    if (b.valuePerHour === undefined) return -1;
    if (a.valuePerHour === Infinity && b.valuePerHour === Infinity) return 0;
    return b.valuePerHour - a.valuePerHour;       // Infinity sorts first
  });

  function descByField(field: "importance" | "cost_of_disservice_per_day") {
    return [...candidates].sort((a, b) => (b[field] ?? 0) - (a[field] ?? 0));
  }

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
    byImportance: descByField("importance"),
    byCostOfDisservice: descByField("cost_of_disservice_per_day"),
    atRisk,
    totalLoss,
    nonRepairableLoss: acc.nonRepairable,
    unattributedLoss: acc.unattributed,
  };
}
