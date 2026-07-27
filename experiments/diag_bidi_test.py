#!/usr/bin/env python3
"""Confirming test for the ORIENTATION hypothesis: are CTown's false positives
caused by one-way pipe edges that block failure-rerouted (reverse) flow?

The FP-capacity test showed uncapping pipes cures 0% of FPs -> not capacity.
Here we instead force EVERY pipe full-duplex (both directions allowed, via a
fabricated both-directions flow profile) and re-score. If the false positives
collapse, the module's directed edges were the cause; whatever survives is
genuine undirected disconnection. We also track true positives -> does making
everything bidirectional cost recall (over-optimistic rerouting)?

Run:  python experiments/diag_bidi_test.py [net.inp]
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
from core.importers.inp.sim import LinkFlowProfile  # noqa: E402

N_LEVELS, REQ_P, MIN_P = 3, 20.0, 0.0


def analyse(path, cap=10):
    name = os.path.basename(path)
    wn = wntr.network.WaterNetworkModel(path)
    demands = compute_junction_demands(wn, "peak_hour")
    prof_real = link_flow_profiles(wn, demands, contingency_samples=20,
                                   contingency_exhaustive_trunk=True, contingency_multiplier=1.0)
    # force every pipe (and valve) full-duplex: signal in BOTH directions
    prof_bidi = {lid: LinkFlowProfile(velocity_fwd=1.0, velocity_rev=1.0)
                 for lid in list(wn.pipe_name_list) + list(wn.valve_name_list)}
    prio = contingency_priorities(wn, demands)
    opts = ImportOptions(demand_mode="peak_hour", n_levels=N_LEVELS)
    bP = build_bundle(wn, name=name, options=opts, flow_profiles=prof_real, priorities=prio)
    bB = build_bundle(wn, name=name, options=opts, flow_profiles=prof_bidi, priorities=prio)
    l2eP, l2nP = vf._build_link_maps(bP.project)
    l2eB, l2nB = vf._build_link_maps(bB.project)

    graph = vf._build_link_graph(wn)
    sits = vf._cluster_situations(wn, graph, 1)[:cap] + vf._targeted_situations(wn)[:cap]

    print(f"\n=== {name}: do false positives survive forcing every pipe BIDIRECTIONAL? ===")
    fpP = fpB = tpP = tpB = fp_fixed = fp_survive_severed = 0
    for s in sits:
        ratios, _ = vf._solve_served_ratios(wn, demands, s, REQ_P, MIN_P)
        if not ratios:
            continue
        lt = {j: vf._ratio_to_level(r, N_LEVELS) for j, r in ratios.items()}
        lP = vf._cascade_levels(bP.project, bP.config, s, l2eP, l2nP, demands)
        lB = vf._cascade_levels(bB.project, bB.config, s, l2eB, l2nB, demands)
        severed = vf._severed_junctions(wn, s)
        for j, tv in lt.items():
            wnt_ok = tv > 1
            pc = lP.get(j, N_LEVELS) <= 1
            bc = lB.get(j, N_LEVELS) <= 1
            if wnt_ok and pc:
                fpP += 1
                if not bc:
                    fp_fixed += 1
                elif j in severed:
                    fp_survive_severed += 1
            if wnt_ok and bc:
                fpB += 1
            if not wnt_ok and pc:
                tpP += 1
            if not wnt_ok and bc:
                tpB += 1
    print(f"  false positives: M_prod={fpP}   M_all-bidirectional={fpB}   "
          f"(cured by bidirectionality = {fp_fixed}, {100*fp_fixed/fpP if fpP else 0:.0f}% of prod FPs)")
    print(f"  of surviving FPs: {fp_survive_severed} are undirected-disconnected (genuine)")
    print(f"  true positives : M_prod={tpP}   M_all-bidirectional={tpB}   "
          f"(recall lost if bidi << prod)")
    verdict = ("ORIENTATION confirmed: most FPs vanish when pipes flow both ways"
               if fpP and fp_fixed >= 0.5 * fpP else "orientation NOT the main cause")
    print(f"  => {verdict}")


if __name__ == "__main__":
    for p in sys.argv[1:] or ["../raw-networks/aqueducts/CTown.inp"]:
        analyse(p)
