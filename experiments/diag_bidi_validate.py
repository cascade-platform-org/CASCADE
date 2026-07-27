#!/usr/bin/env python3
"""Validate the ORIENTATION fix across all 8 networks: does making pipes
bidirectional-by-default (except physical one-way CHECK-VALVE pipes) improve
precision WITHOUT costing recall?

For each network, two bundles, identical except orientation, SAME (production)
priority so only orientation varies:
  M_prod = real simulated orientation (one-way where the sweep saw one-way flow)
  M_bidi = every pipe full-duplex, EXCEPT check-valve pipes kept one-way

A check valve physically permits flow one way only; forcing it open backward
could hide a real critical (recall loss), so it stays directional. Everything
else becomes bidirectional (a plain pipe can carry flow either way).

Partial situations for speed. Reports P/R/FMS for both; the fix is validated if
precision rises and recall holds on every network.

Run:  python experiments/diag_bidi_validate.py
"""
from __future__ import annotations

import math
import os
import statistics
import sys

BACKEND = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "CASCADE-backend")
sys.path.insert(0, BACKEND)
sys.path.insert(0, os.path.join(BACKEND, "scripts"))

import wntr  # noqa: E402

import validate_faithfulness as vf  # noqa: E402
import diag_drill_endtoend as e2e  # noqa: E402
from core.importers.inp import (  # noqa: E402
    ImportOptions, build_bundle, compute_junction_demands, link_flow_profiles, contingency_priorities,
)
from core.importers.inp.sim import LinkFlowProfile  # noqa: E402

N_LEVELS, REQ_P, MIN_P = 3, 20.0, 0.0
CAP = 8
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NETWORKS = ["Net1", "Net2", "Net3", "Cassacco_totale", "Tarcento_totale", "Zampis", "Modena", "CTown"]


def _is_check_valve(wn, pid):
    lk = wn.get_link(pid)
    return bool(getattr(lk, "check_valve", False))


def analyse(short):
    path = os.path.join(REPO, "raw-networks", "aqueducts", f"{short}.inp")
    if not os.path.exists(path):
        print(f"  SKIP {short}"); return
    wn = wntr.network.WaterNetworkModel(path)
    demands = compute_junction_demands(wn, "peak_hour")
    prof_real = link_flow_profiles(wn, demands, contingency_samples=20,
                                   contingency_exhaustive_trunk=True, contingency_multiplier=1.0)
    prio = contingency_priorities(wn, demands)   # held constant -> isolates orientation

    # bidirectional-by-default, except check-valve pipes.
    # CAPACITY-PRESERVING: use each pipe's OWN real peak velocity for BOTH
    # directions, so build_bundle derives the SAME capacity production gave it
    # (area x min(peak x margin, vmax)) — only the DIRECTION changes, not the
    # magnitude. Pipes the sweep never saw get the fallback velocity (same as
    # production would use), still made bidirectional.
    from core.importers.inp.sim import FALLBACK_VELOCITY_MS
    n_cv = 0
    prof_bidi = dict(prof_real)
    for pid in wn.pipe_name_list:
        if _is_check_valve(wn, pid):
            n_cv += 1
            prof_bidi[pid] = prof_real.get(pid, LinkFlowProfile(velocity_fwd=FALLBACK_VELOCITY_MS))  # keep one-way
        else:
            peak = prof_real[pid].peak if pid in prof_real and prof_real[pid].peak > 0 else FALLBACK_VELOCITY_MS
            prof_bidi[pid] = LinkFlowProfile(velocity_fwd=peak, velocity_rev=peak)

    opts = ImportOptions(demand_mode="peak_hour", n_levels=N_LEVELS)
    bP = build_bundle(wn, name=short, options=opts, flow_profiles=prof_real, priorities=prio)
    bB = build_bundle(wn, name=short, options=opts, flow_profiles=prof_bidi, priorities=prio)
    l2eP, l2nP = vf._build_link_maps(bP.project)
    l2eB, l2nB = vf._build_link_maps(bB.project)

    graph = vf._build_link_graph(wn)
    sits = (vf._cluster_situations(wn, graph, 1)[:CAP] + vf._targeted_situations(wn)[:CAP]
            + vf._tank_situations(wn)[:CAP] + vf._source_situations(wn)[:CAP])

    cP = vf.ConfusionCounts(); cB = vf.ConfusionCounts()
    fmsP = []; fmsB = []
    for s in sits:
        ratios, _ = vf._solve_served_ratios(wn, demands, s, REQ_P, MIN_P)
        if not ratios:
            continue
        lt = {j: vf._ratio_to_level(r, N_LEVELS) for j, r in ratios.items()}
        lP = vf._cascade_levels(bP.project, bP.config, s, l2eP, l2nP, demands)
        lB = vf._cascade_levels(bB.project, bB.config, s, l2eB, l2nB, demands)
        fmsP.append(vf._fms(lt, lP, demands, N_LEVELS)[0])
        fmsB.append(vf._fms(lt, lB, demands, N_LEVELS)[0])
        cP += vf._binary_confusion(lt, lP, demands)
        cB += vf._binary_confusion(lt, lB, demands)
    fp = statistics.mean(fmsP) if fmsP else float("nan")
    fb = statistics.mean(fmsB) if fmsB else float("nan")
    print(f"  {short:16s} ({n_cv} check-valve pipes)")
    print(f"      prod : FMS={fp:.3f} P={cP.precision:.3f} R={cP.recall:.3f} F1={cP.f1:.3f} (FP={cP.fp} FN={cP.fn})")
    print(f"      bidi : FMS={fb:.3f} P={cB.precision:.3f} R={cB.recall:.3f} F1={cB.f1:.3f} (FP={cB.fp} FN={cB.fn})")
    dr = cB.recall - cP.recall
    print(f"      => precision {cP.precision:.3f}->{cB.precision:.3f}, recall delta {dr:+.3f}"
          f"{'  <-- RECALL DROP' if dr < -0.01 else ''}")
    sys.stdout.flush()


if __name__ == "__main__":
    print(f"Bidirectional-by-default (except check valves) validation | cap {CAP}/family\n")
    for t in sys.argv[1:] or NETWORKS:
        try:
            analyse(t)
        except Exception as exc:
            print(f"  {t}: ERROR {exc}")
        sys.stdout.flush()
    print("\nBIDI_VALIDATE_DONE")
