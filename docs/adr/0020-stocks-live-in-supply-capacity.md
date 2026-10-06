# ADR-0020 — Stocks live in the capacities; the engine neither reads nor writes one

**Status:** proposed (2026-10-02, revised 2026-10-05; 2026-10-06: storage, §1c). Nothing is
built. Amends ADR-0003 (adds `served_ratio` and `stored` to the Propagation result, and the
storage allocation order of §1c). Reasoning and the sixteen-domain stress
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
    max_fill: Optional[float] = None     # set = storage (§1c): most it may take from the network per period
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

### 1c. Storage: a Stock that fills from the network

A node Stock with `max_fill` is **storage** (a tank, a reservoir). It takes water from the
network's own flow of its Category and feeds that same flow, so pumps, the tank and the
town share one Category and no artificial split is needed. Its `rate` is 0: what it
supplies comes from its level and, when declared, an authored `inflow` (a spring, rain).
Before each propagating Phase the step operator sends it as two numbers on its node:

```
source = min(max_draw, a·L + n·R − m)        used LAST: only for demand other sources cannot cover
sink   = min(max_fill, M − L)                filled LAST: after every consumer's demand
```

The engine returns the node's **`stored`** per Category for that Propagation: `filled`
and `drawn`. After the period's last propagating Phase,
`L' = clamp(a·L + n·φ·R + filled − drawn, m, M)`. Water therefore passes through a tank
within a period, a full tank stops taking water, and a pump outage drains it at the
demand's pace, with no lag. φ is the storage node's own Functionality ratio, so damage to
the tank itself, and only that, scales what it can give and take.

**Why "last" twice.** A max-flow fixes what each consumer receives, not which source sent it
(Considered, first entry), so a Stock's outflow is arbitrary unless an order fixes it.
"Other sources first, stored water after them; consumers first, filling after them" is that
order, and the physical one for a tank floating on a pumped system. The engine computes it
in stages, inside `engine/`: consumers without storage, then with it, then the fill sinks.

**Several storages share by fraction.** Storages that can reach the same demand draw the
same fraction of their `source` (a tank offering 300 gives twice what one offering 150
gives), and fill by the same fraction of their `sink`. It is the consumer-side water-filling
of `_allocate_tiered_fair_share` mirrored onto sources (source-side fairness, for storage),
and approximates tanks drawing down together by head. So storage needs no topology limit and
imported networks run with all their tanks.

A storage node supplies and demands one Category by design, so the Inspector's
supply-and-demand warning skips it. The engine still never reads a Stock: the payload
carries the two numbers and a storage marker.

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
source's outflow only when that node is the Category's **only source**. v1 requires that
(storage excepted, §1c);
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
`["capacity", stock_field]`), the path form of ADR-0021. Reset reverting an Event's write to
`level` then leaves a hand correction to `max` standing, as ADR-0016 intends for authoring
work. (A Temporal Simulation run never writes the model, ADR-0019 §3.)

### 5. v1 limits, stated

- **Supply-side only**, storage excepted. A node Stock adds supply; storage (§1c) is also the
  last sink of its own Category. A backlog that should add to *demand* is the open `couples`
  question.
- **One source per node Stock** with a `rate`; shared-consumer topologies wait for
  source-side fairness between ordinary sources. Storage (§1c) is exempt: its order and its
  fraction sharing make its outflow determinate.
  An **edge Stock** avoids this when its target has one incoming flow edge.

## Considered

- *A supplier node per banca ore activity.* Rejected: a cross-training edge gives a consumer
  two suppliers, and source outflow is then arbitrary (with only the supplier order swapped,
  a max-flow decomposition attributed 30 or 100 of an activity's hours to the first
  supplier), so no Stock could be integrated.
- *Storage as measured inflow* (2026-10-06): the tank demands a separate "pumped water"
  Category and the step operator credits what it received. Rejected: inflow is known only
  after the Propagation while the tank's supply is sent before it, so pumped water reached
  the town one period late, exactly at a refill after an outage; and the tank's unmet inflow
  demand lowered its Functionality, which cut its outflow when the pumps stopped.
- *A Stock on a consumer node.* Rejected: a node with a positive supply and a positive demand
  of the same Category is a modelling slip, and the Inspector's existing warning stays as it
  is. A consumer that needs a balance carries it on its single incoming edge.

## Consequences

- Every reader of `supply_capacity` and `Edge.capacity` changes in the same session
  (CLAUDE.md §8): `schemas/network.py` and the exported JSON Schema;
  `lib/schemas/network.ts` (`z.union`) and `pydantic-mirror.test.ts`; `engine/flow.py`
  (`_in_category`, `_max_source_supply`, `_effective_supply`, `_edge_capacity`, through one
  helper that fails loudly on a stray `Stock`); the Node and Edge Inspector,
  `tab-node-defaults.tsx` and `build-model-tour.ts`; the importers. The existing EPANET importer is
  unchanged (tanks stay Sources with a backup countdown, so the published importer
  benchmarks reproduce); a **second EPANET importer, for Temporal Simulation**, maps each
  tank to storage (§1c): `level`, `min` and `max` from the tank's geometry and initial,
  minimum and maximum levels, `max_draw` from its outlet pipes, `max_fill` from its inlet
  pipes, no backup and no reserve Event. It also writes the project's Temporal Simulation
  from the INP's time data: one Step of `hour × [TIMES] duration`; one profile row per
  demand pattern (base demand × multiplier per hour); each time-based control (`AT TIME`,
  `AT CLOCKTIME`) as a Temporal-Simulation-only Event in its period. Level-based controls are
  conditionals, which v1.1 lacks; they are listed as skipped in the import report (a full
  tank already stops taking water). No Metrics or hazards are added. `logical.py` and `rules_eval.py` read only the keys.
- The Graph Diff differ (ADR-0017) and the Scenario Baseline key (ADR-0016) gain the path
  form of §4.
- **UI:** the supply editor is offered on every Node Type. A non-blocking warning on a
  **Service** node with any `supply_capacity` entry suggests Source; it stays silent on
  Source, Infrastructure and Personnel. A second warning flags a Category holding a Stock
  where an edge or throughput capacity is undeclared.
- Display of a Stock is the Level Scale of ADR-0019 §6.
- New term in CONTEXT.md: Stock. Docs: `local-first-guide.md` (node fields table),
  `api-reference.md` (`served_ratio`, `stored`), `requirements.md` §5.3.
