/**
 * Tests for the model-based Analysis Metrics.
 *
 * The estimator is checked against cooperative games whose exact Shapley values
 * are known in closed form, so these assert real numbers rather than "it ran".
 * The evaluator seam is what makes that possible: no engine, no network, no DOM.
 *
 * The load-bearing one is `first-mover game` — it fails against a non-uniform
 * shuffle, which is the defect this module was written to remove.
 */

import { describe, it, expect } from "vitest";

import {
  computeVitality,
  estimateShapley,
  makeRng,
  maxUniqueCoalitions,
  maxUsefulSamples,
  shuffleInPlace,
  type ElementRef,
} from "@/lib/model-based-analysis";

const refs = (n: number): ElementRef[] =>
  Array.from({ length: n }, (_, i) => ({ id: `e${i}`, kind: "node" as const }));

describe("estimateShapley on games with known values", () => {
  it("recovers exact values for an additive game, from a single sample", async () => {
    // v(S) = Σ w_i for i in S. Every player's marginal contribution is w_i in
    // EVERY permutation, so the estimator must return w_i exactly — no variance,
    // no sample-count dependence. This pins the marginal arithmetic
    // (prevScore − score) and the normalisation by samplesUsed together: get
    // either wrong and these numbers move.
    const weights: Record<string, number> = { e0: 0.5, e1: 0.3, e2: 0.2 };
    const elements = refs(3);

    const result = await estimateShapley(
      elements,
      async (failed) => 1 - [...failed].reduce((acc, id) => acc + weights[id], 0),
      { samples: 1, kMax: 3, seed: 1 },
    );

    expect(result.values.e0).toBeCloseTo(0.5, 12);
    expect(result.values.e1).toBeCloseTo(0.3, 12);
    expect(result.values.e2).toBeCloseTo(0.2, 12);
    // Efficiency: Shapley values sum to v(N) − v(∅).
    const total = Object.values(result.values).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1.0, 12);
  });

  it("splits a unanimity game evenly across its carrier and gives outsiders zero", async () => {
    // v(S) = 1 iff S ⊇ {e0,e1}. Exact Shapley: 1/2 each to e0 and e1, 0 to e2.
    // Needs full permutations (kMax = N) — under truncation the carrier is often
    // never completed, which is a property of the estimator, not a bug.
    const carrier = ["e0", "e1"];
    const result = await estimateShapley(
      refs(3),
      async (failed) => (carrier.every((id) => failed.has(id)) ? 0 : 1),
      { samples: 4000, kMax: 3, seed: 7 },
    );

    expect(result.values.e0).toBeCloseTo(0.5, 1);
    expect(result.values.e1).toBeCloseTo(0.5, 1);
    expect(result.values.e2).toBeCloseTo(0, 6);
  });

  it("first-mover game: each Element must win 1/N of the credit", async () => {
    // v(S) = 1 for any non-empty S. Only the FIRST Element in a permutation has
    // a non-zero marginal, so φᵢ = P(i comes first) — exactly 1/N under uniform
    // sampling. This turns shuffle uniformity into a numeric assertion.
    //
    // This is the regression for the old `sort(() => Math.random() - 0.5)`
    // shuffle: that comparator leaves Elements biased toward their starting
    // positions, so the early ids collect far more than 1/N and the late ones
    // far less. Swap Fisher-Yates for it and this test fails.
    const n = 8;
    const result = await estimateShapley(
      refs(n),
      async (failed) => (failed.size > 0 ? 0 : 1),
      { samples: 6000, kMax: 1, seed: 12345 },
    );

    for (const { id } of refs(n)) {
      expect(result.values[id]).toBeGreaterThan(1 / n - 0.03);
      expect(result.values[id]).toBeLessThan(1 / n + 0.03);
    }
  });
});

describe("what kMax truncation actually estimates", () => {
  it("shrinks every value by exactly kMax/N on an additive game", async () => {
    // The property that is easy to state wrongly. Under truncation the
    // estimator does NOT converge to the true Shapley value as samples grow —
    // it converges to the true value with every marginal from permutation
    // positions beyond kMax REPLACED BY ZERO, not dropped from the average.
    //
    // An additive game makes the factor exact and checkable: every player's
    // marginal is w_i in every position, so φ̂ᵢ = P(pos(i) ≤ kMax) · w_i
    // = (kMax/N) · w_i. Anything else means the normalisation changed.
    const n = 8;
    const w = 0.125; // uniform weights summing to v(N) = 1
    for (const kMax of [1, 2, 4]) {
      const result = await estimateShapley(
        refs(n),
        async (failed) => 1 - failed.size * w,
        { samples: 4000, kMax, seed: 99 },
      );

      // The SUM is exact, with no Monte Carlo variance at all: every
      // permutation contributes exactly kMax marginals of w, whatever order it
      // drew. So Σφ̂ = kMax·w = (kMax/N)·v(N) — efficiency FAILS under
      // truncation. Any claim that φ̂ sums to the total Operativity loss, or
      // that more samples make it, holds only at kMax = N.
      const total = Object.values(result.values).reduce((a, b) => a + b, 0);
      expect(total).toBeCloseTo((kMax / n) * 1.0, 12);

      // Each Element carries an equal share of that shrunken total, up to
      // sampling noise — the loss is uniform, not concentrated on whichever
      // Elements the truncation happened to favour.
      const expected = (kMax / n) * w;
      for (const { id } of refs(n)) {
        expect(result.values[id]).toBeGreaterThan(expected * 0.8);
        expect(result.values[id]).toBeLessThan(expected * 1.2);
      }
    }
  });
});

describe("reproducibility", () => {
  it("replays a run exactly from the returned seed, and differs across seeds", async () => {
    // Unseeded, non-reproducible estimates were the other half of the old defect:
    // a value quoted in a paper could not be regenerated.
    const elements = refs(6);
    const game = async (failed: ReadonlySet<string>) =>
      1 / (1 + [...failed].reduce((acc, id) => acc + id.charCodeAt(1), 0));

    const first = await estimateShapley(elements, game, { samples: 50, kMax: 3 });
    const replay = await estimateShapley(elements, game, { samples: 50, kMax: 3, seed: first.seed });
    expect(replay.values).toEqual(first.values);

    const other = await estimateShapley(elements, game, { samples: 50, kMax: 3, seed: first.seed + 1 });
    expect(other.values).not.toEqual(first.values);
  });
});

describe("evaluation budget", () => {
  it("charges the engine once per distinct coalition, not once per visit", async () => {
    // The coalition cache is what makes a run affordable. With 2 Elements and
    // kMax 2 there are only 3 distinct coalitions plus the baseline, however
    // many permutations are drawn.
    const seen: string[] = [];
    const result = await estimateShapley(
      refs(2),
      async (failed) => {
        seen.push([...failed].sort().join(","));
        return 1 - failed.size / 2;
      },
      { samples: 100, kMax: 2, seed: 3 },
    );

    expect(new Set(seen).size).toBe(seen.length); // never evaluated twice
    expect(result.evaluations).toBe(seen.length);
    expect(result.evaluations).toBeLessThanOrEqual(maxUniqueCoalitions(2, 2));
    expect(result.samplesUsed).toBe(100);
  });

  it("keeps partial results when cancelled, normalising by the samples drawn", async () => {
    let evaluations = 0;
    const result = await estimateShapley(
      refs(4),
      async (failed) => {
        evaluations++;
        return 1 - failed.size / 4;
      },
      { samples: 1000, kMax: 2, seed: 5 },
      { isCancelled: () => evaluations > 6 },
    );

    expect(result.samplesUsed).toBeGreaterThan(0);
    expect(result.samplesUsed).toBeLessThan(1000);
    expect(Object.keys(result.values)).toHaveLength(4); // every Element still reported
  });

  it("stops on the time budget using the injected clock", async () => {
    let clock = 0;
    const result = await estimateShapley(
      refs(4),
      async () => {
        clock += 100;
        return 0.5;
      },
      { samples: 1000, kMax: 2, seed: 5, maxTimeMs: 250 },
      { now: () => clock },
    );
    expect(result.samplesUsed).toBeLessThan(1000);
  });

  it("fails loudly when the baseline cannot be evaluated", async () => {
    // Every coalition evaluation falls back to "no further loss", so a dead
    // engine would otherwise yield a complete-looking all-zero result. The
    // baseline is deliberately the one call with no fallback.
    await expect(
      estimateShapley(refs(3), async () => { throw new Error("engine unreachable"); }, {
        samples: 10,
        kMax: 2,
        seed: 1,
      }),
    ).rejects.toThrow(/baseline/i);
  });

  it("survives a failing evaluation instead of losing the run", async () => {
    let calls = 0;
    const result = await estimateShapley(
      refs(3),
      async (failed) => {
        calls++;
        if (calls === 3) throw new Error("engine unreachable");
        return 1 - failed.size / 3;
      },
      { samples: 20, kMax: 2, seed: 9 },
    );
    expect(result.samplesUsed).toBe(20);
    expect(Number.isFinite(result.values.e0)).toBe(true);
  });
});

describe("degenerate inputs", () => {
  it("returns zeros rather than NaN when nothing can be sampled", async () => {
    const noElements = await estimateShapley([], async () => 1, { samples: 10, kMax: 3, seed: 1 });
    expect(noElements.values).toEqual({});
    expect(noElements.samplesUsed).toBe(0);

    const noSamples = await estimateShapley(refs(3), async () => 1, { samples: 0, kMax: 3, seed: 1 });
    expect(noSamples.values).toEqual({ e0: 0, e1: 0, e2: 0 });
  });
});

describe("computeVitality", () => {
  it("reports the Operativity each Element's removal destroys, and scores a failure zero", async () => {
    const drops: Record<string, number> = { e0: 0.4, e1: 0.1, e2: 0 };
    const result = await computeVitality(refs(3), 1, async ({ id }) => {
      if (id === "e2") throw new Error("engine unreachable");
      return 1 - drops[id];
    });

    expect(result.values.e0).toBeCloseTo(0.4, 12);
    expect(result.values.e1).toBeCloseTo(0.1, 12);
    expect(result.values.e2).toBe(0); // failed call, not a crashed run
    expect(result.evaluations).toBe(3);
  });

  it("stops early when cancelled", async () => {
    let done = 0;
    const result = await computeVitality(
      refs(10),
      1,
      async () => {
        done++;
        return 0.9;
      },
      { isCancelled: () => done >= 3 },
    );
    expect(result.evaluations).toBe(3);
  });
});

describe("shuffle", () => {
  it("is uniform over positions", () => {
    // Direct check of the property the first-mover game exercises end to end.
    const rng = makeRng(42);
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < 8000; i++) {
      const order = shuffleInPlace([0, 1, 2, 3], rng);
      counts[order[0]]++;
    }
    for (const c of counts) expect(c / 8000).toBeCloseTo(0.25, 1);
  });
});

describe("cost estimation", () => {
  it("counts coalitions and the saturation point", () => {
    expect(maxUniqueCoalitions(5, 1)).toBe(6); // baseline + C(5,1)
    expect(maxUniqueCoalitions(5, 2)).toBe(16); // + C(5,2) = 10
    expect(maxUniqueCoalitions(3, 10)).toBe(8); // kMax clamped to N: 1+3+3+1
    expect(maxUsefulSamples(6, 3)).toBe(20); // C(6,3)
    expect(maxUsefulSamples(6, 10)).toBe(20); // clamped at ⌊N/2⌋
  });
});
