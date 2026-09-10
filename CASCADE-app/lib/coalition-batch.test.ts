/**
 * Tests for batched coalition pre-fetching.
 *
 * The point of the module is that batching is invisible to the estimate. So the
 * load-bearing test is not "it chunks" but "the values come out identical to the
 * one-at-a-time run, with far fewer requests".
 */

import { describe, it, expect } from "vitest";

import {
  chunk,
  distinctCoalitions,
  makePrefetchedEvaluator,
  prefetchCoalitionScores,
} from "@/lib/coalition-batch";
import {
  coalitionKey,
  estimateShapley,
  planPermutations,
  type ElementRef,
} from "@/lib/model-based-analysis";

const refs = (n: number): ElementRef[] =>
  Array.from({ length: n }, (_, i) => ({ id: `e${i}`, kind: "node" as const }));

/** An additive game: exact Shapley values, so any drift is visible. */
const weights: Record<string, number> = { e0: 0.4, e1: 0.3, e2: 0.2, e3: 0.1 };
const game = async (failed: ReadonlySet<string>) =>
  1 - [...failed].reduce((acc, id) => acc + (weights[id] ?? 0), 0);

const scoreChunkFrom =
  (calls: { batches: number; coalitions: number }) =>
  async (coalitions: string[][]) => {
    calls.batches++;
    calls.coalitions += coalitions.length;
    return Promise.all(coalitions.map((ids) => game(new Set(ids))));
  };

describe("batching does not change the answer", () => {
  it("reproduces the one-at-a-time estimate exactly, in a fraction of the requests", async () => {
    const elements = refs(4);
    const options = { samples: 200, kMax: 2, seed: 7 };

    const direct = await estimateShapley(elements, game, options);

    const calls = { batches: 0, coalitions: 0 };
    const { scores, requests } = await prefetchCoalitionScores(
      elements,
      { ...options, chunkSize: 50 },
      scoreChunkFrom(calls),
    );
    const batched = await estimateShapley(
      elements,
      makePrefetchedEvaluator(scores, async () => {
        throw new Error("fell back to a single evaluation");
      }),
      options,
    );

    expect(batched.values).toEqual(direct.values);
    expect(batched.samplesUsed).toBe(direct.samplesUsed);
    // 4 Elements at kMax 2: baseline + 4 singletons + 12 ordered pairs that
    // dedupe to 6 sets = 11 Scenarios, one request instead of eleven.
    expect(calls.coalitions).toBe(11);
    expect(requests).toBe(1);
  });

  it("keeps the estimator's own key format, so nothing silently misses", () => {
    // Two modules index the same map. A divergent key would not throw — every
    // lookup would miss and every Scenario would be re-fetched one at a time,
    // which is the failure mode this module exists to remove.
    const plan = planPermutations(refs(4), { samples: 5, kMax: 3, seed: 1 });
    for (const coalition of distinctCoalitions(plan)) {
      expect(coalitionKey(coalition)).toBe(coalitionKey([...coalition].reverse()));
    }
  });
});

describe("the coalition set", () => {
  it("leads with the baseline, because a dead engine must surface first", () => {
    // estimateShapley treats a failed baseline as fatal. Fetching it in the
    // first chunk means the user learns immediately instead of after the plan.
    const plan = planPermutations(refs(5), { samples: 30, kMax: 3, seed: 3 });
    expect(distinctCoalitions(plan)[0]).toEqual([]);
  });

  it("counts each Scenario once however many permutations reach it", () => {
    const plan = planPermutations(refs(4), { samples: 500, kMax: 2, seed: 9 });
    const coalitions = distinctCoalitions(plan);
    const keys = coalitions.map(coalitionKey);
    expect(new Set(keys).size).toBe(keys.length);
    // Baseline + C(4,1) + C(4,2) is the ceiling at kMax 2.
    expect(coalitions.length).toBeLessThanOrEqual(1 + 4 + 6);
  });

  it("is empty of work when there is nothing to sample", () => {
    expect(distinctCoalitions(planPermutations([], { samples: 10, kMax: 3, seed: 1 })))
      .toEqual([[]]);
  });
});

describe("degrading rather than failing", () => {
  it("falls back to a single evaluation for anything the batch missed", async () => {
    const elements = refs(4);
    const options = { samples: 100, kMax: 2, seed: 5 };

    // A scorer that fails outright: nothing is pre-fetched.
    const { scores, requests } = await prefetchCoalitionScores(
      elements,
      { ...options, chunkSize: 50 },
      async () => {
        throw new Error("server down");
      },
    );
    expect(scores.size).toBe(0);
    expect(requests).toBe(1);

    let singles = 0;
    const result = await estimateShapley(
      elements,
      makePrefetchedEvaluator(scores, async (failed) => {
        singles++;
        return game(failed);
      }),
      options,
    );

    // Slower, but identical — the fallback path must produce the same estimate
    // as if the batch endpoint had never been involved. (Comparing against the
    // direct run, not against a closed form: individual truncated values carry
    // sampling noise, only their SUM is exact — see the truncation test in
    // model-based-analysis.test.ts.)
    expect(singles).toBeGreaterThan(0);
    const direct = await estimateShapley(elements, game, options);
    expect(result.values).toEqual(direct.values);
  });

  it("stops between chunks when cancelled and keeps what it scored", async () => {
    const calls = { batches: 0, coalitions: 0 };
    const { scores } = await prefetchCoalitionScores(
      refs(6),
      { samples: 400, kMax: 3, seed: 11, chunkSize: 5 },
      scoreChunkFrom(calls),
      { isCancelled: () => calls.batches >= 3 },
    );
    expect(calls.batches).toBe(3);
    expect(scores.size).toBeGreaterThan(0);
    expect(scores.size).toBeLessThan(41); // 1 + C(6,1) + C(6,2) + C(6,3)
  });
});

describe("chunk", () => {
  it("splits without dropping or duplicating", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 10)).toEqual([]);
    expect(chunk([1], 10)).toEqual([[1]]);
  });
});
