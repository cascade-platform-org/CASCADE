# ADR-0019 — Temporal Simulation: a saved Timeline of Steps and Phases, recorded as Graph Diffs

**Status:** accepted (drafted 2026-10-02, revised 2026-10-05: no period duration; Temporal-Simulation-only Events; plain-text form; revised and accepted 2026-10-06: one per project with its Metrics; a run is a read-only Run View on its own copy, not saved; client-side runs with progress and cancel; hour unit; profile grid; release v1.1). Built in release v1.1 (build plan: `temporal-simulation-design.md` §8). Reasoning, stress
tests and open questions: `docs/project/temporal-simulation-design.md`. Requirements: §9.6.

## Context

A **Temporal Jump** (requirements §9) already is a step loop hardcoded for one stock,
`functionality_time`. A jump sequence is an interactive trail through `update_history`: it
cannot be named, replayed or compared with a variant. Multi-period questions (staged
hazards, maintenance windows, seasonal load, a workforce ledger over 44 months) need a
sequence that is an object.

Recording is the hard constraint. A `PropagationScorecardEntry` stores three snapshots and
three PNGs; 44 periods × several policy variants recreates the problem ADR-0017 measured
(history at 97.6% of the project file).

## Decision

### 1. A Timeline is a saved, re-runnable list of Steps

```
Timeline   name · steps[] · profile
Step       label · unit (hour|day|week|month|quarter|year|none) · repeat (default 1) · phases[]
Phase      events[] · propagate (default true)
events[i]  EventDefinition id  |  { event: id, every: N }   (a bare id = every 1)
profile    { period label: [AttributeOperation, …] }   (ADR-0021)
```

- A **Step** is one period, or the same period pattern `repeat`ed. With a `unit`, repeats
  advance the label (`2023-03-15T08`, `2023-03-15`, `2023-W09`, `2023-03`, `2023-Q1`,
  `2023`); with `none`
  they are numbered `label#2`, `label#3`.
- A **Phase** applies its Events (by `EventDefinition` id), then optionally runs one Propagation.
- A run is refused while a period has no valid label or two periods share one (the profile
  could not tell them apart); a Step with no Phase, or an `every` larger than its Step, is
  only a warning.
  **An Event in a Phase fires every period of its Step, or every N-th** (`every: N`: the
  Step's periods N, 2N, 3N…, counted within the Step). A separate Periodic rule, counted
  from the run's start across Steps, was dropped: it duplicated the Phase for a rare
  cross-Step case, which is now one entry per Step. Phases exist so an
  Event can fire between two Propagations of one period: to isolate an Event read on its own
  (a settlement), or to measure a period twice. Each Propagation re-solves from scratch, so
  a Phase sets no preference between supplies.
- The **profile** holds the per-period exogenous inputs as Attribute Operations keyed by
  period label, so it uses ADR-0021's addressing and validation and adds no second write
  mechanism.
- **A period has no duration.** Simulated time passes only through Temporal Jump Events
  the modeller places in a Phase, with the hours they choose; only
  `functionality_time` reads them. Rates and stocks are per period and involve no hours.
- **The Timeline stores inputs only, and every change over time is authored before the
  run**, as a profile value or a Phase Event: "at period 5" is an Event in period 5. **While
  a run is on the canvas, the model and the Temporal Simulation are read-only** (browsing
  periods, the Functionality ↔ Level switch and saving a period to the Scorecard stay
  available); Reset ends the run, and every run starts from the beginning. There is no
  partial replay.
- A project holds **one** Temporal Simulation, in the project file under its own key
  (`Project.temporal_simulation`): the whole document of §7 (Timeline, profile, Metrics); the
  run record is not saved (§3). The profile is input, roughly model-sized (~40 KB for banca ore), and
  ADR-0017's single-downloadable-file principle applies. A variant to compare is another
  project version or a copy of the project.
- The Timeline is authored as an **editable table** of Steps and Phases; a draggable track
  is not ruled out later. The profile is a **grid on the same period columns**: one row
  per operation (target, path, op), one cell per period. A written value stays in later
  periods, so an empty cell of a `set` row shows the carried value; a value over several
  periods is several filled cells, and a profile entry has no period range.
- **An Event used only in Timelines is marked `temporal_simulation_only`** (an additive
  `EventDefinition` field, any type). It is hidden from the Action Bar and from the
  Scorecard's uncovered-Event list, and only such an Event may be a Temporal Jump in the
  Config Events tab — the way a Timeline advances time. Each Phase's **Create new
  Event** opens Config → Events on a new one, which joins that Phase when Config is saved. A flag rather than a fourth `type`: a
  Temporal-Simulation-only Event can itself be a Hazard, a Disservice or a Temporal Jump.

### 2. The step operator, one period in order

The step operator is client-side and calls the existing `POST /api/propagate` once per
propagating Phase. The engine changes only to return `served_ratio` and each storage's
`stored`, and to allocate storage last (ADR-0020 §1c, §3).

```
run(timeline):
  state = Reset(copy of the model)         # the run's own copy, both halves of Reset: the
                                           # authored model, every Element operational;
                                           # the live model and its history are never written
  for each period p:
    for each Phase k of p:                 # a Step with no Phase: one non-propagating Phase
      events = the Phase's Events that fire in p (every N: p's place in its Step is N, 2N…),
               after profile[p.label] for k = 1  # set/add/… operations on rates, inflows, …
      imposed = apply events to (state with functionality and responsibility_share
                                 reset to the imposed layer)
                                           # vulnerabilities, mutations, then operations
      imposed layer = imposed's functionality and responsibility_share (§2a)
      if k.propagate:
        state = imposed
        payload = buildPropagationPayload(state)
                                           # each Stock → its supply number (ADR-0020 §2)
        apply the Propagation result; keep served_ratio
        if k is p's last propagating Phase:
          integrate every Stock once        # ADR-0020 §2; spilled / unmet recorded
      else:
        apply events to state             # the period's shortage stays on view
      record the Phase's diff
  keep the run record; show the Run View (§3)
```

Events resolve against the imposed layer. A vulnerability applies only where it worsens,
so an Event read against the last Propagation's output would leave no record in the layer
for an Element a shortage had already degraded, and its damage would vanish the moment
supply returned. (Found while building, 2026-10-07.) The profile rides in the first Phase as one
more Event, which is why its writes belong to that Phase's diff.

Integration runs right after the **last propagating** Phase, so a later non-propagating
Phase (a settlement) reads the period's closing balance. A Temporal Jump is one of the
Phase's Events and applies like any other.

**Stocks become numbers in one seam.** `buildPropagationPayload` (`lib/propagation-payload.ts`)
is the builder the Propagate button, model-based Analysis (single and batch), the Scorecard
and the step operator all use, so no engine request ever carries a `Stock`.

### 2a. Recovery, backups and repair between periods

Propagation only worsens Functionality, and ADR-0003 assigns improvement to the timeline.

- **Imposed layer.** For each Element the step operator tracks the Functionality and
  Responsibility Share last written by an Event in this run (a Temporal Jump's expiry
  included), or the post-Reset value. Before
  every Propagation both fields return to it. Shortage-driven degradation is therefore
  recomputed from the current supply each time; Event-imposed state, `direct_damage`,
  `expected_repair_time`, `functionality_time`, Rule-set attributes and Stocks stand. The Scenario Baseline cannot
  serve here: it keeps a field's first write only.
- **Backups keep today's Temporal Jump semantics.** A jump subtracts its hours from every
  positive `functionality_time` and expires a countdown at 0 to Functionality 1, which then
  stands until an Event restores it. The engine never clears a running countdown, so one keeps
  draining after its shortage ends; a model where supply returns first clears it with an
  Event (`set` `functionality_time` 0). Tracking reserves per Element was considered and left
  out: it costs run state and a payload override for a behaviour no model needs yet.
- **Repair is an Event.** Nothing counts `expected_repair_time` down. A repair completing in
  period *t* is an Event in Step *t* (`set` `direct_damage` false and `functionality` to the
  top level). Automatic repair stays deferred (requirements §16).

### 3. Recording: a run record of diffs, shown in the Run View; the model is never edited

- **The run record** holds the start state (one snapshot), per period **one Graph Diff per
  Phase** (the ADR-0017 machinery; the profile's writes belong to the first Phase's diff, the
  Stock integration to the diff of the Phase it follows), and per period the deliveries of each propagating Phase and the
  `spilled`/`unmet` amounts. **No PNG per period.** A period's net change is the composition
  of its diffs.
- **The run record lives in memory for the session and is not saved** (decided
  2026-10-06). Reopening a project means running again; a saved run would add megabytes to
  every save, sync and download plus a content hash to tell when it is stale. A result worth
  keeping is a period saved to the Scorecard.
- **A run is a read-only view** (decided 2026-10-06). It computes on its own copy and
  never writes the live model or `update_history`. The **Run View** shows it as Analysis Mode
  shows a score: the canvas paints the selected period's reconstructed state, read-only.
  Leaving it (Reset, or End run) shows the model exactly as it was. A run therefore needs no
  history entry type, no Scenario Baseline tag and no Clear Event rule; a cancelled or failed
  run has nothing to undo; and ADR-0016 is unchanged. Turning a period's state into the
  working model ("Keep this period as the scenario", one ordinary history entry) is left out
  of v1.1.
- A period's full state is **reconstructed on request** by walking the diffs forward from
  the start state. No keyframes.
- **A metric at period *t* reads period *t* and earlier only.** Centred averages and
  normalisation against the run's final maximum are post-hoc summaries.

### 4. Custom Metrics are view definitions inside the Temporal Simulation

```
Metric   name · target (an ElementFilter, ADR-0021) · path
         · read: state | change · phase (optional, 1-based; for change, absent = the period)
         · aggregate: sum | mean | min | max | count | share_where | percentile (+ percentile)
         · value_filter (optional {cmp, value}; also the predicate of share_where)
```

`read: change` is **after − before** over the chosen Phase or period, which is how a
settlement's cash outlay is a Metric. A Metric has no formula language; if free text is ever
wanted it extends `shared/rule-grammar.json` in that one file. A Metric is presentation
arithmetic over recorded state and is no Rule, so evaluating it client-side leaves
CLAUDE.md §7 intact.

**Three standard Metrics ship** (decided 2026-10-06), each a Run-table column beside the
custom ones:
- **Operativity Score**, as the Scorecard computes it, at each period's end state;
- **coverage** per Category: delivered ÷ demand over the Category's consumers, from
  `served_ratio` (ADR-0020 §3), at the period's last propagating Phase;
- **stock level** per Category: the signed sum of its Stocks' levels at the period's end
  (water stored, hours owed).

**Series leave as CSV.** The Run table (periods × Metrics) exports as CSV; post-hoc
summaries (averages, normalisation against the run's maximum) are left to the spreadsheet.

**A period saved to the Scorecard is a new `temporal_simulation` entry** in ADR-0006's union.
A `propagation` entry would carry a meaningless "before" (the run's reset start), and the
run record is not saved, so the entry holds what it shows: the Timeline's name and the
period's label, the period's end-state snapshot (from which the Scorecard derives
Operativity as for any entry), the custom and coverage Metric values at that period
(computed at save, since the run that produced them is not kept), the Level Mode values per
Stock with the reference used, and a PNG. `PropagationScorecardEntry` does not migrate to
diffs.

### 5. Reset ends the Run View

Reset, or End run, leaves the Run View and its Level Mode. The model never changed, so
nothing is reverted: every Stock shows its authored level again. An earlier draft ran on the
live model, landed as one `temporal_simulation_run` history entry and reverted through a
fourth Scenario Baseline tag, `simulation`; once the model became read-only during a run,
that machinery protected nothing.

### 6. A Level Scale shows a stock, orthogonal to Functionality; Level Mode recolours like Analysis

Functionality only worsens and is derived by the engine, so it cannot show an accumulation
whose extremes are both problems. A **Level Scale** in **Client Configuration** (the engine
never reads it) is an ordered list of bands over the signed ratio `value / reference`, each
with a label and a brand colour token; the default has five (large deficit, deficit,
balanced, surplus, large surplus). The reference belongs to the Stock: by default its own
bound `max(|min|, |max|)`, overridable by `Stock.level_reference` (level) and
`Stock.change_reference` (a period's change). A Stock with neither is left neutral and the
legend says so.

As built, the Level Scale is `ModelConfiguration.level_scale` (bands of label, upper bound
and brand token, edited under Config → Functionality Scale). Level Mode paints through the
same per-Element colour map as the Analysis Heatmap; a node with several Stocks shows the
most extreme ratio, and an Element without a Stock recedes to a light grey.

**Level Mode**, available only inside a Temporal Simulation, recolours the canvas by the
Level Scale as Analysis Mode does by a score; the legend swaps; Reset clears it. A switch
flips Functionality ↔ Level, and within Level between the stock's level and its change over
the period (`read: change`). Selecting a period repaints from the reconstructed state. A
node Stock colours its node and an edge Stock colours its edge. **Display only**: it feeds
no Rule, Operativity Score or Recovery Value. A Scorecard entry saved from a simulation
**stores the per-element values it shows** (level or change, and the reference used), so it
repaints in Level Mode later.

### 7. One definition, two forms: the window and plain text

The whole definition — Timeline, profile and Metrics — is one document,
`{"format": "cascade.temporal-simulation/v1", timeline, profile, metrics}`, validated by one
schema whether it is edited in the window or pasted as JSON. Objects are strict, so a
misspelt key is an error; a reference this project cannot satisfy (an unknown Event id, a
missing Element, a filter matching nothing) is a warning, and the text still applies.
Pasting accepts bare JSON or a whole LLM reply (the first fenced `json` block). **Copy with
context** produces a prompt an LLM can act on from zero: a primer (what CASCADE models,
how a run executes, which field paths an operation can reach, how filters and Metrics
work), the format reference, a worked example that the test suite validates, this
project's Functionality scale, Categories, Events and Canvases, the Element list with
current supplies, demands and capacities (up to 300 Elements), and the current definition. Text is the bulk and LLM route; the window remains the route
that explains each control.

## Consequences

- `EventDefinition.temporal_simulation_only` lands ahead of the rest (Pydantic, JSON Schema,
  Zod; Action Bar, Scorecard and Events tab). The document schema is
  `schemas/temporal_simulation.py`, mirrored by `lib/schemas/temporal-simulation.ts`.
- `Project` gains `temporal_simulation` (optional, one per project); the Level Scale stays in
  Client Configuration as a display preference.
- New Pydantic models (Timeline, Step, Phase, PhaseEvent, Metric, ElementFilter, Level Scale) →
  `export_json_schema.py` → Zod → `pydantic-mirror.test.ts`, per CLAUDE.md §6.
- ADR-0016, `AnyUpdateEntry`, Clear Event and `deriveSituation` are unchanged: a run never
  enters `update_history` (§3).
- **The step operator is client-side** (decided 2026-10-06 for v1.1). Each Propagation is an
  ordinary engine call, metered as one Engine Evaluation (ADR-0008): a 72-hour run with two
  propagating Phases is 144, well inside a role's per-minute budget, which is raised if real
  use needs it. A run shows its progress and can be cancelled; a cancel, a budget refusal or
  an engine error discards it and names the failing period. The model is never touched. A
  server-side run endpoint (one upload instead of one per Propagation) is deferred: it would
  port the whole step operator to Python.
- `functionality_time` converges onto the Stock mechanism **last**: it is well-tested core
  behaviour with no e2e driver.
- **Level Mode** reuses the Analysis Heatmap's legend and repaint machinery
  (`lib/analysis-legend.ts`).
- **CONTEXT.md** gains Temporal Simulation, Timeline, Step, Phase, Run View, Stock, Level
  Scale, Level Mode, Attribute Operation and Element Filter; "Simulation" as a bare word is retired in favour of Propagation and Temporal
  Simulation.
- ADR-0006's Scorecard union gains a `temporal_simulation` entry (§4).
- **Open (design doc §7):** automatic repair; backups whose countdown stops when supply
  returns.
