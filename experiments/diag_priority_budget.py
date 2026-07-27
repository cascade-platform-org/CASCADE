#!/usr/bin/env python3
"""How many single-link closures does the PRIORITY drill actually need?

Priority ranks junctions by fragility; the engine only ever sheds the
lowest-priority first. So the question is: how large a top-flow single-closure
budget until the SHED-FIRST ranking converges to the full single-break ensemble
--- and does flow-ordering converge faster than random ordering?

Candidate closures = source-contracted non-bridge links (closing a source-bridge
only disconnects, which reachability already predicts and which gives no
fragility signal). Each candidate is closed once at nominal demand; per-junction
deficit `d_j * max(0, 1 - delivered_ratio_j)` is recorded. A budget's priority
is the prefix-sum over the top-b closures (flow order) or a random b.

We solve every candidate once, then compose all budgets from those results (no
re-solving per budget). Reference = all candidates.

Metrics vs reference, per budget:
  spearman   rank correlation of accumulated deficit over demand junctions
  shed@20%   overlap (Jaccard) of the bottom-20%-priority (shed-first) set
  lvl-match  fraction of junctions whose 1..10 priority level equals reference

Run:  python experiments/diag_priority_budget.py [net.inp ...]
"""
from __future__ import annotations

import math
import os
import random
import sys
import tempfile
from collections import Counter
from pathlib import Path

BACKEND = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "CASCADE-backend")
sys.path.insert(0, BACKEND)

import networkx as nx  # noqa: E402
import wntr  # noqa: E402

from core.importers.inp import compute_junction_demands  # noqa: E402
from core.importers.inp.sim import (  # noqa: E402
    _fixed_demand_model,
    _run_sweep_step,
    _REQUIRED_PRESSURE_M,
    _MINIMUM_PRESSURE_M,
)


def _source_contracted_nonbridges(wn) -> set[str]:
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
            continue
        out.add(lid)
    return out


def _base_model(wn, demands):
    model = _fixed_demand_model(wn, demands)
    model.options.time.duration = 0
    model.options.hydraulic.demand_model = "PDD"
    model.options.hydraulic.required_pressure = _REQUIRED_PRESSURE_M
    model.options.hydraulic.minimum_pressure = _MINIMUM_PRESSURE_M
    return model


def _priority_from_deficit(deficit: dict[str, float]) -> dict[str, int]:
    worst = max(deficit.values()) if deficit else 0.0
    if worst <= 0:
        return {j: 10 for j in deficit}
    return {j: max(1, min(10, 10 - round(9 * d / worst))) for j, d in deficit.items()}


def _rank(values: list[float]) -> list[float]:
    order = sorted(range(len(values)), key=lambda i: values[i])
    ranks = [0.0] * len(values)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        avg = (i + j) / 2.0
        for k in range(i, j + 1):
            ranks[order[k]] = avg
        i = j + 1
    return ranks


def _spearman(a: list[float], b: list[float]) -> float:
    ra, rb = _rank(a), _rank(b)
    n = len(a)
    ma, mb = sum(ra) / n, sum(rb) / n
    cov = sum((ra[i] - ma) * (rb[i] - mb) for i in range(n))
    va = math.sqrt(sum((ra[i] - ma) ** 2 for i in range(n)))
    vb = math.sqrt(sum((rb[i] - mb) ** 2 for i in range(n)))
    return cov / (va * vb) if va > 0 and vb > 0 else float("nan")


def _shed_set(priority: dict[str, int], junctions: list[str], frac: float) -> set[str]:
    k = max(1, round(len(junctions) * frac))
    # lowest priority = shed first; tie-break stable by id for determinism
    return set(sorted(junctions, key=lambda j: (priority[j], j))[:k])


def analyse(path: str, seed: int = 1) -> None:
    name = os.path.basename(path)
    wn = wntr.network.WaterNetworkModel(path)
    demands = compute_junction_demands(wn, "peak_hour")
    junctions = [j for j, d in demands.items() if d > 0]

    # nominal flows for ranking
    model = _base_model(wn, demands)
    with tempfile.TemporaryDirectory(prefix="cascade-prio-") as tmpdir:
        fr = _run_sweep_step(model, 1.0, str(Path(tmpdir) / "floor")).link["flowrate"].iloc[0]
    flows = {lid: abs(float(fr.get(lid, 0.0)))
             for lid in set(wn.pipe_name_list) | set(wn.valve_name_list) | set(wn.pump_name_list)}

    candidates = sorted(_source_contracted_nonbridges(wn), key=lambda l: flows.get(l, 0.0), reverse=True)
    n = len(candidates)
    print(f"\n=== {name} | {len(junctions)} demand junctions | {n} candidate single closures ===")

    # solve every candidate once; record its per-junction deficit contribution
    per_closure: list[dict[str, float]] = []
    model = _base_model(wn, demands)
    solved = 0
    with tempfile.TemporaryDirectory(prefix="cascade-prio-") as tmpdir:
        prefix = str(Path(tmpdir) / "c")
        for i, lid in enumerate(candidates):
            link = model.get_link(lid)
            orig = link.initial_status
            link.initial_status = "Closed"
            try:
                res = _run_sweep_step(model, 1.0, f"{prefix}-{i}")
            except Exception:
                per_closure.append({})
                continue
            finally:
                link.initial_status = orig
            solved += 1
            delivered = res.node["demand"].iloc[0]
            contrib = {}
            for j in junctions:
                exp = demands[j]
                got = float(delivered.get(j, 0.0))
                ratio = got / exp if exp > 0 else 1.0
                if math.isfinite(ratio):
                    contrib[j] = exp * max(0.0, 1.0 - ratio)
            per_closure.append(contrib)
    print(f"  solved {solved}/{n} candidates")

    def deficit_over(idxs) -> dict[str, float]:
        d = dict.fromkeys(junctions, 0.0)
        for i in idxs:
            for j, v in per_closure[i].items():
                d[j] += v
        return d

    ref_def = deficit_over(range(n))
    ref_prio = _priority_from_deficit(ref_def)
    ref_vec = [ref_def[j] for j in junctions]
    ref_shed = _shed_set(ref_prio, junctions, 0.20)

    print(f"  {'budget':>8s} {'nclose':>7s} | {'flow: spear':>12s} {'shed@20':>8s} {'lvlmatch':>9s} "
          f"| {'rand: spear':>12s} {'shed@20':>8s}")
    rng = random.Random(seed)
    for frac in (0.05, 0.10, 0.15, 0.25, 0.50, 1.00):
        b = max(1, round(n * frac))
        # flow order = top-b
        d_flow = deficit_over(range(b))
        p_flow = _priority_from_deficit(d_flow)
        sp_f = _spearman([d_flow[j] for j in junctions], ref_vec)
        shed_f = _shed_set(p_flow, junctions, 0.20)
        jac_f = len(shed_f & ref_shed) / len(shed_f | ref_shed) if (shed_f | ref_shed) else 1.0
        lvl = sum(1 for j in junctions if p_flow[j] == ref_prio[j]) / len(junctions)
        # random order = b random candidates
        ridx = rng.sample(range(n), b)
        d_rand = deficit_over(ridx)
        p_rand = _priority_from_deficit(d_rand)
        sp_r = _spearman([d_rand[j] for j in junctions], ref_vec)
        shed_r = _shed_set(p_rand, junctions, 0.20)
        jac_r = len(shed_r & ref_shed) / len(shed_r | ref_shed) if (shed_r | ref_shed) else 1.0
        print(f"  {frac:>7.0%} {b:>7d} | {sp_f:>12.3f} {jac_f:>8.2f} {lvl:>9.2f} "
              f"| {sp_r:>12.3f} {jac_r:>8.2f}")


NETWORKS = [
    "../raw-networks/aqueducts/Net3.inp",
    "../raw-networks/aqueducts/CTown.inp",
]

if __name__ == "__main__":
    for p in sys.argv[1:] or NETWORKS:
        analyse(p)
