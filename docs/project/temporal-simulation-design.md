# Temporal Simulation — platform design proposal

**Status: proposed, not accepted.** Nothing here is built. Accepting it needs an entry in
`requirements.md` and an ADR (see §7). The stock mechanism is `core/`-only and amends
nothing; exposing `served_ratio` amends ADR-0003.

This document is about the **platform**. It never mentions a particular domain
model. The first concrete use case is a workforce banca ore model, and how that
uses these capabilities lives with the case, not here.

---

## Contents

1. What exists today
2. Capability A — a composable time simulation
3. Capability B — recording a run
4. Capability C — stocks (4.0 constraints to check first · 4.1 schema · 4.2 order of
   operations · 4.3 the two formulas · 4.4–4.5 why the engine is excluded · 4.6 sign ·
   4.7 elapsed vs. period time · 4.8 what the engine must return · 4.9 invariants)
5. What this buys, beyond the first use case
6. Stress-testing the abstraction against other domains
7. Open questions

---

## 1. What exists today

CASCADE can already run time forward, for exactly one stock, hardcoded.

CONTEXT.md defines a **Temporal Jump**: *"An Event kind advancing simulated time by
N hours: subtracts N from every positive Functionality Time, clamps expiries to 0
with Functionality 1, then a Propagation follows. Full Event semantics (history
entry, undo, Scorecard trigger, and Clear Event). Auto-advance fires jumps to the
minimum remaining Functionality Time until none remain."*

Read as a specification, that sentence is already a step loop:

| The sentence says | Which is |
|---|---|
| advancing simulated time by N hours | the **step** |
| subtracts N from every positive Functionality Time | the **integration rule** — one stock, fixed drain |
| clamps expiries to 0 with Functionality 1 | the stock's **bound**, and its effect on derived state |
| then a Propagation follows | the **flow computation** |
| history entry, undo, Clear Event, Scorecard trigger | the **run machinery** |
| auto-advance until none remain | the **loop driver** |

The division of labour is also already right: the **engine sets**
`functionality_time` (backup exhaustion, `propagation.py`), and the **Temporal Jump
decrements it** client-side. Propagation proposes; the step integrates.

Three capabilities generalise this. They are **not** independent: stocks (C) integrate
once per step, so they need the Timeline (A) to have steps at all, and a run is only
legible once it is recorded (B). A → B → C is the order.

---

## 2. Capability A — a composable time simulation

**Today** a jump sequence is an interactive trail through `update_history`:
the user fires jumps and Events by hand, and auto-advance chains jumps by the
minimum remaining `functionality_time`. It is not an object, cannot be named,
re-run, or compared against a variant.

**Proposed**: a **Timeline** — an ordered, saved, replayable list of steps.

```
Timeline
  baseline: the Scenario Baseline it replays from
  steps: [ Step, … ]

Step
  advance_hours: elapsed hours — what `functionality_time` counts down (§4.7)
  label:         the period this step represents, e.g. "2023-03"
  events:        [ EventDefinition id, … ]   applied before propagating
  propagate:     bool                        (some steps only set up state)
```

Plus one repeat form, because periodic policy is the common case and unrolling it
by hand defeats the purpose:

```
  every: N steps → apply events [ … ]
```

**This schema is known not to fit the first real case as written**, and is left
unresolved rather than patched silently — see the open question in §7. The banca ore
model (`Coop-Noncello/period-simulation-design.md` §2.4) needs an Event to fire
*between* two Propagations within one period (release supplement capacity after
seeing what contract hours alone delivered), but a Step has exactly one `propagate`
after all its events. §7's cross-cutting entitlement estimate already counts "two
Propagations" per step for that model, which the schema above cannot express — that
arithmetic is ahead of the schema it is estimating.

Two properties matter and neither is free today:

- **Determinism.** A saved Timeline must produce the same result on re-run. Event
  application is already deterministic; the flow solver needed a `sorted()` at
  `flow.py:87` to stop degenerate optima flipping between runs, which is a warning
  that determinism here is earned, not assumed. See §2.2.
- **Replay from a baseline.** This is exactly *"apply a sequence of Any Graph
  Updates to the Scenario Baseline"*, which is ADR-0016's and ADR-0017's territory.
  A Timeline should replay through that machinery rather than invent a second
  mechanism for winding scenario state forward.

### 2.1 The Event is the only edit handle

**A Timeline is editable in the middle, and the only way to edit it is to add or change
an Event at a step.** Nothing else is a handle: not arbitrary state, not a result.

That is a stronger rule than it looks, and it buys three things:

- **Steps before the edit point are untouched.** Their recorded diffs stay valid, so a
  mid-Timeline edit re-runs forward from that step rather than recomputing the whole run.
- **Clear Event's "newest only" limit stops mattering.** There is no need to unwind an
  arbitrary middle step: change the Event, replay forward.
- **Every edit is already a first-class, undoable, recorded operation** — Events carry
  full semantics today (history entry, undo, Clear Event, Scorecard trigger).

Replaying from step *n* needs the state at step *n−1*, which is a forward walk of the
diffs from the baseline — the **same primitive** §3.1 uses to show a step on request. One
mechanism serves both.

Interaction is an open question (§7). Dragging Events onto a track is one option; so is
a plain editable table of steps, which is cheaper and probably clearer for 44 monthly
periods.

### 2.2 A Timeline stores inputs, not results

**Decision: store the inputs.** Schema changes are additive — every new field is
optional and absent by default — so a model authored today computes the same tomorrow,
and duplicating a result series that can be recomputed is the storage mistake §3.1
exists to avoid.

Engine changes can still move results without any change to a saved Timeline: a planned
change to a project's configured `flow_ratio_thresholds` table (ADR-0003), a
networkx upgrade altering how a degenerate optimum breaks ties (`flow.py:87`), or an
ordinary bug fix. **Out of scope here** — a published figure is pinned by citing the
commit it was produced at.

---

## 3. Capability B — recording a run

### 3.1 Storage: diffs, not snapshots

**This is the part with a hard constraint, and the codebase already paid for the
lesson once.**

`PropagationScorecardEntry` today stores, per entry:

- `before_propagation: GraphSnapshot` (required)
- `after_propagation: GraphSnapshot`
- `after_temporal_jump: GraphSnapshot`
- three base64-encoded PNGs of the canvas

ADR-0017 measured whole-snapshot history on a 39-node sample: `update_history` was
**2,137 KB for 20 entries — 97.6% of the project file, 40× the model it describes**,
and that size had already forced four different persistence policies for one field,
with the user-visible consequence that undo was empty after a crash. The fix was
Graph Diffs.

A 44-step Timeline recorded as Scorecard entries would be ~44 × (3 snapshots +
3 PNGs). Across policy variants that is tens of megabytes per experiment. **It
recreates precisely the problem ADR-0017 removed.**

So a Timeline run stores:

- **one** baseline snapshot, and
- **one Graph Diff per step** — the machinery exists, is invertible, and is measured.
- **no PNG per step.** Render from reconstructed state on demand; capture at most one
  image for the run.

ADR-0018 set the same precedent independently: it kept a per-evaluation *delta*
(`EvaluationOutcome`) rather than snapshots, because *"retaining whole snapshots for
every evaluation of a Shapley run would be hundreds of megabytes."* Two ADRs have
now chosen deltas over snapshots for the same reason. A third case should follow.

**Reconstruction is the cost of diffs, and it is affordable.** A diff holds only what
changed, so the whole state at step 30 is a walk of 30 diffs from the baseline. Timelines
are short — tens of steps, not thousands — so that walk is cheap and needs no keyframes,
no caching layer and no cleverness.

Two things follow, and the first is a *semantic* rule rather than a performance one:

- **A metric at step *t* is computed from step *t* and the steps before it.** Nothing
  later. That is what a metric on a running simulation means — at step 12 the run has not
  happened yet past 12 — so a centred moving average or a normalisation against the run's
  own final maximum is not a step metric at all. It is a post-hoc summary over the
  finished series, and belongs wherever the finished series is presented.
- **State is reconstructed on request, not stored.** No snapshot per step. A step's row
  carries a control that rebuilds and shows the full graph state at that step when
  someone asks for it — which is the case worth supporting (inspecting one interesting
  period) without paying for the case that is not (keeping all of them).

### 3.2 Metrics: standard plus custom, evaluated at read time

The Scorecard's existing rule is the right foundation and should be kept verbatim:
*"Derived metrics are computed client-side from the snapshots; never stored."*

That means **any metric is available after the fact**, provided the recorded state
contains its inputs — and it is the same principle ADR-0018 established for the
Operativity weighting: *how a result is read is not a property of how it was
computed.*

A metric defined this way is shown **at every step** of a Timeline run, alongside the
standard ones — that is the point of defining it, and it costs nothing extra because the
forward walk passes through every step anyway.

So a **custom metric is a view definition**, living in Client Configuration:

```
Metric
  name:      "workers in deficit"
  target:    node filter (type, category, canvas, …)
  attribute: which attribute to read
  aggregate: sum | mean | min | max | count | share_where | percentile(p)
  filter:    optional predicate on the attribute
```

**Deliberately not a formula language.** Dropdowns over a fixed aggregation set
cover the realistic cases and stay bounded; free-text expressions are a surface that
grows without limit and brings evaluation, error-reporting and performance concerns
with it. If free text is ever wanted, the grammar already exists —
`shared/rule-grammar.json`, read by both `core/rule_grammar.py` and
`lib/rule-suggestions.ts` — and must be extended there, in the one file, not forked.

**On the engine boundary:** a Scorecard metric is **not a Rule.** It does not affect
propagation; it is presentation arithmetic over recorded state. So evaluating it
client-side does not touch CLAUDE.md §7, which reserves *rule evaluation* to the
engine. Worth stating explicitly, because the resemblance invites the wrong
conclusion.

---

## 4. Capability C — stocks

### 4.0 Constraints a v1 stock model must respect

The schema and formulas below are shaped entirely by six constraints. Each is argued
for in full where cited; this list is for checking the shape, not deriving it.

- **The engine never reads or writes a stock.** It is read once, by the step operator,
  into a capacity handed to the engine; it is written once, by the step operator, from
  the flows the engine returned. The engine sees a stock only as a number already baked
  into `supply_capacity` (§4.4, §4.5).
- **`level` is on-hand only** — never a total that includes amounts in transit or on
  order. `min`/`max` bound on-hand, not total commitment (§4.1, pinned further by §6.1).
- **A clamp is always reported, never silent.** `max` or `min` truncating a step emits
  `spilled` or `unmet` as a result rather than absorbing the amount (§4.1).
- **A stock is never written by a Rule.** ADR-0015 consequents are a set-once latch;
  applied to a stock, that would freeze it after its first write (§4.9).
- **A supply-side stock needs exactly one source.** Source outflow is only determinate
  when sources do not share consumers; a shared-consumer topology — most real supply
  chains — is out of v1's reach until source-side fairness exists (§4.8, §6.4).
- **Rates and levels are per period; `advance_hours` is a separate, elapsed-time
  quantity that only `functionality_time` reads.** Conflating the two under-drains
  backup countdowns by roughly the labour/calendar ratio (§4.7).

### 4.1 Where a stock belongs: with the capacities, without being one

A **stock** is a value that persists across steps, in contrast to derived state which
is recomputed every run. Today the product has exactly one, `functionality_time`:
integer hours, `ge=0`, fixed drain.

The product already groups the fields that answer *"how much can this node deliver"*
separately from the ones that answer *"how does it depend on others"* — the node
Inspector has a **Capacities** section holding **Supply Capacity** and **Throughput
Capacity** side by side, distinct from the dependency fields.

Storage now matches that grouping: `Node.throughput_capacity` sits beside
`Node.supply_capacity`, both keyed by category. It used to live on
`CategoryDependencyProfile.capacity`, which put a "how much can it deliver" answer
among the "how does it depend" fields; that was moved rather than imitated.

A stock belongs in the **Capacities** family: it describes what the node holds and can
therefore deliver, not how it depends on anything.

**It must not go inside `supply_capacity`, though**, and the reason is in the code.
`_effective_supply` computes `cap × (functionality / N)`: capacity is a **rate**, and
degrading it with Functionality is correct — a half-broken pump moves half the flow.
A stock is a **level**, and a half-broken tank still holds all its water. Putting a
level into that dict would silently scale it by Functionality.

So: **its own Node-level field, in the capacity family, per category.**

```python
class Stock(BaseModel):
    level: float                      # signed
    min: Optional[float] = None
    max: Optional[float] = None
    retention: float = 1.0            # per-step multiplier on the LEVEL (§6.2).
                                      # 1.0 = no decay; <1 spoilage/evaporation/
                                      # self-discharge; >1 interest/growth
    efficiency: float = 1.0           # multiplier on the INFLOW (§6.3).
                                      # <1 = round-trip or transmission loss
    pending: Optional[dict[str, float]] = None
                                      # step label -> amount arriving then (§6.1).
                                      # The integration reads it from v1; authoring
                                      # it comes later.

class Node(BaseModel):
    ...
    stocks: Optional[dict[str, Stock]] = None   # keyed by category. None = no stock
```

Three of these fields are inert by default and only earn their keep in §6:
`retention` and `efficiency` are coefficients, justified in §6.2 and §6.3 respectively;
`pending` is the one *shape* change admitted into v1, justified in §6.1. All three
default to identity (1.0, 1.0, empty), so a model that never reads §6 sees only the
plain `L' = clamp(L + R − D, m, M)` of §4.3 and nothing else.

Signed, unlike `functionality_time` — a balance, a reservoir drawdown and a backlog
all go negative or need a floor that is not zero. One dict of models rather than three
parallel dicts, mirroring `category_dependency_profiles`' shape.

**Two semantics pinned now**, because they cannot be changed later without breaking every
model authored against them (§6.1 explains what forces the decision):

1. **`level` is what is on hand, and `min`/`max` bound that** — never a total that includes
   amounts in transit or on order. §4.3's `capacity = R + (level − min)` already assumes
   it: you cannot draw on stock that has not arrived. A bound on *total commitment* is a
   different concept (a credit limit) and would be its own field, not a redefinition of
   this one.
2. **A clamp is reported, never silent.** When `max` or `min` truncates, the truncated
   amount is emitted as a result (`spilled` above the ceiling, `unmet` below the floor). A
   reservoir genuinely spills; a workforce balance at its cap should never reach the clamp
   at all, because the pre-step capacity transform prevented the accrual. So a clamp
   firing is either physics or a modelling error, and the two are impossible to tell apart
   if the amount disappears.

### 4.2 What a stock does, in order

One step, start to finish. Everything about stocks happens in the two shaded rows;
the engine's row is unchanged from today.

| # | Who | Does what | Touches the stock? |
|---|---|---|---|
| 1 | Step operator | Load the period's exogenous inputs from the profile | no |
| 2 | **Step operator** | **Turn each stock's level into a capacity the engine can use** | **reads** |
| 3 | Engine | Propagate. Sees capacities and demands, exactly as today | **no** |
| 4 | **Step operator** | **Integrate the returned flows back into each level** | **writes** |
| 5 | Step operator | Record the step | no |

So a stock is **read once before the run and written once after it**, by the step
operator, and the engine never sees one. That is the whole role. §4.3 gives the two
formulas; §4.4 and §4.5 say why the engine is absent from both.

The same division already exists for the one stock the product has:
`functionality_time` is *set* by the engine as a level and *decremented* by the
Temporal Jump. Propagation proposes; the step integrates.

### 4.3 The two formulas

With `R` the declared per-period rate (`supply_capacity`, or an edge's capacity),
`L` the level, `[m, M]` its bounds (the Stock fields `min`/`max` above) and `D` what
the engine reported delivered:

```
step 2   capacity handed to the engine  =  R + (L − m)
step 4   new level                      =  clamp( a·L + n·R − D + arrivals(t),  m,  M )
```

`a` is `retention`, `n` is `efficiency`, and `arrivals(t)` is whatever `pending`
schedules for this step (§6). All three default to 1.0 / empty, so the ordinary case
is `capacity = R + (L − m)` and `L' = clamp(L + R − D, m, M)`.

**The rule is fixed, not declarative.** A declaration supplies only *which attributes
play `R` and `D`* — each either an exogenous profile attribute (§2) or a returned flow
(`served_ratio × demand`). No expression language: that covers every case in §5, and a
fixed rule is the difference between a schema field and a parser.

Read step 2 as: **a stock is spendable**. This period can deliver more than the rate
by drawing the level down toward its floor. And step 4 as: **delivering less than the
rate refills it**, up to the ceiling. That is what makes a stock a buffer rather than
a ceiling, which is the point of having one.

Two checks that it is the right shape:

- **The banca ore ledger.** With `R` = contract hours and `D` = hours worked,
  `L' = L + contract − worked`. That is the observed recurrence, verified on 1,372 of
  1,372 worker-years.
- **A reservoir.** `L` is the tank level, `m` is dead storage, `R` the catchment
  inflow; capacity is the inflow plus whatever is usably stored, and a dry period
  draws the level down.

**`min` and `max` are the policy instrument, not safety clamps.** "Cap the balance at
X" *is* `max`; "never draw below dead storage" *is* `min`. They are what a scenario
varies.

### 4.4 Why the engine never writes a stock

**It would break idempotency, and that breaks Analysis.** `POST /api/propagate/batch`
takes **one Project and up to 50 coalitions**, running a Propagation per coalition over
unchanged input; Vitality Centrality and Shapley Values run hundreds. A Propagation
that mutated stocks would move them on every coalition evaluation, so an Analysis run
would silently corrupt the very model state it was measuring. Re-running a scenario,
undo and Clear Event rest on the same property.

Secondary: propagation is an iterative fixpoint, so an in-loop write would fire several
times per run and "once, after convergence" is a special case bolted onto the core loop.

### 4.5 Why the engine never reads one either

A stock **does** have to constrain the allocation — a reservoir below dead storage
cannot supply, a balance at its ceiling cannot accept more, a depleted parts stock
removes a repair path. Clipping *after* the run gives a different and wrong answer,
because the allocator would have routed differently had it known.

Step 2 is what satisfies that without the engine knowing anything: the constraint is
**baked into the capacity the engine is handed**. It allocates against a number that
already accounts for the stock.

The reason it has to be step 2 rather than a read inside the engine is dimensional. A
stock is a **level** and a capacity is a **rate**; reconciling them is a per-period
question, and **the engine is period-agnostic and should stay that way**.

That reconciliation is free provided rates are declared **per period**: if
`supply_capacity` means "units per step" and the level is in "units", the factor is 1
and no Δt appears anywhere. This is not a new convention — the engine is already
**dimensionless**. `_effective_supply` and `_demand` return bare numbers,
`served_ratio = delivered / demand` cancels the unit, and nothing in `flow.py` names a
time unit. Declaring rates per period makes explicit what the code already does.

One caveat: that holds while every step covers the same span. A Timeline with **uneven**
steps — a month, then a quarter — would break it, since a quarter's contract hours are
not a month's. It resolves itself, because the profile supplies values **per step**
(§2), so an uneven step carries its own rate. The unevenness lives in the data rather
than in a conversion.

See §4.7 for why none of this may be folded into the Temporal Jump's hours.


### 4.6 The sign is not universal, so it must be declared

§4.3 assumes a positive level means **more** can be delivered. True for a reservoir, an
inventory and a budget. Not true everywhere:

| Stock | A positive level means | Effect on capacity |
|---|---|---|
| reservoir, inventory, budget | you hold something spendable | **raises** it |
| banca ore, conventional sign | the worker is owed time off | **lowers** it — a liability |
| repair backlog | work is waiting | adds to **demand**, not supply |

**The first case worked through did not need a new field.** Storing the *negative* of
a banca ore balance — positive when workers owe the company — makes §4.3's formulas
reproduce that ledger's verified recurrence **and** its accrual cap with no special
case: the cap `B ≤ B_max` is simply `min = −B_max`, and capacity falls to `R` exactly
when the cap binds. See `Coop-Noncello/period-simulation-design.md` §2.9. So a
liability is expressed by choosing the sign alone, **not in the `Stock` model of §4.1,
because it may not be needed** — whether a case exists that the sign trick cannot
reach, and what field it would need, is an open question argued in §7.

### 4.7 Elapsed time and period quantity are two different numbers

A step therefore carries **two independent quantities**, and collapsing them is a real
trap:

| Quantity | Unit | Consumed by |
|---|---|---|
| `advance_hours` | **elapsed** hours of wall-clock time | `functionality_time` countdowns, exactly as Temporal Jump does today |
| the step itself | one period | stock integration — rates are per period, so no conversion |

The tempting shortcut is to define a monthly step as `40 h × 4 weeks = 160 h` and use
that for both. It breaks, because **160 is a count of *labour* hours while
`functionality_time` counts *elapsed* hours.** A calendar month is ~730 elapsed hours.
A step declaring 160 would under-drain every backup countdown by a factor of ~4.5, so a
24-hour reserve would appear to survive a month of simulated time.

(The constant is also wrong on its own terms: a month is 52/12 = 4.33 weeks, which is
why a 38 h/week contract resolves to 164.7 h/month rather than 152.)

So:

- **Rates and stocks are per period.** No hours involved, no conversion, matching the
  engine's existing dimensionless behaviour.
- **`advance_hours` is elapsed time and only `functionality_time` reads it.** For a
  calendar month use that month's real hours (672–744) when backups matter, or a flat
  730 when approximate is fine.

The two mechanisms only interact in a model that uses backup countdowns **and** period
stocks. Keeping them as two fields now means that decision can be made properly when
such a model appears, instead of being frozen by the first one that does not need it.

### 4.8 What the engine must return

To integrate a stock the step needs the **flows in physical units**, and Functionality
cannot supply them: it is quantised (`_ratio_to_level` is `max(1, min(n, ceil(ratio·n)))`)
and one-sided (the sink edge is capped at demand, so the ratio cannot exceed 1).

One field lands now; a second is specified but deferred:

- **`served_ratio`** — per consumer. `delivered = served_ratio × demand`. Land this.
- **`utilisation`** — per source: delivered ÷ supply. Deferred; see below for why.

A demand-side stock (a backlog) needs only `served_ratio`. A **supply-side stock needs
the source's outflow**: a reservoir's level falls by what *it* delivered, and summing
consumers only recovers that when the source is the sole supplier.

**But `utilisation` is not always well-defined, and the engine already knows it.**
`_allocate_tiered_fair_share`'s docstring says the residual-reachability test exists
precisely to make per-consumer amounts well-defined *"despite max-flow's arbitrary flow
decomposition under ties (asking 'who is stuck' of the residual graph instead of reading
amounts off one arbitrary decomposition)."*

So consumer amounts are canonical by construction. **Source outflow is not** — it would
have to be read off the very decomposition the engine deliberately avoids trusting.

| Topology | Is source outflow determined? |
|---|---|
| one source per category | **yes** — it is the sum of the consumer amounts |
| several sources, disjoint sets of consumers | **yes** — each source is determined by its own |
| several sources sharing consumers | **no** — arbitrary under ties |

Two consequences, and they are load-bearing:

- **`served_ratio` lands now.** It is well-defined, and it is the only field a
  single-source stock model needs.
- **`utilisation` is deferred, with its precondition written down.** Making it canonical
  in the shared-consumer case needs a fairness rule on the *source* side to pick a
  determinate point — the same work as a source-side allocation strategy. Until then a
  supply-side stock model must keep **one source per stock**, which is a modelling
  constraint to state rather than a limitation to hide. The reservoir sketch in §5 stays
  inside that region; two reservoirs jointly feeding one zone would not, and their levels
  would be arbitrary.

This is what writing the second use case is for, and it is worth noticing that it was
caught by asking the question rather than by implementing and debugging it.

Three implementation notes:

- `flow.py:135` drops fully-served consumers from the candidate set. They must still be
  *reported*, while still proposing no degradation.
- Flow runs inside the fixpoint loop (`propagation.py:147`). Keep the **converged**
  iteration's values.
- Updates are emitted only for changed Elements (`propagation.py:294`). Emitting an
  unchanged one has precedent — ADR-0015 attribute rules already do it.

A specific-rule override or a backup deferral can make `functionality` disagree with
`served_ratio`. That is correct behaviour and must be documented, or it reads as a bug.

**This needs an ADR.** CLAUDE.md §7 forbids exposing engine internals *beyond what
`PropagationResult` defines*, so the move is to define it — on the grounds that
a served ratio is the immediate *cause* of a Functionality level, while the per-edge
assignment stays internal. That line belongs in the ADR, not in an assumption.

### 4.9 Two hard invariants

1. **A stock is never written by a Rule.** ADR-0015's generic attribute-set consequents
   are a *set-once latch* — first writer wins, never overwritten — which would freeze a
   stock after the first step.
2. **A stock is never written by the engine** (§4.4), or Analysis corrupts it.

---


## 5. What this buys, beyond the first use case

| Capability | Unlocks |
|---|---|
| Timeline (A) | any multi-period scenario: staged hazards, phased repairs, maintenance windows, seasonal load |
| Diff-based recording + custom metrics (B) | long runs that fit in a project file, and domain metrics without a schema change per domain |
| Stocks (C) | reservoir and tank levels, fuel reserves, spare-parts inventory, repair backlogs, budgets |
| `served_ratio` (C) | coverage as a number rather than a quantised level — useful to **every** flow model, including the existing water work. `utilisation` follows once source-side fairness exists (§6.4) |

A second declaration should be written on paper before any schema is frozen. The
readiest is a **water reservoir** on the EPANET side (ADR-0012 / ADR-0013): stock =
tank level, bounds = capacity and dead storage, inflow = a seasonal catchment profile,
outflow = demand computed by propagation, periodic policy = a release schedule. If
only one domain fits the abstraction, the abstraction is wrong.

`functionality_time` should converge onto this mechanism **last**. It is core,
well-tested behaviour, there is no e2e or runtime driver in this project, and changing
it to prove a generality claim is the wrong risk to take early.

---

## 6. Stress-testing the abstraction against other domains

The mechanism is `L' = clamp(L + R − D, m, M)` with rates per period, one stock per
(node, category), and a single source per stock. Sixteen candidate models, chosen to be
as unlike a workforce as possible. Most fit; four find something.

| Scenario | Stock | Verdict |
|---|---|---|
| Water reservoir | tank level | fits |
| Municipal budget over a fiscal year | remaining allocation | fits — annual reset is the periodic policy |
| Landfill capacity | remaining volume | fits — depleting, `R = 0`, `min = 0` |
| Carbon / emissions allowance | remaining allowance | fits |
| Generator fuel during a blackout | litres in tank | fits |
| Network or call-centre queue | queue length | fits, and it is the missing **`couples: demand`** example |
| Soil moisture for irrigation | moisture | needs decay (drainage) — see §6.2 |
| Battery storage on a grid | state of charge | needs efficiency — see §6.3 |
| Debt, or any interest-bearing liability | principal | needs growth — see §6.2 |
| Insurance capital | capital | needs growth |
| Food or reagent stock | quantity | needs decay (spoilage) |
| Hospital beds | free beds | **breaks** — see §6.1 |
| Spare parts with supplier lead time | on-hand + in transit | **breaks** — see §6.1 |
| Rolling stock with maintenance cycles | vehicles in service | **breaks** — see §6.1 |
| Multi-warehouse supply chain | stock per warehouse | **breaks** — see §6.4 |
| SIR epidemic, or a training pipeline | population per compartment | **out of scope** — see §6.5 |

### 6.0 How general to build: a test

Generalising from the start is usually cheaper than migrating later, so the default is to
aim at the general version. But the principle justifies anything if it is not bounded, so
the test is **what kind of thing the generality is**:

| Kind | Cost of adding now | Cost of retrofitting | Verdict |
|---|---|---|---|
| **A coefficient** — one multiplication, no restructure | ~nothing | a migration touching every model | **build it now** |
| **A shape** — changes what the step operator's expression looks like | small, if the term is present from the start | restructuring the integration | **build the hook now**, author it later |
| **A different algorithm** | a research question, in `engine/` | the same question, later | **wait for a model that needs it** |
| **A different mechanism** | a second product | — | **declare out of scope** |

Applied to what §6 found:

- `retention` (decay, interest) and `efficiency` (transfer loss) are **coefficients** → in.
- Delay is a **shape**, but its term is one addend → **the term goes in v1**, see §6.1.
- Source-side fairness is a **different algorithm** → waits (§6.4).
- Compartment models are a **different mechanism** → out of scope (§6.5).

The integration rule therefore settles as

```
L' = clamp( a*L + n*R - D + arrivals(t),  m,  M )
```

using §4.3's `m, M` for the `min`/`max` fields, with `a = retention` (default 1.0),
`n = efficiency` (default 1.0), and `arrivals(t)` empty unless a pipeline is in use.
All three defaults make it identical to the simple form, so nothing pays for
generality it does not use.

### 6.1 Delay is the primitive most often missing

A hospital bed is occupied and returns after a length of stay. A part ordered now arrives
in three steps. A vehicle enters maintenance and comes back. In each case *what was
delivered k steps ago returns now*, and `L' = L + R − D` has no way to say it.

This is the gap that showed up most often — four of sixteen — so it is the extension
whose absence will be felt first.

It does **not** break the Markov property the design rests on: a stock with a pipeline is
state `(level, pending…)`, which is still sufficient for the next step. But it is a
different *shape* from a scalar, so it belongs in a later revision.

**The two delays are one primitive.** A bed returning after a stay and a part arriving
after a lead time look different — one is an outflow coming back, the other an inflow
landing late — but both are *an amount scheduled to hit this stock at a future step*. One
mechanism covers both, which is why it is worth reserving space for rather than
special-casing twice.

#### What has to be decided now, and what does not

**Not the field.** Adding `pending` later is additive and costs nothing: the codebase's
pattern is that every new field is `Optional` and absent by default, and
`pydantic-mirror.test.ts` compares by property name and required-ness, so an optional
addition passes. Deferring the field is free.

**Not a subclass either.** A `PipelineStock` as a discriminated union would force the Zod
mirror, the Inspector and every reader to branch, for a variant most models never use. An
optional field on one `Stock` keeps the Pydantic → JSON Schema → Zod chain and the UI
unbranched.

**What genuinely cannot wait is what `level` and `max` mean.** Once a pipeline exists,
`level` is either on-hand or on-hand-plus-in-transit, and `max` bounds one or the other. If
v1 ships one reading and v2 needs the other, that is a silent semantic change to every
existing model, and no amount of optionality protects against it. Hence the two pins in
§4.1: **`level` is on-hand, `min`/`max` bound on-hand, and a clamp is reported.** The
capacity formula already commits v1 to that reading, so the only risk was leaving it
unwritten.

**The term goes in v1; only the authoring waits.** What makes a delay expensive to
retrofit is not the field — it is that a step operator written without an arrivals term has
nowhere for a late amount to land, so adding one later means restructuring the integration.
With `arrivals(t)` present from the start, reading an empty schedule by default, the
pipeline costs **one term now and nothing later**. That is §6.0's "build the hook" case,
and the cheapest insurance in this document.

**The shape.** Key the schedule by the **target step's label**, not by a relative
offset:

```python
pending: Optional[dict[str, float]] = None   # step label → amount arriving then
```

Three reasons: it is sparse, so a long lead time is not a long run of zeros; nothing has to
be shifted each step, only read; and it survives §2.1's mid-Timeline edits, where inserting
a step would silently corrupt every relative offset. It is also directly inspectable —
*"3 units arrive in 2026-05"* — which a list of offsets is not.

### 6.2 A retention factor is one field and covers a whole class

Interest, evaporation, spoilage, battery self-discharge and drainage are all
**proportional**, not additive. The current rule cannot express any of them.

```
L' = clamp( a·L + R − D,  m,  M )        a = per-step retention, default 1.0
```

One optional field, `a = 1.0` meaning no decay, and five of the sixteen scenarios become
expressible. **Recommended for v1** — it is far cheaper now than as a migration later.

### 6.3 Loss on transfer is a second coefficient, so it is also in

A battery loses ~15% round-trip; a transmission line loses on delivery. That is a
multiplier on the **flow**, not on the level, so `retention` does not cover it.

A modeller *could* fold it into the declared rate, but then `supply_capacity` stops reading
as the physical capacity — the kind of quiet distortion that makes a model untrustworthy to
whoever did not build it. By §6.0 it is a coefficient, one optional float defaulting to
1.0 and symmetric with `retention`, so it goes in now.

### 6.4 One source per stock excludes ordinary supply chains

§4.5 restricted supply-side stocks to one source per stock, because source outflow is
only determinate when sources do not share consumers. A **multi-warehouse supply chain
feeding shared retailers violates that immediately**, and so does any two-reservoir zone.

That is a more common topology than the restriction implied. **Source-side fairness is
therefore closer to required than "someday"** — it is what the second or third real model
will need, not an optimisation.

### 6.5 Compartment models are out of scope, deliberately

SIR dynamics, a training pipeline, and cohorts moving between balance bands all need
**stock-to-stock transitions**, often with bilinear coupling (`β·S·I`). The flow engine
allocates a commodity between sources and consumers; it does not move population between
states, and nothing proposed here would make it.

This is the same reason cohort nodes were rejected for the workforce model. Stating it as
a boundary is better than letting someone discover it halfway through building one.

---

## 7. Open questions

**Capability A**
- **A Step's `events → propagate` order is too rigid, and the first real case already
  needs more.** The banca ore model needs Propagate → Event → Propagate within one
  period (§2). Candidate fix: a Step carries a list of `(events, propagate)` phases
  instead of one flat pair — but that changes what "one step = one period" means for
  capability B's per-step metrics and for `advance_hours`, so it is not a drop-in
  widening of the field. Blocks P2 of the banca ore model, which is the first thing
  that would exercise this schema for real.
- Is a Timeline authored as a track with draggable Events, or as an editable table of
  steps? The table is cheaper and likely clearer at tens of periods. Either way the Event
  is the only edit handle (§2.1).
- Does a Timeline replay through ADR-0016 Reset + ADR-0017 diffs, or keep its own
  wind-forward path? Reusing them is the stated preference; it needs checking against
  what Reset guarantees.
- Where does a Timeline live — Model Configuration, or beside the Project? An
  exogenous per-step input table (demand varying by period) is derived data of
  non-trivial size, and ADR-0017 rejected persisting large derived data into the
  project file on exactly that reasoning.

**Capability B**
- Does the existing `PropagationScorecardEntry` migrate to diffs, or does a Timeline
  run get its own record type? Migration touches ADR-0006's discriminated union.
- Which standard metrics ship? Operativity Score already exists; coverage and stock
  level are the obvious additions once `served_ratio` and stocks exist.
- Where do post-hoc summaries over a finished run live (§3.1) — beside the step series,
  or only in an export? They are not step metrics and should not be offered as if they
  were.

**Capability C**
- **Neither write mechanism covers a stock-conditioned policy write.** §4.3's
  integration rule is one fixed shape (`L' = clamp(a·L + n·R − D + arrivals(t), m, M)`)
  and an Event is a static declared `attribute_mutations` set — neither can express
  "write half of the current level" or "write 0 once the level crosses a threshold."
  The banca ore model's liquidation rule needs exactly that, and its own design
  (`Coop-Noncello/period-simulation-design.md` §7.3) resolves it by placing the rule in
  client-side script code that never touches a Stock, an Event, or the engine — i.e.
  the actual governance policy sits outside every one of the three capabilities. If a
  second model needs the same kind of write, this needs a real primitive rather than a
  second bespoke escape hatch.
- Delayed return (§6.1) is resolved as far as it needs to be: the field is deferred, the
  semantics of `level`/`max` are pinned in §4.1, and the shape when it lands is a
  label-keyed dict. Nothing further blocks v1.
- Source-side fairness (§6.4) — schedule it against the second real model rather than
  treating it as an optimisation.
- `advance_hours` per step (§4.7): real hours per calendar month, or a flat 730? Only
  matters for a model using both backups and stocks; decide when one exists.
- Does a stock ever need to be per-edge rather than per-node? The in-transit case that
  motivated the question is now covered by `pending` on the destination (§6.1), so nothing
  outstanding requires it.
- Is `couples` (§4.6) needed at all? Candidate shape:
  ```python
  couples: Literal["supply", "demand", "none"] = "supply"   # candidate
  ```
  where `none` would record a stock without letting it constrain anything — what a
  consequence-only quantity wants. The first real case (banca ore) needed no such
  field: storing the balance's negative made §4.3's formulas reproduce the ledger's
  accrual cap for free (§4.6). The queue-length case in §6's stress test (`fits, and it
  is the missing couples: demand example`) is the one that would still need it, and no
  concrete backlog model has been written yet.

**Cross-cutting**
- `ENGINE_TIMEOUT_SECONDS` is 30 per Propagation (ADR-0008). A Timeline of 44 steps
  with two Propagations each is 88 sequential calls, each metered against the role's
  Engine Evaluation budget. A batch path for a Timeline may be needed, and the
  entitlement accounting for one needs deciding.
- **New vocabulary, if accepted.** None of **Timeline**, **Step** (as a Timeline
  element — distinct from any existing use of the word), **Stock**, or `couples`
  (above) exist in CONTEXT.md today; accepting this proposal means adding entries for
  whichever of them ship, alongside the ADR (CLAUDE.md §4). `EventDefinition` already
  exists (`CASCADE-backend/schemas/config.py`) and needs no new entry.
