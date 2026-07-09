# Propagation heuristic pipeline, multi-category composition, and responsibility share

## Heuristic pipeline: propose → guard → commit

The engine operates purely on integer Functionality `1..N` (1 = worst, N = best); the four-state vocabulary of earlier versions is retired (see CONTEXT.md). During a Propagation the engine iterates in rounds until the Functionality of every Element stabilises (convergence). Within a round, each node carries a single **running proposed Functionality `P`**, initialised to its current Functionality, and passes through three phases in a **fixed canonical order**:

1. **Propose.** Proposal mechanisms compute candidate Functionality values and merge them into `P` via `worst_of` (a downgrade-only contribution). Two built-in proposal mechanisms exist: **logical aggregation** (category-aware best-of/worst-of) and **flow allocation** (priority min-cost max-flow). A firing "if-then" specific or intra/inter rule may also act as a proposal, injecting its prescribed value as a candidate.

2. **Guard.** Guard mechanisms read `P` and transform it, in **either direction**. A guard never originates a degradation — it modulates the severity of an existing proposal. Built-in guards: `dependency_level` (attenuates the drop, raising `P`), `backup` (defers the drop into `functionality_time` rather than lowering `functionality`), and a firing specific rule registered as an override (replaces `P`).

3. **Commit.** `functionality = worst_of(current, P)`. This single step is the **sole guarantor of monotonicity** — a guard that tries to raise `P` above the node's current Functionality is harmlessly clamped here. There is no "guards only raise" restriction; guards move `P` freely and the commit enforces that Functionality can only worsen. This applies to **every** mechanism including specific-rule overrides: a rule that would improve a node is a no-op (the v1 "rules may improve" behaviour is retired). Improvement is recovery/repair, handled by the timeline, never by propagation. The bounded-below integer scale plus monotone-decreasing commit guarantees the round iteration terminates.

**Mechanism roles are typed**, not universal:
- **Proposal-only:** logical aggregation, flow allocation.
- **Guard-only:** `dependency_level`, `backup` — they modulate severity, never originate a proposal.
- **Both:** specific, intracategorical, and intercategorical rules — a rule injected as a candidate is a proposal; a rule that overrides or re-parameterises an existing proposal is a guard.

The pipeline ordering is **engine-imposed**, not modeller-authored: the `GraphTypeConfig.heuristics` list toggles steps on/off and sets their params, but cannot reorder phases. A new project's **default pipeline is derived from each Canvas's `graph_type` combined with the `category_type`s present** — the engine seeds a sensible default Model Configuration the modeller can then tune.

## Flow proposal (`SourceToDemands` categories)

For each `SourceToDemands` category the engine builds a priority-aware capacitated flow network (super-source → sources → infrastructure/edges → demanding nodes → super-sink) and solves a min-cost max-flow, with sink-edge rewards scaled by node `priority` and small positive transport-edge costs as friction. For each consuming node it computes `served_ratio = delivered / original_demand`.

`served_ratio` maps to a proposed integer Functionality via a **configurable threshold table** that is a parameter of the flow heuristic, defined **at the `SourceToDemands` category-type level** in the Engine Configuration — it answers "for a starved consumer, what delivery ratio counts as which Functionality level?" The table **defaults to the linear split** `proposed = max(1, ceil(served_ratio · N))` so a new project works untuned, and is applied uniformly to all `SourceToDemands` categories the flow heuristic processes (a future revision may key it per category).

The mapping is **never per-node**: per-node tolerance is expressed downstream by the `dependency_level` guard. This keeps "how starved the node is" (flow, category-type level) orthogonal to "how much the node cares" (`dependency_level`, per-node).

**Functionality → capacity ratio.** Supply, edge capacity, and throughput are scaled by a node/edge's Functionality via a midpoint mapping, not a flat `func/N`: the **top level carries 100%, the bottom level 0%, and each intermediate level the midpoint of its interval** `(func − 0.5)/N` (e.g. N=4 → 0, 0.375, 0.625, 1.0). So a **critical** element passes no flow at all (forcing downstream degradation), while a fully-operational one passes everything.

**Default capacity.** An unspecified edge capacity or infrastructure throughput defaults to the **maximum supply of any source in that category** (computed per category per run), rather than being treated as infinite. This makes the capacity finite so that scaling it by the element's Functionality (`capacity · func/N`) actually throttles flow — without it, a critical edge with no explicit capacity would stay effectively infinite and never propagate a shortage. A healthy element (`func = N`) keeps the full default capacity (no artificial bottleneck); as it degrades, throughput shrinks and the shortfall cascades. If the category has no source, capacities remain unbounded.

## Logical aggregation operators

The logical heuristic aggregates the **deliverable** values `L(u→v) = worst_of(node_functionality, edge_functionality)` — never raw node functionality. The default intracategorical operator is `best_of` (redundancy: one healthy supplier suffices) and the default intercategorical operator is `worst_of` (conjunctive: all categories needed). Intra/inter rules may override these with any operator below. All operate on the integer scale `1..N` and resolve every ambiguous case **pessimistically (toward the worse level)**, consistent with the engine's pessimistic-monotone philosophy:

| Operator | Semantics on `1..N` |
|---|---|
| `best_of` | `max` |
| `worst_of` | `min` |
| `majority_of` | mode (most frequent level); ties broken toward the **worse** level |
| `average_of` | arithmetic mean, rounded **down** (`floor`) |
| `median_of` | middle value; even count → **lower** median |

(In the retired four-state code only `best_of`/`worst_of`/`majority_of` existed, with `majority_of` = `Counter.most_common`. `average_of` and `median_of` are new in v2 and only well-defined because Functionality is now an integer scale.)

## Guard mechanics

Guards read the running proposal `P` (and the node's `current` Functionality and `category_dependency_profiles[cat]`) and run in the Guard phase in a **fixed order: `dependency_level → backup → rule-override`**. A specific-rule override therefore has the **highest priority** — it runs last and wins over both the dependency attenuation and the backup deferral:

1. **`dependency_level` attenuation.** Linear shift on the integer scale:
   `P' = min(current, P + (N − dependency_level))`, where **`N` is the maximum
   configured Functionality level** (`max(level for level in functionality_scale)`),
   *not* `len(functionality_scale)`: the scale need not be a contiguous `1..N`
   (the schema only enforces `level ≥ 1`), and using the count as the ceiling
   would let this guard clamp a healthy top-level category *below* its real level —
   a guard originating a degradation it must never originate.
   `dependency_level = N` passes the full drop; `= 1` neutralises any drop entirely
   (shift of `N−1` ≥ the maximum possible drop); intermediate values reduce the
   drop linearly by `N − dependency_level` levels.

2. **`backup` deferral.** Engages on **any** proposed drop (not only a drop to critical) when a binding category has backup: a reserve keeps the node **fully operational**, so the node **holds its current Functionality** and sets `functionality_time = backup_duration` instead of committing the drop. The deferred drop is realised by a future Temporal Jump (see CONTEXT.md → *Functionality Time*). Consequently a backed-up node's `functionality` does not change during the Propagation run — only `functionality_time` is written. If the node **already has `functionality_time > 0`** from a prior run, the existing countdown is **left untouched** (a draining backup is never refreshed). Backup is consulted on the binding (worst) categories; backup on a non-binding category does not protect against a different category's failure.

3. **Specific-rule override (highest priority).** A firing specific rule registered as a guard *replaces* `P` with its prescribed value, **overriding both the dependency attenuation and the backup deferral**. A rule-forced critical goes critical immediately and **supersedes any `functionality_time`** the backup guard set this run (the deferral is cleared). The override is still subject to the monotone commit, but since rules typically force a worse value the clamp rarely applies.

## Multi-category composition

**Dependency detection (union of both ends).** A node's dependency categories are the **union** of the categories it declares (`node_categories` ∪ `category_dependency_profiles` keys) and the categories its parents supply. Crucially this includes **cross-category** edges: a `Digital` parent feeding a `water` node creates an *intercategorical* dependency on `Digital` — that is exactly what intercategorical aggregation is for, so it must not be dropped. Within a category `g`, a parent **contributes** if it participates in `g` (via `node_categories`/`supply_capacity`) *or* declares no categories at all (an untagged feeder supplies whatever the consumer needs); a parent tagged with only *other* categories does not supply `g`. A declared category with no supplying parent simply yields no constraint. A `category_dependency_profiles[g]` entry is **optional per-category guard parameters** (`dependency_level`, `backup`, …); its **absence means the worst-case default** (full dependency, no protection), never "no dependency". This handles every tagging layout: category on the supplier, on the consumer, on both, an untagged feeder, or a cross-category feeder.

**Overlap refinement — a parent's *other* categories only flow through when nothing is shared.** When a parent shares a category with the target, the target already depends on that shared category directly; naively unioning in the parent's *remaining* categories too would attach a phantom cross-category dependency (a `power`+`digital` supplier degraded only on `power` must not drag down a `digital`-only consumer that has its own healthy, redundant `digital` supplier — `engine/logical.py::test_multi_category_parent_no_phantom_dependency`). So a parent's non-shared categories are folded in only when the parent's *full* declared category set has **no** overlap with the target's own declared categories (or the parent is an untagged generic feeder).

**Exception — a Requisite category never gets swallowed by that overlap guard.** The overlap refinement above must not suppress a genuine **Requisite** (threshold) dependency: an inline pump/valve node (ADR-0012) is tagged `["water", "pumping"]`, and a `water`-declared downstream junction sharing the `water` category with it would otherwise lose visibility of `pumping` — silently dropping the pump's Requisite floor for exactly the topology ADR-0005's universal Requisite pass exists to cover. So a parent's `Requisite`-typed categories are **always** added to the target's dependency set regardless of overlap; only the parent's non-Requisite (`SourceToDemands`) categories remain subject to the overlap exclusion (`engine/logical.py::logical_category_candidates`, `category_types` param; regression test `test_requisite_parent_category_not_swallowed_by_shared_category`).

A node may belong to multiple Categories (`node_categories: list[str]`). **Dispatch keys off distinct *categories*, not category *types*:**

1. For **each category** the node depends on, compute one candidate Functionality:
   - `SourceToDemands` category → **flow** allocation (served-ratio mapping above).
   - `Requisite` category → **intracategorical logical** aggregation (`best_of` over deliverables `L(u→v)`, or the rule-overridden operator).
2. If the node has **≥2 distinct categories** (any mix of types — including two `SourceToDemands` categories such as water + electricity), combine the per-category candidates with the **intercategorical** operator (`worst_of` by default, or rule-overridden).
3. If the node depends on **exactly one** category, that single candidate *is* the proposal.

The final Functionality is therefore the worst-of across all Category contributions: if any required Category input degrades, the node degrades (pessimistic propagation). This supersedes the LaTeX spec's dispatch wording, which keyed (inconsistently) off category *types* and left a node with two `SourceToDemands` categories with no rule to combine its candidates.

## Responsibility share

Whenever a heuristic or Rule causes a node's Functionality to worsen, it must return a **responsibility share** dictionary alongside the Functionality result:

```
{ element_id: responsibility_share }
```

where `0 ≤ responsibility_share ≤ 1` and all values sum to 1. The dictionary identifies which upstream Elements are the direct triggers of the degradation. A value of `0` means the Element is formally listed as a causal participant but contributed no measurable share to the degradation (e.g. a partially-delivering upstream whose shortfall was already covered by another supplier). Zero-share entries may be omitted from the dictionary — absence and zero are semantically equivalent.

Responsibility share comes **only from the heuristic/rule that produced the final (worst) Functionality** for the node. Contributions from non-winning heuristics are discarded.

### Weighting rules per Category Type

- **Requisite** (logical heuristic): responsibility falls on the inputs that *pulled the level down* — an input is responsible iff raising it would raise the aggregate. This is *not* "all failed upstreams": under the default `best_of` redundancy the node rides its **best** surviving supplier, so worse (already-degraded) suppliers are not to blame. Shares are **weighted where there is spread, uniform otherwise**:
  - `worst_of` → the argmin; `best_of` → the argmax; `majority_of`/`median_of` → the holders of the winning/median level. In all of these the contributors sit at a single level, so the share is **uniform** (ties split evenly).
  - `average_of` → the inputs **below the mean**, each weighted by its **gap `(mean − value)`** (a node far below pulled harder); inputs at or above the mean are blameless. If all inputs are equal, uniform. This is the one logical operator with an informative, non-uniform share.

  The engine reads this directly from the weighted `Attribution.shares` dict returned by `core.aggregation.attributed` (keys → share in `[0,1]`, summing to 1).
- **SourceToDemands** (flow heuristic): a **provisional v1 "uniform-blame" heuristic** is used, because there is no cheap principled way to attribute a flow shortfall (causes range over degraded sources, bottleneck edges/nodes, and priority-driven competition). For a degraded consumer `v`: take the **transitive incoming closure** of `v` within that category, keep the elements (nodes *and* edges) of the **same category** whose Functionality is **degraded** (`< N`), and split responsibility **uniformly** — each gets `1/k`. If `k = 0` (nothing upstream is degraded — pure competition or structural under-supply), the dictionary is **empty**. This deliberately trades attribution precision for determinism and cheapness; a future revision may weight by flow contribution or min-cut membership. (Rigorous game-theoretic importance is handled separately by the Shapley analysis, not by responsibility share.)

### Attribution through the pipeline

The committed Functionality is the binding (worst) category candidate, possibly modified by guards. The `responsibility_share` is resolved as follows:

- **Binding-category authorship.** Blame comes from the category whose candidate produced the worst (committed) value, using that mechanism's own rule (logical even-split, or flow uniform-blame).
- **Guards modify magnitude, not authorship.** `dependency_level` and `backup` change *how far* the node drops, not *who* caused it, so they **leave the responsibility dict untouched**. A backed-up node deferred this run carries no new responsibility until it actually drops in a future Temporal Jump, at which point the original blame set applies.
- **Rule-override replaces both value and blame.** Because a specific-rule override is the highest-priority guard and supersedes the proposal, its responsibility dict becomes the rule's referenced Elements, split evenly.
- **Ties union.** If two categories produce the same worst value, **union** their blame sets and renormalise to sum to 1 — a node starved of both water and electricity at the same level is caused by both, and both chains should surface in the causal UI.

### When no upstream is responsible

If a node's Functionality was set directly by an Event (via `attribute_mutations` or `vulnerability_levels`), the responsibility dictionary contains the EventId as the single key with value `1.0`.

If set by a Specific Rule, the responsibility dictionary contains all Elements referenced in the rule's condition, split evenly.
