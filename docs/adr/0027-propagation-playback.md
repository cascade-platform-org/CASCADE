# ADR-0027 — Propagation Playback: the engine's rounds, replayed

**Status:** accepted (2026-11-16)

## Context

A Propagation returns the converged state and a round count. Users asked to
watch the cascade happen: round by round, and, for SourceToDemands categories,
the flow travelling from the Sources to the demand, with a consumer changing as
too little arrives. The frontend cannot reconstruct any of this: it would mean
re-running propagation logic outside `engine/`, which CLAUDE.md §7 forbids.

The engine's loop (ADR-0003) shapes what can be shown truthfully. Each round:
effective edge levels refresh from their sources (ADR-0004); one flow solve
per SourceToDemands category on the state at the round's start; then one pass
over the nodes in list order, each committing at once (later nodes see it).
Rounds repeat until one changes nothing.

Two alternatives were set aside:

- **Cascade waves** (a step per link of the causal chain from the Event),
  shown with a flow re-solved per wave. Easier to read, but the flow drawn
  would be one the engine never computed, and could show a consumer served
  that the engine degraded.
- **Changing the engine** to alternate logical-to-convergence and
  flow-to-convergence phases. That would change results; the animation must
  show the engine as it is.

## Decision

**Show the engine as it is: one slider tick per engine round.**

**Engine (opt-in).** `PropagationRequest.trace` (default false) makes the
result carry `rounds`, one `PropagationRound` per round:
- `flows`: Category → edge → amount — one routing of what that round's solve
  delivered (`engine/flow.py::route_flows`: the delivered amounts held fixed,
  one min-cost solve preferring short paths). Allocation fixes who receives
  how much; the routing is a picture of it, never an input.
- `served_ratio`: that round's solve.
- `changes`: every Functionality change in commit order, each with its
  `cause` — `edge` (refresh at the round's start), `flow`, `logical`, `rule`
  (specific-rule override) or `backup` (drop deferred into
  functionality_time, level held) — and its responsibility share.

The record observes the loop and never feeds back into it: with `trace` the
rest of the result is identical, and replaying `changes` in order reproduces
`updates` (`test/test_engine_trace.py`, over the shipped samples). Without
`trace` the result is unchanged and no larger.

**Frontend.** An **Animate** switch beside Propagate, a preference of this
browser (localStorage), off by default. With it on, Propagate sends `trace`,
applies the result to the model as always, and — when the run lowered at
least one node (a `flow`, `logical` or `rule` change; edges catching up and a
backup countdown alone do not count) — opens a **Propagation Playback** over
the canvas (`lib/propagation-playback.ts` lays the rounds
out as frames; `store/playback-store.ts`; `components/canvas/playback-*`):

- per round, **one flow screen**: edges take their sources' levels; then
  the round's flow leaves the Sources as balls in the Category's colour, a
  ball's area proportional to what its edge carries (relative to the largest
  amount that Category carries in the run). The timing lives inside the
  screen, never in extra screens: the front crosses one edge per hop-time
  (2.8 s at 1×), an edge's balls leave when the front reaches its source and
  each crosses the edge in one hop-time, and a consumer whose change the flow
  decided changes as the balls land;
- then the **logical changes**: the other changes in the engine's commit
  order, each pulsing along the edges from the elements responsible for it
  (a long phase is grouped into at most 40 steps);
- **Converged**, the canvas as the model holds it, with the final flow
  standing. The engine's last round re-solves the same flow and lowers no
  node — that is how it knows it converged — so it is this screen rather
  than a round of its own.

On a screen that degrades something, its **targets** stay at full strength
and every other node and edge fades to 25% at once, so what is about to
change stands out before it does; the balls and pulses never fade. Each
target takes its new colour only when its animation ends: the balls landing
on it, or the pulse from its cause arriving (1.4 s at 1×). The fade marks
the targets, so no ring or ripple is added to them. A view with none of the
screen's targets on screen (on another Canvas, or panned away) fades nothing,
so a Canvas never goes uniformly pale. Converged fades nothing.

The playback paints through the SnapshotColors context (as Level Mode does)
and never writes the model. Done closes it; any change to the model, other
than moving a node, ends it.

## Consequences

- `PropagationResult` gains an optional field and `PropagationRequest` a
  flag; Zod mirrors both. Batch requests inherit the flag but the client never
  sets it there.
- A traced run costs one extra min-cost solve per SourceToDemands category
  per round.
- The flow front's timing is by hops from the Sources, a drawing choice: the
  engine's solve has no notion of travel time.
- Changes the flow decided are shown in the flow phase even when the engine
  committed them after a logical change of the same round; their level was
  fixed by the round's solve, which precedes the node pass.
- Not animated: Temporal Simulation runs and Analysis, which have their own
  views.
