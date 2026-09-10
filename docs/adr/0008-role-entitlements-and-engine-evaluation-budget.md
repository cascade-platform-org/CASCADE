# ADR-0008 — Roles carry Entitlements; the engine is metered in evaluations, not requests

**Status:** accepted

Signup is self-service (anyone can register via the OIDC provider), so a new
account must not be able to abuse the engine. Rather than lock the
engine behind manual approval, we let every role use the full toolset —
including model-based analysis — but bound by a per-role **Entitlement**: a
bundle of quotas that scales up with trust.

## The metering unit is the engine evaluation

A single Propagation costs **1** engine evaluation. We meter the thing actually
being spent: **engine evaluations**, via a per-role **token bucket** that refills
per minute. A request whose evaluation cost exceeds the remaining budget is
**refused with a clear message**, never run silently or throttled into a long
queue.

### How this is actually enforced (corrected 2026-09-10)

The original text of this section described a model-based analysis as
`permutations × N` evaluations **inside a single API request**, and rejected
per-request metering on that basis. **The system was never built that way.** The
Shapley and Vitality estimators run in the browser
(`CASCADE-app/lib/model-based-analysis.ts`) and issue **one `POST /api/propagate`
per coalition**. `api/propagation_routes.py` charges `cost=1` per request.

So one request *is* one evaluation, and the budget is correct as shipped — but
by a property of the client, not by anything the server enforces. Two things
follow, and both matter:

- The rejected option "rate-limit by requests per minute" and the accepted
  design are, today, **the same thing**. The distinction only becomes real when
  a request can carry more than one evaluation.
- Any endpoint that batches coalitions server-side **must charge
  `cost = len(coalitions)`**. Shipping one at `cost=1` would turn the budget
  into a request limit over an unbounded amount of compute — the exact failure
  this ADR was written to prevent. This is a hard requirement on the batching
  work, not a preference.

**Satisfied 2026-09-10.** `POST /api/propagate/batch` charges
`cost=len(body.coalitions)` through the same `_enforce_entitlement` helper as the
single route, so the node cap and the budget cannot drift apart while the costs
differ. Two tests pin it — a batch of 3 must spend 3 units, and a batch larger
than the remaining budget is refused before any engine work — and both fail if
the cost is changed back to 1 (verified by mutation). The batch size is capped in
the schema (`MAX_COALITIONS_PER_BATCH = 50`), so one token can never buy an
unbounded amount of compute. With that endpoint live, the ADR's original premise
finally describes the system: a request can now carry many evaluations, and the
budget meters evaluations.

Two further claims in the original text described behaviour that does not
exist and are withdrawn: there is **no exact `2^N` Shapley path** (the estimator
is Monte Carlo only), and there is **no automatic degradation or warning above
~30 elements** — the user sets permutations, `k_max` and a wall-clock budget by
hand, and the panel shows the projected call count before the run. What makes
model-based analysis safe for `viewer` is the 45-node cap plus the budget, not
an automatic downgrade.

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

### Known weaknesses / future refinements

The token bucket charges **1 unit per evaluation regardless of node count**, but a
300-node eval costs ~6× a 45-node eval. So the budget is only accurate at one
size; sizing it for the worst case (`max_nodes`) is conservative but
over-restrictive for small graphs. A future refinement: charge
`cost = ceil(node_count / K)` so big networks debit proportionally, making the
budget size-aware.

A second weakness, visible once the enforcement above is stated plainly: because
the client makes one request per coalition, a Shapley run over a 39-node network
sends ~1,300 requests carrying the same ~49 KB project each time. The budget
bounds the compute correctly, but nothing bounds the redundant transfer and
re-parsing. That was the case for a batch endpoint, built on 2026-09-10 under the `cost`
rule above: the same run now sends 26 requests instead of 1,297, with
bit-identical Shapley values.

## Considered options

- *Lock the engine until an admin approves each user.* Rejected: kills the
  self-service trial that drives adoption.
- *Rate-limit by requests per minute (e.g. "5 runs/min").* Rejected **for a
  server that fans out internally** — one such request would be thousands of
  evaluations, so a request-based limit would not bound compute. See the
  correction above: with today's client-side fan-out the two coincide, and the
  rejection only bites again once batching lands.
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
