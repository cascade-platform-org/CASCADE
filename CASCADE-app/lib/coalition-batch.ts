/**
 * coalition-batch.ts — pre-score a Shapley run's Scenarios in batches.
 *
 * THE PROBLEM. `estimateShapley` asks for one coalition at a time, and in
 * production each ask was a `POST /api/propagate` carrying the whole Project. A
 * 39-node network at the default settings is ~1,300 requests re-sending an
 * unchanged ~49 KB Project, re-parsed server-side every time; measured, over
 * half a run's wall clock was that transport, against ~8 ms of actual engine
 * work per call.
 *
 * THE FIX, AND WHAT IT DELIBERATELY DOES NOT TOUCH. The estimator's sampling is
 * seeded, so `planPermutations` yields every Scenario the run will visit before
 * the first one is evaluated. This module scores those in chunks and hands the
 * estimator a `CoalitionEvaluator` backed by the filled map. `estimateShapley`
 * is unchanged and cannot tell the difference — its interface stays "give me a
 * score for this set", which is also what keeps its tests running against pure
 * functions with no network.
 *
 * A coalition the estimator asks for that is somehow not in the map falls back
 * to a single evaluation rather than failing: the plan is derived from the same
 * seed, so a miss should be impossible, and a wrong answer is a worse outcome
 * than a slow one if it ever is not.
 */

import {
  coalitionKey,
  planPermutations,
  type CoalitionEvaluator,
  type ElementRef,
} from "@/lib/model-based-analysis";

/** Scores one chunk of Scenarios. Returns one score per coalition, in order. */
export type ChunkScorer = (coalitions: string[][]) => Promise<number[]>;

export interface PrefetchOptions {
  samples: number;
  kMax: number;
  seed: number;
  /** Server-enforced maximum; see MAX_COALITIONS_PER_BATCH in lib/schemas/api.ts. */
  chunkSize: number;
}

export interface PrefetchHooks {
  /**
   * Called once per chunk with how many coalitions it scored and how long the
   * request took. The elapsed time is the chunk's, not one coalition's — a
   * caller estimating "time remaining" should divide.
   */
  onScored?: (count: number, elapsedMs: number) => void;
  /** Polled between chunks. Returning true stops fetching and keeps what is scored. */
  isCancelled?: () => boolean;
  /** Injectable clock, so timing can be tested without waiting. */
  now?: () => number;
}

/**
 * Every distinct Scenario a run will need, in first-visit order.
 *
 * The empty coalition leads because the estimator evaluates the baseline first
 * and treats a failure there as fatal — fetching it in the first chunk means a
 * dead engine surfaces immediately rather than after the whole plan.
 *
 * Deduplicated for the same reason the estimator caches: a coalition reached by
 * two permutations is one Scenario and must cost one evaluation.
 */
export function distinctCoalitions(plan: readonly string[][]): string[][] {
  const seen = new Set<string>([coalitionKey([])]);
  const out: string[][] = [[]];

  for (const order of plan) {
    const failed: string[] = [];
    for (const id of order) {
      failed.push(id);
      const key = coalitionKey(failed);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([...failed]);
    }
  }
  return out;
}

/** Split into server-sized chunks. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface PrefetchResult {
  /** coalitionKey → Operativity Score fraction. */
  scores: Map<string, number>;
  /** Requests actually sent — what replaced one-per-coalition. */
  requests: number;
}

/**
 * Score every Scenario the run needs, `chunkSize` at a time.
 *
 * A chunk that throws is skipped, not fatal: its coalitions stay absent from the
 * map and fall back to single evaluations, so one bad response costs speed
 * rather than the run. Cancellation is checked between chunks — the estimator
 * then normalises over the samples it managed, exactly as before.
 */
export async function prefetchCoalitionScores(
  elements: readonly ElementRef[],
  options: PrefetchOptions,
  scoreChunk: ChunkScorer,
  hooks: PrefetchHooks = {},
): Promise<PrefetchResult> {
  const plan = planPermutations(elements, options);
  const coalitions = distinctCoalitions(plan);
  const scores = new Map<string, number>();
  let requests = 0;

  const now = hooks.now ?? Date.now;
  for (const batch of chunk(coalitions, options.chunkSize)) {
    if (hooks.isCancelled?.()) break;
    requests++;
    const startedAt = now();
    try {
      const results = await scoreChunk(batch);
      results.forEach((score, i) => {
        if (i < batch.length) scores.set(coalitionKey(batch[i]), score);
      });
      hooks.onScored?.(Math.min(results.length, batch.length), now() - startedAt);
    } catch {
      /* leave this chunk unscored — its coalitions fall back to single calls */
    }
  }

  return { scores, requests };
}

/**
 * A `CoalitionEvaluator` that answers from the pre-fetched map, falling back to
 * `evaluateOne` for anything missing.
 */
export function makePrefetchedEvaluator(
  scores: ReadonlyMap<string, number>,
  evaluateOne: CoalitionEvaluator,
): CoalitionEvaluator {
  return async (failed) => {
    const hit = scores.get(coalitionKey(failed));
    return hit !== undefined ? hit : evaluateOne(failed);
  };
}
