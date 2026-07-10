"""
core/importers/inp/sim.py — WNTR pressure-driven demand-multiplier sweep.

One sweep mechanism (`_run_sweep`), two things derived from it:

  scarcity_priorities  — junction id → 1..10 flow-allocation priority.
    CASCADE's SourceToDemands flow heuristic sheds load by `priority`; to make the
    engine's shedding order emulate real hydraulics, we ask WNTR *which
    junctions lose service first as the network is stressed*: at each step a
    junction's delivered/expected ratio is checked, and the first step it
    drops below a threshold is its failure step (fragile → low priority,
    engine sheds it first — matches WNTR; never fails → high priority).
    Computed on the ORIGINAL network (true geometry — the skeleton's merged
    pipes distort hydraulics) and transferred to the skeleton by
    demand-weighted averaging over each retained junction's absorbed originals.

  link_flow_profiles  — pipe/valve id → LinkFlowProfile, the peak |velocity|
    (m/s) each link reaches EACH direction across the whole sweep. A pipe's
    velocity at normal, unstressed demand is NOT its capacity — a lightly-
    loaded branch pipe carrying a trickle at rest could carry much more if
    actually needed. Capacity is "what can this pipe deliver when pushed,"
    which the top of a demand-multiplier sweep is a real, simulation-grounded
    proxy for, unlike either a single assumed constant or the pipe's
    idle-flow velocity. Tracking BOTH signs (not just the old unsigned peak)
    also gives the importer a simulation-grounded answer to "which way does
    this pipe actually flow" — map.py uses it to orient edges instead of
    guessing from BFS graph distance, and to detect a pipe that carries
    meaningful flow in BOTH directions across the sweep (e.g. a loop pipe
    that reverses as demand is pushed toward stress), which is modelled as
    two independently-capacitated edges instead of being forced onto a
    single, possibly wrong, direction. Computed on the SAME (already
    skeletonized) network build_bundle emits edges for — a skeleton merge can
    change a pipe's diameter/length, so this cannot reuse the
    original-network priority sweep's own per-pipe results.

Both sweeps start from the SAME demand `compute_junction_demands` (inp_map.py)
computed for the chosen `demand_mode` — every junction's declared demand
pattern is overridden to that fixed value before the multiplier scales it up,
so "capacity vs demand" and "priority order" are consistent with whatever
demand scenario is actually being modelled, not an arbitrary pattern hour.

This is import-time preprocessing: it derives static input data for the
CASCADE model. It is not propagation and does not touch the engine. It is
also deliberately NOT a time-varying (extended-period) simulation — every
step is its own independent steady state at a given demand multiplier, never
a real clock, so a pipe that only reverses between night and day (e.g. a
tank's recharge vs. discharge) is out of scope on purpose: telling that apart
needs real pattern timing, not a demand-magnitude sweep. What this sweep DOES
catch, with no clock at all, is a pipe reversing because of topology/
redistribution as demand is pushed up (a loop pipe) — the common, purely
structural case.

Solved via `wntr.sim.EpanetSimulator` (the real EPANET toolkit), not the
pure-Python `WNTRSimulator`: the latter does not implement every valve/headloss
type real utility exports use (observed: PBV, GPV valves; C-M, D-W headloss).
EpanetSimulator writes its working files under a private per-sweep temp
directory so concurrent imports can't collide on them.
"""
from __future__ import annotations

import copy
import math
import random
import tempfile
from pathlib import Path
from typing import Any

import wntr
from pydantic import BaseModel

# Pressure-driven-demand parameters: below `minimum` no water is delivered,
# above `required` full demand is met. 20 m ≈ 2 bar, a common service target.
_REQUIRED_PRESSURE_M = 20.0
_MINIMUM_PRESSURE_M = 0.0

# Fallback for a pipe/valve the sweep never reports meaningful velocity for
# (isolated loop, or the solve fails outright) — capacity = π/4·d²·v must
# still have a v to multiply. 1 m/s is a common water-distribution design
# velocity, used only as this floor, never as the primary source of capacity.
FALLBACK_VELOCITY_MS = 1.0
# Below this magnitude a link's flow at a given sweep step is treated as "no
# signal" — noise, not a real direction — for both capacity accumulation and
# orientation/bidirectionality classification (map.py). Not private: map.py
# reads it too, to apply the exact same noise floor when deciding whether a
# pipe's fwd/rev signal is real.
#
# A stricter, absolute-flow-based version of this floor (plus a dominance
# ratio to decide when one direction should win over a "genuinely both real"
# split) was tried and reverted — see ADR-0012 "Pipe capacity / orientation."
# It fixed one real noisy-leaf-pipe case on Zampis.inp but, measured on the
# full faithfulness benchmark (scripts/validate_faithfulness.py) against that
# same real two-source aqueduct, scored materially worse overall: being
# "smarter" about noise risks confidently forcing a single WRONG direction
# for a genuine near-balance point in a real mesh, which can silently
# disconnect everything downstream of it — a much worse failure than
# occasionally splitting a link that didn't really need it. The plain
# velocity threshold below biases toward the safe failure mode (split, never
# disconnects) and wins on real data.
NEGLIGIBLE_VELOCITY_MS = 1e-4
# Below THIS (higher) velocity, a SINGLE-SIDED reading isn't fast enough to
# confidently trust as a genuinely one-way pipe — hedge with a bidirectional
# split instead of picking it outright (NEGLIGIBLE_VELOCITY_MS still gates
# whether there is any real flow whatsoever; this gates whether that flow is
# fast enough to call the direction question closed). Only applies when the
# OTHER side never registered any signal at all — if both sides clear
# NEGLIGIBLE_VELOCITY_MS, map.py already splits regardless of magnitude. A
# low-velocity single-sided reading is exactly where solver noise, near a
# near-zero equilibrium, is most likely to have picked an arbitrary winner
# (the Zampis.inp regression, ADR-0012 "Pipe capacity / orientation") —
# hedging (see MIN_HEDGE_SHARE) costs little when the pipe really is one-way,
# but keeps a real, usable reverse capacity open for a later hazard that
# needs the other direction, instead of hard-zeroing it. 0.3 m/s is a common
# minimum "self-cleansing" design velocity for water mains — real, confidently
# one-way trunk flow is typically well above it (observed 0.9-4+ m/s on real
# aqueduct data); the noisy leaf-pipe case that motivated this sits at 0.03-
# 0.09 m/s, comfortably below.
DECISIVE_VELOCITY_MS = 0.3
# The minimum share of a low-confidence pipe's capacity (DECISIVE_VELOCITY_MS)
# reserved for the direction that never registered any signal at all. A pure
# proportional split would hand it exactly 0% (there is nothing to be
# proportional TO), which hedges nothing; this guarantees real, usable
# capacity in that direction instead, at the dominant direction's expense.
MIN_HEDGE_SHARE = 0.1


class LinkFlowProfile(BaseModel):
    """One pipe/valve's flow behaviour across the demand-multiplier sweep.

    `velocity_fwd` / `velocity_rev` — peak |velocity| (m/s) observed while
    flowing link.start_node_name → end (fwd) or end → start (rev), per WNTR's
    own signed velocity convention. A link with signal in only one direction
    keeps the other at 0.0. `peak` is the old single-value capacity basis
    (unsigned); `bidirectional` is true when BOTH directions clear
    NEGLIGIBLE_VELOCITY_MS (genuine two-way flow, any magnitude), OR when
    only one does but even that side's velocity is below DECISIVE_VELOCITY_MS
    (a low-confidence single reading, hedged rather than trusted outright —
    see that constant's docstring).
    """

    velocity_fwd: float = 0.0
    velocity_rev: float = 0.0

    @property
    def peak(self) -> float:
        return max(self.velocity_fwd, self.velocity_rev)

    @property
    def bidirectional(self) -> bool:
        if self.velocity_fwd > NEGLIGIBLE_VELOCITY_MS and self.velocity_rev > NEGLIGIBLE_VELOCITY_MS:
            return True
        return self.peak > NEGLIGIBLE_VELOCITY_MS and self.peak <= DECISIVE_VELOCITY_MS


def _fixed_demand_model(
    wn: wntr.network.WaterNetworkModel, demands: dict[str, float]
) -> wntr.network.WaterNetworkModel:
    """A private copy of `wn` with every junction's demand pattern replaced by
    a single fixed value from `demands` — so `demand_multiplier` scales from
    exactly the modelled demand_mode value, not an arbitrary pattern hour.

    Regression, caught on Net6: a Demand entry's `pattern_name=None` does NOT
    mean "constant, no pattern" to WNTR/EPANET — it falls back to the model's
    GLOBAL default pattern (`wn.options.hydraulic.pattern`, the .inp file's
    top-level `Pattern` option), if one is set. Net6 declares one whose very
    first multiplier is 0.1, so every "fixed" demand above was silently cut to
    a tenth of its value at solve time — uniformly, so it looked like a
    capacity/pressure problem (a flat ~10% delivered ratio everywhere) rather
    than the demand-side bug it actually was. Net1/Net3 have no global default
    pattern, so this never surfaced there. Clearing it on this private copy
    makes `pattern_name=None` actually mean constant, matching every other
    caller's intent."""
    model = copy.deepcopy(wn)
    hydraulic_options: Any = model.options.hydraulic  # WNTR's stub claims non-Optional str
    hydraulic_options.pattern = None
    for jid, demand in demands.items():
        junction: Any = model.get_node(jid)  # WNTR ships no usable stubs
        junction.demand_timeseries_list.clear()
        junction.demand_timeseries_list.append((demand, None, "cascade_fixed"))
    return model


def _run_sweep_step(
    model: wntr.network.WaterNetworkModel, multiplier: float, file_prefix: str
) -> Any:
    """One steady-state PDD solve at `multiplier`. `model` is the sweep's
    private, pre-configured copy; only the multiplier is (re)assigned here.
    Returns the raw WNTR SimulationResults (node + link tables)."""
    model.options.hydraulic.demand_multiplier = multiplier
    return wntr.sim.EpanetSimulator(model).run_sim(file_prefix=file_prefix)


def _sweep_multipliers(steps: int, max_multiplier: float) -> list[float]:
    return [1.0 + (max_multiplier - 1.0) * i / (steps - 1) for i in range(steps)]


def scarcity_priorities(
    wn: wntr.network.WaterNetworkModel,
    demands: dict[str, float],
    *,
    steps: int = 15,
    max_multiplier: float = 8.0,
    fail_threshold: float = 0.9,
    warnings: list[str] | None = None,
) -> dict[str, int]:
    """Junction id → priority 1..10 from a PDD demand-multiplier sweep.

    `demands` — junction id → m³/s for the chosen demand_mode (see module
    docstring); every junction's demand is fixed to this before the sweep.

    Returns {} (engine default priority everywhere) when the simulation cannot
    run — a missing curve, a non-converging solve — with the reason appended to
    `warnings`. An import must never fail because the hydraulics are imperfect.
    """
    warnings = warnings if warnings is not None else []

    junctions = [jid for jid, d in demands.items() if d > 0]
    if not junctions:
        return {}

    model = _fixed_demand_model(wn, demands)
    model.options.time.duration = 0  # single steady-state step
    model.options.hydraulic.demand_model = "PDD"
    model.options.hydraulic.required_pressure = _REQUIRED_PRESSURE_M
    model.options.hydraulic.minimum_pressure = _MINIMUM_PRESSURE_M

    failure_step: dict[str, int] = {}
    multipliers = _sweep_multipliers(steps, max_multiplier)

    # Own temp directory for the whole sweep — EpanetSimulator writes
    # file_prefix.{inp,rpt,bin} to disk; an absolute prefix inside a directory
    # unique to this call keeps concurrent imports from colliding.
    with tempfile.TemporaryDirectory(prefix="cascade-epanet-") as tmpdir:
        file_prefix = str(Path(tmpdir) / "priority-sweep")
        for step, multiplier in enumerate(multipliers):
            try:
                results = _run_sweep_step(model, multiplier, file_prefix)
                delivered = results.node["demand"].iloc[0]
            except Exception as exc:
                warnings.append(
                    f"Hydraulic sweep stopped at multiplier {multiplier:.2f} ({exc}); "
                    f"priorities derived from {step} of {steps} steps."
                )
                break
            for jid in junctions:
                if jid in failure_step:
                    continue
                exp = demands[jid] * multiplier
                got = float(delivered.get(jid, 0.0))
                ratio = got / exp if exp > 0 else 1.0
                if math.isfinite(ratio) and ratio < fail_threshold:
                    failure_step[jid] = step

    if not failure_step:
        warnings.append(
            "No junction lost service across the sweep — uniform priorities."
        )
        return {}

    # Map failure step linearly onto 1..9; survivors get 10.
    last = len(multipliers) - 1 or 1
    priorities: dict[str, int] = {}
    for jid in junctions:
        if jid in failure_step:
            priorities[jid] = 1 + round(8 * failure_step[jid] / last)
        else:
            priorities[jid] = 10
    return priorities


def transfer_priorities(
    priorities: dict[str, int],
    merged_map: dict[str, list[str]],
    original_demands: dict[str, float],
) -> dict[str, int]:
    """Aggregate original-network priorities onto skeleton junctions.

    Retained junction priority = demand-weighted mean over itself plus every
    original junction it absorbed (unweighted mean when all demands are zero).
    Junctions untouched by skeletonization keep their own priority.
    """
    if not priorities:
        return {}

    result = dict(priorities)
    for retained, absorbed in merged_map.items():
        members = [retained, *absorbed]
        weighted = [
            (priorities[m], original_demands.get(m, 0.0))
            for m in members
            if m in priorities
        ]
        if not weighted:
            continue
        total_weight = sum(w for _, w in weighted)
        if total_weight > 0:
            mean = sum(p * w for p, w in weighted) / total_weight
        else:
            mean = sum(p for p, _ in weighted) / len(weighted)
        result[retained] = min(10, max(1, round(mean)))
    return result


def _accumulate_profiles(
    profiles: dict[str, LinkFlowProfile],
    link_ids: set[str],
    velocity: Any,
    flowrate: Any,
    exclude: str | None = None,
) -> None:
    """Fold one solved step's per-link velocity/flowrate into `profiles`,
    shared by both the demand-escalation sweep and the contingency pass
    below — same accumulation rule either way."""
    for link_id in link_ids:
        if link_id == exclude:
            continue
        # WNTR's own "velocity" column is an UNSIGNED magnitude (never
        # negative) — direction has to come from "flowrate", which IS
        # signed (positive = link.start_node_name -> end). Reading
        # velocity's sign instead (as an earlier version of this function
        # did) always classifies every link as flowing start->end, silently
        # discarding real reversed flow.
        mag = float(velocity.get(link_id, 0.0))
        if not math.isfinite(mag) or mag <= NEGLIGIBLE_VELOCITY_MS:
            continue
        signed_flow = float(flowrate.get(link_id, 0.0))
        if not math.isfinite(signed_flow):
            continue
        profile = profiles.setdefault(link_id, LinkFlowProfile())
        if signed_flow >= 0:
            profile.velocity_fwd = max(profile.velocity_fwd, mag)
        else:
            profile.velocity_rev = max(profile.velocity_rev, mag)


def link_flow_profiles(
    wn: wntr.network.WaterNetworkModel,
    demands: dict[str, float],
    *,
    steps: int = 8,
    max_multiplier: float = 8.0,
    contingency_samples: int = 20,
    seed: int = 0,
    warnings: list[str] | None = None,
) -> dict[str, LinkFlowProfile]:
    """Per-pipe/valve LinkFlowProfile from TWO stress mechanisms, run on THIS
    SAME network (call it post-skeleton — see module docstring):

    1. A demand-multiplier sweep (1x → max_multiplier) — the pipe's capacity
       under rising demand along its EXISTING flow paths.
    2. A bounded sample of single-link contingency solves (`contingency_samples`
       random pipes/pumps/valves closed one at a time, at nominal demand) —
       without this, a backup/redundant pipe that carries little flow in
       normal operation (its whole purpose is to reroute traffic if something
       ELSE fails) never gets stressed by (1) at all, since escalating demand
       uniformly does not discover alternate paths; only an actual topology
       change does. Verified on Net3: pipe 317 (a 203mm backup main) peaks at
       0.44 m/s under (1) alone — a plausible-looking but badly undersized
       ~14 300 capacity — while closing an unrelated upstream pipe reveals it
       actually carries several times that when called on to reroute.

    `demands` — junction id → m³/s for the chosen demand_mode; every
    junction's demand is fixed to this before every solve (both mechanisms),
    so multiplier=1.0 IS the modelled scenario.

    A link absent from the returned dict never reached the noise floor in
    either direction across any solve (no signal at all — isolated/idle
    branch, or every solve failed); its caller falls back to
    FALLBACK_VELOCITY_MS and a topology-only (BFS) orientation guess, same as
    before this function tracked direction at all.
    """
    warnings = warnings if warnings is not None else []

    model = _fixed_demand_model(wn, demands)
    model.options.time.duration = 0
    model.options.hydraulic.demand_model = "PDD"
    model.options.hydraulic.required_pressure = _REQUIRED_PRESSURE_M
    model.options.hydraulic.minimum_pressure = _MINIMUM_PRESSURE_M

    link_ids = set(wn.pipe_name_list) | set(wn.valve_name_list)
    profiles: dict[str, LinkFlowProfile] = {}
    multipliers = _sweep_multipliers(steps, max_multiplier)
    solved_any = False

    with tempfile.TemporaryDirectory(prefix="cascade-epanet-") as tmpdir:
        file_prefix = str(Path(tmpdir) / "velocity-sweep")
        for step, multiplier in enumerate(multipliers):
            try:
                results = _run_sweep_step(model, multiplier, file_prefix)
            except Exception as exc:
                warnings.append(
                    f"Velocity sweep stopped at multiplier {multiplier:.2f} ({exc}); "
                    f"pipe capacities derived from {step} of {steps} steps."
                )
                break
            solved_any = True
            _accumulate_profiles(profiles, link_ids, results.link["velocity"].iloc[0], results.link["flowrate"].iloc[0])

        if contingency_samples > 0:
            # sorted(), not a bare set→list: Python's set iteration order for
            # strings depends on the per-process hash seed (PYTHONHASHSEED),
            # not just insertion order — an unsorted list here silently
            # breaks the `seed` parameter's determinism, so the same `seed`
            # could sample different contingency links (and so derive
            # different pipe capacities) on different runs/processes despite
            # looking fully reproducible.
            all_links = sorted(set(wn.pipe_name_list) | set(wn.valve_name_list) | set(wn.pump_name_list))
            picks = random.Random(seed).sample(all_links, min(contingency_samples, len(all_links)))  # nosec B311 — deterministic capacity-sizing sample, not security
            model.options.hydraulic.demand_multiplier = 1.0
            for i, closed_id in enumerate(picks):
                # Mutate the one shared model in place rather than
                # deepcopy-ing the whole network (full node/link graph +
                # pattern/timeseries structures) per sample just to flip one
                # link's status — restore in `finally` so each iteration sees
                # the same baseline the next one expects.
                closed_link: Any = model.get_link(closed_id)  # WNTR ships no usable stubs
                original_status = closed_link.initial_status
                closed_link.initial_status = "Closed"
                try:
                    results = _run_sweep_step(model, 1.0, f"{file_prefix}-c{i}")
                except Exception:  # nosec B112: one failed contingency solve is skipped, not fatal — an import must never fail because the hydraulics are imperfect (same rule as scarcity_priorities/the main sweep above)
                    continue
                finally:
                    closed_link.initial_status = original_status
                _accumulate_profiles(
                    profiles, link_ids, results.link["velocity"].iloc[0], results.link["flowrate"].iloc[0],
                    exclude=closed_id,
                )

    if not solved_any:
        warnings.append(
            f"Velocity sweep produced no solved steps; every pipe/valve falls "
            f"back to {FALLBACK_VELOCITY_MS} m/s."
        )

    return profiles
