# ADR-0018 — Operativity Weighting Is a View Parameter, Not a Run Parameter

**Status:** accepted (2026-09-11)

## Context

The **Operativity Score** is a weighted average of Functionality across a Scenario. Which node attribute supplies the weight is the user's choice — uniform, `importance`, `cost_of_disservice_per_day`, or any numeric attribute discovered in the data (`lib/oi-weight-attrs.ts`).

The Scorecard and the model-based Analysis Metrics treated that choice in opposite ways.

The **Scorecard** stores Scenario snapshots and calls `computeOperativityScore` at render time. Changing the weighting re-renders; nothing is recomputed and nothing is lost.

The **Analysis window**'s model-based metrics — **Vitality Centrality** and **Shapley Values** — did the opposite. Each evaluation propagated a Scenario, collapsed it to a single Operativity Score, and discarded the Scenario. The weighting was therefore baked into the run, and `setOiWeightAttr` had to clear `result`. Changing the weighting silently destroyed the result and demanded a fresh run.

That is the expensive direction to be wrong in. These are **Engine Evaluations**: Vitality costs one engine call per Element, Shapley costs `samples × k_max`. A run is metered against the role's Engine Evaluation budget (ADR-0008) and can take minutes. Paying all of it again to answer "and what if I weight by `importance`?" — a question the Scorecard answers instantly on the same data — is not a defensible cost.

The asymmetry was never a decision. It followed from the evaluator signature returning `number`.

## Decision

**The Operativity weighting is a property of how a result is read, not of how it was computed.** Both surfaces now treat it that way.

A model-based run retains a **reweight basis**: the baseline Scenario plus, for every evaluation it performed, an `EvaluationOutcome` — the node Functionality values that differ from the baseline, and the nodes the evaluation removed (`lib/operativity-basis.ts`). Changing the weighting replays the finished run against that basis instead of clearing it.

Three things make this work:

1. **The weighting enters only at the last step.** `computeOperativityScore` reads node Functionality and one node attribute. A Propagation moves Functionality; the weight attributes are the baseline's. So an outcome plus the baseline is sufficient to re-score under *any* weighting.

2. **An outcome is a delta, not a snapshot.** Retaining whole snapshots for every evaluation of a Shapley run would be hundreds of megabytes. A cascade moves the Functionality of a handful of Elements, so the delta is a few kilobytes per evaluation.

3. **The estimators are deterministic.** `computeVitality` is a loop over the Element list. `estimateShapley` draws its permutations from a seeded RNG, and the seed is already returned and stored. Replaying either against a cache-backed evaluator therefore asks for exactly the evaluations the run already performed — **zero engine calls**, and the arithmetic is the estimator's own rather than a re-implementation of it.

The basis is stored as `reweightBasis` on the analysis store, which is not persisted to the project file. It is dropped when a new run starts.

### Rejected alternatives

- **Store the weighting per result and show a "stale" badge.** Keeps the result on screen but still demands a re-run to answer the question. Solves the surprise, not the cost.
- **Recompute the scores arithmetically from the old ones.** There is no such transform: the Shapley value of an Element is not a function of its value under a different weighting.
- **Retain full snapshots per evaluation.** Correct and simpler to write, but the memory cost is prohibitive for exactly the runs where re-weighting matters most.
- **Persist the basis to the project file.** It is derived data that can be several megabytes, and the project file is the user's document. A weighting change is a within-session question.

## Consequences

- A finished model-based run answers "under which weighting?" for free, as many times as the user asks.
- Because a replay writes a *new* Result, the Analysis Heatmap follows it: `HeatmapControls` repaints on every Result it sees, so the colours on the canvas can never describe a weighting other than the one selected.
- The weighting selector no longer destroys work, so it stops being a trap.
- Whoever edits `makeCoalitionEvaluator` or `makeChunkScorer` must keep recording outcomes. An evaluator that scores without capturing silently degrades re-weighting to "result left untouched" — the incomplete-basis guard in `SectionModelBased` will keep the standing result rather than re-score from partial data, so the failure is safe but invisible. `lib/operativity-basis.test.ts` pins the capture/rebuild/score round trip.
- A run cut short by the time budget replays with `samplesUsed`, not the requested sample count, so the replay draws exactly the permutations the run drew.
- **Correction to ADR-0016.** Its consequences list states that "No Reset path calls `clearHeatmap` — its only callers are the Analysis page's close button and `heatmap-controls`." That is no longer true in either half: `resetFunctionality` calls `clearHeatmap` (`lib/network-utils.ts`), which makes `requirements.md` §11 and `CONTEXT.md` correct in saying Reset clears the Analysis Heatmap; and the Analysis window's close button deliberately no longer clears it, because the window now floats over the canvas and closing it is not a statement about the overlay. Clearing is the explicit **Clear heatmap** control, or Reset.
