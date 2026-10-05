# ADR-0019 — Temporal Simulation: a saved Timeline of Steps and Phases, recorded as Graph Diffs

**Status:** proposed (2026-10-02, revised 2026-10-05). Nothing is built. Reasoning, stress
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

### 1. A Timeline is a saved, replayable list of Steps

```
Timeline   name · steps[] · every[] · profile
Step       label · unit (day|week|month|quarter|year|none) · advance_hours · repeat (default 1) · phases[]
Phase      events[] (EventDefinition ids) · propagate (default true)
Periodic   every N periods · phase index · events[]
profile    { period label: [AttributeOperation, …] }   (ADR-0021)
```

- A **Step** is one period, or the same period pattern `repeat`ed. With a `unit`, repeats
  advance the label (`2023-03`, `2023-W09`, `2023-03-15`, `2023-Q1`, `2023`); with `none`
  they are numbered `label#2`, `label#3`. `Periodic.every` counts unrolled periods from the
  run's start.
- A **Phase** applies its Events, then optionally runs one Propagation. Phases exist so an
  Event can fire between two Propagations of one period: to isolate an Event read on its own
  (a settlement), or to measure a period twice. Each Propagation re-solves from scratch, so
  a Phase sets no preference between supplies.
- The **profile** holds the per-period exogenous inputs as Attribute Operations keyed by
  period label, so it uses ADR-0021's addressing and validation and adds no second write
  mechanism.
- **`advance_hours` is elapsed time**, read only by reserves (§2a). A Timeline carries no
  Temporal Jump Events; each period's `advance_hours` is its jump. Rates and stocks are per
  period and involve no hours.
- **The Timeline stores inputs only.** The **Event is the only edit handle**: a mid-Timeline
  change is an Event (or profile operation) added or changed at a Step, and the run replays
  forward from that period.
- The Timeline and its profile live **in the project file** under their own key: the
  profile is input, roughly model-sized (~40 KB for banca ore), and ADR-0017's
  single-downloadable-file principle applies.
- The Timeline is authored as an **editable table** of Steps and Phases; a draggable track
  is not ruled out later.

### 2. The step operator, one period in order

The step operator is client-side and calls the existing `POST /api/propagate` once per
propagating Phase. The engine changes only to return `served_ratio` (ADR-0020).

```
run(timeline):
  Reset                                    # one undoable scenario_reset: every run starts
                                           # from the authored model, every Element operational
  for each period p:
    apply profile[p.label]                 # set/add/… operations on rates, inflows, …
    for each Phase k of p:
      apply the Phase's Events, then Periodic Events for (p, k)
                                           # vulnerabilities, mutations, then operations;
                                           # each updates the imposed layer (§2a)
      if k.propagate:
        reset functionality and responsibility_share to the imposed layer
        set functionality_time to 0 on every Element
        payload = buildPropagationPayload(state, reserves)
                                           # each Stock → its supply number (ADR-0020 §2);
                                           # each backed Category → remaining reserve,
                                           # backup off once spent
        apply the Propagation result; keep served_ratio
        if k is p's last propagating Phase:
          integrate every Stock once        # ADR-0020 §2; spilled / unmet recorded
      record the Phase's diff
    close the period:
      Elements with functionality_time > 0 are in shortage:
        drain their reserves by p.advance_hours; a reserve at 0 is spent,
        and the Element shows Functionality 1
      every other Element's reserves refill in full (v1)
      record the closing diff
  push one temporal_simulation_run entry (net diff of the run)
```

Integration runs right after the **last propagating** Phase, so a later non-propagating
Phase (a settlement) reads the period's closing balance. Reserves close the period because
time passes over it while the shortage holds.

**Stocks become numbers in one seam.** `buildPropagationPayload` (`lib/propagation-payload.ts`)
is the builder the Propagate button, model-based Analysis (single and batch), the Scorecard
and the step operator all use, so no engine request ever carries a `Stock`.

### 2a. Recovery, reserves and repair between periods

Propagation only worsens Functionality, and ADR-0003 assigns improvement to the timeline.

- **Imposed layer.** For each Element the step operator tracks the Functionality and
  Responsibility Share last written by an Event in this run, or the post-Reset value. Before
  every Propagation both fields return to it. Shortage-driven degradation is therefore
  recomputed from the current supply each time; Event-imposed state, `direct_damage`,
  `expected_repair_time`, Rule-set attributes and Stocks stand. The Scenario Baseline cannot
  serve here: it keeps a field's first write only.
- **Reserve state**, per (Element, backed Category), is run state outside the graph. The
  engine never clears a running `functionality_time`, so carrying it across periods would
  drain a reserve after its shortage ended. Instead each Propagation starts from countdown 0
  with the remaining reserve sent as `backup_duration`; a countdown the Propagation sets marks
  the Element in shortage; the period's close drains or refills as in §2. A spent reserve is
  sent as no backup, so the next Propagation degrades the Element from its actual supply, and
  the Element recovers like any shortage once supply returns.
- **Repair is an Event.** Nothing counts `expected_repair_time` down. A repair completing in
  period *t* is an Event in Step *t* (`set` `direct_damage` false and `functionality` to the
  top level). Automatic repair stays deferred (requirements §16).

### 3. Recording: a run record of diffs, and one history entry per run

- **The run record** holds the start state (one snapshot), per period **one Graph Diff per
  Phase and one closing diff** (the ADR-0017 machinery; the profile's writes belong to the
  first Phase's diff), and per period the deliveries of each propagating Phase and the
  `spilled`/`unmet` amounts. **No PNG per period.** A period's net change is the composition
  of its diffs.
- **The run record is a cache.** It is persisted beside its Timeline with a content hash of
  the model, Timeline and profile; a mismatch marks it stale. It is kept because recomputing
  costs an Engine Evaluation per propagating Phase.
- **One `update_history` entry per run.** History is capped at `HISTORY_LIMIT = 20` and the
  Scenario Baseline folds it, so per-period entries would evict the Reset that started the
  run. The run is one Any Graph Update of `update_type` `temporal_simulation_run` holding the
  net diff from start to end. CTRL+Z undoes the whole run.
- **Clear Event treats a run as one Event.** Ctrl+R picks the newest `event_applied` or
  `temporal_simulation_run` entry; on a run it reverts the net diff, landing on the post-Reset
  state. The Situation lists a run as one item named by its Timeline.
- A period's full state is **reconstructed on request** by walking the diffs forward from
  the start state, the same primitive a mid-Timeline replay uses. No keyframes.
- **A metric at period *t* reads period *t* and earlier only.** Centred averages and
  normalisation against the run's final maximum are post-hoc summaries.

### 4. Custom Metrics are view definitions in Client Configuration

```
Metric   name · target (node filter: type, category, canvas, …) · attribute
         · read: state | change · phase (optional; for change, absent = the period)
         · aggregate: sum | mean | min | max | count | share_where | percentile(p)
         · filter (optional predicate on the attribute)
```

`read: change` is **after − before** over the chosen Phase or period, which is how a
settlement's cash outlay is a Metric. A Metric has no formula language; if free text is ever
wanted it extends `shared/rule-grammar.json` in that one file. A Metric is presentation
arithmetic over recorded state and is no Rule, so evaluating it client-side leaves
CLAUDE.md §7 intact.

### 5. Reset ends a simulation, through the Scenario Baseline

The Baseline fold tags a `temporal_simulation_run` entry **`simulation`**, a fourth source
tag beside `event:<id>`, `propagation` and `manual` (ADR-0016). Everything inside a run is one
writer from history's point of view. Reset's second half reverts `simulation` entries with
the machine-written ones, so every Stock returns to its pre-run level; Reset also ends the run
and its Level Mode. A hand edit of a Stock is authoring work and survives, because the differ
addresses a Stock field by its full path (ADR-0020).

### 6. A Level Scale shows a stock, orthogonal to Functionality; Level Mode recolours like Analysis

Functionality only worsens and is derived by the engine, so it cannot show an accumulation
whose extremes are both problems. A **Level Scale** in **Client Configuration** (never sent
to the backend) is an ordered list of bands over the signed ratio `value / reference`, each
with a label and a brand colour token; the default has five (large deficit, deficit,
balanced, surplus, large surplus). The reference belongs to the Stock: by default its own
bound `max(|min|, |max|)`, overridable by `Stock.level_reference` (level) and
`Stock.change_reference` (a period's change). A Stock with neither is left neutral and the
legend says so.

**Level Mode**, available only inside a Temporal Simulation, recolours the canvas by the
Level Scale as Analysis Mode does by a score; the legend swaps; Reset clears it. A switch
flips Functionality ↔ Level, and within Level between the stock's level and its change over
the period (`read: change`). Selecting a period repaints from the reconstructed state. A
node Stock colours its node and an edge Stock colours its edge. **Display only**: it feeds
no Rule, Operativity Score or Recovery Value. A Scorecard entry saved from a simulation
**stores the per-element values it shows** (level or change, and the reference used), so it
repaints in Level Mode later.

## Consequences

- New Pydantic models (Timeline, Step, Phase, Periodic, Metric, Level Scale) →
  `export_json_schema.py` → Zod → `pydantic-mirror.test.ts`, per CLAUDE.md §6.
- ADR-0016 gains the `simulation` source tag (Reset's second half reverts it), and Clear
  Event's target becomes "the newest Event or run". `AnyUpdateEntry` gains
  `temporal_simulation_run`. `deriveSituation` lists a run as one item.
- **The step operator is client-side in v1.** A 44-period run with two propagating Phases
  is 88 sequential Propagations, each an Engine Evaluation (ADR-0008), multiplied by policy
  variants; the batch endpoint cannot help because periods depend on each other. A
  server-side run endpoint behind `propagation_service` and the entitlement accounting for a
  run are open.
- `buildPropagationPayload` gains the reserve override (§2a) beside the Stock conversion.
- `functionality_time` converges onto the Stock mechanism **last**: it is well-tested core
  behaviour with no e2e driver. The reserve state of §2a is the first step.
- **Level Mode** reuses the Analysis Heatmap's legend and repaint machinery
  (`lib/analysis-legend.ts`).
- **CONTEXT.md** gains Temporal Simulation, Timeline, Step, Phase, Level Scale and Level
  Mode; "Simulation" as a bare word is retired in favour of Propagation and Temporal
  Simulation.
- **Open (design doc §7):** whether `PropagationScorecardEntry` migrates to diffs and whether
  a simulation Scorecard entry is a new type in ADR-0006's union; automatic repair;
  per-Category reserve draining.
