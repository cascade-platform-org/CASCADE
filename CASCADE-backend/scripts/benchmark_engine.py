"""
scripts/benchmark_engine.py — measure engine cost to ground the ADR-0008 caps.

The entitlement caps (max_nodes, evals_per_minute) were initially guessed. This
script measures what one propagation actually costs as a function of network
size, so the caps can be derived from real numbers instead of intuition.

    python scripts/benchmark_engine.py
    python scripts/benchmark_engine.py --sizes 10,45,100,300,600 --repeats 5

IMPORTANT: run it ON THE TARGET VM. A single Propagation is CPU-bound Python;
latency scales with the box. The numbers below are the *shape*; the final caps
come from the machine you actually deploy on.
"""
from __future__ import annotations

import argparse
import random
import statistics
import sys
import time
from pathlib import Path

# Allow `python scripts/benchmark_engine.py` from CASCADE-backend/ by putting the
# backend package root on sys.path (same pattern as scripts/export_json_schema.py).
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

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
    args = parser.parse_args()
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
