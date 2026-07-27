#!/usr/bin/env python3
"""Design-velocity sensitivity for the SIMPLIFIED design (no capacity drill):
capacity = area x V (uniform design velocity), priority = flow-ranked singles.

Sweeps V in {2.5, 3.0, 3.5} on all 8 networks (partial situations for speed) and
reports precision / recall / FMS. The key question: does raising V (more capacity
-> more optimistic) hold RECALL everywhere, or does some network start missing
real criticals (recall drop) -> V too high there.

Structure (orientation/duplex) comes from one demand-sweep; capacity is then
overwritten with the uniform formula; priority is the flow-ranked top-15% single
drill. Ground truth is solved once per network and shared across the 3 velocities.

Run:  python experiments/diag_velocity_sensitivity.py
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
    ImportOptions, build_bundle, compute_junction_demands, link_flow_profiles,
)
from core.importers.inp.map import FLOW_UNIT_SCALE  # noqa: E402

N_LEVELS, REQ_P, MIN_P = 3, 20.0, 0.0
VELOCITIES = [2.5, 3.0, 3.5]
CAP = 8  # situations per family

NETWORKS = [
    "Net1", "Net2", "Net3",
    "Cassacco_totale", "Tarcento_totale", "Zampis", "Modena", "CTown",
]


def _uniform_v(bundle, wn, v):
    diam = {pid: wn.get_link(pid).diameter for pid in wn.pipe_name_list}
    pipes = set(wn.pipe_name_list)
    for eid, edge in bundle.project.edges.items():
        base = eid[2:] if eid.startswith("e_") else eid
        for suf in ("__fwd", "__rev", "__in", "__out"):
            if base.endswith(suf):
                base = base[: -len(suf)]
        if base in pipes:
            edge.capacity = math.pi / 4.0 * diam[base] ** 2 * v * FLOW_UNIT_SCALE
    return bundle


REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def analyse(short):
    path = os.path.join(REPO, "raw-networks", "aqueducts", f"{short}.inp")
    if not os.path.exists(path):
        print(f"  SKIP {short}: not found")
        return
    wn = wntr.network.WaterNetworkModel(path)
    demands = compute_junction_demands(wn, "peak_hour")
    flows = e2e._nominal_flows(wn, demands)
    cand = e2e._candidates(wn, flows)
    prof = link_flow_profiles(wn, demands, contingency_samples=0)   # structure only
    prio = e2e._flowranked_single_priority(wn, demands, cand)
    opts = ImportOptions(demand_mode="peak_hour", n_levels=N_LEVELS)

    graph = vf._build_link_graph(wn)
    sits = (vf._cluster_situations(wn, graph, 1)[:CAP] + vf._targeted_situations(wn)[:CAP]
            + vf._tank_situations(wn)[:CAP] + vf._source_situations(wn)[:CAP])
    gt = {}
    for s in sits:
        ratios, _ = vf._solve_served_ratios(wn, demands, s, REQ_P, MIN_P)
        gt[s.label] = {j: vf._ratio_to_level(r, N_LEVELS) for j, r in ratios.items()} if ratios else None
    sits = [s for s in sits if gt[s.label] is not None]

    print(f"\n{short}  ({len(sits)} situations)")
    for v in VELOCITIES:
        b = _uniform_v(build_bundle(wn, name=short, options=opts, flow_profiles=prof, priorities=prio), wn, v)
        c, fbyfam, _ = e2e._score(b, sits, wn, demands, gt)
        allf = [x for vv in fbyfam.values() for x in vv]
        fms = statistics.mean(allf) if allf else float("nan")
        print(f"    V={v:<4} FMS={fms:.3f}  P={c.precision:.3f}  R={c.recall:.3f}  F1={c.f1:.3f}  (FP={c.fp} FN={c.fn})")
    sys.stdout.flush()


if __name__ == "__main__":
    targets = sys.argv[1:] or NETWORKS
    print(f"Design-velocity sensitivity | V in {VELOCITIES} | cap {CAP}/family")
    for t in targets:
        try:
            analyse(t)
        except Exception as exc:
            print(f"  {t}: ERROR {exc}")
        sys.stdout.flush()
    print("\nVELOCITY_SENSITIVITY_DONE")
