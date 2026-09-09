# ADR-0008 — Roles carry Entitlements; the engine is metered in evaluations, not requests

**Status:** accepted

Signup is self-service (anyone can register via the OIDC provider), so a new
account must not be able to abuse the engine. Rather than lock the
engine behind manual approval, we let every role use the full toolset —
including model-based analysis — but bound by a per-role **Entitlement**: a
bundle of quotas that scales up with trust.

## The metering unit is the engine evaluation

A single Propagation costs **1** engine evaluation; a model-based analysis
(e.g. Shapley Value) costs **`permutations × N`** evaluations inside a single
API request. Metering by *request* is therefore meaningless — one request can be
1 unit or thousands. We meter the thing actually being spent: **engine
evaluations**, via a per-role **token bucket** that refills per minute. A request
whose evaluation cost exceeds the remaining budget is **refused with a clear
message**, never run silently or throttled into a long queue.

This is what makes model-based analysis safe to offer to `viewer`: a 45-node
Shapley is automatically forced down to a low-permutation Monte Carlo to fit the
small budget — matching the existing UI behaviour (degrade to Monte Carlo and
warn above ~30 elements).

## Entitlement knobs and starting defaults

| Knob | viewer | analyst |
|---|---|---|
| max nodes (propagation & model-based) | 45 | 300 |
| engine-eval budget / minute (calibrated) | ~10,000 | **~5,000** |

Node caps are firm decisions; eval budgets are tunable config.

## Calibration (measured, not guessed) — 2026-07

`scripts/benchmark_engine.py` measures the real cost. Findings:

- **A single Propagation is cheap** — ~1 ms at 45 nodes, ~8 ms at 300, ~30 ms at
  1000. So per-request latency is *not* the binding constraint, and `max_nodes` is
  best understood as a **model-based blast-radius / UX bound**, not a
  propagation-latency limit.
- **The old analyst budget (100,000/min) was decorative.** On a ~4-vCPU VM
  (~240 CPU-seconds/minute) spending 100k evals at the 300-node cost (~13 ms)
  needs ~1,260 CPU-s/min — ~20× the box. The CPU saturates long before the token
  bucket binds, so the cap throttled nothing. It is recalibrated to **~5,000/min**
  (~25% of one small box), so the throttle is real (migration 003).
- `viewer` stays ~10,000: its 45-node cap keeps each eval cheap enough to fit.

**Re-run the benchmark on the actual VM and set the final numbers there.**

### Known weakness / future refinement

The token bucket charges **1 unit per evaluation regardless of node count**, but a
300-node eval costs ~6× a 45-node eval. So the budget is only accurate at one
size; sizing it for the worst case (`max_nodes`) is conservative but
over-restrictive for small graphs. A future refinement: charge
`cost = ceil(node_count / K)` so big networks debit proportionally, making the
budget size-aware.

## Considered options

- *Lock the engine until an admin approves each user.* Rejected: kills the
  self-service trial that drives adoption.
- *Rate-limit by requests per minute (e.g. "5 runs/min").* Rejected: a single
  model-based request is thousands of evaluations, so a request-based limit does
  not bound compute at all.
- *Model-based analysis as an analyst-only feature.* Rejected: we want viewers to
  experience the full toolset on small graphs.

## Consequences

- Enforcement lives server-side in the propagation path, before the engine runs
  (this is also the "rate limiting" the deployment doc flags as missing).
- RBAC grows from boolean permissions to permissions **+ Entitlement quotas**;
  the role record gains `max_nodes` and `evals_per_minute` fields.
- Accepted trade-off: a budget large enough for one model-based run also permits
  many cheap single-run probes in that minute, so **small-graph IP probing is
  possible**. This is accepted in favour of adoption; it does not weaken the
  DoS/compute bound. A separate single-propagation rate could be layered on later
  if probing needs clamping.
