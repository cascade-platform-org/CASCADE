#!/usr/bin/env python3
"""Does edge ORIENTATION carry the flow module's fidelity?

The import-time hydraulic solves have one job under the shipped configuration:
they orient edges from the sign of the simulated flow. Pipe capacity comes from
a constant (area x 2.5 m/s) that never consults them, and priority is left
unset. So orientation is the only thing the solves buy — but that had never been
measured directly, only inferred by eliminating the other two.

This is the direct test. Two arms, identical in every other respect:

  ORIENTED  (shipped) — pipe direction from the flow sign; a pipe is split into
    two opposed directed edges only when it carries flow both ways, or when its
    single reading is too slow to trust (< DECISIVE_VELOCITY_MS).
  UNDIRECTED (ablated) — every pipe split into two opposed directed edges,
    which is what the graph looks like with no orientation information at all.
    Achieved by handing the mapper a profile with flow in both directions, so
    map.py takes its `_emit_split` branch for every pipe.

Capacity is IDENTICAL in both arms: under the default `capacity_velocity` the
mapper computes `area x 2.5` and never reads the profile's velocities, which are
the only fields this script alters. The two arms therefore differ in orientation
and nothing else.

Scoring matches the paper: FMS is the demand-weighted per-situation mean;
precision and recall are computed per situation and averaged, crediting a
correctly-quiet answer with 1 (Supp. Mat. S2).

Networks run smallest-first so partial results are useful; each network's row is
printed and appended to CSV as it completes.

Run:  python experiments/aqueducts/orientation_ablation.py [net ...]
"""
from __future__ import annotations

import csv
import os
import statistics
import sys
import time

_REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BACKEND = os.path.join(_REPO, "CASCADE-backend")
sys.path.insert(0, BACKEND)

import wntr  # noqa: E402

import validate_faithfulness as vf  # noqa: E402
from core.importers.inp import (  # noqa: E402
    ImportOptions,
    build_bundle,
    compute_junction_demands,
    link_flow_profiles,
)

REQ_P, MIN_P, N_LEVELS, DEMAND_MODE = 20.0, 0.0, 3, "peak_hour"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "orientation_ablation.csv")

# Smallest first: partial results are useful, and the aqueducts dominate runtime.
DEFAULT_NETS = [
    "Net1", "Net2", "Net3",
    "../raw-networks/aqueducts/Modena.inp",
    "../raw-networks/aqueducts/Cassacco_totale.inp",   # Aqueduct A
    "../raw-networks/aqueducts/Tarcento_totale.inp",   # Aqueduct B
    "../raw-networks/aqueducts/CTown.inp",
    "../raw-networks/aqueducts/Zampis.inp",            # Aqueduct C
]
# Anonymization (paper hard constraint): never print the real export names.
ALIAS = {"Cassacco_totale": "Aqueduct A", "Tarcento_totale": "Aqueduct B", "Zampis": "Aqueduct C"}


def _resolve(name: str) -> str:
    if "/" in name or name.lower().endswith(".inp"):
        return os.path.join(BACKEND, name) if not os.path.isabs(name) else name
    return wntr.library.model_library.get_filepath(name)


def _label(path: str) -> str:
    return ALIAS.get(os.path.basename(path).replace(".inp", ""), os.path.basename(path).replace(".inp", ""))


def _undirected_profiles(profiles: dict, pipe_ids: set) -> dict:
    """Every PIPE gets flow in both directions, so the mapper splits it. 1.0 m/s
    is arbitrary and unused: it clears NEGLIGIBLE_VELOCITY_MS (the only thing
    the split branch tests) and pipe capacity ignores velocity entirely under
    the shipped uniform-design-velocity method."""
    out = dict(profiles)
    for lid in pipe_ids:
        prof = profiles.get(lid)
        out[lid] = prof.model_copy(update={"velocity_fwd": 1.0, "velocity_rev": 1.0}) if prof is not None \
            else type(next(iter(profiles.values())))(velocity_fwd=1.0, velocity_rev=1.0)
    return out


def _score(bundle, situations, truth_levels, demands):
    """Per-situation FMS plus per-situation precision/recall, averaged, with a
    correctly-quiet answer credited 1 (the paper's convention)."""
    l2e, l2n = vf._build_link_maps(bundle.project)
    fms, precs, recs = [], [], []
    for label, situation in situations:
        truth = truth_levels[label]
        if not truth:
            continue
        got = vf._cascade_levels(bundle.project, bundle.config, situation, l2e, l2n, demands)
        score, _ = vf._fms(truth, got, demands, N_LEVELS)
        c = vf._binary_confusion(truth, got, demands)
        fms.append(score)
        precs.append(1.0 if c.tp + c.fp == 0 else c.tp / (c.tp + c.fp))
        recs.append(1.0 if c.tp + c.fn == 0 else c.tp / (c.tp + c.fn))
    return statistics.mean(fms), statistics.mean(precs), statistics.mean(recs), len(fms)


def run_network(name: str, seed: int = 1) -> None:
    path = _resolve(name)
    label = _label(path)
    t0 = time.perf_counter()
    wn = wntr.network.WaterNetworkModel(path)
    graph = vf._build_link_graph(wn)
    demands = compute_junction_demands(wn, DEMAND_MODE)
    profiles = link_flow_profiles(wn, demands, contingency_exhaustive_trunk=True)

    situations = [(s.label, s) for s in (
        vf._cluster_situations(wn, graph, seed) + vf._targeted_situations(wn)
        + vf._tank_situations(wn) + vf._source_situations(wn))]

    truth_levels = {}
    for lb, sit in situations:
        ratios, _ = vf._solve_served_ratios(wn, demands, sit, REQ_P, MIN_P)
        truth_levels[lb] = {j: vf._ratio_to_level(r, N_LEVELS) for j, r in ratios.items()} if ratios else {}
    situations = [(lb, s) for lb, s in situations if truth_levels[lb]]

    opts = ImportOptions(demand_mode=DEMAND_MODE, n_levels=N_LEVELS)
    pipe_ids = set(wn.pipe_name_list)

    oriented = build_bundle(wn, name=label, options=opts, flow_profiles=profiles, priorities={})
    undirected = build_bundle(wn, name=label, options=opts,
                              flow_profiles=_undirected_profiles(profiles, pipe_ids), priorities={})
    n_edges_o = len(oriented.project.edges)
    n_edges_u = len(undirected.project.edges)

    fo, po, ro, n = _score(oriented, situations, truth_levels, demands)
    fu, pu, ru, _ = _score(undirected, situations, truth_levels, demands)

    print(f"{label:12s} n={n:3d} edges {n_edges_o}->{n_edges_u} | "
          f"ORIENTED FMS={fo:.3f} P={po:.3f} R={ro:.3f} | "
          f"UNDIRECTED FMS={fu:.3f} P={pu:.3f} R={ru:.3f} | "
          f"dFMS={fu-fo:+.3f} dP={pu-po:+.3f} dR={ru-ro:+.3f}  [{time.perf_counter()-t0:.0f}s]",
          flush=True)

    new = not os.path.exists(OUT)
    with open(OUT, "a", newline="") as fh:
        w = csv.writer(fh)
        if new:
            w.writerow(["network", "n", "edges_oriented", "edges_undirected",
                        "fms_oriented", "prec_oriented", "recall_oriented",
                        "fms_undirected", "prec_undirected", "recall_undirected"])
        w.writerow([label, n, n_edges_o, n_edges_u,
                    f"{fo:.4f}", f"{po:.4f}", f"{ro:.4f}", f"{fu:.4f}", f"{pu:.4f}", f"{ru:.4f}"])


def main() -> None:
    for name in (sys.argv[1:] or DEFAULT_NETS):
        try:
            run_network(name)
        except Exception as exc:  # keep going; one network's failure is not the run's
            print(f"{_label(_resolve(name)):12s} FAILED: {type(exc).__name__}: {exc}", flush=True)


if __name__ == "__main__":
    main()
