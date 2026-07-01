# Roles carry Entitlements; the engine is metered in evaluations, not requests

**Status:** accepted

Signup is self-service (anyone can register via the OIDC provider), so a new
account must not be able to abuse the proprietary engine. Rather than lock the
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
| engine-eval budget / minute (tunable config) | ~10,000 | ~100,000 |

Node caps are firm decisions; eval budgets are tunable config, derived from the
rule *"one full model-based analysis per minute at the role's max graph size."*
`analyst` is deliberately **big-but-finite** (300 nodes) because large graphs are
untested and model-based cost grows with size.

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
  the role record gains `max_nodes` and `eval_budget_per_min` fields.
- Accepted trade-off: a budget large enough for one model-based run also permits
  many cheap single-run probes in that minute, so **small-graph IP probing is
  possible**. This is accepted in favour of adoption; it does not weaken the
  DoS/compute bound. A separate single-propagation rate could be layered on later
  if probing needs clamping.
