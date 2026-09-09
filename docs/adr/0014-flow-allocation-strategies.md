# ADR-0014 — Flow allocation strategies: tiered fair-share (default) and priority-greedy

**Status:** accepted (2026-07-15)

## Context

The SourceToDemands flow pass (ADR-0003) answered scarcity with a single
min-cost max-flow whose priority rewards make it **winner-take-all**: under a
shared bottleneck, an LP optimum may serve one of two equal-priority
consumers 100% and the other exactly 0%. The allocation-alternatives study
(`experiments/aqueducts/ATTEMPTS.md` §5) showed this
shape is *not* a hydraulic-fidelity problem once importer capacities are
right — but for hand-modelled networks there is no ground truth to match,
and how scarcity is shared is a **policy choice** the modeller should own:
"serve hospitals first, ration the rest fairly" vs "strict triage" are
different, equally legitimate scenario strategies.

## Decision

`engine/flow.py` implements two allocation strategies over the **same**
flow-graph construction (no duplicated build):

- **`tiered_fair_share` (default)** — strict priority preemption BETWEEN
  tiers; true max-min-fair water-filling WITHIN a tier. Mechanism: per tier
  (descending priority), first try one max-flow at full demands (fast path —
  a healthy tier costs one solve); on scarcity, bisect the largest common
  allotment λ feasible for all active consumers, then classify each as fully
  served (demand ≤ λ), bottlenecked (no augmenting path from the
  super-source in the λ-solve's residual graph → frozen at λ), or able to
  grow (another round with the frozen fixed). The residual-reachability test
  is what makes per-consumer amounts well-defined despite max-flow's
  arbitrary flow decomposition under ties (two earlier constructions failed
  exactly there — `experiments/aqueducts/ATTEMPTS.md` §5).
- **`priority_greedy`** — the original single LP (`nx.max_flow_min_cost`,
  priority rewards). Cheapest (one solve per category), strict triage,
  winner-take-all among equals (deterministic only when path costs differ).

Selection is per graph type, through the **existing** heuristic-pipeline
config (no new schema): the `"source-to-demands-flow"` heuristic's
`allocation` param on a `GraphTypeConfig`, advertised with an enum in
`GET /api/engine/algorithms` and edited via a select in the Config modal's
Graph types tab. `engine/propagation.py::_resolve_flow_allocation` reads the
scoped project's canvases in order and takes the first valid param; anything
absent or unrecognized falls back to the default. Resolution is per RUN, not
per category — a graph type declaring a strategy expresses the scenario's
policy, not one resource's.

`priority` semantics under both strategies: tier ordering. It is proven
irrelevant to EPANET-fidelity (ADR-0012 addendum) but is the modeller's
lever for "who suffers first" — with fair-share it finally has a
non-degenerate meaning between equals too (equals share, unequals preempt).

## Consequences

- **Default behaviour changes**: equal-priority consumers on a shared
  bottleneck now degrade together (e.g. both to 50%) instead of one being
  silently zeroed. The shipped engine sample expectations
  (`test/test_engine_samples.py`) pass unchanged — they only exercise
  cross-tier scarcity, where the strategies agree by construction.
- Cost: healthy networks pay one max-flow per occupied priority tier
  (instead of one LP); a scarce tier pays ~log₂(maxDemand·SCALE) ≈ 17 extra
  solves per water-filling round. Networks that need the old cost profile
  set `allocation: "priority_greedy"` on their graph type.
- `flow_category_candidates` gained an `allocation` keyword (defaulted), so
  the one permitted engine caller (`services/propagation_service.py`) and
  the dev harnesses are source-compatible.
- Responsibility/blame is unchanged (the provisional uniform-blame rule is
  allocation-agnostic).
- The engine's member iteration is now `sorted` — removes the latent
  hash-seed nondeterminism (same class as the 2026-07-11 engine bug) that
  could flip degenerate-tie outcomes between processes.
