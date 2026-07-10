"""
scripts/benchmark_engine.py — measure engine cost to ground the ADR-0008 caps,
and (via `--networks`) the CompleNet paper's cost claim: one engine
Propagation vs. one WNTR PDD solve, plus the EPANET importer's one-time cost,
on the same real networks `scripts/validate_faithfulness.py` validates.

    python scripts/benchmark_engine.py
    python scripts/benchmark_engine.py --sizes 10,45,100,300,600 --repeats 5
    python scripts/benchmark_engine.py --networks Net1,Net3,Net6

IMPORTANT: run it ON THE TARGET VM. A single Propagation is CPU-bound Python;
latency scales with the box. The numbers below are the *shape*; the final caps
come from the machine you actually deploy on.
"""
from __future__ import annotations

import argparse
import random
import statistics
import sys
import tempfile
import time
from pathlib import Path

# Allow `python scripts/benchmark_engine.py` from CASCADE-backend/ by putting the
# backend package root on sys.path (same pattern as scripts/export_json_schema.py).
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import wntr  # noqa: E402

from core.importers.inp import (  # noqa: E402
    ImportOptions,
    build_bundle,
    compute_junction_demands,
    link_flow_profiles,
    scarcity_priorities,
)
from engine.propagation import run  # noqa: E402
from schemas.config import (
    CategoryDefinition,
    ConfigMeta,
    FunctionalityScaleLevel,
    ModelConfiguration,
)
from schemas.network import Canvas, Edge, Graph, Node, Project, ProjectMeta
from schemas.results import PropagationRequest

_N = 4  # functionality scale size


def _config() -> ModelConfiguration:
    return ModelConfiguration(
        version="1.0",
        meta=ConfigMeta(name="bench"),
        functionality_scale=[
            FunctionalityScaleLevel(level=lvl, label=str(lvl), color="#000")
            for lvl in range(1, _N + 1)
        ],
        categories=[CategoryDefinition(name="dep", category_type="Requisite")],
    )


def _build_request(num_nodes: int, seed: int = 0) -> tuple[PropagationRequest, int]:
    """A synthetic dependency network: ~10% degraded sources, the rest each
    depending on 1-3 upstream nodes (a random DAG so failures cascade)."""
    rng = random.Random(seed)  # nosec B311
    nodes: list[Node] = []
    edges: list[Edge] = []

    for i in range(num_nodes):
        is_source = i < max(1, num_nodes // 10)
        nodes.append(
            Node(
                id=f"n{i}",
                functionality=1 if is_source else _N,  # sources start degraded
                node_categories=["dep"],
            )
        )
        if i > 0:  # depend on 1-3 earlier nodes -> forward-cascading DAG
            for j in rng.sample(range(i), k=min(i, rng.randint(1, 3))):
                edges.append(
                    Edge(id=f"e{j}_{i}", source=f"n{j}", target=f"n{i}", functionality=_N)
                )

    project = Project(
        version="2.0",
        meta=ProjectMeta(name="bench"),
        nodes={n.id: n for n in nodes},
        edges={e.id: e for e in edges},
        canvases=[
            Canvas(
                id="c1",
                graph=Graph(
                    graph_type="generic",
                    node_ids=[n.id for n in nodes],
                    edge_ids=[e.id for e in edges],
                ),
            )
        ],
    )
    request = PropagationRequest(project=project, config=_config(), scope="global")
    return request, len(edges)


def _time_once(request: PropagationRequest) -> float:
    t0 = time.perf_counter()
    run(request)
    return (time.perf_counter() - t0) * 1000.0  # ms


def _resolve_network_path(name: str) -> str:
    """Same resolution rule as scripts/validate_faithfulness.py: a bare name
    (Net1, Net3, ...) resolves against wntr's bundled example networks;
    anything that looks like a path (has a slash or a .inp suffix) is loaded
    directly."""
    if "/" in name or name.lower().endswith(".inp"):
        return name
    return wntr.library.model_library.get_filepath(name)


def _benchmark_one_network(name: str, repeats: int) -> None:
    """Times the three costs the CompleNet paper's §5.8 needs: (1) the
    EPANET importer's one-time cost — parse, the scarcity-priority sweep on
    the original network, and the velocity/capacity sweep on it (no
    skeletonization: matches scripts/validate_faithfulness.py's own import
    shape, so these numbers are comparable to that script's FMS results on
    the same networks); (2) one WNTR PDD solve, the ground-truth cost per
    situation; (3) one engine Propagation, the CASCADE cost per situation.
    (2) and (3) are what the paper's "many-scenario workload" cost argument
    is actually about — the importer's cost is paid once, the solve/
    propagation cost is paid once per situation evaluated."""
    path = _resolve_network_path(name)

    t0 = time.perf_counter()
    wn = wntr.network.WaterNetworkModel(path)
    parse_ms = (time.perf_counter() - t0) * 1000.0

    demands = compute_junction_demands(wn, "peak")

    t0 = time.perf_counter()
    priorities = scarcity_priorities(wn, demands)
    priority_sweep_ms = (time.perf_counter() - t0) * 1000.0

    t0 = time.perf_counter()
    flow_profiles = link_flow_profiles(wn, demands)
    velocity_sweep_ms = (time.perf_counter() - t0) * 1000.0

    t0 = time.perf_counter()
    bundle = build_bundle(
        wn, name=name,
        options=ImportOptions(demand_mode="peak", n_levels=3),
        priorities=priorities,
        flow_profiles=flow_profiles,
    )
    build_ms = (time.perf_counter() - t0) * 1000.0

    import_total_ms = parse_ms + priority_sweep_ms + velocity_sweep_ms + build_ms

    # One WNTR PDD solve at baseline (no interventions) — the ground-truth
    # cost validate_faithfulness.py pays once per situation. Same fixed-
    # demand setup as that script's _solve_served_ratios (a Demand's
    # pattern_name=None falls back to the model's own global default pattern,
    # not "constant" — see ADR-0012's Net6 finding), so this measures the
    # same kind of solve, not an artificially cheaper/costlier one.
    model = wn
    model.options.hydraulic.pattern = None
    for jid, demand in demands.items():
        junction = model.get_node(jid)
        junction.demand_timeseries_list.clear()
        junction.demand_timeseries_list.append((demand, None, "bench_fixed"))
    model.options.time.duration = 0
    model.options.hydraulic.demand_model = "PDD"
    model.options.hydraulic.required_pressure = 20.0
    model.options.hydraulic.minimum_pressure = 0.0
    solve_samples: list[float] = []
    for _ in range(repeats):
        with tempfile.TemporaryDirectory(prefix="cascade-bench-") as tmpdir:
            prefix = str(Path(tmpdir) / "bench")
            t0 = time.perf_counter()
            wntr.sim.EpanetSimulator(model).run_sim(file_prefix=prefix)
            solve_samples.append((time.perf_counter() - t0) * 1000.0)

    # One engine Propagation on the imported project, same baseline (no
    # intervention) — the CASCADE cost validate_faithfulness.py pays once
    # per situation, for direct comparison against the WNTR solve above.
    prop_request = PropagationRequest(project=bundle.project, config=bundle.config, scope="global")
    prop_samples = [_time_once(prop_request) for _ in range(repeats)]

    n_junctions = len(demands)
    print(f"\n=== {name} ({n_junctions} junctions, {wn.num_links} links) ===")
    print(
        f"  import (one-time): parse={parse_ms:.0f}ms  priority_sweep={priority_sweep_ms:.0f}ms  "
        f"velocity_sweep={velocity_sweep_ms:.0f}ms  build={build_ms:.0f}ms  TOTAL={import_total_ms:.0f}ms"
    )
    print(
        f"  per-situation: WNTR PDD solve median={statistics.median(solve_samples):.1f}ms "
        f"(min={min(solve_samples):.1f} max={max(solve_samples):.1f})  |  "
        f"engine Propagation median={statistics.median(prop_samples):.1f}ms "
        f"(min={min(prop_samples):.1f} max={max(prop_samples):.1f})  |  "
        f"speedup={statistics.median(solve_samples) / max(statistics.median(prop_samples), 1e-6):.0f}x"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Benchmark the propagation engine.")
    parser.add_argument("--sizes", default="10,45,100,300,600,1000")
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument(
        "--budget-ms",
        type=float,
        default=1500.0,
        help="Target max wall-clock for a single propagation (drives max_nodes).",
    )
    parser.add_argument(
        "--networks",
        default=None,
        help="Comma-separated wntr.library.model_library names or .inp paths "
             "(same resolution as scripts/validate_faithfulness.py --networks). "
             "When given, runs the real-network import/solve/propagation "
             "benchmark (CompleNet paper §5.8) instead of the synthetic-size "
             "sweep below.",
    )
    args = parser.parse_args()

    if args.networks:
        for name in (n.strip() for n in args.networks.split(",")):
            _benchmark_one_network(name, args.repeats)
        return

    sizes = [int(s) for s in args.sizes.split(",")]

    print(f"{'nodes':>7} {'edges':>7} {'median_ms':>10} {'min_ms':>8} {'max_ms':>8}")
    print("-" * 44)
    results: list[tuple[int, float]] = []
    for n in sizes:
        samples = []
        edges = 0
        for r in range(args.repeats):
            request, edges = _build_request(n, seed=r)
            samples.append(_time_once(request))
        med = statistics.median(samples)
        results.append((n, med))
        print(f"{n:>7} {edges:>7} {med:>10.1f} {min(samples):>8.1f} {max(samples):>8.1f}")

    # Derive a max_nodes recommendation: largest measured size within budget.
    within = [n for n, ms in results if ms <= args.budget_ms]
    rec_nodes = max(within) if within else min(s for s, _ in results)

    # Derive a single-user evals/minute ceiling from the per-eval cost at that
    # size: how many such propagations fit in a minute on ONE core, then leave
    # headroom (÷4) so one user can't monopolise the single shared process.
    ms_at_rec = next((ms for n, ms in results if n == rec_nodes), results[-1][1])
    evals_per_min_core = 60_000.0 / ms_at_rec if ms_at_rec else 0
    rec_evals = int(evals_per_min_core / 4)

    print("\nDerived recommendation (THIS box; re-run on the VM):")
    print(f"  target single-request budget : {args.budget_ms:.0f} ms")
    print(f"  max_nodes (largest ≤ budget) : {rec_nodes}")
    print(f"  ~cost per propagation at cap : {ms_at_rec:.1f} ms")
    print(f"  evals/min a single core sustains at that size : {evals_per_min_core:.0f}")
    print(f"  suggested per-user evals_per_minute (÷4 headroom): {rec_evals}")
    print(
        "\nNote: a model-based analysis costs permutations×N evals of the above "
        "cost — e.g. a Shapley at the node cap is minutes of CPU, which is why "
        "the per-minute budget (not just max_nodes) is the real throttle."
    )


if __name__ == "__main__":
    main()
