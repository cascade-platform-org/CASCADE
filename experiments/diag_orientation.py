#!/usr/bin/env python3
"""Is the flow module's LOW PRECISION (false starvation) caused by fixed pipe
ORIENTATION rather than capacity?

Capacity is not the binding constraint (diag_precision.py: every pipe uses
<50% of its imported capacity). Hypothesis: the module fixes each pipe to one
direction from the sweep; under a failure WNTR reroutes by REVERSING pipes the
sweep never saw reverse, so the module's directed graph cannot deliver water it
physically could -> false 'critical'.

Test: re-import with EVERY pipe forced full-duplex (both directions capacitated)
and compare precision/recall/FMS against the shipped orientation logic, on the
SAME situations and ground truth.

Run from repo root:  python experiments/diag_orientation.py [net.inp ...]
"""
from __future__ import annotations

import copy
import os
import random
import sys

BACKEND = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "CASCADE-backend")
sys.path.insert(0, BACKEND)
sys.path.insert(0, os.path.join(BACKEND, "scripts"))

import wntr  # noqa: E402
import validate_faithfulness as vf  # noqa: E402
from core.importers.inp import ImportOptions, build_bundle, compute_junction_demands, link_flow_profiles  # noqa: E402


def _force_bidirectional(profiles):
    """Make every pipe with any signal full-duplex: set both directions to the
    peak so map.py's _emit_split path fires for all of them."""
    out = {}
    for pid, pr in profiles.items():
        p = copy.deepcopy(pr)
        peak = max(p.velocity_fwd, p.velocity_rev)
        p.velocity_fwd = peak
        p.velocity_rev = peak
        out[pid] = p
    return out


def _score(bundle, wn, demands, sits, req_p=20.0, min_p=0.0, nlv=3):
    l2e, l2n = vf._build_link_maps(bundle.project)
    conf = vf.ConfusionCounts()
    scores = []
    for s in sits:
        ratios, _ = vf._solve_served_ratios(wn, demands, s, req_p, min_p)
        if not ratios:
            continue
        lt = {j: vf._ratio_to_level(r, nlv) for j, r in ratios.items()}
        lc = vf._cascade_levels(bundle.project, bundle.config, s, l2e, l2n, demands)
        sc, _ = vf._fms(lt, lc, demands, nlv)
        scores.append(sc)
        conf += vf._binary_confusion(lt, lc, demands)
    import statistics
    return (statistics.mean(scores) if scores else float("nan")), conf


def analyse(path: str, situations: int = 20, seed: int = 1) -> None:
    name = os.path.basename(path)
    wn = wntr.network.WaterNetworkModel(path)
    graph = vf._build_link_graph(wn)
    demands = compute_junction_demands(wn, "peak")
    profiles = link_flow_profiles(wn, demands, contingency_exhaustive_trunk=True,
                                  contingency_samples=20, contingency_trunk_pairs=30)

    opts = ImportOptions(demand_mode="peak", n_levels=3)
    b_default = build_bundle(wn, name=name, options=opts, flow_profiles=profiles, priorities={})
    b_bidi = build_bundle(wn, name=name, options=opts,
                          flow_profiles=_force_bidirectional(profiles), priorities={})

    rng = random.Random(seed)  # one stream shared across draws, as validate does
    sits = [vf._random_situation(wn, graph, rng, i) for i in range(situations)]
    sits += vf._tank_situations(wn)

    fms_d, c_d = _score(b_default, wn, demands, sits)
    fms_b, c_b = _score(b_bidi, wn, demands, sits)
    n_edges_d = len(b_default.project.edges)
    n_edges_b = len(b_bidi.project.edges)
    print(f"\n=== {name} ({situations}+tank sits) ===")
    print(f"  {'variant':16} {'edges':>6} {'FMS':>7} {'prec':>6} {'recall':>7} {'TP':>5} {'FP':>5} {'FN':>5}")
    print(f"  {'default orient':16} {n_edges_d:>6} {fms_d:>7.3f} {c_d.precision:>6.2f} {c_d.recall:>7.2f} "
          f"{c_d.tp:>5} {c_d.fp:>5} {c_d.fn:>5}")
    print(f"  {'all bidirectional':16} {n_edges_b:>6} {fms_b:>7.3f} {c_b.precision:>6.2f} {c_b.recall:>7.2f} "
          f"{c_b.tp:>5} {c_b.fp:>5} {c_b.fn:>5}")


if __name__ == "__main__":
    targets = sys.argv[1:] or [os.path.join(BACKEND, "..", "raw-networks", "benchmark", "Modena.inp")]
    for t in targets:
        analyse(t)
