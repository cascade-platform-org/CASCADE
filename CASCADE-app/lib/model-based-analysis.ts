/**
 * model-based-analysis.ts — the engine-side Analysis Metrics.
 *
 * Vitality Centrality and Shapley Value are the two model-based Analysis Metrics
 * (CONTEXT.md). Both answer "how much Operativity does the multi-canvas lose
 * without this Element", and both do it by re-running Propagation many times.
 *
 * The estimators live here rather than in the Analysis page because they are
 * numerical methods, not UI: they need to be seedable, deterministic, and
 * checkable against games whose exact Shapley values are known. Propagation
 * reaches them as an injected evaluator, so production passes the ephemeral
 * engine call and tests pass a synthetic scoring function — the estimator never
 * knows which it got.
 *
 * WHY THE SEEDED RNG IS NOT A DETAIL. Shapley requires permutations drawn
 * UNIFORMLY. The previous implementation shuffled with
 * `array.sort(() => Math.random() - 0.5)`, which is not a uniform shuffle — a
 * comparator that ignores its arguments makes the result depend on the sort
 * algorithm's access pattern, leaving elements biased toward their original
 * positions. That biases every reported Shapley value. It was also unseeded, so
 * two runs on the same network disagreed and no result could be reproduced for a
 * paper. Both are fixed here: Fisher-Yates over a seeded PRNG, with the seed
 * returned in the result so a run can be replayed exactly.
 */

/** A node or edge the analysis can remove or fail. */
export interface ElementRef {
  id: string;
  kind: "node" | "edge";
}

/**
 * Scores the Operativity of the multi-canvas with `failed` Elements driven to
 * the worst Functionality. Returns the Operativity Score as a fraction (0–1).
 *
 * This is the seam the engine sits behind. Production supplies an adapter that
 * applies the coalition to a GraphSnapshot and calls `POST /api/propagate`;
 * tests supply a pure function.
 */
export type CoalitionEvaluator = (failed: ReadonlySet<string>) => Promise<number>;

/** Scores Operativity with one Element removed from the multi-canvas entirely. */
export type RemovalEvaluator = (element: ElementRef) => Promise<number>;

export interface AnalysisHooks {
  /** Called after each evaluation that actually reached the evaluator (cache misses only). */
  onEvaluation?: (elapsedMs: number) => void;
  /** Polled between evaluations; returning true stops the run and keeps partial results. */
  isCancelled?: () => boolean;
  /** Injectable clock, so a time budget can be tested without waiting. */
  now?: () => number;
}

// ---------------------------------------------------------------------------
// Seeded uniform shuffling
// ---------------------------------------------------------------------------

/** mulberry32 — small, fast, well-distributed PRNG. Returns floats in [0, 1). */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher-Yates, in place. Every permutation is equally likely, which is the
 * property Shapley sampling depends on — see the file header for what the
 * previous `sort`-based shuffle did instead.
 */
export function shuffleInPlace<T>(items: T[], rng: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

// ---------------------------------------------------------------------------
// Vitality Centrality
// ---------------------------------------------------------------------------

export interface VitalityResult {
  /** Operativity drop caused by removing each Element. */
  values: Record<string, number>;
  /** Evaluator calls made — one per Element, minus any skipped by cancellation. */
  evaluations: number;
}

/**
 * Vitality Centrality: for each Element, the Operativity Score lost when it is
 * removed and the multi-canvas is re-propagated. One evaluation per Element.
 *
 * An evaluation that throws scores 0 rather than aborting the run — one
 * unreachable engine call should not discard the other N−1 results.
 */
export async function computeVitality(
  elements: readonly ElementRef[],
  baselineScore: number,
  evaluate: RemovalEvaluator,
  hooks: AnalysisHooks = {},
): Promise<VitalityResult> {
  const now = hooks.now ?? Date.now;
  const values: Record<string, number> = {};
  let evaluations = 0;

  for (const element of elements) {
    if (hooks.isCancelled?.()) break;
    const startedAt = now();
    try {
      values[element.id] = baselineScore - (await evaluate(element));
    } catch {
      values[element.id] = 0;
    }
    evaluations++;
    hooks.onEvaluation?.(now() - startedAt);
  }

  return { values, evaluations };
}

// ---------------------------------------------------------------------------
// Shapley Value
// ---------------------------------------------------------------------------

export interface ShapleyOptions {
  /**
   * Permutations to draw — $M$ in the IJDRR paper. Each is a random failure
   * ORDER over all Elements, truncated to its first kMax entries.
   */
  samples: number;
  /** Truncation: only coalitions of size ≤ kMax are explored. */
  kMax: number;
  /** Omit for a random seed. The seed used is always returned, so any run replays. */
  seed?: number;
  /** Wall-clock budget. The run stops between samples and keeps what it has. */
  maxTimeMs?: number;
}

export interface WorstCoalition {
  ids: string[];
  /** Operativity lost relative to the baseline. */
  loss: number;
}

export interface ShapleyResult {
  /** Estimated Shapley value per Element, normalised by the samples actually drawn. */
  values: Record<string, number>;
  /** Highest-loss coalition seen at each size 1..kMax. Sparse: sizes never drawn are absent. */
  worstCoalitions: Record<number, WorstCoalition>;
  /** Permutations actually drawn — fewer than `samples` if cancelled or out of time. */
  samplesUsed: number;
  /** Evaluator calls made. Cache hits do not count; this is the real engine cost. */
  evaluations: number;
  /** The seed used. Replay a run exactly by passing this back as `options.seed`. */
  seed: number;
}

/**
 * Monte-Carlo truncated-permutation Shapley.
 *
 * For each of `samples` uniformly random permutations, fail Elements one at a
 * time up to `kMax` and credit each with the Operativity it destroyed on entry
 * (`prevScore − currentScore`). Values are the mean marginal contribution over
 * the permutations actually drawn: `φ̂ᵢ = (1/T) Σₜ Δᵢᵗ`.
 *
 * Coalitions are cached by their sorted id set, so a coalition reached by two
 * permutations costs one evaluation. `evaluations` reports cache misses, which is
 * what the engine is actually asked to do.
 *
 * An evaluation that throws is treated as "no further loss" (the previous score
 * carries), so a flaky engine call costs accuracy rather than the whole run.
 *
 * WHAT TRUNCATION ESTIMATES. With kMax < N this does NOT converge to the true
 * Shapley value as `samples` grows. It converges to the true value with every
 * marginal from permutation positions beyond kMax replaced by ZERO — not dropped
 * from the average. On an additive game the effect is exactly a kMax/N shrink,
 * and Σφ̂ = (kMax/N)·v(N) with no sampling variance at all (pinned in the tests).
 * So efficiency — values summing to the total Operativity loss — holds only at
 * kMax = N. Under truncation the values RANK Elements against one another; they
 * are not each Element's full share. Elements never drawn keep φ = 0.
 */
export async function estimateShapley(
  elements: readonly ElementRef[],
  evaluate: CoalitionEvaluator,
  options: ShapleyOptions,
  hooks: AnalysisHooks = {},
): Promise<ShapleyResult> {
  const now = hooks.now ?? Date.now;
  const seed = options.seed ?? Math.floor(Math.random() * 0x100000000);
  const rng = makeRng(seed);
  const effectiveK = Math.min(options.kMax, elements.length);

  const phi: Record<string, number> = {};
  for (const { id } of elements) phi[id] = 0;

  // The baseline is the one evaluation with no fallback. If it fails, every
  // coalition evaluation will fail too, and those DO fall back (to "no further
  // loss") — which would quietly produce a complete-looking run of all-zero
  // Shapley values. An error the caller can show beats a plausible wrong answer.
  const empty: ReadonlySet<string> = new Set();
  let baseline: number;
  try {
    baseline = await evaluate(empty);
  } catch (cause) {
    throw new Error(
      "Could not evaluate the baseline Scenario, so no Shapley estimate is meaningful. " +
        "Check that the server is reachable and try again.",
      { cause },
    );
  }
  let evaluations = 1;
  hooks.onEvaluation?.(0);

  const cache = new Map<string, number>();
  const worstCoalitions: Record<number, WorstCoalition> = {};
  const startedAt = now();
  let samplesUsed = 0;

  for (let s = 0; s < options.samples; s++) {
    if (hooks.isCancelled?.()) break;
    if (options.maxTimeMs !== undefined && now() - startedAt > options.maxTimeMs) break;
    if (elements.length === 0 || effectiveK === 0) break;

    samplesUsed++;
    const order = shuffleInPlace([...elements], rng).slice(0, effectiveK);
    const failed = new Set<string>();
    let prevScore = baseline;

    for (const { id } of order) {
      if (hooks.isCancelled?.()) break;
      failed.add(id);
      const key = [...failed].sort().join(" ");

      let score: number;
      if (cache.has(key)) {
        score = cache.get(key)!;
      } else {
        const callStartedAt = now();
        try {
          score = await evaluate(failed);
        } catch {
          score = prevScore;
        }
        cache.set(key, score);
        evaluations++;
        hooks.onEvaluation?.(now() - callStartedAt);
      }

      const loss = baseline - score;
      const size = failed.size;
      const incumbent = worstCoalitions[size];
      if (!incumbent || loss > incumbent.loss) {
        worstCoalitions[size] = { ids: [...failed], loss };
      }

      phi[id] += prevScore - score;
      prevScore = score;
    }
  }

  const values: Record<string, number> = {};
  for (const { id } of elements) {
    values[id] = samplesUsed > 0 ? phi[id] / samplesUsed : 0;
  }

  return { values, worstCoalitions, samplesUsed, evaluations, seed };
}

// ---------------------------------------------------------------------------
// Cost estimation — what the caller shows before committing to a run
// ---------------------------------------------------------------------------

/** Upper bound on distinct coalitions with caching: 1 + Σ C(N,j) for j=1..kMax. */
export function maxUniqueCoalitions(n: number, kMax: number): number {
  let total = 1;
  let binom = 1;
  for (let k = 1; k <= Math.min(kMax, n); k++) {
    binom = (binom * (n - k + 1)) / k;
    total += Math.round(binom);
    if (total > 1e9) return Math.round(total);
  }
  return total;
}

/**
 * C(N, min(⌊N/2⌋, kMax)) — the count of unordered subsets at the size hardest to
 * saturate. Beyond this many samples nearly every draw is a full cache hit, so it
 * is the point past which more samples buy no new engine work.
 */
export function maxUsefulSamples(n: number, kMax: number): number {
  const k = Math.min(Math.floor(n / 2), kMax);
  let binom = 1;
  for (let i = 0; i < k; i++) {
    binom = (binom * (n - i)) / (i + 1);
    if (binom > 1e9) return Math.round(binom);
  }
  return Math.round(binom);
}
