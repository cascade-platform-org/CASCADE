# Roadmap — Extending CASCADE to the Overload (Load-Redistribution) Regime

**Status:** future work (not started). Scoping only.
**Owner decision needed** on the items in §7 before any implementation.

## 1. Problem

The current architecture models **demand starvation**: an element fails when it is
damaged or when its supply falls short. It does **not** model the *converse*
mechanism — **load redistribution / overload**: a failure reroutes flow onto a
surviving element, that element is pushed past its physical limit and fails, and
the cascade propagates. This is the water-distribution cascading-failure
mechanism of Shuang et al. (2014) and the interdependent water–power version of
Li & Zhang (2025), and the general precedent is the power-grid load-redistribution
models of Motter–Lai (2002) / Crucitti et al. (2004). The paper states plainly
(Related Work, Limitations, Future Work) that we do **not** address it.

## 2. The distinction that drives the whole plan

There are **two** overload mechanisms, and they need different tools:

- **A — steady-state overload.** Rerouted *sustained* flow exceeds a pipe's safe
  velocity/capacity → it fails → reroute → cascade. Depends on **steady flow
  magnitude**, which the flow module already computes.
- **B — transient surge (water hammer).** A *sudden* event (valve slam, pump trip)
  launches a pressure wave that bursts pipes; magnitude follows Joukowsky
  (`Δp ≈ ρ·a·Δv`), driven by **rate-of-change and wave speed**, not steady flow.

**Consequences:**
- The engine is **steady-state**, so it can plausibly model **A** but is
  architecturally incapable of predicting **B**.
- For **A** the oracle is **EPANET/WNTR itself** — it already reports post-failure
  velocities and pressures; we only add a failure *criterion* in post-processing
  and iterate. **No transient solver needed.**
- **TSNet** (open-source MOC transient solver, reads `.inp`) is only relevant to
  **B** — but B is exactly the regime a steady-state engine can't reach, so
  validating against B mostly measures that mismatch (a valid negative result).

**Therefore: pursue A first (achievable, EPANET oracle). B is exploratory.**

## 3. Phased plan (track A)

### Phase 0 — Feasibility & scoping (~1 day)
- Decide criterion inputs; inventory missing data (pipe pressure rating, material/
  class, max design velocity — none are in `.inp`, assign by rule).
- If B is in scope: smoke-test TSNet on Net3 + one aqueduct (install, run, speed).

### Phase 1 — Failure model (ADR) (~1 day)
- ADR: the failure *criterion* (element fails when steady-state velocity `> v_fail`
  and/or pressure `> p_rating`), the thresholds, and the functionality mapping.
- **Convergence check:** overloaded elements only ever *fail* (functionality
  decreases, never recovers) → the propose/guard/commit loop stays **monotone** and
  terminates in ≤ M rounds (extend the convergence proposition). This keeps the
  extension inside the existing engine architecture.

### Phase 2 — Engine mechanism (~2–4 days)
- In `CASCADE-backend/engine/` (§7 — engine logic): add an **overload guard** to the
  flow mechanism. After each flow allocation, flag elements whose allocated flow
  implies velocity/pressure past the criterion, degrade them, let the monotone loop
  re-propagate. Opt-in (config/category-type flag) so defaults + current results are
  untouched.
- Unit tests on a hand-built network where rerouting predictably overloads one
  survivor → assert exactly-those failures and convergence.

### Phase 3 — Steady-state overload oracle (~2–3 days)
- Dev harness (not product): given an initiating failure, PDD-solve in WNTR → read
  per-pipe velocity/pressure → apply the **same criterion** → close failed pipes →
  re-solve → repeat until no new failures. Reuse the existing non-convergence /
  singular-PDD guards.

### Phase 4 — Validation experiment (~2–3 days)
- Metric: **precision/recall on failed elements** (engine set vs oracle set),
  mirroring the critical-junction detection framing.
- Run on the six networks (aqueducts, where redundant paths make overload real).
- **Sensitivity to `v_fail`** — same playbook as the capacity-margin sweep, since the
  threshold is the one free parameter.

### Phase 5 — (Exploratory, gated by Phase 0) Transient / TSNet track (~1–2 weeks, high risk)
- Only for mechanism B. TSNet transient-cascade oracle: event → transient sim → max
  surge pressure per pipe → burst criterion → re-run → cascade. Assign wave speeds/
  ratings by rule.
- Expectation stated up front: this tests whether a *steady-state* engine can
  *screen* for *transient-driven* failure. The gap is the finding either way.

### Phase 6 — Write-up (~2–3 days)
- If A works: new results subsection or companion paper ("extending the architecture
  to overload cascades"), citing Shuang 2014 / Li 2025 as the modelled mechanism.
- Update the main paper's Limitations: overload is no longer *fully* out of scope
  (steady-state variant handled); transient surge (B) remains the boundary, TSNet the
  future oracle.

## 4. Related work / oracle tooling
- **Shuang et al. 2014** (PLOS ONE) — WDN cascading failure by load redistribution;
  the water-specific mechanism.
- **Li & Zhang 2025** (RESS) — interdependent water–power cascading failure.
- **Motter–Lai 2002 / Crucitti 2004** — general load-redistribution precedent.
- **TSNet** (MIT, Python, MOC, reads `.inp`; models pipe burst + surge) — the
  transient oracle for track B. https://github.com/glorialulu/TSNet

## 5. Risks & open questions
1. **Criterion arbitrariness** — `v_fail`/`p_rating` are assumptions; mitigate with
   the Phase-4 sensitivity sweep.
2. **Data** — ratings/materials/wave speeds absent from `.inp`; assign by rule and
   disclose.
3. **Steady-state ≠ transient (the big one)** — B may be fundamentally beyond a
   steady-state engine; decide whether it's a target or an acknowledged boundary.
4. **TSNet maturity** — pre-release (0.2.x); MOC stability/speed unknown at aqueduct
   scale; Phase-0 de-risks before committing.
5. **Convergence** — the overload loop must stay monotone (Phase 1) or the engine's
   core guarantee breaks.

## 6. Physical grounding note (links to the capacity-margin work)
Capacity in the importer is `π/4·d²·v_peak·margin`. A **max-design-velocity cap**
(`v ≤ ~2.5–3 m/s`) both bounds the current margin physically and provides a natural
default `v_fail` for the overload criterion — the two features share the threshold.
See the capacity-margin sensitivity work and `experiments/margin_sweep.py`.

## 7. Decisions to confirm before starting
- **Scope:** A only (~2 weeks), or A + exploratory B (+1–2 weeks, high risk)?
- **Failure criterion:** velocity-based, pressure-based, or both?
- **Deliverable:** new subsection in this paper vs a companion paper.
