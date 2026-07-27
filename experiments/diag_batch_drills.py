#!/usr/bin/env python3
"""Batched vs single-break contingency drills for CAPACITY discovery.

Question (2026-07-23 design discussion): instead of closing one link per solve
(N-1), close a FEW together per solve until every candidate edge has been broken
~twice. Does that recover the same imported pipe capacities as exhaustive
singles, more cheaply --- and how much does batching OVER-size (more simultaneous
breaks concentrate more flow on survivors -> higher capacities)?

Candidate closures = SOURCE-CONTRACTED non-bridge links (reservoirs+tanks merged
to one super-node; a link that's still a bridge there only disconnects, so it
teaches the capacitated model nothing). Ranked by |nominal flow| from one
baseline solve.

Strategies compared, all on the same candidate set, all starting from the same
nominal demand floor (so the delta is purely the CONTINGENCY contribution ---
absolute numbers are contingency-relative, not production x8-sweep values):

  singles_all         every candidate closed once           (N-1 reference)
  singles_top15       top-15%-flow candidates, once
  singles_top30       top-30%-flow candidates, once
  batch3_cover2       groups of 3, 2 covering passes (each edge in ~2 groups)
  batch5_cover2       groups of 5, 2 covering passes
  batch5_top_cover2   groups of 5 over top-40%-flow only, 2 passes

Reference capacity per pipe = max over ALL strategies (best we ever saw). Each
strategy is scored by how much of that reference it recovers, and its solve cost.

Run:  python experiments/diag_batch_drills.py [net.inp ...]
"""
from __future__ import annotations

import math
import os
import random
import statistics
import sys
import tempfile
from collections import Counter
from pathlib import Path

BACKEND = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "CASCADE-backend")
sys.path.insert(0, BACKEND)

import networkx as nx  # noqa: E402
import wntr  # noqa: E402

from core.importers.inp import compute_junction_demands  # noqa: E402
from core.importers.inp.map import DEFAULT_CAPACITY_MARGIN  # noqa: E402
from core.importers.inp.sim import (  # noqa: E402
    _accumulate_profiles,
    _fixed_demand_model,
    _run_sweep_step,
    _REQUIRED_PRESSURE_M,
    _MINIMUM_PRESSURE_M,
    LinkFlowProfile,
)

MAX_VELOCITY = 3.0


def _capacity(velocity: float, diameter_m: float) -> float:
    return math.pi / 4.0 * diameter_m**2 * min(velocity * DEFAULT_CAPACITY_MARGIN, MAX_VELOCITY)


def _source_contracted_nonbridges(wn) -> set[str]:
    """Links that are NOT bridges once reservoirs+tanks are contracted to one
    super-node — i.e. closing them reroutes flow rather than merely disconnecting."""
    sources = set(wn.reservoir_name_list) | set(wn.tank_name_list)
    graph = nx.Graph()
    pair: dict[str, tuple[str, str]] = {}
    for lid in list(wn.pipe_name_list) + list(wn.valve_name_list) + list(wn.pump_name_list):
        lk = wn.get_link(lid)
        a = "S" if lk.start_node_name in sources else lk.start_node_name
        b = "S" if lk.end_node_name in sources else lk.end_node_name
        pair[lid] = (a, b)
        if a != b:
            graph.add_edge(a, b)
    counts = Counter(frozenset(p) for p in pair.values() if p[0] != p[1])
    bridges = {frozenset(e) for e in nx.bridges(graph)} if graph.number_of_edges() else set()
    out = set()
    for lid, (a, b) in pair.items():
        if a == b:
            continue
        fp = frozenset((a, b))
        if fp in bridges and counts[fp] == 1:
            continue  # a genuine source-separating bridge — skip
        out.add(lid)
    return out


def _base_model(wn, demands):
    model = _fixed_demand_model(wn, demands)
    model.options.time.duration = 0
    model.options.hydraulic.demand_model = "PDD"
    model.options.hydraulic.required_pressure = _REQUIRED_PRESSURE_M
    model.options.hydraulic.minimum_pressure = _MINIMUM_PRESSURE_M
    return model


def _run_groups(wn, demands, link_ids, groups, floor) -> tuple[dict[str, LinkFlowProfile], int]:
    """Close each group together, re-solve, accumulate peak velocity/flow.
    Seeds every profile with the shared nominal floor first."""
    profiles: dict[str, LinkFlowProfile] = {lid: LinkFlowProfile(velocity_fwd=p.velocity_fwd, velocity_rev=p.velocity_rev)
                                             for lid, p in floor.items()}
    model = _base_model(wn, demands)
    solved = 0
    with tempfile.TemporaryDirectory(prefix="cascade-batch-") as tmpdir:
        prefix = str(Path(tmpdir) / "g")
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
                for lk, st in zip(links, original):
                    lk.initial_status = st
            solved += 1
            _accumulate_profiles(profiles, link_ids, results.link["velocity"].iloc[0],
                                 results.link["flowrate"].iloc[0], exclude=frozenset(group))
    return profiles, solved


def _nominal_floor(wn, demands, link_ids) -> tuple[dict[str, LinkFlowProfile], dict[str, float]]:
    model = _base_model(wn, demands)
    profiles: dict[str, LinkFlowProfile] = {}
    flows: dict[str, float] = {}
    with tempfile.TemporaryDirectory(prefix="cascade-batch-") as tmpdir:
        results = _run_sweep_step(model, 1.0, str(Path(tmpdir) / "floor"))
        _accumulate_profiles(profiles, link_ids, results.link["velocity"].iloc[0], results.link["flowrate"].iloc[0])
        fr = results.link["flowrate"].iloc[0]
        for lid in set(wn.pipe_name_list) | set(wn.valve_name_list) | set(wn.pump_name_list):
            flows[lid] = abs(float(fr.get(lid, 0.0)))
    return profiles, flows


def _partition_groups(items, k, passes, rng):
    """`passes` random partitions of `items` into groups of size k — each item
    appears in exactly `passes` groups."""
    groups = []
    for _ in range(passes):
        shuffled = items[:]
        rng.shuffle(shuffled)
        for j in range(0, len(shuffled), k):
            groups.append(tuple(shuffled[j:j + k]))
    return groups


def analyse(path: str, seed: int = 1) -> None:
    name = os.path.basename(path)
    wn = wntr.network.WaterNetworkModel(path)
    demands = compute_junction_demands(wn, "peak_hour")
    link_ids = set(wn.pipe_name_list) | set(wn.valve_name_list)
    diam = {pid: wn.get_link(pid).diameter for pid in wn.pipe_name_list}
    rng = random.Random(seed)

    floor, flows = _nominal_floor(wn, demands, link_ids)
    candidates = sorted(_source_contracted_nonbridges(wn), key=lambda l: flows.get(l, 0.0), reverse=True)
    n = len(candidates)
    top = lambda frac: candidates[: max(1, round(n * frac))]

    print(f"\n=== {name} ({len(wn.pipe_name_list)} pipes) | {n} source-contracted non-bridge candidates ===")

    strategies = {
        "singles_all":       [(l,) for l in candidates],
        "singles_top15":     [(l,) for l in top(0.15)],
        "singles_top30":     [(l,) for l in top(0.30)],
        "batch3_cover2":     _partition_groups(candidates, 3, 2, random.Random(seed)),
        "batch5_cover2":     _partition_groups(candidates, 5, 2, random.Random(seed)),
        "batch5_top_cover2": _partition_groups(top(0.40), 5, 2, random.Random(seed)),
    }

    caps: dict[str, dict[str, float]] = {}
    solves: dict[str, int] = {}
    for tag, groups in strategies.items():
        prof, s = _run_groups(wn, demands, link_ids, groups, floor)
        caps[tag] = {pid: _capacity(prof.get(pid, LinkFlowProfile()).peak, diam[pid]) for pid in diam}
        solves[tag] = s

    # reference = best capacity seen for each pipe across all strategies
    ref = {pid: max(caps[t][pid] for t in strategies) for pid in diam}
    ref_total = sum(ref.values())

    print(f"  {'strategy':18s} {'solves':>7s} {'meancap/ref':>12s} {'total/ref':>10s} "
          f"{'within5%ofref':>14s} {'>ref? oversize':>15s}")
    for tag in strategies:
        c = caps[tag]
        # per-pipe recovery vs reference (only pipes with any reference signal)
        rel = [c[pid] / ref[pid] for pid in diam if ref[pid] > 1e-12]
        within = sum(1 for r in rel if r >= 0.95) / len(rel)
        total_ratio = sum(c.values()) / ref_total if ref_total else float("nan")
        # a strategy can DEFINE the reference on some pipes (over-sizing); count how often it is the sole max
        oversize = sum(1 for pid in diam if ref[pid] > 1e-12 and c[pid] >= ref[pid] - 1e-12)
        print(f"  {tag:18s} {solves[tag]:>7d} {statistics.mean(rel):>12.3f} {total_ratio:>10.3f} "
              f"{within:>13.1%} {oversize:>15d}")


NETWORKS = [
    "../raw-networks/aqueducts/Net3.inp",
    "../raw-networks/aqueducts/CTown.inp",
]

if __name__ == "__main__":
    for p in sys.argv[1:] or NETWORKS:
        analyse(p)
