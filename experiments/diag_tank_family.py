#!/usr/bin/env python3
"""Why does the flow module miss CTown's tank criticals (tank recall ~0 on
CTown, but ~1.0 on every other network)?

For each single-tank isolation on CTown, compare junction-by-junction:
  - WNTR ground truth  (level 1 = critical)
  - the flow module    (_cascade_levels)
  - reachability       (severed = no path to any source after the closure)

The decisive split, over the junctions WNTR calls critical:
  - SEVERED (disconnected)      -> should be caught by connectivity alone;
                                   if the module misses these it's a real bug.
  - REACHABLE (still connected) -> the module keeps them supplied by rerouting
                                   from another source; WNTR nonetheless starves
                                   them -> a PRESSURE effect the quantity-only
                                   module cannot see.

Run:  python experiments/diag_tank_family.py [net.inp]
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


def analyse(path):
    name = os.path.basename(path)
    wn = wntr.network.WaterNetworkModel(path)
    demands = compute_junction_demands(wn, "peak_hour")
    prof = link_flow_profiles(wn, demands, contingency_samples=20,
                              contingency_exhaustive_trunk=True, contingency_multiplier=1.0)
    prio = contingency_priorities(wn, demands)
    bundle = build_bundle(wn, name=name, options=ImportOptions(demand_mode="peak_hour", n_levels=N_LEVELS),
                         flow_profiles=prof, priorities=prio)
    l2e, l2n = vf._build_link_maps(bundle.project)

    print(f"\n=== {name}: {len(wn.tank_name_list)} tanks, {len(wn.reservoir_name_list)} reservoirs ===")
    tank_sits = vf._tank_situations(wn)
    singles = [s for s in tank_sits if s.label.split("#")[1].isdigit()][:len(wn.tank_name_list)]

    tot_true = tot_sev = tot_reach = tot_mod_caught = 0
    for s in tank_sits[:12]:
        ratios, _ = vf._solve_served_ratios(wn, demands, s, REQ_P, MIN_P)
        if not ratios:
            continue
        lt = {j: vf._ratio_to_level(r, N_LEVELS) for j, r in ratios.items()}
        lc = vf._cascade_levels(bundle.project, bundle.config, s, l2e, l2n, demands)
        severed = vf._severed_junctions(wn, s)

        true_crit = {j for j, lv in lt.items() if lv <= 1}
        if not true_crit:
            continue
        sev = {j for j in true_crit if j in severed}
        reach = true_crit - sev
        mod_caught = {j for j in true_crit if lc.get(j, N_LEVELS) <= 1}
        # module's delivered ratio (level) on the REACHABLE-but-WNTR-critical ones
        mod_levels_on_reach = sorted(lc.get(j, N_LEVELS) for j in reach)
        tot_true += len(true_crit); tot_sev += len(sev)
        tot_reach += len(reach); tot_mod_caught += len(mod_caught)
        print(f"  {s.label:10s} broken={s.broken_link_ids} | WNTR-crit={len(true_crit):3d} "
              f"severed={len(sev):3d} reachable={len(reach):3d} | module-caught={len(mod_caught):3d} "
              f"| module lvl on reachable: {mod_levels_on_reach[:8]}")

    print(f"\n  TOTAL over tank situations: WNTR-critical={tot_true}  "
          f"severed(disconnected)={tot_sev}  reachable(still connected)={tot_reach}")
    print(f"  module caught {tot_mod_caught}/{tot_true}  "
          f"({'PRESSURE effect — reachable but starved in reality' if tot_reach > tot_sev else 'mostly disconnection'})")


if __name__ == "__main__":
    for p in sys.argv[1:] or ["../raw-networks/aqueducts/CTown.inp"]:
        analyse(p)
