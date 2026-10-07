# Temporal Simulation — platform design proposal

**Status: proposed, not built.** The decisions are recorded as proposed ADRs —
[0019](../adr/0019-temporal-simulation.md) (Timeline, Phases, the period sequence, run
recording), [0020](../adr/0020-stocks-live-in-supply-capacity.md) (Stocks, `served_ratio`)
and [0021](../adr/0021-event-attribute-operations.md) (Event Attribute Operations) — and
the product behaviour is specified in `requirements.md` §9.6. **This document holds the
reasoning, the stress tests and the open questions.** Formulas, schemas and the period
sequence have one home, the ADRs; this document cites them.

The stock mechanism runs in the client: the step operator and `buildPropagationPayload`
(`lib/propagation-payload.ts`). The engine changes in two places, amending ADR-0003: it
returns `served_ratio`, and it allocates storage last and returns each storage's `stored`
(ADR-0020 §1c, §3).

**Temporal Simulation** is the name of this module (CONTEXT.md). A **Temporal Jump** stays
what it is today, one Event kind. A Temporal Simulation is a saved sequence of periods. A
period has no duration of its own: simulated time passes only where the modeller places a
Temporal Jump Event, in a Phase, with the hours they choose.

This document is about the **platform**. Its running example is a workforce banca ore
model, the first concrete use case; that case's own design notes live with the case, outside
the repository.

---

## Contents

1. What exists today
2. Capability A — a composable time simulation
   (2.1 changes over time are authored before the run · 2.2 inputs only ·
   2.3 Events carry operations · 2.4 recovery, backups and repair between periods ·
   2.5 one period, in order)
3. Capability B — recording a run
   (3.1 storage · 3.2 metrics · 3.3 Level Scale and Level Mode)
4. Capability C — stocks
   (4.0 constraints · 4.1 where a stock belongs · 4.2 the step operator's role ·
   4.3 the two formulas · 4.4–4.5 why the engine is excluded · 4.6 sign ·
   4.7 time is an Event · 4.8 what the engine must return · 4.9 writers ·
   4.10 Reset)
5. What this buys, beyond the first use case
6. Stress-testing the abstraction against other domains
7. Open questions
8. Build plan (release v1.1)

---

## 1. What exists today

CASCADE can already run time forward, for exactly one stock, hardcoded.

CONTEXT.md defines a **Temporal Jump**: *"An Event kind advancing simulated time by
N hours: subtracts N from every positive Functionality Time, clamps expiries to 0
with Functionality 1, then a Propagation follows."* Read as a specification, that sentence
is already a step loop:

| The sentence says | Which is |
|---|---|
| advancing simulated time by N hours | the **step** |
| subtracts N from every positive Functionality Time | the **integration rule** — one stock, fixed drain |
| clamps expiries to 0 with Functionality 1 | the stock's **bound**, and its effect on derived state |
| then a Propagation follows | the **flow computation** |
| history entry, undo, Clear Event, Scorecard trigger | the **run machinery** |
| auto-advance until none remain | the **loop driver** |

The division of labour is also already right: the **engine sets** `functionality_time`
(backup exhaustion, `propagation.py`), and the **Temporal Jump decrements it** client-side.
Propagation proposes; the step integrates.

Three capabilities generalise this. Stocks (C) integrate once per period, so they need the
Timeline (A) to have periods at all, and a run is legible only once it is recorded (B).
A → B → C is the build order.

---

## 2. Capability A — a composable time simulation

**Today** a jump sequence is an interactive trail through `update_history`: the user fires
jumps and Events by hand, and auto-advance chains jumps by the minimum remaining
`functionality_time`. The trail cannot be named, re-run, or compared with a variant.

**Proposed**: a **Timeline**, an ordered, saved, re-runnable list of Steps. The schema is
ADR-0019 §1. In short: a **Step** is one period (or the same period `repeat`ed) with a
`label`, a calendar `unit` and an ordered list of **Phases**; a Phase
applies its Events, each firing every period of its Step or every N-th one, and then
optionally runs one Propagation; and a **profile** holds the per-period exogenous inputs.

A **Phase** lets an Event fire *between* two Propagations inside one period. Its uses are
to isolate an Event whose effect should be read on its own (a settlement, §3.1) and to
measure the same period twice (what contract hours alone delivered, then with supplement).
Each Propagation re-solves from scratch, so a Phase does not make the engine prefer one
supply over another (§7). A Step with a single Phase is the flat shape.

**The Step carries its own calendar.** With a `unit`, repeats advance the label
(`2023-03` → `2023-04` for months, `2023-W09` → `2023-W10` for weeks, `2023-03-15` for
days, `2023-03-15T08` for hours, `2023-Q1` for quarters, `2023` for years); with `none` they are numbered `label#2`,
`label#3`. The profile is keyed by these labels, so it only has to cover the labels the
Timeline produces.

**The profile is a list of Attribute Operations per label** (§2.3), applied at the start of
that period. It is input, roughly the size of the model it feeds (banca ore: about
19 elements × 6 attributes × 44 periods, ~40 KB), so it lives **in the project file**
beside its Timeline; ADR-0017 rejected splitting the project in two because that loses the
single downloadable file local-first depends on. Writing the profile as operations means it
reuses ADR-0021's addressing, validation and diff path, and adds no second write mechanism.

**A run starts from a working network.** A run Resets its own copy of the model (both
halves), so every run starts from the authored model with every Element operational; the
live model and `update_history` are never written (§3.1). An initial condition — an earthquake before a twelve-month
recovery — is an Event in the first Step. This is what makes a re-run reproducible: the
start state depends on the model alone.

**A period is the unit of metrics.** Recording is per Phase (§3.1),
so a Metric can read one Phase's change, but every Metric is reported per period. The
entitlement arithmetic is *propagating Phases × periods*.

**The step operator runs client-side** and calls the existing `POST /api/propagate` once per
propagating Phase. A server-side run endpoint, behind `services/propagation_service.py`, is
the later answer to the cost (§7).

One property matters, and it is not free today:

- **Determinism.** A saved Timeline must produce the same result on re-run **on the same
  build**. Event application is deterministic; the flow solver needed a `sorted()` in
  `flow_category_candidates` (`flow.py`) to stop degenerate optima flipping between runs, which is a
  warning that determinism here is earned. See §2.2.

There is no partial replay: every change over time is authored before the run (§2.1), and
every run starts from the beginning.

### 2.1 Changes over time are authored before the run

**Every change over time is an Event in a Phase or a profile value, written before the
run.** "At period 5" is an Event in period 5; arbitrary state and results are never
handles. While a run is shown (the Run View) the model and the Temporal Simulation are
read-only; End run, edit, and run again from the beginning. There is no partial replay: a
run takes seconds, and one code path leaves nothing to reconcile.

The Timeline is authored as an **editable table** of Steps and Phases, which is clearer
than a draggable track at tens of periods. A track is not ruled out later. The profile sits
under the Timeline on the same period columns, as a spreadsheet of known inputs: one row
per operation, one cell per period. Because a written value stays until something changes
it, a period range would only repeat a `set`, or need a revert rule that would also undo
an Event's change to that field; filled cells, with the carried value shown in empty ones,
say the same thing with no new rule.

### 2.2 A Timeline stores inputs only

**The Timeline stores inputs only**: Steps, Phases, Event ids (with their `every`) and the
profile. Schema changes are additive — every new field is optional and absent by default —
so a model authored today computes the same tomorrow.

**The run record is not saved** (decided 2026-10-06). It lives in memory for the session;
reopening a project means running again, seconds to tens of seconds of metered
Propagations. A saved run would add megabytes to every save, sync and download, and a
content hash to tell when it no longer matches; a result worth keeping is saved as a period
on the Scorecard.

Engine changes can still move results without any change to a saved Timeline: a project's
configured `flow_ratio_thresholds` table (ADR-0003), a networkx upgrade altering how a
degenerate optimum breaks ties, or an ordinary bug fix. **Out of scope here** — a published
figure is pinned by citing the commit it was produced at.

### 2.3 An Event says what to do with the current value

Today an Event's `attribute_mutations` can only **overwrite** a field with a literal
(`"<elementId>.<field>": value`). Policy in a Temporal Simulation depends on the current
value: "settle half the balance", "settle whatever exceeds X", "raise the cap by 10%".

So an Event gains **Attribute Operations** (ADR-0021): an ordered list of
`(element, path, op, value)` where `op` is one of `set`, `add`, `mul`, `at_most`,
`at_least`, applied to the value the field holds when the operation runs. `at_most` caps
the value at `value`; `at_least` raises it to `value`.

| Intent | Operation (stored sign, §4.6) |
|---|---|
| liquidate half the balance | `mul 0.5` on `level` |
| liquidate the excess above X | `at_least −X` on `level` |
| pay out everything owed | `at_least 0` on `level` |
| raise a ceiling by 10% | `mul 1.1` on `max` |
| open or close a draw limit | `set` on `max_draw` |

`path` is a list (`["supply_capacity", "hours", "level"]`): a dotted key would have to split
on the last dot, and EPANET ids contain dots (the reason ADR-0016 and ADR-0017 keyed
structurally). Operations stay in `attribute_mutations`'s lane — client-side, declared,
static arithmetic on one value — so they are not Rules and CLAUDE.md §7 is untouched.

What an operation cannot express is a *conditional* ("do A if B else C"). An operation
reaches one Element (`element`) or every Element an **Element Filter** selects (`where`:
kind, canvas, Node Type, Category, a label substring, minus any unticked match), resolved
when it runs. A policy over 19 activities is one entry.

### 2.4 Recovery, backups and repair between periods

A Propagation only worsens Functionality (ADR-0003's commit), and ADR-0003 puts
improvement in the timeline. Checked against the engine: a consumer degraded by a short
Phase stays degraded when the next Propagation runs with ample supply, and recovers only if
its Functionality is restored first.

**Shortage is recomputed every Propagation.** The step operator keeps an **imposed layer**:
for each Element, the Functionality and Responsibility Share last written by an Event in this
run (its vulnerability, a mutation, an operation, or a Temporal Jump's expiry), or the
post-Reset value when no Event wrote one. Before every Propagation it resets both fields to
the imposed layer. Everything else stands: `direct_damage`, `expected_repair_time`,
`functionality_time`, Rule-set attributes (ADR-0015's latch means "the fault occurred") and
every Stock. A shortage in March therefore ends with March, and an Event's damage stays until
a later Event changes it.

This needs no provenance lookup. The Scenario Baseline keeps only each field's *first*
write, so it cannot tell "the value before the last Propagation" when an Event and a
Propagation both wrote the same field; the step operator tracks the imposed layer itself as
it applies each Event.

**Time is an Event.** A period has no duration. A Temporal Jump Event in a Phase advances simulated time by the hours its definition says, with exactly
today's semantics: it subtracts its hours from every positive `functionality_time` and
expires a countdown reaching 0 to Functionality 1. The modeller decides how much time a
period represents for backups, and a model without backups needs no jump at all. The jump is
an Event, so an expiry joins the imposed layer: the Element stays at Functionality 1 until a
later Event restores it, and the backup guard does not re-grant a reserve to an Element that
already sits at the bottom.

Backups behave exactly as they do with hand-fired jumps today, including one inherited
limit: the engine never clears a running countdown (`propagation.py`, backup guard), so a
countdown keeps draining after its shortage ends. A model where supply returns before the
reserve runs out clears it with an Event (`set` `functionality_time` 0) in the period the
shortage ends (§7).

**Repair is an Event.** Nothing counts `expected_repair_time` down; it stays informational.
A repair completing at period *t* is an Event in Step *t* that operates on the damaged
Elements (`set` `direct_damage` false, `set` `functionality` to the top level). Automatic
repair is open (§7) and is what requirements §16's deferred recovery mechanics would
become.

### 2.5 One period, in order

The canonical sequence is ADR-0019 §2. Why each piece sits where it does:

| Position | Reason |
|---|---|
| Profile operations first | the period's exogenous inputs (rates, inflows) must be in place before any Event or Propagation reads them |
| Imposed layer reset before every Propagation | each Propagation derives shortage from the current supply (§2.4) |
| Stocks read into supply before every Propagation | an Event in an earlier Phase may change `max_draw` or `min` for a later one (§4.3) |
| Integration right after the **last propagating** Phase | `D` is that Phase's delivery; later non-propagating Phases (a settlement) then see the period's closing balance |
| Temporal Jump Events wherever the modeller puts them | a jump is an ordinary Event; before a period's Propagation it lets that Propagation see expired backups, after it the next period does |

---

## 3. Capability B — recording a run

### 3.1 Storage: a start state and diffs

**This is the part with a hard constraint, and the codebase already paid for the lesson
once.** `PropagationScorecardEntry` stores, per entry, `before_propagation`,
`after_propagation` and `after_temporal_jump` (`GraphSnapshot`s) plus three base64 PNGs of
the canvas.

ADR-0017 measured whole-snapshot history on a 39-node sample: `update_history` was
**2,137 KB for 20 entries — 97.6% of the project file, 40× the model it describes**. The fix
was Graph Diffs. A 44-period Timeline recorded as Scorecard entries would be
~44 × (3 snapshots + 3 PNGs), tens of megabytes per experiment across policy variants.

So a run record holds:

- the **start state** as one snapshot (the post-Reset state, §2);
- per period, **one Graph Diff per Phase**. The profile operations belong to the first
  Phase's diff and the Stock integration to the diff of the Phase it follows. A diff holds
  both sides of every field it changed, so *what a Phase changed* is derivable at read time.
  A period's net change is the composition of its diffs. 44 periods of two Phases is
  88 sparse diffs, against ADR-0017's measured 66 KB for 20 entries;
- per period, a few numbers that are not graph state: what each propagating Phase delivered,
  and what a clamp spilled or left unmet;
- **no PNG per period.** Render from reconstructed state on demand; capture at most one
  image for the run.

Putting an Event whose effect matters on its own (a settlement) in **its own Phase** makes
that Phase's diff exactly that effect, which is how a cash outlay is read (§3.2).

**A run is a view, not an edit.** It computes on its own copy of the model and is shown in
the **Run View**, read-only, the way Analysis Mode shows a score. Every change over time is
authored before the run (profile values, Phase Events), so nothing needs editing while one
is shown. The live model and `update_history` (capped at `HISTORY_LIMIT = 20`, folded into
the Scenario Baseline, ADR-0016) are never written: no history entry type, no Baseline tag,
no Clear Event rule, and a cancelled run has nothing to undo. An earlier draft landed a run
as one `temporal_simulation_run` entry tagged `simulation`; it existed only to keep a run
undoable while the model stayed editable.

ADR-0018 set the same precedent independently: it kept a per-evaluation *delta*
(`EvaluationOutcome`) because *"retaining whole snapshots for every evaluation of a Shapley
run would be hundreds of megabytes."* This is the third case to choose deltas for the same
reason.

**Reconstruction is cheap.** The whole state at period 30 is a walk of its diffs from the
start state. Timelines are tens of periods, so that walk needs no keyframes and no caching.

Two consequences, the first semantic:

- **A metric at period *t* is computed from period *t* and the periods before it.** At
  period 12 the run has not happened past 12, so a centred moving average or a
  normalisation against the run's final maximum is a post-hoc summary over the finished
  series. It belongs wherever the finished series is presented.
- **State is reconstructed on request.** A period's row carries a control that rebuilds
  and shows the full graph at that period, which supports inspecting one interesting period
  without storing all of them.

### 3.2 Metrics: standard plus custom, evaluated at read time

The Scorecard's existing rule is the foundation: *"Derived metrics are computed
client-side from the snapshots; never stored."* So **any metric is available after the
fact**, provided the recorded state contains its inputs — the principle ADR-0018 set for
the Operativity weighting: *how a result is read is not a property of how it was computed.*

A **custom Metric is a view definition** saved with the Temporal Simulation
(`Project.temporal_simulation`). Its schema is
ADR-0019 §4: target filter, attribute, `read` (`state` or `change`), an optional Phase,
an aggregate and an optional filter. `read: change` is **after − before** over the chosen
Phase (or the whole period), so a quantity that rises reads positive. That is what makes a
settlement's cash outlay a Metric: `sum` of the change in a Stock `level` over the
settlement Phase. With banca ore's stored sign (§4.6) the settlement raises `level` toward
0, so the outlay reads positive.

A Metric is shown **at every period** of a run, beside the standard ones, at no extra cost:
the forward walk passes through every period anyway.

**A Metric has no formula language.** Dropdowns over a fixed aggregation set cover the
realistic cases and stay bounded; free-text expressions bring evaluation, error-reporting
and performance concerns. If free text is ever wanted, the grammar already exists in one
file, `shared/rule-grammar.json`, and is extended there.

**A Metric is presentation arithmetic over recorded state, and it is no Rule**: it does not
affect propagation, so evaluating it client-side leaves CLAUDE.md §7 (rule *evaluation*
belongs to the engine) intact.

### 3.3 Level Scale and Level Mode: showing a stock

Functionality answers *"how well is this element serving"* and only ever worsens within a
Propagation. A stock answers *"how much has accumulated"*, and **both extremes can be a
problem**: a reservoir that overflows or runs dry, an inventory glut or a stockout, a banca
ore liability or deficit. Functionality cannot show that (one direction, quantised, derived
by the engine), so a stock gets a second scale, orthogonal to it. The schema and behaviour
are ADR-0019 §6; the reasoning:

- **The Level Scale lives in Client Configuration** because the engine never needs it.
  Bands over a signed ratio `value / reference`, each with a label and a brand colour token
  (CLAUDE.md §5).
- **The reference belongs to the Stock**, because a Stock is per (node, Category) and a
  node with two Stocks needs two references. It defaults to the Stock's own bound,
  `max(|min|, |max|)`; `Stock.level_reference` and `Stock.change_reference` override it.
  Banca ore uses each activity's own historical swing as `change_reference`, so a 25 h move
  reads as large where it is and ordinary where it is not.
- **Level Mode** recolours the canvas the way **Analysis Mode** does, and stays display
  only: it feeds no Rule, Operativity Score or Recovery Value. A stock that should affect
  propagation would do so through a Rule on a plain attribute, which is a later step.
- **A Scorecard entry saved from a simulation stores the per-element values it shows**, so
  it repaints in Level Mode later, as an analysis entry repaints its Analysis Heatmap.

---

## 4. Capability C — stocks

### 4.0 Constraints a v1 stock model must respect

Each is argued in full where cited; this list is for checking the shape.

1. **The engine never reads or writes a Stock.** `buildPropagationPayload`, the one builder
   the Propagate button, model-based Analysis, the Scorecard and the step operator all use,
   turns each Stock into a number before any engine request (§4.4, §4.5).
2. **The stored `level` is never scaled by Functionality; what a Stock offers and accrues
   is** (§4.1).
3. **A Stock lives inside `supply_capacity` or an edge `capacity`** (`float | Stock`), so it
   is supply-side only in v1 (§4.1), except **storage** (`max_fill`), which also takes from
   the network (ADR-0020 §1c).
4. **A node Stock with a `rate` needs its node to be the only source of its Category; an
   edge Stock needs its target to have exactly one incoming flow edge.** Otherwise that
   Stock's integration is skipped with a warning (§4.1, §4.8). Storage has no such limit:
   it is used last, filled last, and shares by fraction with other storages.
5. **`level` is on-hand only**, and `min`/`max` bound on-hand (§4.1, pinned by §6.1).
6. **A clamp is always reported**: `max` or `min` truncating a period emits `spilled` or
   `unmet` (§4.1).
7. **A Stock `level` is never written by a Rule** (§4.9).
8. **Rates and levels are per period.** Elapsed time exists only as Temporal Jump Events,
   which only `functionality_time` reads (§4.7).

### 4.1 Where a stock belongs: with the capacities

A **stock** is a value that persists across periods. Today the product has exactly one,
`functionality_time`: integer hours, `ge=0`, fixed drain.

The node Inspector's **Capacities** section holds **Supply Capacity** and **Throughput
Capacity** side by side, distinct from the dependency fields, and storage matches:
`Node.throughput_capacity` sits beside `Node.supply_capacity`, both keyed by Category. A
stock describes what the node holds and can therefore deliver, so it belongs in the
Capacities family.

**It goes inside `supply_capacity`, as the richer form of a supply rate.** A bare number
under a Category key stays a plain per-period rate. An object under the key is a **Stock**
(schema: ADR-0020 §1), and its `rate` field is that same number. Every existing project
file and sample stays valid.

**Scaling by Functionality.** `_effective_supply` computes `cap × φ(functionality)`, with φ
the midpoint mapping of ADR-0003 (top level 100%, bottom level 0%). The payload carries
`rate + draw` as an ordinary supply number, so the **engine scales the whole drawable amount
by φ with no change to its code**: a damaged outlet limits how fast the stock can be drawn,
and a critical node offers nothing. The stored `level` is never scaled, so a damaged tank
keeps its water and can be drawn again once repaired. The inflow credited at integration is
scaled by the same φ (ADR-0020 §2); crediting the full rate to a source that could offer
only part of it would let the level drift upward.

**This scaling fits a physical rate** (a catchment, a pump). A **sunk obligation** — a
contract hour owed whether or not the pool is healthy — wants its inflow unscaled. A model
with sunk inflow keeps the node at the top Functionality level, where φ = 1, and varies the
rate through `rate`. Banca ore does exactly this. A second model needing a degraded node
with unscaled inflow would be the argument for a per-stock flag (§7).

**Supply-side only in v1, storage excepted.** `supply_capacity` makes a node a source in the
Category's flow graph, so a node Stock adds supply. Storage (`max_fill`, a tank) is also the
last sink of its own Category (ADR-0020 §1c). A backlog, which should add to *demand*, is
the `couples` question (§7).

**A Stock may also sit on an Edge.** `Edge.capacity` is `float | Stock` in the same way.
**An edge Stock adds edge capacity and no supply**: drawing its level lets more flow pass
through that edge, and the hours themselves must still come from the edge's source. In banca
ore the single pool's `supply_capacity` therefore has to cover the sum of what its edges may
carry, and the profile sets it per period. This is what lets one source feed many consumers
while each consumer keeps its own balance (one edge per activity, each edge's Stock being
that activity's balance). For an edge Stock, **`D` is the flow delivered into the target
through that edge** (`served_ratio × demand`), canonical when the target has exactly one
incoming flow edge; with several, the split between them is arbitrary (§4.8) and that
Stock's integration is skipped with a warning. φ is the edge's own Functionality ratio
(`_edge_capacity` already scales by it).

**When an edge's `rate` exceeds its `inflow`, the balance is not attributable.** The extra
capacity is hours lent by other consumers' suppliers (cross-training in a single pool). They
land in the target's `D`, so the target's balance shows work its own people did not do, and
the lenders' balances show idle hours that were really lent. Coverage stays correct. The step
operator integrates anyway and **flags that period's level as attribution-invalid**; a
correct balance needs source attribution.

**Default capacities move with a draw.** `_max_source_supply` gives every edge and
throughput with no declared capacity the largest supply in its Category as a default. A Stock
sends `rate + draw`, so a large draw raises those defaults too. A model with Stocks should
declare its edge and throughput capacities explicitly; the Inspector warns when a Category
holds a Stock and an edge or throughput in it has no capacity.

**What the union costs.** Every reader of the field changes in the same session
(CLAUDE.md §8); the list is ADR-0020's Consequences. `logical.py` and `rules_eval.py` read
only the keys and need nothing.

**UI.** The supply editor is offered on every Node Type: Node Type is a display
classification, and the engine treats all types the same. A non-blocking warning on a
**Service** node with any `supply_capacity` entry suggests Source; it stays silent on Source,
Infrastructure and Personnel (a tank can be Infrastructure; the banca ore pool is
Personnel).

`retention` and `efficiency` default to 1.0 and only earn their keep in §6 (§6.2, §6.3); a
model that never reads §6 sees the plain `L' = clamp(L + R − D, m, M)`.

`max_draw` is a rate limit on the stored level: a reservoir's outlet limits how fast it is
drawn down exactly as an agreement limits how many extra hours may be asked in one period. An
Event can open or close it (`set` on `max_draw`, §2.3), for instance to measure a period
first without supplementary hours and then with them. `pending` (delayed arrivals, §6.1) is
not in the v1 schema.

A Stock `level` is signed, unlike `functionality_time`: a balance, a reservoir drawdown and
a backlog all go negative or need a floor that is not zero.

**Two semantics pinned now**, because changing them later would break every model authored
against them (§6.1 says what forces the decision):

1. **`level` is what is on hand, and `min`/`max` bound that** — never a total including
   amounts in transit or on order. The supply formula already assumes it: stock that has
   not arrived cannot be drawn. A bound on total commitment is a different concept (a credit
   limit) and would be its own field.
2. **A clamp is reported.** When `max` or `min` truncates, the amount is emitted (`spilled`
   above the ceiling, `unmet` below the floor). The draw formula keeps the level at or above
   `min` whenever the inflow covers the rate (§4.3), so a firing clamp is physics (a
   reservoir spilling), a capacity lent by others (§4.1, flagged) or a modelling error; the
   amount is needed to tell them apart.

**Recording a Stock change.** The ADR-0017 differ recurses one level into `properties` and
stores every other compound field whole. A Stock is changed one field at a time (an
integration writes `level`, an author corrects `max`), so the differ and the Scenario
Baseline address a Stock field by its full path `[field, category, stock_field]`, the list
form ADR-0021 uses. Without that, a Reset reverting a run's `level` would also revert a hand
correction to `max` in the same `supply_capacity` object (ADR-0016 §3, the
"already-held field" row).

### 4.2 The step operator's role

Per period (full sequence: ADR-0019 §2):

| # | Who | Does what | Touches the stock? |
|---|---|---|---|
| 1 | Step operator | Apply the period's profile operations and Phase Events | may write `rate`, `inflow`, `max_draw`… |
| 2 | **Step operator** | **Turn each Stock into a supply number** (storage: a last source and a last sink) | **reads** |
| 3 | Engine | Propagate. Sees capacities and demands, exactly as today | **no** |
| 4 | **Step operator** | **Integrate the returned flows into each level**, once, after the last propagating Phase | **writes `level`** |
| 5 | Step operator | Record the diffs | no |

The engine never sees a Stock. The same division already exists for the one stock the
product has: `functionality_time` is *set* by the engine and *decremented* by the Temporal
Jump.

### 4.3 The two formulas

The formulas are ADR-0020 §2; with `a = retention`, `n = efficiency`, `R` the inflow
credited (`inflow`, defaulting to `rate`), `d = max_draw`, `[m, M]` the bounds and `D` the
delivery of the last propagating Phase:

```
supply handed to the engine  =  rate + min( d,  max(0,  a·L + n·R − rate − m) )   (engine applies φ)
new level                     =  clamp( a·L + n·φ·R − D + arrivals(t),  m,  M )
```

In the ordinary case (`a = n = 1`, `R = rate`, no `max_draw`, φ = 1) these are
`supply = rate + (L − m)` and `L' = clamp(L + rate − D, m, M)`.

**Storage** (`max_fill`, `rate` 0) is handed over as two numbers and integrated from what
the engine reports it filled and drew (ADR-0020 §1c):

```
source (used last)   =  min( max_draw,  a·L + n·R − m )
sink   (filled last) =  min( max_fill,  M − L )
new level            =  clamp( a·L + n·φ·R + filled − drawn,  m,  M )
```

**Why the draw reads `a·L + n·R − rate`.** The draw is the level the period can give up and
still end at or above `m` when everything offered is delivered. Drawing against the raw `L`
would let a decaying stock (`a < 1`) end at `m − (1 − a)·L`, and an inefficient one
(`n < 1`) below `m` too, firing `unmet` on every full draw. With this form the level ends at
or above `m` for any φ in [0, 1] whenever `n·R ≥ rate`; when `n·R < rate` (capacity lent by
others, §4.1) the shortfall is real and `unmet` reports it.

**With Phases,** a Stock is read before every propagating Phase, so an Event that changes
`max_draw` or `min` between two Phases changes the second Phase's supply. It is **integrated
once per period**, right after the last propagating Phase, from that Phase's delivery.
Earlier Phases shape the allocation and do not write the stock; later non-propagating Phases
see the integrated level.

**The rule is fixed.** A declaration supplies only *which attributes play `R` and `D`* — each
either a profile value (§2) or a returned flow (`served_ratio × demand`). A fixed rule is the
difference between a schema field and a parser, and it covers every case in §5.

Read the supply formula as: **a stock is spendable**. And the integration as: **delivering
less than the rate refills it**, up to the ceiling. That is what makes a stock a buffer.

Two checks that it is the right shape:

- **The banca ore ledger.** With `R` = contract hours and `D` = hours worked,
  `L' = L + contract − worked`: the observed recurrence, verified on 1,372 of 1,372
  worker-years.
- **A reservoir.** `L` is the tank level, `m` dead storage, `R` the catchment inflow;
  capacity is the inflow plus whatever is usably stored, and a dry period draws it down.

**`min` and `max` are the policy instrument.** "Cap the balance at X" *is* `max`; "never
draw below dead storage" *is* `min`. They are what a scenario varies.

### 4.4 Why the engine never writes a stock

**It would break idempotency, and that breaks Analysis.** `POST /api/propagate/batch` takes
one Project and up to 50 coalitions, running a Propagation per coalition over unchanged
input; Vitality Centrality and Shapley Values run hundreds. A Propagation that mutated stocks
would move them on every coalition evaluation, so an Analysis would corrupt the model state
it was measuring. Re-running a scenario, undo and Clear Event rest on the same property.

Secondary: propagation is an iterative fixpoint, so an in-loop write would fire several
times per run, and "once, after convergence" would be a special case bolted onto the loop.

### 4.5 Why the engine never reads one either

A stock **does** have to constrain the allocation — a reservoir below dead storage cannot
supply, a depleted parts stock removes a repair path. Clipping *after* the run gives a wrong
answer, because the allocator would have routed differently had it known. The payload
conversion satisfies that: the constraint is **baked into the capacity the engine is
handed**.

The conversion has to happen outside the engine because a stock is a **level** and a
capacity is a **rate**, and reconciling them is a per-period question. **The engine is
period-agnostic and stays that way.** The reconciliation needs no step length provided rates
are declared **per period**: the factor is 1 and no Δt appears anywhere. The engine is
already dimensionless — `_effective_supply` and `_demand` return bare numbers,
`served_ratio = delivered / demand` cancels the unit, and nothing in `flow.py` names a time
unit.

That holds while every period covers the same span. An uneven Timeline — a month, then a
quarter — carries the difference in its profile, which sets each period's `rate`,
`inflow` and, where it matters, `retention`. The unevenness lives in the data.

### 4.6 The sign is not universal

The formulas assume a positive level means **more** can be delivered. True for a reservoir,
an inventory and a budget. Not everywhere:

| Stock | A positive level means | Effect on capacity |
|---|---|---|
| reservoir, inventory, budget | something spendable is held | **raises** it |
| banca ore, conventional sign | the worker is owed time off | **lowers** it — a liability |
| repair backlog | work is waiting | adds to **demand** |

**The first case needed no new field.** Storing the *negative* of a banca ore balance —
positive when workers owe the company — makes the formulas reproduce that ledger's verified
recurrence **and** its accrual cap with no special case: the cap `B ≤ B_max` is simply
`min = −B_max`, and capacity falls to `rate` exactly when the cap binds. Whether a case
exists that the sign alone cannot reach is the `couples` question (§7).

**Decision: the user types the stock in its stored sign.** There is no display inversion and
no flag. The Inspector labels the field *"level (positive = available to draw)"*, and the
operation table of §2.3 is written in the stored sign.

### 4.7 Time is an Event; quantities are per period

A Stock's rates are per period, so integration involves no hours at all. Elapsed time matters
only to `functionality_time`, and it enters a run only through Temporal Jump Events the
modeller places. The two are independent: a workforce model with monthly periods and no
backups never jumps; a model with backups jumps by however many hours a period represents.

One trap to know when choosing a jump's hours: **a reserve counts *elapsed* hours.** A
calendar month is ~730 elapsed hours (672–744). Using a month's labour hours instead
(`40 h × 4.33 weeks ≈ 173 h`) would under-drain every backup ~4×, and a 24-hour reserve would
appear to survive a month.

### 4.8 What the engine must return

To integrate a stock the step operator needs **flows in physical units**, which
Functionality cannot supply: it is quantised (`_ratio_to_level`) and one-sided (the sink
edge is capped at demand, so the ratio cannot exceed 1).

- **`served_ratio`** — per consumer **and per Category** (`{category: ratio}`), because a
  consumer of water and electricity has two ratios and a stock is per (node, Category).
  `delivered = served_ratio[cat] × demand[cat]`. Lands with v1.
- **`stored`** — per storage node and Category, `filled` and `drawn` (ADR-0020 §1c). Lands
  with v1.1; storage's order (last source, last sink, fraction sharing) makes it determinate.
- **`utilisation`** — per source: delivered ÷ supply. Deferred.

A **node Stock needs the source's outflow**: a reservoir's level falls by what *it*
delivered, and summing consumers recovers that only when the source is the sole supplier.
Source outflow is not always determinate. `_allocate_tiered_fair_share`'s docstring says the
residual-reachability test exists to make per-consumer amounts well-defined *"despite
max-flow's arbitrary flow decomposition under ties"*. Consumer amounts are canonical by
construction; source outflow would have to be read off the decomposition the engine
deliberately avoids trusting.

| Topology | Is source outflow determined? |
|---|---|
| one source per Category | **yes** — the sum of the consumer amounts |
| several sources, disjoint sets of consumers | **yes** — each source by its own |
| several sources sharing consumers | **no** — arbitrary under ties |

Hence `served_ratio` lands now, and `utilisation` waits for a source-side fairness rule (the
same work as a source-side allocation strategy). Until then a node Stock with a `rate` keeps
**one source per Category**; an edge Stock with a single-incoming-edge target needs only
`served_ratio`; storage needs `stored`.

Implementation notes (ADR-0020 §3): consumers the flow pass drops as fully served must still
be reported; keep the **converged** iteration's values; emit ratios for unchanged Elements
too. A specific-rule override or a backup deferral can make `functionality` disagree with
`served_ratio`; that is correct and documented.

Exposing `served_ratio` is a change to `PropagationResult`, made by ADR-0020 under
CLAUDE.md §7's "beyond what `PropagationResult` defines": a served ratio is the immediate
*cause* of a Functionality level, and the per-edge assignment stays internal.

### 4.9 Who writes a stock

1. **A Rule never writes a Stock.** ADR-0015's consequents are a *set-once latch* — first
   writer wins — which would freeze a stock after its first period.
2. **The engine never writes a Stock** (§4.4), or Analysis corrupts it.

`level` has exactly two writers: the **step operator** (integration, once per period) and an
**Event's Attribute Operation** (policy, §2.3). The profile writes `rate`, `inflow` and the
other parameters through the same Attribute Operations. All are client-side, all run between
Propagations, and all land in the run's diffs. `attribute_mutations` addresses a whole field,
so a mutation on `supply_capacity` that replaces a Stock is rejected with a warning: a Stock
is written field by field.

### 4.10 Reset and Stocks

- `Stock.level` is **model**, so Reset's first half (force operational) does not touch it.
  Reset's second half reverts machine writes from the Scenario Baseline, **by provenance**
  (ADR-0016): an Event fired by hand that changed a `level` is reverted.
- A run never writes the model (§3), so leaving the Run View shows every Stock at its
  authored level with nothing to revert.
- A hand edit of a Stock (a new opening balance) is authoring work and survives Reset; the
  path-level diff of §4.1 is what keeps it separate from an Event's `level` writes.

---

## 5. What this buys, beyond the first use case

| Capability | Unlocks |
|---|---|
| Timeline (A) | any multi-period scenario: staged hazards, phased repairs, maintenance windows, seasonal load |
| Diff-based recording + custom metrics (B) | long runs that fit in a project file, and domain metrics without a schema change per domain |
| Stocks (C) | reservoir and tank levels, fuel reserves, spare-parts inventory, budgets |
| `served_ratio` (C) | coverage as a number beside the quantised level — useful to **every** flow model, including the existing water work. `utilisation` follows once source-side fairness exists (§6.4) |
| storage + `stored` (C) | tanks over a day: flow rates and stored volume both bind, and pump outages, demand surges and hazards reach the town through the tanks |

The second declaration is the **aqueduct over a day** (decided 2026-10-06): EPANET Net1
through the Temporal Simulation importer, each tank a storage Stock (level, bounds, outlet
and inlet capacities from its geometry and pipes), demand patterns as profile rows, a pump
outage as Events. If only one domain fits the abstraction, the abstraction is wrong.

`functionality_time` converges onto this mechanism **last**. It is well-tested core
behaviour, the project has no e2e driver, and changing it to prove a generality claim is the
wrong early risk.

---

## 6. Stress-testing the abstraction against other domains

The mechanism is `L' = clamp(a·L + n·φ·R − D + arrivals(t), m, M)` with rates per period,
one stock per (node, Category) or per edge, and one source per node stock with a `rate`
(storage is exempt). Sixteen candidate
models, chosen to be as unlike a workforce as possible: five fit v1 as is, five need a
coefficient that v1 includes, and six find a limit.

| Scenario | Stock | Verdict |
|---|---|---|
| Water reservoir | tank level | fits |
| Municipal budget over a fiscal year | remaining allocation | fits — annual reset is an Event every 12 periods |
| Landfill capacity | remaining volume | fits — depleting, `R = 0`, `min = 0` |
| Carbon / emissions allowance | remaining allowance | fits |
| Generator fuel during a blackout | litres in tank | fits |
| Soil moisture for irrigation | moisture | needs decay (drainage) — `retention`, §6.2 |
| Food or reagent stock | quantity | needs decay (spoilage) — `retention`, §6.2 |
| Debt, or any interest-bearing liability | principal | needs growth — `retention`, §6.2 |
| Insurance capital | capital | needs growth — `retention`, §6.2 |
| Battery storage on a grid | state of charge | needs transfer loss — `efficiency`, §6.3 |
| Network or call-centre queue | queue length | **limit** — a demand-side stock, the `couples: demand` case (§7) |
| Hospital beds | free beds | **limit** — delay, §6.1 |
| Spare parts with supplier lead time | on-hand + in transit | **limit** — delay, §6.1 |
| Rolling stock with maintenance cycles | vehicles in service | **limit** — delay, §6.1 |
| Multi-warehouse supply chain | stock per warehouse | **limit** — shared consumers, §6.4 |
| SIR epidemic, or a training pipeline | population per compartment | **out of scope** — §6.5 |

### 6.0 How general to build: a test

Generalising from the start is usually cheaper than migrating later, so the default is to aim
at the general version. The principle justifies anything if unbounded, so the test is **what
kind of thing the generality is**:

| Kind | Cost of adding now | Cost of retrofitting | Verdict |
|---|---|---|---|
| **A coefficient** — one multiplication, no restructure | ~nothing | a migration touching every model | **build it now** |
| **A shape** — changes what the integration expression looks like | small, if the term is present from the start | restructuring the integration | **build the hook now**, author it later |
| **A different algorithm** | a research question, in `engine/` | the same question, later | **wait for a model that needs it** |
| **A different mechanism** | a second product | — | **declare out of scope** |

Applied: `retention` and `efficiency` are coefficients → in. Delay is a shape whose term is
one addend → the term goes in v1 (§6.1). Source-side fairness is a different algorithm →
waits (§6.4). Compartment models are a different mechanism → out (§6.5). All three
coefficient defaults reduce the rule to the simple form, so nothing pays for generality it
does not use.

### 6.1 Delay is the primitive most often missing

A hospital bed is occupied and returns after a length of stay. A part ordered now arrives in
three periods. A vehicle enters maintenance and comes back. In each case *what was delivered
k periods ago returns now*, and `L' = L + R − D` cannot say it. Three of the sixteen hit this,
more than any other limit.

A stock with a pipeline is state `(level, pending…)`, still sufficient for the next period,
so the Markov property the design rests on holds. **The two delays are one primitive**: a
bed returning after a stay and a part arriving after a lead time are both *an amount
scheduled to hit this stock at a future period*.

**What cannot wait is what `level` and `max` mean.** Once a pipeline exists, `level` is
either on-hand or on-hand-plus-in-transit, and `max` bounds one or the other; switching later
is a silent semantic change to every model. Hence the two pins of §4.1.

**The term goes in v1; the field and its authoring wait.** A step operator written without an
arrivals term has nowhere for a late amount to land, so adding one later means restructuring
the integration. With `arrivals(t)` present from the start as an addend that is zero until
`pending` exists, the pipeline costs one term now. `pending` itself is left out of the v1
schema: nothing could author or test it, and an optional field is free to add later. A
discriminated `PipelineStock` subtype is rejected: it would make the Zod mirror, the
Inspector and every reader branch for a variant most models never use.

**The shape, when it lands**, keys the schedule by the **target period's label**:

```python
pending: Optional[dict[str, float]] = None   # period label → amount arriving then
```

It is sparse, nothing shifts each period, it survives inserting a Step before it (relative
offsets would be corrupted), and it reads directly — *"3 units arrive in 2026-05"*.

### 6.2 A retention factor covers a whole class

Interest, evaporation, spoilage, battery self-discharge and drainage are all
**proportional**. One optional field, `retention` (`a`, default 1.0 = no decay), makes the
four decay-or-growth rows of §6 expressible, and it is far cheaper now than as a migration.

### 6.3 Loss on transfer is a second coefficient

A battery loses ~15% round-trip; a transmission line loses on delivery. That is a multiplier
on the **inflow**, so `retention` does not cover it. Folding it into the declared rate would
stop `supply_capacity` reading as the physical capacity, the kind of quiet distortion that
makes a model untrustworthy to whoever did not build it. `efficiency` (`n`, default 1.0) goes
in now.

### 6.4 One source per node stock excludes ordinary supply chains

§4.8 restricts node Stocks to one source per Category, because source outflow is determinate
only when sources do not share consumers. A **multi-warehouse supply chain feeding shared
retailers** violates that immediately. A zone fed by several tanks does not, since storage shares by
fraction (ADR-0020 §1c). Edge Stocks avoid it only where each consumer has a single incoming
edge. **Source-side fairness is what the
second or third real model will need**, so it is scheduled against that model.

### 6.5 Compartment models are out of scope

SIR dynamics, a training pipeline, and cohorts moving between balance bands all need
**stock-to-stock transitions**, often with bilinear coupling (`β·S·I`). The flow engine
allocates a commodity between sources and consumers and does not move population between
states; nothing proposed here would make it. This is the reason cohort nodes were rejected
for the workforce model, and stating the boundary saves someone discovering it halfway
through.

---

## 7. Open questions

Decisions taken while writing this are recorded in ADR-0019, ADR-0020 and ADR-0021. What
remains open:

**Capability A**
- **Automatic repair.** Should a Temporal Jump count `expected_repair_time` down and repair
  an Element at 0? v1 repairs only through an Event (§2.4); requirements §16's deferred
  recovery mechanics land here.
- **Backups across periods.** A countdown keeps draining after its shortage ends, and an
  expired backup stays down until an Event restores it (§2.4). Both are today's Temporal Jump
  behaviour. If a real model needs reserves that stop when supply returns and refill
  afterwards, the step operator would have to track reserve state per Element; no model needs
  it yet.
- **Phase B re-solves from scratch.** The engine is stateless, so staging "contract hours
  first, then supplement" yields two measurements (`delivered_A`, `delivered_B`) and enforces
  no preference. Is a preference order between supplies ever needed?

**Capability B** — settled 2026-10-06 (ADR-0019 §4): three standard Metrics (Operativity
Score, coverage, stock level); series export as CSV with summaries left to the spreadsheet;
a saved period is a new `temporal_simulation` Scorecard entry holding its snapshot and
values, and `PropagationScorecardEntry` does not migrate to diffs.

**Capability C**
- **A per-stock switch for φ-scaling of the inflow?** Needed only when a model has a degraded
  node with sunk inflow (§4.1).
- **Conditionals** ("if A then B else C"), which operations do not express. No model needs
  one yet.
- **Is `couples` needed?** Candidate shape:
  ```python
  couples: Literal["supply", "demand", "none"] = "supply"   # candidate
  ```
  `none` would record a stock without letting it constrain anything. Banca ore needed no such
  field (§4.6). The queue in §6 would, and no concrete backlog model has been written yet.
  Until this is answered a stock cannot express a backlog on a consumer.
- **Source-side fairness** (§6.4) between ordinary sources — schedule it against the second
  real model. Storage got its own rule (ADR-0020 §1c: last source, last sink, shared by
  fraction).

**Cross-cutting**
- **A server-side run endpoint.** v1.1 runs client-side, one metered Propagation per
  propagating Phase, budgets raised if use needs it (ADR-0019, Consequences). An endpoint
  that uploads the model once matters for large models and policy frontiers; it would port
  the step operator to Python.
- **Worker-level data is personal data.** The banca ore case keeps per-worker ledgers in its
  import script, pseudonymised, and sends only per-activity aggregates to the platform; the
  canvas works on those aggregates, and the ledger is the authority for per-worker claims.
  ADR-0007's persistence boundary applies unchanged.

---

## 8. Build plan (release v1.1)

Decided in the plan review of 2026-10-06; the decisions themselves live in ADR-0019/0020/0021
and requirements §9.6. Each slice ships on its own, schema-first (CLAUDE.md §6), with its
tests, its docs and the audit table (CLAUDE.md §8a) green.

**What the prototype hands over.** The tested pure modules carry over as they are:
`lib/timeline-plan.ts`, `lib/stock-math.ts`, `lib/element-filter.ts` and
`lib/temporal-simulation-text.ts`. The prototype's document schema is now the Zod
mirror `lib/schemas/temporal-simulation.ts` (slice 2). The window becomes the feature's UI; its banner and "What
this will do" panel go, and their text becomes the user-manual chapter.

| # | Slice | Needs | Done when |
|---|---|---|---|
| 1 | **Attribute Operations on Events** (ADR-0021) — *built 2026-10-06* | — | a hand-fired Event applies `set/add/mul/at_most/at_least` to one Element or a filter; Graph Diff and Scenario Baseline address the full path; Reset reverts it |
| 2 | **The Temporal Simulation in the project** — *built 2026-10-07* | 1 | `Project.temporal_simulation` (Timeline with `hour`, profile, Metrics) round-trips through file, sync and versions; the window edits it |
| 3 | **Step operator and Run View** — *built 2026-10-07* | 2 | a run on the IJDRR sample computes on its own copy with progress and cancel, shows any period read-only, and End run leaves the model byte-identical |
| 4 | **Stocks and storage** (ADR-0020) — *built 2026-10-07* | 3 (engine part: none) | the engine returns `served_ratio` and `stored`, allocates storage last and shares it by fraction; Stocks integrate per period; the Inspector edits a Stock |
| 5 | **Level Scale and Level Mode** | 4 | the Run View recolours by level or change, with the Analysis legend machinery |
| 6 | **Metrics and Scorecard** | 3 (coverage and stock level: 4) | the Run table shows Operativity, coverage, stock level and custom Metrics; CSV export; a period saves as a `temporal_simulation` Scorecard entry |
| 7 | **EPANET Temporal Simulation importer and samples** | 2, 4 | Net1 imports with tanks as storage and a starting simulation; the IJDRR and Net1 samples run end to end; banca ore runs locally |
| 8 | **Manual and reference docs** | all | user-manual chapter (`npm run docs:manual`), `api-reference.md` (`served_ratio`, `stored`), `local-first-guide.md` (Stock, `temporal_simulation`) |

**Slice 1.** Pydantic `ElementFilter` and `AttributeOperation` in `schemas/config.py`,
`EventDefinition.attribute_operations`; export and Zod. `lib/event-application.ts` applies
operations after `attribute_mutations`, in id order, rejecting an out-of-range result with a
warning. The differ and the Baseline key gain the path form. Config → Events gets an
operations editor reusing the FilterEditor and the profile row editor.

**Slice 2.** Pydantic `Timeline`, `Step`, `Phase`, `PhaseEvent`, `Metric` and the document;
`Project.temporal_simulation` (optional). `file-io` and sync carry it like the Scorecard.
The window binds to the project; the Text tab and the LLM copy work on the saved document. Built
as: the store keeps the window's draft and saves it into the project on every edit that
passes the schema; an edit that does not is listed in the window's status line and the
project keeps the last valid document, so a project file always loads. `ElementFilter` and
`AttributeOperation` moved to `lib/schemas/attribute-operation.ts`, a leaf module, because
the Project schema now holds them and `config.ts` imports `network.ts`.

**Slice 3.** `lib/step-operator.ts` runs ADR-0019 §2: Reset of a copy (both halves), per
period the profile, then per Phase its Events (vulnerabilities, mutations, operations), the
imposed layer, `buildPropagationPayload`, one `POST /api/propagate`, one diff per Phase.
Plan errors and schema errors block; a cancel, a budget refusal or an engine error discards
the run and names the period. The Run View paints the reconstructed period through Analysis
Mode's display path; the store refuses definition edits until End run or Reset. Tests: the
same IJDRR Timeline gives the same diffs twice; a reconstructed period equals the running
state; cancel leaves the model untouched. Built as: `lib/step-operator.ts` (pure; the engine
call is passed in), `lib/temporal-simulation-run.ts` (Reset copy, `runEphemeralPropagation`
with the Propagate scope, one abort controller per run), canvas-store's `modelLocked()` on
every model writer, and `hooks/useShownElements.ts` for the canvas views and the Inspector.
Building it corrected ADR-0019 §2: a Phase's Events resolve against the imposed layer, since
read against a shortage they could leave no record and their damage would vanish.

**Slice 4.** Backend first: the `Stock` union in `supply_capacity` and `Edge.capacity`, one
engine helper that fails on a stray Stock, `served_ratio` per consumer and Category, and the
storage stages (other sources, then storage sources, then fill sinks, sharing by fraction)
returning `stored`. Tests pin determinism with two tanks on one zone. Then the client:
`buildPropagationPayload` turns each Stock into numbers, the step operator integrates with
`lib/stock-math.ts`, the Inspector edits Stocks, and the two warnings land. Built as: the
engine counts a storage draw as one more supply while the fixed point runs (who receives
what does not depend on which source sent it), then `storage_exchange` orders draw and fill
once on the converged state; the client integrates in `lib/stock-integration.ts`, where a
node Stock's D is every delivery of its Category less what storage drew.

**Slice 5.** The Level Scale in Client Configuration (five default bands); Level Mode in the
Run View, Functionality ↔ Level and Level ↔ Change, via `lib/analysis-legend.ts`.

**Slice 6.** Metric evaluation per period over the run record, the three standard Metrics,
the CSV export, and the `temporal_simulation` Scorecard entry (Pydantic, Zod, the ADR-0006
union, its Scorecard card).

**Slice 7.** A second endpoint beside `POST /api/import/inp` maps tanks to storage and
writes the starting simulation from `[TIMES]`, `[PATTERNS]` and time-based `[CONTROLS]`,
reporting level-based controls as skipped; the Import dialog offers both importers. The
IJDRR sample gains its Timeline; Net1 joins `public/samples/manifest.json`.

**Order.** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8. The engine half of slice 4 needs nothing on the
client and can start beside slice 1.
