#!/usr/bin/env python3
"""Why is flow-module precision low (over-prediction of criticality)?

Hypothesis: imported pipe capacities are BELOW the flows that actually occur
under failure, so the module's max-flow cannot deliver and it reports false
starvation. Test it directly: for every pipe, compare its imported capacity
(peak-velocity x margin) against the maximum |flow| WNTR pushes through it
across the validation situations. A pipe with imported_cap < observed_flow is
a false bottleneck the module invents.

Run from repo root:  python experiments/diag_precision.py
"""
from __future__ import annotations

import os
import random
import statistics
import sys
import tempfile

BACKEND = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "CASCADE-backend")
sys.path.insert(0, BACKEND)
sys.path.insert(0, os.path.join(BACKEND, "scripts"))

import wntr  # noqa: E402
import validate_faithfulness as vf  # noqa: E402
from core.importers.inp import ImportOptions, build_bundle, compute_junction_demands, link_flow_profiles  # noqa: E402
from core.importers.inp.map import FLOW_UNIT_SCALE  # noqa: E402
from core.importers.inp.sim import _fixed_demand_model  # noqa: E402


def analyse(path: str, situations: int = 20, seed: int = 1) -> None:
    name = os.path.basename(path)
    wn = wntr.network.WaterNetworkModel(path)
    graph = vf._build_link_graph(wn)
    demands = compute_junction_demands(wn, "peak")
    profiles = link_flow_profiles(wn, demands, contingency_exhaustive_trunk=True,
                                  contingency_samples=20, contingency_trunk_pairs=30)
    bundle = build_bundle(wn, name=name,
                          options=ImportOptions(demand_mode="peak", n_levels=3),
                          flow_profiles=profiles, priorities={})

    # inp pipe id -> imported capacity (sum both directions of a bidirectional split)
    cap_by_pipe: dict[str, float] = {}
    for e in bundle.project.edges.values():
        p = e.properties or {}
        if p.get("kind") == "pipe" and p.get("inp_id") and e.capacity is not None:
            # edge.capacity is in FLOW_UNIT_SCALE units (mL/s); back to SI m3/s
            # so it is comparable to WNTR's flowrate.
            cap_by_pipe[p["inp_id"]] = cap_by_pipe.get(p["inp_id"], 0.0) + e.capacity / FLOW_UNIT_SCALE

    # max |flow| WNTR actually pushes through each pipe across situations
    rng = random.Random(seed)  # one shared stream, as validate does
    sits = [vf._random_situation(wn, graph, rng, i) for i in range(situations)]
    obs_flow: dict[str, float] = {pid: 0.0 for pid in wn.pipe_name_list}
    for s in sits:
        model = _fixed_demand_model(wn, demands)
        _apply(model, wn, demands, s)
        with tempfile.TemporaryDirectory() as d:
            try:
                res = wntr.sim.EpanetSimulator(model).run_sim(file_prefix=os.path.join(d, "x"))
            except Exception:
                continue
        fr = res.link["flowrate"].iloc[0]
        for pid in wn.pipe_name_list:
            obs_flow[pid] = max(obs_flow[pid], abs(float(fr.get(pid, 0.0))))

    # compare
    ratios = []  # observed_flow / imported_capacity  (>1 => undersized false bottleneck)
    undersized = []
    for pid, cap in cap_by_pipe.items():
        f = obs_flow.get(pid, 0.0)
        if cap <= 0 or f <= 0:
            continue
        r = f / cap
        ratios.append(r)
        if r > 1.0:
            undersized.append((r, pid, f, cap))
    ratios.sort()
    undersized.sort(reverse=True)
    n = len(ratios)
    frac_under = sum(1 for r in ratios if r > 1.0) / n if n else 0.0
    print(f"\n=== {name}  ({len(wn.pipe_name_list)} pipes, {n} with flow+capacity) ===")
    print(f"  pipes where WNTR flow EXCEEDS imported capacity: {frac_under*100:.0f}%  "
          f"(these are the false bottlenecks)")
    if ratios:
        print(f"  observed_flow/imported_cap  median={statistics.median(ratios):.2f}  "
              f"p90={ratios[int(0.9*n)-1]:.2f}  max={ratios[-1]:.2f}")
    print(f"  worst undersized pipes (flow/cap, id, flow m3/s, cap m3/s):")
    for r, pid, f, cap in undersized[:8]:
        print(f"    x{r:5.1f}  pipe {pid:>8}  flow={f:.4f}  cap={cap:.4f}")


def _fix(wn, demands, s):
    return vf._fixed_demand_model(wn, demands)


def _apply(model, wn, demands, s):
    """Mirror vf._solve_served_ratios setup: fixed demands (hot-scaled), broken
    links closed, pumps open, PDD steady."""
    model.options.hydraulic.pattern = None
    for jid, dem in demands.items():
        factor = s.hot_factor if jid in s.hot_junction_ids else 1.0
        j = model.get_node(jid)
        j.demand_timeseries_list.clear()
        j.demand_timeseries_list.append((dem * factor, None, "diag"))
    for pump_id in wn.pump_name_list:
        model.get_link(pump_id).initial_status = "Open"
    for lid in s.broken_link_ids:
        model.get_link(lid).initial_status = "Closed"
    model.options.time.duration = 0
    model.options.hydraulic.demand_model = "PDD"
    model.options.hydraulic.required_pressure = 20.0
    model.options.hydraulic.minimum_pressure = 0.0


if __name__ == "__main__":
    targets = sys.argv[1:] or [
        os.path.join(BACKEND, "..", "raw-networks", "benchmark", "Modena.inp"),
        wntr.library.model_library.get_filepath("Net3"),
    ]
    for t in targets:
        analyse(t)
