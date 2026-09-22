# ADR-0013 — EPANET-mode canvas: a second, non-engine solve path for `.inp` imports

**Status:** accepted (2026-07-12)

## Context

While validating the propagation engine for a research paper, we found and
fixed a real bug: `engine/flow.py`'s min-cost-max-flow allocation had been
reformulated (a prior optimization) as a min-cost circulation, reasoning that
the priority-reward structure makes cost-minimization and flow-maximization
the same objective. That reasoning is correct only in aggregate — the two
solvers reach the identical total delivered flow and total cost, but under
scarcity with tied allocations (multiple equal-priority consumers reachable
through equal-friction paths, which capacity-targeted attacks on shared trunk
infrastructure routinely produce) they can select *different* tied-optimal
solutions, disagreeing on which specific junction receives the water. This
was invisible to aggregate validation metrics and was only caught by
comparing individual scenarios against real WNTR/EPANET hydraulics in a
Python harness (`experiments/aqueducts/validate_faithfulness.py`).

The owner wants to see this same comparison live, inside the CASCADE app,
without leaving the UI or writing a script: import a `.inp` network, let
CASCADE propagate it normally, then flip a switch and see what a live EPANET
solve says instead for the identical intervention.

## Decision

A Canvas's `graph.graph_type` gains a **reserved value**, `"epanet"`. When a
canvas has this graph_type, `services/propagation_service.py::propagate`
branches before submitting to the engine's thread pool and instead runs a
live WNTR/EPANET solve (`services/epanet_solve_service.py`) against the
original `.inp` file, returning the identical `PropagationResult` shape the
frontend already renders. Switching the graph_type to anything else resumes
normal engine propagation with no other change.

Three sub-decisions, each with a real constraint driving it:

1. **The original `.inp` travels as embedded content, not a path.**
   (Revised 2026-07-13, superseding the first implementation's manually-typed
   server path.) The browser already holds the picked file's full text at
   import time, so it is stamped automatically onto the canvas
   (`Canvas.source_inp_content`) and travels inside the project JSON like
   everything else — fully local-first, zero user input, works on hosted
   deployments. The alternatives both lost: a **filesystem path** cannot be
   auto-captured (a browser file picker never exposes a real path, only the
   bare filename — a browser security restriction), so it was a manually
   typed field that only resolved on local/self-hosted setups where backend
   and file share a filesystem; a **server-side copy** made at import would
   have broken the import endpoint's nothing-persisted property and raised
   retention/deletion questions for the anonymization-sensitive real utility
   files. Cost of embedding: the project file and each epanet-mode
   propagation request grow by the `.inp`'s size (tens of KB for real
   aqueduct exports — acceptable). A canvas without embedded content (e.g.
   imported before this feature) fails the propagation request with a clear
   error (`ValueError` → HTTP 422), not a silent fallback to the normal
   engine.

2. **Dispatch is a reserved string, not new `GraphTypeConfig` semantics.**
   `graph_type` normally names a `ModelConfiguration.graph_types` entry
   defining a heuristics pipeline; `"epanet"` is checked directly in
   `propagation_service.py` instead, since it doesn't select a heuristics
   pipeline at all — it bypasses the engine entirely. Both graph-type
   pickers in the frontend (`canvas-meta.tsx`, `tab-graph-types.tsx`'s
   per-canvas selector) offer `"epanet"` as a hardcoded option alongside the
   configured `graph_types` list, the same way they already hardcode
   `"— none —"`. It is deliberately **not** offered on the global-view
   selector: global Propagation composes multiple graph types' heuristics by
   design, which has no live-EPANET equivalent.

3. **Canvas edits are translated by full binarization, not graded scaling.**
   EPANET has no notion of a 60%-degraded pipe or junction, so any imported
   element (one carrying `properties.inp_id`) below the functionality
   scale's max level is treated as **fully broken** in the EPANET solve —
   this is the only faithful translation, not an approximation of a graded
   one. A link-bearing element (`properties.kind` in `pipe`/`pump`/`valve`)
   maps to closing its own `.inp` link id directly; a non-link element
   (`junction`/`reservoir`/`tank`) maps to closing every link touching it —
   generalizing the same mechanism
   `experiments/aqueducts/validate_faithfulness.py::_tank_situations` already established
   for "how do you fully take a non-link element out of service." An element
   with **no** `properties.inp_id` (a CASCADE-only addition with no EPANET
   counterpart, e.g. a manually added node) cannot be represented in an
   EPANET solve at all; it is skipped, and the response's `warnings` name it
   explicitly rather than silently ignoring it — this is also what backs the
   UI's "canvas edits are not reflected" banner with a concrete, inspectable
   list when it applies.

### Engine-boundary discipline (ADR-0009) is preserved, not expanded

`services/propagation_service.py` stays the **only** file that imports from
`engine/` — ADR-0009's stated goal is that a future extraction of the engine
into a private submodule/service is a one-step change touching only that
seam. `services/epanet_solve_service.py` (the new WNTR solve logic) is
deliberately engine-import-free: it returns raw served *ratios*, not
Functionality *levels*. The ratio-to-level quantization
(`engine.flow._ratio_to_level` — the same rule the normal flow heuristic
uses, so "what CASCADE says" and "what EPANET says" are a fair,
apples-to-apples comparison rather than one measuring rounding drift) is done
by `propagation_service.py` itself, after calling `epanet_solve_service`.
This was a correction made during implementation — an earlier draft of this
feature had `epanet_solve_service.py` import `engine.flow._ratio_to_level`
directly, which would have made it a second production seam and broken the
one-step-privatization property. The import-linter contract
(`CASCADE-backend/pyproject.toml`) needed no changes at all: the corrected
split keeps `services.epanet_solve_service` outside `engine.*` entirely,
verified by `lint-imports` passing unchanged.

**Amendment 2026-09-10 — the invariant is now tested, not merely asserted.**
Two properties carry the fair comparison, and until now both were prose:

- *One rule, applied once.* `test_epanet_levels_use_the_engines_own_quantization`
  drives a full EPANET-mode `propagate()` with the solve stubbed to known served
  ratios and asserts every resulting Functionality level equals
  `engine.flow._ratio_to_level(ratio, N)`. The ratios sit on both sides of each
  level boundary, because that is where an alternative rounding rule diverges:
  replace `ceil` with the obvious-looking `round` and only the 0.6667 case
  fails (`ceil(2.0001) = 3`, `round(2.0001) = 2`) — verified by mutation, and
  the sole reason the boundary values are chosen rather than mid-band ones.
- *Nothing quantizes twice.* `test_epanet_solve_returns_ratios_not_levels`
  asserts `solve_epanet_snapshot` returns values in [0, 1], so a level cannot
  leak out of the service that is forbidden to compute one.

The engine-import half of the split needs no test of its own: import-linter
already fails the build if `services.epanet_solve_service` imports `engine.*`.
What it could not catch is a *reimplementation* of the rounding rule inside this
file, which is what the first test above pins.

## Consequences

- `Canvas` gains two new optional fields (`source_inp_content`,
  `source_inp_demand_mode`), Pydantic-first per CLAUDE.md §6, mirrored in the
  Zod `CanvasSchema`.
- `PropagationResult.updates` from an EPANET-mode solve carry no
  `responsibility_share` — there is no causal chain to attribute, since this
  bypasses the engine's propose/guard/commit pipeline entirely. The frontend
  already renders `responsibility_share` as optional, so this needed no UI
  change.
- EPANET-mode propagation is CPU-bound exactly like the normal engine call,
  just via a different solver; it is offloaded to a thread
  (`fastapi.concurrency.run_in_threadpool`) rather than the engine's own
  worker-slot pool (`_executor`/`_slots_in_use` in `propagation_service.py`),
  since it is a different, unrelated resource. It currently has no
  timeout/concurrency cap of its own, unlike the engine path's
  `ENGINE_TIMEOUT_SECONDS`/`EngineBusyError` — acceptable for now since this
  is an opt-in, per-canvas, local/self-hosted-oriented feature, but a
  candidate for the same protections if it sees production load.
- Global scope with an `"epanet"`-typed canvas mixed into a global
  Propagation falls through to the normal engine, same as any other
  unrecognized `graph_type` would — this is a deliberate scope limit
  (sub-decision 2), not an oversight.

## Known limitation — singular PDD on severed components

WNTR's PDD solve on a component severed from every source converges, without
warning, to an arbitrary internal circulation that reads "fully served"
(discovered benchmarking the engine — `experiments/aqueducts/ATTEMPTS.md` §6). An
epanet-mode Propagation on such a scenario therefore shows healthy junctions
that physically receive nothing; the normal engine path marks them critical
correctly. `experiments/aqueducts/validate_faithfulness.py` already applies the
source-reachability correction (`_severed_junctions`); porting the same
correction into `services/epanet_solve_service.py` is the pending fix.
