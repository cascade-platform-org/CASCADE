#!/usr/bin/env python3
"""Held-out selection of the importer capacity margin (CLAUDE plan A).

The x2 capacity margin was originally chosen on the same six networks the
paper evaluates on -- a leakage / overfitting concern. This script re-selects
it on networks that are NOT in the evaluation set (ky10, Net6), so the choice
is made on held-out data.

Efficiency: the margin is a pure post-multiplier on pipe capacity. The
hydraulic sweep (`link_flow_profiles`) and the WNTR ground-truth solves are
margin-independent, so we run them ONCE per network and only re-do the cheap
`build_bundle` + engine propagation for each margin. We report mean FMS AND
the binary precision/recall (a larger margin trades the module's pessimism
-- low precision -- against missing real starvation -- recall), so the knee
is chosen on both, not on FMS alone.

Run from the repo root:  python experiments/margin_sweep.py --help
"""
from __future__ import annotations

import argparse
import os
import random
import statistics
import sys

# repo-root/experiments/this.py -> repo-root/CASCADE-backend (matches the
# sibling variant scripts' path bootstrap).
BACKEND = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "CASCADE-backend"
)
sys.path.insert(0, BACKEND)
sys.path.insert(0, os.path.join(BACKEND, "scripts"))

import wntr  # noqa: E402

import validate_faithfulness as vf  # noqa: E402  (the shared harness internals)
from core.importers.inp import (  # noqa: E402
    ImportOptions,
    build_bundle,
    link_flow_profiles,
)

MARGINS = [1.0, 1.25, 1.5, 1.75, 2.0, 3.0]


def cache_network(path: str, *, situations: int, seeds: list[int],
                  req_p: float, min_p: float, nlv: float,
                  exhaustive_trunk: bool, samples: int, trunk_pairs: int,
                  include_tanks: bool = True):
    """Do all margin-independent work once: import sweep + ground truth."""
    wn = wntr.network.WaterNetworkModel(path)
    graph = vf._build_link_graph(wn)
    demands = vf.compute_junction_demands(wn, "peak")
    print("  importing (hydraulic sweep + contingencies)...", flush=True)
    flow_profiles = link_flow_profiles(
        wn, demands,
        contingency_samples=samples,
        contingency_exhaustive_trunk=exhaustive_trunk,
        contingency_trunk_pairs=trunk_pairs,
    )
    cached = []  # (situation, levels_true) with margin-independent ground truth
    for seed in seeds:
        rng = random.Random(seed)
        sits = [vf._random_situation(wn, graph, rng, i) for i in range(situations)]
        if include_tanks:
            sits += vf._tank_situations(wn)
        for s in sits:
            ratios, _ = vf._solve_served_ratios(wn, demands, s, req_p, min_p)
            if not ratios:
                continue
            levels_true = {jid: vf._ratio_to_level(r, nlv) for jid, r in ratios.items()}
            cached.append((s, levels_true))
    print(f"  {len(cached)} scored situations cached (ground truth solved once)", flush=True)
    return wn, demands, flow_profiles, cached


def score_margin(wn, demands, flow_profiles, cached, name, margin, nlv):
    bundle = build_bundle(
        wn, name=name,
        options=ImportOptions(demand_mode="peak", n_levels=int(nlv),
                              capacity_margin=margin),
        flow_profiles=flow_profiles, priorities={},
    )
    l2e, l2n = vf._build_link_maps(bundle.project)
    scores = []
    conf = vf.ConfusionCounts()
    for s, levels_true in cached:
        levels_cascade = vf._cascade_levels(
            bundle.project, bundle.config, s, l2e, l2n, demands)
        score, _ = vf._fms(levels_true, levels_cascade, demands, nlv)
        scores.append(score)
        conf += vf._binary_confusion(levels_true, levels_cascade, demands)
    return statistics.mean(scores), conf


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--networks", nargs="+",
                    default=["../raw-networks/aqueducts/ky10.inp"])
    ap.add_argument("--situations", type=int, default=12)
    ap.add_argument("--seeds", type=int, nargs="+", default=[1, 2])
    ap.add_argument("--required-pressure", type=float, default=20.0)
    ap.add_argument("--minimum-pressure", type=float, default=0.0)
    ap.add_argument("--n-levels", type=float, default=3)
    ap.add_argument("--no-exhaustive-trunk", action="store_true")
    ap.add_argument("--no-tanks", action="store_true",
                    help="Skip the (many) per-tank outage situations to cut cost.")
    ap.add_argument("--margins", type=float, nargs="+", default=MARGINS)
    ap.add_argument("--samples", type=int, default=20)
    ap.add_argument("--trunk-pairs", type=int, default=30)
    args = ap.parse_args()
    margins = args.margins

    pooled = {m: [vf.ConfusionCounts(), []] for m in margins}
    for spec in args.networks:
        # bare names (ky4, Net6) resolve to wntr's bundled examples; a path or
        # a .inp suffix loads directly -- same rule as validate_faithfulness.py
        if "/" in spec or spec.lower().endswith(".inp"):
            path, name = spec, os.path.basename(spec)
        else:
            path, name = wntr.library.model_library.get_filepath(spec), spec
        print(f"\n=== {name} ===", flush=True)
        wn, demands, flow_profiles, cached = cache_network(
            path, situations=args.situations, seeds=args.seeds,
            req_p=args.required_pressure, min_p=args.minimum_pressure,
            nlv=args.n_levels, exhaustive_trunk=not args.no_exhaustive_trunk,
            samples=args.samples, trunk_pairs=args.trunk_pairs,
            include_tanks=not args.no_tanks)
        print(f"  {'margin':>7} {'FMS':>7} {'prec':>6} {'recall':>7}", flush=True)
        for m in margins:
            fms, conf = score_margin(wn, demands, flow_profiles, cached, name, m, args.n_levels)
            pooled[m][0] += conf
            pooled[m][1].append(fms)
            print(f"  {m:>7.2f} {fms:>7.3f} {conf.precision:>6.2f} {conf.recall:>7.2f}", flush=True)

    print(f"\n=== POOLED over {len(args.networks)} held-out network(s) ===", flush=True)
    print(f"  {'margin':>7} {'FMS':>7} {'prec':>6} {'recall':>7}", flush=True)
    for m in margins:
        conf, scores = pooled[m]
        fms = statistics.mean(scores) if scores else float("nan")
        print(f"  {m:>7.2f} {fms:>7.3f} {conf.precision:>6.2f} {conf.recall:>7.2f}", flush=True)


if __name__ == "__main__":
    main()
