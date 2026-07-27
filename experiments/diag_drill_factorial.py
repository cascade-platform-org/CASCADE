#!/usr/bin/env python3
"""Disentangle the C->B gain: is it PRIORITY or CAPACITY?

B differs from C in two things at once (capacity method AND priority method).
This runs a clean 2x2 --- capacity {uniform-2.5, batch-drill} x priority
{production-contingency, flow-ranked-single} --- with the SAME graph structure
(orientation/duplex) across all four cells, so only the two named factors vary.

  cap=batch  = build_bundle's own capacities from (demand sweep + batch-5 drill)
  cap=unif   = same structure, every pipe edge overwritten with area x 2.5 m/s
  prio=prod  = contingency_priorities (cycle-trunk singles/pairs/triplets)
  prio=flow  = flow-ranked top-15% single closures

Cell (batch, flow) == method B; (unif, prod) ~= method C. The row/column deltas
isolate each factor.

Run:  python experiments/diag_drill_factorial.py [net.inp ...]
"""
from __future__ import annotations

import os
import statistics
import sys

BACKEND = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "CASCADE-backend")
sys.path.insert(0, BACKEND)
sys.path.insert(0, os.path.join(BACKEND, "scripts"))

import wntr  # noqa: E402

import validate_faithfulness as vf  # noqa: E402
import diag_drill_endtoend as e2e  # noqa: E402  (reuse helpers)
from core.importers.inp import (  # noqa: E402
    ImportOptions, build_bundle, compute_junction_demands, link_flow_profiles, contingency_priorities,
)

N_LEVELS, REQ_P, MIN_P = 3, 20.0, 0.0


def analyse(path, cap=12, seed=1):
    name = os.path.basename(path)
    wn = wntr.network.WaterNetworkModel(path)
    demands = compute_junction_demands(wn, "peak_hour")
    flows = e2e._nominal_flows(wn, demands)
    cand = e2e._candidates(wn, flows)
    print(f"\n=== {name} | {len(cand)} candidates | cap {cap}/family ===")

    # ONE structure for all cells: demand sweep + batch-5 drill profiles
    prof = e2e._merge(link_flow_profiles(wn, demands, contingency_samples=0),
                      e2e._batch_capacity(wn, demands, cand))
    prio_prod = contingency_priorities(wn, demands)
    prio_flow = e2e._flowranked_single_priority(wn, demands, cand)

    def mk(prio, uniform):
        b = build_bundle(wn, name=name, options=ImportOptions(demand_mode="peak_hour", n_levels=N_LEVELS),
                        flow_profiles=prof, priorities=prio)
        if uniform:
            e2e._uniform_override(b, wn)
        return b

    cells = {
        "cap=batch prio=prod": mk(prio_prod, False),
        "cap=unif  prio=prod": mk(prio_prod, True),
        "cap=batch prio=flow": mk(prio_flow, False),   # == method B
        "cap=unif  prio=flow": mk(prio_flow, True),
    }

    graph = vf._build_link_graph(wn)
    sits = (vf._cluster_situations(wn, graph, seed)[:cap] + vf._targeted_situations(wn)[:cap]
            + vf._tank_situations(wn)[:cap] + vf._source_situations(wn)[:cap])
    gt = {}
    for s in sits:
        ratios, _ = vf._solve_served_ratios(wn, demands, s, REQ_P, MIN_P)
        gt[s.label] = {j: vf._ratio_to_level(r, N_LEVELS) for j, r in ratios.items()} if ratios else None
    sits = [s for s in sits if gt[s.label] is not None]
    print(f"  {len(sits)} situations with valid ground truth\n")

    print(f"  {'cell':22s} {'FMS':>6s} {'prec':>6s} {'rec':>6s} {'F1':>6s} {'FP':>6s}")
    res = {}
    fam_res = {}
    for tag, b in cells.items():
        c, fbyfam, cfbyfam = e2e._score(b, sits, wn, demands, gt)
        allf = [x for v in fbyfam.values() for x in v]
        fms = statistics.mean(allf) if allf else float("nan")
        res[tag] = (fms, c)
        fam_res[tag] = cfbyfam
        print(f"  {tag:22s} {fms:>6.3f} {c.precision:>6.3f} {c.recall:>6.3f} {c.f1:>6.3f} {c.fp:>6d}")

    print("\n  per-family precision/recall:")
    for fam in ("cluster", "targeted", "tank", "source"):
        cellstr = "   ".join(
            f"{tag.split()[0][4:]}/{tag.split()[1][5:]}:{fam_res[tag][fam].precision:.2f}/{fam_res[tag][fam].recall:.2f}"
            for tag in cells)
        print(f"    {fam:9s} {cellstr}")

    # isolate the factors (precision)
    print("\n  factor isolation (precision):")
    p = {t: res[t][1].precision for t in cells}
    print(f"    CAPACITY (unif->batch): prio=prod {p['cap=unif  prio=prod']:.3f}->{p['cap=batch prio=prod']:.3f}"
          f"   prio=flow {p['cap=unif  prio=flow']:.3f}->{p['cap=batch prio=flow']:.3f}")
    print(f"    PRIORITY (prod->flow):  cap=unif  {p['cap=unif  prio=prod']:.3f}->{p['cap=unif  prio=flow']:.3f}"
          f"   cap=batch {p['cap=batch prio=prod']:.3f}->{p['cap=batch prio=flow']:.3f}")


NETWORKS = ["../raw-networks/aqueducts/Net3.inp", "../raw-networks/aqueducts/CTown.inp"]

if __name__ == "__main__":
    for pth in sys.argv[1:] or NETWORKS:
        analyse(pth)
