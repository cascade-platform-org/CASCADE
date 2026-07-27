#!/usr/bin/env python3
"""Groundwork for the `contingency_priorities` TODO ("a future optimisation
could derive the deficit from link_flow_profiles' capacity-discovery
contingencies (same ensemble)"): before merging the two mechanisms, check
whether they can even safely SHARE one ensemble.

The two currently run completely independent EPANET solves:
  - capacity discovery (`link_flow_profiles`): top-10%-diameter pipes + pumps,
    closed EXHAUSTIVELY, no bridge/cycle filter, plus ~20 uniform random
    singles on the rest.
  - priority (`contingency_priorities`): top-20%-diameter pipes + pumps,
    filtered to CYCLE-ONLY (bridges excluded), singles(40)+pairs(20)+triplets(10).

Question: does capacity discovery's extra, UNFILTERED solves (bridges
included, wider trunk pool, random sample) actually raise any pipe's imported
capacity beyond what the small, cycle-only, singles-only set already finds? If
not, both mechanisms can share ONE cycle-aware ensemble --- cutting redundant
EPANET solves and removing the (probably wasted) bridge closures, which by the
paper's own argument for priority ("closing a bridge only disconnects, it
never forces rerouting") should be uninformative for capacity too.

Runs FOUR configurations per network, all starting from the same one-shot
demand-sweep peak (steps=1, i.e. multiplier=1x only used as the pre-contingency
floor -- NOT the paper's real x8 adaptive sweep, this diagnostic isolates the
CONTINGENCY contribution only):
  A. demand-sweep floor only, zero contingency solves.
  B. cycle-only trunk SINGLES (top-20%, cycle-filtered) -- "very few
     contingencies": at most `len(cycle_trunk)` solves, typically a handful.
  C. PRODUCTION as run_final_benchmark.sh actually configures it:
     contingency_exhaustive_trunk=True (top-10%, UNFILTERED) + 20 uniform
     random singles on the rest. This is what final_benchmark.csv's reported
     capacities actually come from -- the real "existing capacity values".
  D. cycle-only trunk singles+pairs+triplets (40+20+10, the full priority
     ensemble) -- does combinatorial coverage add anything beyond B?

For every pipe with signal in ANY config, reports peak velocity (post-margin
capacity too) at each stage and highlights pipes where a later stage found
something earlier stages missed.

Run from repo root:  python experiments/diag_contingency_unification.py
"""
from __future__ import annotations

import itertools
import math
import os
import random
import statistics
import sys
import tempfile
from pathlib import Path

BACKEND = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "CASCADE-backend")
sys.path.insert(0, BACKEND)

import wntr  # noqa: E402

from core.importers.inp import compute_junction_demands  # noqa: E402
from core.importers.inp.map import DEFAULT_CAPACITY_MARGIN  # noqa: E402
from core.importers.inp.sim import (  # noqa: E402
    _accumulate_profiles,
    _cycle_links,
    _fixed_demand_model,
    _run_sweep_step,
    _REQUIRED_PRESSURE_M,
    _MINIMUM_PRESSURE_M,
    LinkFlowProfile,
)

MAX_VELOCITY = 3.0  # matches ImportOptions default


def _capacity(velocity: float, diameter_m: float) -> float:
    return math.pi / 4.0 * diameter_m**2 * min(velocity * DEFAULT_CAPACITY_MARGIN, MAX_VELOCITY)


def _demand_floor(wn, demands: dict[str, float], link_ids: set[str]) -> dict[str, LinkFlowProfile]:
    """Config A: one solve at nominal demand (multiplier=1), no contingency."""
    model = _fixed_demand_model(wn, demands)
    model.options.time.duration = 0
    model.options.hydraulic.demand_model = "PDD"
    model.options.hydraulic.required_pressure = _REQUIRED_PRESSURE_M
    model.options.hydraulic.minimum_pressure = _MINIMUM_PRESSURE_M
    profiles: dict[str, LinkFlowProfile] = {}
    with tempfile.TemporaryDirectory(prefix="cascade-diag-") as tmpdir:
        try:
            results = _run_sweep_step(model, 1.0, str(Path(tmpdir) / "floor"))
        except Exception:
            return profiles
        _accumulate_profiles(profiles, link_ids, results.link["velocity"].iloc[0], results.link["flowrate"].iloc[0])
    return profiles


def _run_groups(
    wn, demands: dict[str, float], link_ids: set[str], groups: list[tuple[str, ...]], tag: str
) -> dict[str, LinkFlowProfile]:
    model = _fixed_demand_model(wn, demands)
    model.options.time.duration = 0
    model.options.hydraulic.demand_model = "PDD"
    model.options.hydraulic.required_pressure = _REQUIRED_PRESSURE_M
    model.options.hydraulic.minimum_pressure = _MINIMUM_PRESSURE_M
    profiles: dict[str, LinkFlowProfile] = {}
    solved = 0
    with tempfile.TemporaryDirectory(prefix="cascade-diag-") as tmpdir:
        prefix = str(Path(tmpdir) / tag)
        for i, group in enumerate(groups):
            links = [model.get_link(lid) for lid in group]
            original = [lk.initial_status for lk in links]
            for lk in links:
                lk.initial_status = "Closed"
            try:
                results = _run_sweep_step(model, 1.0, f"{prefix}-{i}")
            except Exception:
                continue
            finally:
                for lk, status in zip(links, original):
                    lk.initial_status = status
            solved += 1
            _accumulate_profiles(
                profiles, link_ids, results.link["velocity"].iloc[0], results.link["flowrate"].iloc[0],
                exclude=frozenset(group),
            )
    print(f"    [{tag}] {solved}/{len(groups)} contingency solves converged")
    return profiles


def _merge(*profile_dicts: dict[str, LinkFlowProfile]) -> dict[str, LinkFlowProfile]:
    out: dict[str, LinkFlowProfile] = {}
    for pd in profile_dicts:
        for lid, prof in pd.items():
            merged = out.setdefault(lid, LinkFlowProfile())
            merged.velocity_fwd = max(merged.velocity_fwd, prof.velocity_fwd)
            merged.velocity_rev = max(merged.velocity_rev, prof.velocity_rev)
    return out


def analyse(path: str, seed: int = 1) -> None:
    name = os.path.basename(path)
    wn = wntr.network.WaterNetworkModel(path)
    demands = compute_junction_demands(wn, "peak_hour")
    link_ids = set(wn.pipe_name_list) | set(wn.valve_name_list)
    diameters = {pid: wn.get_link(pid).diameter for pid in wn.pipe_name_list}

    print(f"\n=== {name} ({len(wn.pipe_name_list)} pipes, {len(wn.pump_name_list)} pumps) ===")

    # --- pools -----------------------------------------------------------
    cycle = _cycle_links(wn)
    by_diameter = sorted(wn.pipe_name_list, key=lambda pid: wn.get_link(pid).diameter, reverse=True)
    trunk10_unfiltered = sorted(set(by_diameter[: max(1, round(len(by_diameter) * 0.10))]) | set(wn.pump_name_list))
    trunk20_cycle = [
        lid for lid in by_diameter[: max(1, round(len(by_diameter) * 0.20))] + list(wn.pump_name_list)
        if lid in cycle
    ]
    n_bridges_in_trunk10 = sum(1 for lid in trunk10_unfiltered if lid not in cycle)
    print(f"    trunk-10% (unfiltered, production): {len(trunk10_unfiltered)} links, "
          f"{n_bridges_in_trunk10} are bridges")
    print(f"    trunk-20% (cycle-only, priority's pool): {len(trunk20_cycle)} links")

    rng = random.Random(seed)
    all_links_ext = sorted(set(wn.pipe_name_list) | set(wn.valve_name_list) | set(wn.pump_name_list))
    remaining = sorted(set(all_links_ext) - set(trunk10_unfiltered))
    n_random = min(20, len(remaining))
    production_random_singles = rng.sample(remaining, n_random)

    # --- configs -----------------------------------------------------------
    floor = _demand_floor(wn, demands, link_ids)

    groups_B = [(lid,) for lid in trunk20_cycle]
    prof_B_solo = _run_groups(wn, demands, link_ids, groups_B, "B-cycle-singles")
    prof_B = _merge(floor, prof_B_solo)

    groups_C_extra = [(lid,) for lid in trunk10_unfiltered] + [(lid,) for lid in production_random_singles]
    prof_C_solo = _run_groups(wn, demands, link_ids, groups_C_extra, "C-production")
    prof_C = _merge(floor, prof_C_solo)

    groups_D_extra = (
        list(itertools.islice(itertools.combinations(trunk20_cycle, 2), 20))
        + list(itertools.islice(itertools.combinations(trunk20_cycle, 3), 10))
    )
    prof_D_solo = _run_groups(wn, demands, link_ids, groups_D_extra, "D-pairs+triplets")
    prof_D = _merge(prof_B, prof_D_solo)

    # --- compare -----------------------------------------------------------
    all_pipes = sorted(set(diameters))
    rows = []
    for pid in all_pipes:
        d = diameters[pid]
        vA = floor.get(pid, LinkFlowProfile()).peak
        vB = prof_B.get(pid, LinkFlowProfile()).peak
        vC = prof_C.get(pid, LinkFlowProfile()).peak
        vD = prof_D.get(pid, LinkFlowProfile()).peak
        cA, cB, cC, cD = (_capacity(v, d) for v in (vA, vB, vC, vD))
        rows.append((pid, vA, vB, vC, vD, cA, cB, cC, cD))

    def _summ(label: str, lo_idx: int, hi_idx: int) -> None:
        deltas = [r[4 + hi_idx] - r[4 + lo_idx] for r in rows]
        moved = [d for d in deltas if d > 1e-9]
        if moved:
            print(f"    {label}: {len(moved)}/{len(rows)} pipes gained capacity, "
                  f"mean +{statistics.mean(moved):.4f} m3/s, max +{max(moved):.4f} m3/s")
        else:
            print(f"    {label}: 0/{len(rows)} pipes gained ANY capacity")

    _summ("A(floor) -> B(cycle singles, few)", 1, 2)
    _summ("B(cycle singles) -> C(PRODUCTION, current final_benchmark.csv basis)", 2, 3)
    _summ("B(cycle singles) -> D(cycle singles+pairs+triplets)", 2, 4)
    _summ("C(PRODUCTION) -> D(cycle full ensemble)", 3, 4)

    # Pipes where PRODUCTION (C) found something the small cycle-only set (B) missed
    c_beats_b = sorted((r for r in rows if r[7] - r[6] > 1e-9), key=lambda r: r[7] - r[6], reverse=True)[:8]
    if c_beats_b:
        print(f"    top pipes where PRODUCTION > cycle-singles-only (id, cap_B, cap_C, diam_mm):")
        for pid, *_rest, cA, cB, cC, cD in c_beats_b:
            print(f"      {pid:10s} B={cB:.4f} C={cC:.4f} diam={diameters[pid]*1000:.0f}mm "
                  f"{'[BRIDGE via random-sample?]' if pid not in cycle else '[cycle link]'}")


NETWORKS = [
    "../raw-networks/aqueducts/Cassacco_totale.inp",
    "../raw-networks/aqueducts/Tarcento_totale.inp",
    "../raw-networks/aqueducts/Zampis.inp",
    "../raw-networks/aqueducts/Modena.inp",
    "../raw-networks/aqueducts/CTown.inp",
]

if __name__ == "__main__":
    targets = sys.argv[1:] or NETWORKS
    for p in targets:
        analyse(p)
