#!/usr/bin/env python3
"""Are CTown's false positives caused by under-sized pipe capacity (the module
can't ROUTE water WNTR actually delivers), or by something else?

Decisive test: score the module twice on the same cluster/targeted situations ---
  M_prod  = production imported capacities
  M_inf   = every edge capacity set to ~infinite (nothing bottlenecks except
            source supply + connectivity)
A false positive = module says critical (level 1) where WNTR says supplied.
If M_inf's false positives collapse vs M_prod's, the over-flagging IS pipe
capacity: the water was available, the module just didn't believe the pipes
could carry it. Whatever FPs survive under infinite pipes are NOT capacity ---
they're disconnection or genuine source shortfall.

Run:  python experiments/diag_fp_capacity.py [net.inp]
"""
from __future__ import annotations

import os
import sys

BACKEND = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "CASCADE-backend")
sys.path.insert(0, BACKEND)
sys.path.insert(0, os.path.join(BACKEND, "scripts"))

import wntr  # noqa: E402

import validate_faithfulness as vf  # noqa: E402
from core.importers.inp import (  # noqa: E402
    ImportOptions, build_bundle, compute_junction_demands, link_flow_profiles, contingency_priorities,
)

N_LEVELS, REQ_P, MIN_P = 3, 20.0, 0.0
INF = 1e15


def _infinite_pipes(bundle):
    for edge in bundle.project.edges.values():
        if edge.capacity is not None:
            edge.capacity = INF
    return bundle


def analyse(path, cap=10):
    name = os.path.basename(path)
    wn = wntr.network.WaterNetworkModel(path)
    demands = compute_junction_demands(wn, "peak_hour")
    prof = link_flow_profiles(wn, demands, contingency_samples=20,
                              contingency_exhaustive_trunk=True, contingency_multiplier=1.0)
    prio = contingency_priorities(wn, demands)
    opts = ImportOptions(demand_mode="peak_hour", n_levels=N_LEVELS)
    bP = build_bundle(wn, name=name, options=opts, flow_profiles=prof, priorities=prio)
    bI = _infinite_pipes(build_bundle(wn, name=name, options=opts, flow_profiles=prof, priorities=prio))
    l2e, l2n = vf._build_link_maps(bP.project)

    graph = vf._build_link_graph(wn)
    sits = vf._cluster_situations(wn, graph, 1)[:cap] + vf._targeted_situations(wn)[:cap]

    print(f"\n=== {name}: do false positives survive infinite pipe capacity? ===")
    fpP = fpI = tpP = tpI = fp_fixed = 0
    for s in sits:
        ratios, _ = vf._solve_served_ratios(wn, demands, s, REQ_P, MIN_P)
        if not ratios:
            continue
        lt = {j: vf._ratio_to_level(r, N_LEVELS) for j, r in ratios.items()}
        lP = vf._cascade_levels(bP.project, bP.config, s, l2e, l2n, demands)
        lI = vf._cascade_levels(bI.project, bI.config, s, l2e, l2n, demands)
        severed = vf._severed_junctions(wn, s)
        for j, tv in lt.items():
            wnt_ok = tv > 1
            modP_crit = lP.get(j, N_LEVELS) <= 1
            modI_crit = lI.get(j, N_LEVELS) <= 1
            if wnt_ok and modP_crit:
                fpP += 1
                if not modI_crit:
                    fp_fixed += 1          # infinite pipes cured this FP -> capacity-caused
            if wnt_ok and modI_crit:
                fpI += 1
            if not wnt_ok and modP_crit:
                tpP += 1
            if not wnt_ok and modI_crit:
                tpI += 1
        # of the FPs that SURVIVE infinite pipes, how many are actually disconnected?
    print(f"  false positives: M_prod={fpP}   M_infinite-pipes={fpI}   "
          f"(cured by uncapping = {fp_fixed}, {100*fp_fixed/fpP if fpP else 0:.0f}% of prod FPs)")
    print(f"  true positives : M_prod={tpP}   M_infinite-pipes={tpI}   "
          f"(recall preserved if these stay equal)")
    print(f"  => {'CAPACITY-ROUTING confirmed: most FPs vanish when pipes are uncapped' if fpP and fp_fixed >= 0.6*fpP else 'FPs NOT mainly capacity — investigate source/connectivity'}")


if __name__ == "__main__":
    for p in sys.argv[1:] or ["../raw-networks/aqueducts/CTown.inp"]:
        analyse(p)
