# ADR-0023 — Expectations: what the person knows, as checks the model must pass

**Status:** accepted (2026-10-21, release v1.2). Built: `schemas/expectation.py` ↔
`lib/schemas/expectation.ts`, `lib/expectations.ts` (the runner, pure), `lib/expectations-run.ts`,
`store/project-data-store.ts` (saved), `store/expectation-run-store.ts` (session results), the
Topbar's **Expectations** window, the *Calibrate against what you know* Recipe.

## Context

A CASCADE model is only as good as its match with the system it describes, and until now
nothing recorded what that system does. The only spec was the model itself, so neither a
person nor an LLM could tell a right model from a plausible one. The people who know the
system best (a director, an operations lead) cannot read `dependency_level` or a Phase, but
they can say "if the grid fails, the hospital runs 8 hours on its generators, then stops", or
"the June payout is about half the January balance". Release v1.2 puts an agent in the
modelling loop (ADR-0024), and an agent that edits a model needs a test it can run after each
edit to know whether the model got closer.

## Decision

**An Expectation is the person's statement plus a check** (`Project.expectations[]`:
`id`, `statement`, `check`, optional `provenance`). The check is one of:

- **`scenario`**: `events` applied in order to the Reset model (both halves, as a Temporal
  Simulation run starts), one Propagation, then optionally `advance_hours` passing (a Temporal
  Jump, `passTime`) and a second Propagation; then `assertions`, each on one Element (`element`)
  or every/any Element an Element Filter selects (`where`, `quantifier`), comparing a field
  (`path`, default Functionality) with a number, a boolean or a Functionality scale label.
- **`simulation`**: one of the project's Temporal Simulations runs through the step operator
  (ADR-0019) with its own scope, and one column of its Run table, at a `period` or as a
  `statistic` (end, mean, min, max, total, as Compare computes them), is compared with a
  number, within `tolerance` for `==`/`!=`.

These two cover the two kinds of knowledge a person brings: how the system reacts to a
disruption, and what a quantity does over time.

- **Run on a copy, never written.** The runner (`lib/expectations.ts`) is pure and takes the
  engine call as an argument, like model-based Analysis; the app passes `propagateSnapshot`
  with the check's scope. Each Propagation is an ordinary Engine Evaluation (ADR-0008); in one
  run, Expectations that share a scenario (the same Events, hours and scope) or a Temporal
  Simulation share its Propagations, charged to the first. The
  model, its history and the Scorecard are untouched. A result is kept for the session only:
  it describes the model as it was when the check ran, so saving it would let a stale pass
  look current.
- **Results are words.** One line per Element checked: its actual value against the expected
  one, and for a degraded Element its cause, by name, from the Responsibility Share. That line
  is what a calibration loop reads to choose the next edit, and what a person reads to see why.
- **A check that cannot run is an error, never a fail or a pass:** an unknown Event, Element,
  Canvas, Simulation, column or period, a label not on the scale, a filter selecting nothing,
  an engine error. A file whose Expectation names something the project lacks gets a
  `validateBundle` warning, as a dangling vulnerability does.
- **Provenance marks who wrote it.** An Expectation added through LLM Design or by an agent
  (`origin: "agent"`, ADR-0024) is unconfirmed until the person confirms the *statement*,
  meaning "yes, my system does this". The check's JSON is never what they are asked to read.
  `Provenance.origin` gains `agent` for this.
- **Calibrating means changing what the system is first.** The Calibrate Recipe and the Agent
  Kit tell an LLM to make a failing Expectation pass by changing topology and attributes (an
  edge, a Category, a dependency level, a backup, a capacity, a priority), to write a Specific
  Rule only for an agreement or procedure the person describes, and never to rewrite a statement
  to fit the model.
- **Saved and undoable like Series.** Expectations live in `project-data-store` and are saved
  by `toProject`. Every add, edit, confirm or delete is one Model Diff entry
  (`expectation:<id>`, ADR-0017 §1a). Plain changes add, update and delete them by id
  (`"add": "expectation"`). A shown Temporal Simulation run does not lock them, since they are
  not model inputs.

## Consequences

- `Project.expectations` is optional; a project that never used one keeps its file unchanged.
  The Propagation payload leaves it out with the Series and the Temporal Simulations.
- The copy/paste route works without an agent: Calibrate writes Expectations and changes, the
  person applies and runs them, and **Copy results for the LLM** hands the failures back.
- An Expectation is not a Rule and evaluates nothing the engine does: it reads the snapshot the
  engine returned (CLAUDE.md §7).
- Not built: per-Element tolerances on scenario assertions, and Expectations kept hidden from
  the agent as a held-out check. Both can be added without changing the schema's shape.
