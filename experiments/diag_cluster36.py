#!/usr/bin/env python3
"""Diagnose why CTown cluster#36 scores FMS~0.04: dump, for that one situation,
the severed set and each side's per-junction verdict (truth vs CASCADE)."""
from __future__ import annotations

import os
import sys
from collections import Counter

BACKEND = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "CASCADE-backend")
sys.path.insert(0, BACKEND)
sys.path.insert(0, os.path.join(BACKEND, "scripts"))

import wntr  # noqa: E402
import validate_faithfulness as vf  # noqa: E402
from core.importers.inp import ImportOptions, build_bundle, compute_junction_demands, link_flow_profiles  # noqa: E402

REQ_P, MIN_P, N = 20.0, 0.0, 3
path = os.path.join(BACKEND, "../raw-networks/aqueducts/CTown.inp")
wn = wntr.network.WaterNetworkModel(path)
graph = vf._build_link_graph(wn)
demands = compute_junction_demands(wn, "peak_hour")
fp = link_flow_profiles(wn, demands, contingency_exhaustive_trunk=True)
bundle = build_bundle(wn, name="CTown", options=ImportOptions(demand_mode="peak_hour", n_levels=N),
                      flow_profiles=fp, priorities={})
l2e, l2n = vf._build_link_maps(bundle.project)

sit = next(s for s in vf._cluster_situations(wn, graph, 1) if s.label == "cluster#36")
print("broken links:", sit.broken_link_ids)

ratios, _ = vf._solve_served_ratios(wn, demands, sit, REQ_P, MIN_P)
truth = {j: vf._ratio_to_level(r, N) for j, r in ratios.items()}
casc = vf._cascade_levels(bundle.project, bundle.config, sit, l2e, l2n, demands)
severed = vf._severed_junctions(wn, sit)

common = [j for j in truth if j in casc and demands.get(j, 0) > 0]
print(f"junctions compared: {len(common)}  severed(undirected): {len(severed & set(common))}")
print("truth level dist:  ", dict(Counter(truth[j] for j in common)))
print("cascade level dist:", dict(Counter(casc[j] for j in common)))

# disagreement breakdown
flip_tc = [j for j in common if truth[j] == 1 and casc[j] > 1]  # truth critical, cascade ok
flip_ct = [j for j in common if truth[j] > 1 and casc[j] == 1]  # truth ok, cascade critical
print(f"truth-critical but cascade-operational: {len(flip_tc)}  (demand {sum(demands[j] for j in flip_tc):.4f})")
print(f"truth-operational but cascade-critical: {len(flip_ct)}  (demand {sum(demands[j] for j in flip_ct):.4f})")
print("severed & cascade-operational (should be critical):",
      len([j for j in (severed & set(common)) if casc[j] > 1]))
print("severed & truth-operational (should be critical):",
      len([j for j in (severed & set(common)) if truth[j] > 1]))
