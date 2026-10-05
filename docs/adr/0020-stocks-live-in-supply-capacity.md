# ADR-0020 — Stocks live in the capacities; the engine neither reads nor writes one

**Status:** proposed (2026-10-02, revised 2026-10-05). Nothing is built. Amends ADR-0003
(adds `served_ratio` to the Propagation result). Reasoning and the sixteen-domain stress
test: `docs/project/temporal-simulation-design.md` §4 and §6.

## Context

`functionality_time` is the product's only stock: integer hours, `≥ 0`, fixed drain. A
Temporal Simulation (ADR-0019) needs values that persist across periods and constrain the
allocation: a reservoir, a budget, a banca ore balance.

The product already groups *"how much can this node deliver"* in the Inspector's
**Capacities** section (Supply and Throughput Capacity). A stock belongs there.

## Decision

### 1. A stock is the richer form of a supply rate

```python
supply_capacity: Optional[dict[str, float | Stock]] = None   # keyed by Category

class Stock(BaseModel):
    rate: float                          # per-period capacity basis: what a bare float would carry
    inflow: Optional[float] = None       # R credited in integration; None = rate
    level: float                         # signed, as the user types it
    min: Optional[float] = None
    max: Optional[float] = None
    max_draw: Optional[float] = None     # most the level may add per period; None = no limit
    retention: float = 1.0               # multiplier on the level (decay, interest)
    efficiency: float = 1.0              # multiplier on the inflow (transfer loss)
    level_reference: Optional[float] = None    # Level Scale reference for the level (ADR-0019 §6)
    change_reference: Optional[float] = None   # Level Scale reference for a period's change
```

A bare number stays a plain rate, so **every existing project and sample stays valid**.
An absent `min` is 0 (the draw stops at an empty stock, and the floor clamp is at 0); an
absent `max` is no ceiling. A liability or an overdraft declares its negative `min`.
`level` is what is **on hand**, and `min`/`max` bound that; a bound on total commitment would
be a different field. **A clamp is reported**: the truncated amount is emitted as `spilled`
(above `max`) or `unmet` (below `min`). `pending` (delayed arrivals) is left out of the v1
schema; the integration keeps an `arrivals(t)` addend, zero until it exists.

The user types the stored sign; there is no display inversion. A liability (banca ore owed
to workers) is a negative level. The Inspector labels the field *"level (positive =
available to draw)"*.

### 1b. A stock may also sit on an Edge

`Edge.capacity` is `float | Stock` in the same way (`rate` is the edge's per-period
capacity). **An edge Stock adds edge capacity and no supply**: its draw lets more flow
through the edge, and the flow itself comes from the edge's source, whose supply must cover
it. This lets one source feed many consumers while each keeps its own balance: banca ore is a
single pool with one edge per activity, each edge's Stock being that activity's balance.

For an edge Stock **`D` is the flow delivered into the target through that edge**
(`served_ratio × demand`), canonical when the target has exactly one incoming flow edge; with
several, that Stock's integration is skipped with a warning. φ is the edge's own
Functionality ratio. Cross-training is a change of an edge's capacity.

**When `rate` exceeds `inflow`, the balance is not attributable.** The extra capacity is
hours lent by other consumers' suppliers, which land in the target's `D`. Coverage stays
correct. The step operator integrates and flags that period's level as
**attribution-invalid**; a correct balance waits for source attribution.

### 2. The step operator reads and writes; the engine does neither

With `a = retention`, `n = efficiency`, `R = inflow` (or `rate` when absent),
`d = max_draw`, `[m, M] = [min, max]`, `D` the delivery of the period's last propagating
Phase and φ the Functionality-to-capacity ratio of ADR-0003 (top level 100%, bottom 0%):

```
before each propagating Phase:   supply = rate + min( d, max(0, a·L + n·R − rate − m) )
after the last propagating Phase: L'    = clamp( a·L + n·φ·R − D + arrivals(t), m, M )
```

The ordinary case (`a = n = 1`, `R = rate`, no `max_draw`, φ = 1) is
`supply = rate + (L − m)` and `L' = clamp(L + rate − D, m, M)`. The draw is what the level
can give up and still end at or above `m` when everything offered is delivered, so the floor
clamp fires only when `n·R < rate` (capacity lent by others, §1b) and then reports a real
shortfall. The engine applies φ to the supply number it receives; the step operator applies
it to the credited inflow from the Functionality the Propagation returned. The stored level
is never scaled. `inflow` is separate from `rate` so a capacity can rise without crediting
more inflow (cross-training raises an edge's `rate`; contract hours stay put).

**`D` for a node Stock** is the sum of the consumers' deliveries of its Category, which is the
source's outflow only when that node is the Category's **only source**. v1 requires that;
otherwise the Stock's integration is skipped with a warning.

- **The engine never writes a Stock.** `POST /api/propagate/batch` runs up to 50 coalitions
  over one unchanged Project, and Vitality and Shapley run hundreds; a Propagation that
  mutated stocks would corrupt the model an Analysis is measuring.
- **The engine never reads one.** `buildPropagationPayload` replaces every `Stock` with its
  supply number before **any** engine request (the Propagate button, model-based Analysis,
  the Scorecard and the step operator all build their payload there), so an Analysis sees the
  current `rate + draw`. Rates are per period, so the conversion needs no step length, and the
  engine stays period-agnostic.
- **A Rule never writes a Stock** (ADR-0015's set-once latch would freeze it). `level` has
  two writers: the step operator and an Event's Attribute Operation (ADR-0021).
- A **sunk inflow** (contract hours owed whether or not the pool is healthy) is modelled by
  keeping the node at the top Functionality level, where φ = 1.
- **Default capacities move with a draw.** `_max_source_supply` defaults every undeclared
  edge and throughput capacity in a Category to the largest supply there, which now includes
  draws. A model with Stocks declares those capacities; the Inspector warns when one is
  missing.

### 3. `served_ratio` joins the Propagation result

Per consumer **and per Category**, `{category: ratio}`, because a consumer of two Categories
has two ratios and a stock is per (node, Category). It is the immediate *cause* of a
Functionality level, so exposing it respects CLAUDE.md §7's "beyond what `PropagationResult`
defines" by defining it; the per-edge assignment stays internal. Consumer amounts are
canonical by construction (`_allocate_tiered_fair_share`'s residual-reachability test).
**`utilisation` (per source) is deferred**: source outflow is determinate only when sources
do not share consumers.

Implementation notes: the flow pass skips fully-served consumers when proposing (`flow_category_candidates`),
and they must still be reported; keep the **converged** fixpoint iteration's values; emit
ratios for unchanged Elements (ADR-0015 attribute rules already emit unchanged ones). A rule
override or backup deferral can make `functionality` disagree with `served_ratio`; that is
correct and is documented.

### 4. A Stock field is recorded by its full path

The ADR-0017 differ recurses one level into `properties` and stores other compound fields
whole. A Stock is written one field at a time, so the differ and the Scenario Baseline
address a Stock field by `[field, category, stock_field]` (an edge Stock by
`["capacity", stock_field]`), the path form of ADR-0021. Reset reverting a run's `level` then
leaves a hand correction to `max` standing, as ADR-0016 intends for authoring work.

### 5. v1 limits, stated

- **Supply-side only.** A node Stock adds supply. A backlog that should add to *demand* is
  the open `couples` question.
- **One source per node Stock**; shared-consumer topologies wait for source-side fairness.
  An **edge Stock** avoids this when its target has one incoming flow edge.

## Considered

- *A supplier node per banca ore activity.* Rejected: a cross-training edge gives a consumer
  two suppliers, and source outflow is then arbitrary (with only the supplier order swapped,
  a max-flow decomposition attributed 30 or 100 of an activity's hours to the first
  supplier), so no Stock could be integrated.
- *A Stock on a consumer node.* Rejected: a node with a positive supply and a positive demand
  of the same Category is a modelling slip, and the Inspector's existing warning stays as it
  is. A consumer that needs a balance carries it on its single incoming edge.

## Consequences

- Every reader of `supply_capacity` and `Edge.capacity` changes in the same session
  (CLAUDE.md §8): `schemas/network.py` and the exported JSON Schema;
  `lib/schemas/network.ts` (`z.union`) and `pydantic-mirror.test.ts`; `engine/flow.py`
  (`_in_category`, `_max_source_supply`, `_effective_supply`, `_edge_capacity`, through one
  helper that fails loudly on a stray `Stock`); the Node and Edge Inspector,
  `tab-node-defaults.tsx` and `build-model-tour.ts`; the importers (expected unchanged, to
  confirm). `logical.py` and `rules_eval.py` read only the keys.
- The Graph Diff differ (ADR-0017) and the Scenario Baseline key (ADR-0016) gain the path
  form of §4.
- **UI:** the supply editor is offered on every Node Type. A non-blocking warning on a
  **Service** node with any `supply_capacity` entry suggests Source; it stays silent on
  Source, Infrastructure and Personnel. A second warning flags a Category holding a Stock
  where an edge or throughput capacity is undeclared.
- Display of a Stock is the Level Scale of ADR-0019 §6.
- New term in CONTEXT.md: Stock. Docs: `local-first-guide.md` (node fields table),
  `api-reference.md` (`served_ratio`), `requirements.md` §5.3.
