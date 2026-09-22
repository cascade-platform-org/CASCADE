#!/usr/bin/env python3
"""Per-situation cost: one CASCADE Propagation vs one WNTR PDD solve.

Backs the computational-cost section of the paper's supplementary material
(Supp. Mat. S4). The claim it supports is a CONCESSION — the engine is slower
than a dedicated hydraulic solver, decisively so at scale — so the point is to
measure it honestly on the same machine as every other number, not to win.

What is timed, and what is not:
  - PER-SITUATION (the number that matters): the work a scenario costs once the
    model exists. CASCADE side = `propagation_service.run` on the imported
    project. WNTR side = `_solve_served_ratios`, i.e. one steady-state PDD solve
    of the same situation. Both sides are given the SAME situations, drawn from
    the same four families as the validation, so the comparison is paired.
  - ONE-TIME IMPORT (reported separately): parse + the hydraulic sweep that
    orients edges. This is paid once per network, not per scenario, which is
    why it is not folded into the per-situation figure.

Timing methodology: `time.perf_counter` around each call, `REPEATS` runs per
situation, and we report the MEDIAN over all (situation, repeat) pairs. Median
rather than mean because a single scheduler hiccup on a multi-second solve would
dominate a mean, and because the distribution is right-skewed by construction.

Absolute times are machine-shaped; the ratio is the content.

Run:  python experiments/aqueducts/cost_benchmark.py [net.inp ...]
"""
from __future__ import annotations

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

REQ_P = 20.0
MIN_P = 0.0
N_LEVELS = 3
DEMAND_MODE = "peak_hour"

# How many situations to time per network, and how many repeats each. Kept small
# deliberately: the engine takes seconds per situation on the largest network, so
# a full 939-situation timing pass would run for hours to sharpen a number whose
# stated precision is one significant figure.
N_SITUATIONS = 8
REPEATS = 3

DEFAULT_NETS = [
    "Net1",
    "Net3",
    "../raw-networks/aqueducts/Cassacco_totale.inp",   # Aqueduct A
    "../raw-networks/aqueducts/Tarcento_totale.inp",   # Aqueduct B
    "../raw-networks/aqueducts/Zampis.inp",            # Aqueduct C
]
# Anonymization (paper hard constraint): never print the real export names.
ALIAS = {"Cassacco_totale": "Aqueduct A", "Tarcento_totale": "Aqueduct B", "Zampis": "Aqueduct C"}


def _resolve(name: str) -> str:
    if "/" in name or name.lower().endswith(".inp"):
        return os.path.join(BACKEND, name) if not os.path.isabs(name) else name
    return wntr.library.model_library.get_filepath(name)


def _label(path: str) -> str:
    stem = os.path.basename(path).replace(".inp", "")
    return ALIAS.get(stem, stem)


def _situations(wn, graph, seed: int = 1):
    """An EVEN spread across the four validation families: up to
    `N_SITUATIONS // 4` from each, taken at a stride so they are not all
    single-element closures.

    Balancing across families is the load-bearing choice here, and it is why
    these figures are higher than a naive sample would give. Engine cost is
    dominated by fair-share water-filling under scarcity, which the `targeted`
    and `source` families produce and the `cluster` family mostly does not.
    Timing whichever family happens to be most numerous (cluster, at 459 of the
    939 validation situations) would report a cost the harness does not pay.
    """
    families = [
        vf._cluster_situations(wn, graph, seed),
        vf._targeted_situations(wn),
        vf._tank_situations(wn),
        vf._source_situations(wn),
    ]
    per_family = max(1, N_SITUATIONS // 4)
    picked = []
    for fam in families:
        if not fam:
            continue
        stride = max(1, len(fam) // per_family)
        picked.extend(fam[::stride][:per_family])
    return picked


def run_network(name: str) -> tuple[str, float, float, float] | None:
    path = _resolve(name)
    label = _label(path)

    t0 = time.perf_counter()
    wn = wntr.network.WaterNetworkModel(path)
    demands = compute_junction_demands(wn, DEMAND_MODE)
    flow_profiles = link_flow_profiles(wn, demands, contingency_exhaustive_trunk=True)
    opts = ImportOptions(demand_mode=DEMAND_MODE, n_levels=N_LEVELS)
    bundle = build_bundle(wn, name=label, options=opts, flow_profiles=flow_profiles, priorities={})
    import_s = time.perf_counter() - t0

    graph = vf._build_link_graph(wn)
    link_to_edges, link_to_node = vf._build_link_maps(bundle.project)
    situations = _situations(wn, graph)
    if not situations:
        return None

    engine_ms: list[float] = []
    wntr_ms: list[float] = []
    copy_ms: list[float] = []
    for situation in situations:
        for _ in range(REPEATS):
            # `_cascade_levels` deep-copies the Project before mutating it, so
            # the figure it yields is what the harness actually pays per
            # scenario. Time the copy separately rather than reimplementing the
            # function without it — the harness is the reference, and a local
            # copy of its logic would drift from the engine it is measuring.
            t = time.perf_counter()
            bundle.project.model_copy(deep=True)
            copy_ms.append((time.perf_counter() - t) * 1000)

            t = time.perf_counter()
            vf._cascade_levels(
                bundle.project, bundle.config, situation,
                link_to_edges, link_to_node, demands,
            )
            engine_ms.append((time.perf_counter() - t) * 1000)

            t = time.perf_counter()
            vf._solve_served_ratios(wn, demands, situation, REQ_P, MIN_P)
            wntr_ms.append((time.perf_counter() - t) * 1000)

    e = statistics.median(engine_ms)
    w = statistics.median(wntr_ms)
    c = statistics.median(copy_ms)
    # The spread matters more than the median on the engine side: cost tracks
    # how much scarcity a situation creates, so a network's worst situation can
    # be orders of magnitude above its median. Report both rather than let one
    # number stand for a distribution this skewed.
    print(
        f"{label:12s} import {import_s:6.2f}s | "
        f"engine {e:9.1f} ms [{min(engine_ms):7.1f}-{max(engine_ms):9.1f}] (copy {c:5.1f}) | "
        f"WNTR {w:6.1f} ms [{min(wntr_ms):5.1f}-{max(wntr_ms):6.1f}] | ratio {e / w:6.1f}x "
        f"({len(situations)} situations x {REPEATS})"
    )
    return label, e, w, e / w


def main() -> None:
    nets = sys.argv[1:] or DEFAULT_NETS
    print(f"per-situation cost (median of {REPEATS} repeats over {N_SITUATIONS} situations)\n")
    rows = [r for name in nets if (r := run_network(name)) is not None]
    if rows:
        print(f"\nratio range: {min(r[3] for r in rows):.1f}x - {max(r[3] for r in rows):.1f}x")


if __name__ == "__main__":
    main()
