"""
experiments/centrality/category_ablation.py — links are not interchangeable.

Network-of-networks studies generally treat every link alike, inter-network links
included: a link is a link, and a node's exposure is read off its in-degree. On a
SERVICE dependency network what an incoming link means depends on the service
category it carries:

  - two in-links of the SAME category are REDUNDANCY   (either one suffices)
  - two in-links of DIFFERENT categories are CONJUNCTION (both are required)

Those are opposite meanings on the same picture. This script demonstrates the
consequence in the most controlled way available: it FIXES the topology — the
same nodes, the same links, the same degree sequence — and varies only the
category labels. Every purely structural quantity is therefore constant by
construction, while the importance ranking moves.

The knob is L, the number of service categories. With L = 1 every parent supplies
the same service, so a node survives on any one of them (pure OR). As L grows,
parents increasingly supply distinct services, so a node needs all of them (pure
AND). Identical graph, opposite resilience.

The index is computed by conditioning — hold a node present and failed — which
removes no link and therefore scores the network with each node's required
services intact.

Run from CASCADE-backend/:
    python ../experiments/centrality/category_ablation.py --n 60 --reps 20

Dev-only paper harness importing engine.* directly, so that it measures the
engine's real logic rather than a reimplementation of it. No import-linter
carve-out is required: the contract's `root_packages` (pyproject.toml) cover the
backend tree only, so a harness under `experiments/` is outside the analysed
modules.
"""
from __future__ import annotations

import argparse
import json
import random
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "CASCADE-backend"))

import networkx as nx  # noqa: E402
from scipy.stats import kendalltau  # noqa: E402

from engine.propagation import run  # noqa: E402
from schemas.config import (  # noqa: E402
    CategoryDefinition,
    ConfigMeta,
    FunctionalityScaleLevel,
    ModelConfiguration,
)
from schemas.network import Canvas, Edge, Graph, Node, Project, ProjectMeta  # noqa: E402
from schemas.results import PropagationRequest  # noqa: E402

FAILED, OK = 1, 2

Topology = tuple[int, list[tuple[int, int]]]



def bootstrap_ci(values: list[float], level: float = 0.95, draws: int = 5000,
                 seed: int = 0) -> tuple[float, float]:
    """Percentile bootstrap interval for the mean of `values`.

    Every cell in the paper's tables is a mean over replicates, and a mean with
    no dispersion beside it invites the reader to trust a digit that may be
    noise. Resampling the replicates with replacement is the assumption-free way
    to put an interval on it: no normality, no variance estimate, just the
    spread of the means the same experiment could have produced.
    """
    clean = [x for x in values if x == x]
    if len(clean) < 2:
        return (float("nan"), float("nan"))
    rng = random.Random(seed)
    n = len(clean)
    means = sorted(
        statistics.fmean(clean[rng.randrange(n)] for _ in range(n))
        for _ in range(draws)
    )
    lo = means[int((1 - level) / 2 * draws)]
    hi = means[min(draws - 1, int((1 + level) / 2 * draws))]
    return (lo, hi)

def make_config(n_categories: int) -> ModelConfiguration:
    return ModelConfiguration(
        version="1.0",
        meta=ConfigMeta(name="category-ablation"),
        functionality_scale=[
            FunctionalityScaleLevel(level=FAILED, label="failed", color="#ef4444"),
            FunctionalityScaleLevel(level=OK, label="operational", color="#22c55e"),
        ],
        categories=[
            CategoryDefinition(name=f"c{i}", category_type="Requisite")
            for i in range(n_categories)
        ],
    )


def make_topology(n: int, n_roots: int, max_parents: int,
                  rng: random.Random) -> Topology:
    """A layered DAG. Built ONCE, then shared by every category assignment.

    Every structural measure — degree, betweenness, PageRank, reachability, and
    removal-based vitality — is a function of this object alone, so all of them
    are held fixed across the whole ablation.
    """
    edges: list[tuple[int, int]] = []
    for i in range(n_roots, n):
        n_parents = rng.randint(1, max_parents)
        for j in rng.sample(range(i), min(n_parents, i)):
            edges.append((j, i))
    return n, edges


def label(topology: Topology, n_categories: int, rng: random.Random) -> Project:
    """Attach service categories to a FIXED topology.

    Each node provides exactly one category, drawn uniformly from the L
    available. A consumer's incoming edges then partition by category: edges
    sharing a category are alternatives to one another, edges in different
    categories are jointly required.
    """
    n, edge_list = topology
    nodes = {
        f"n{i}": Node(
            id=f"n{i}",
            functionality=OK,
            node_categories=[f"c{rng.randrange(n_categories)}"],
        )
        for i in range(n)
    }
    edges = {
        f"e{k}": Edge(id=f"e{k}", source=f"n{u}", target=f"n{v}", functionality=OK)
        for k, (u, v) in enumerate(edge_list)
    }
    return Project(
        version="2.0",
        meta=ProjectMeta(name="ablation"),
        nodes=nodes,
        edges=edges,
        canvases=[Canvas(id="cv", graph=Graph(graph_type="generic",
                                              node_ids=list(nodes),
                                              edge_ids=list(edges)))],
    )


def solve(project: Project, config: ModelConfiguration) -> dict[str, int]:
    res = run(PropagationRequest(project=project, config=config, scope="global"))
    func = {nid: node.functionality for nid, node in project.nodes.items()}
    for u in res.updates:
        if u.id in func:
            func[u.id] = u.functionality
    return func


def omega(func: dict[str, int], denominator: int) -> float:
    return sum(level - FAILED for level in func.values()) / denominator


def propagation_index(project: Project, config: ModelConfiguration) -> dict[str, float]:
    """c_prop(v): hold v present and failed, measure the loss of operativity."""
    n = len(project.nodes)
    base = omega(solve(project, config), n)
    out = {}
    for v in project.nodes:
        nodes = dict(project.nodes)
        nodes[v] = nodes[v].model_copy(update={"functionality": FAILED})
        hurt = project.model_copy(update={"nodes": nodes})
        out[v] = base - omega(solve(hurt, config), n)
    return out


def structural_indices(topology: Topology) -> dict[str, dict[str, float]]:
    """Everything computable from the topology alone — constant across labels."""
    n, edge_list = topology
    g = nx.DiGraph()
    g.add_nodes_from(f"n{i}" for i in range(n))
    g.add_edges_from((f"n{u}", f"n{v}") for u, v in edge_list)
    return {
        "reach": {v: float(len(nx.descendants(g, v))) for v in g},
        "indeg": {v: float(d) for v, d in g.in_degree()},
        "outdeg": {v: float(d) for v, d in g.out_degree()},
        "betw": nx.betweenness_centrality(g),
        "pagerank": nx.pagerank(g.reverse(copy=True)),
    }


def inclusion_prob(scores: dict[str, float], k: int) -> dict[str, float]:
    """P(v lands in the top k) when ties at the cut are broken at random.

    c_prop takes few distinct values under a parallel reading, so more nodes can
    sit ON the top-k boundary than there are seats and the top-k SET is not
    determined by the index. Sorting the dict would resolve that by node id, and
    since both sides of an overlap share that id order the tied nodes enter both
    sets together, inventing agreement. Each node instead carries the probability
    that a random tie-break admits it: 1 above the cut, (seats/tied) on it,
    0 below.
    """
    cut = sorted(scores.values(), reverse=True)[k - 1]
    tied = [v for v in scores if scores[v] == cut]
    seats = k - sum(1 for v in scores if scores[v] > cut)
    return {v: 1.0 if scores[v] > cut else (seats / len(tied) if scores[v] == cut else 0.0)
            for v in scores}


def expected_overlap(a: dict[str, float], b: dict[str, float], k: int) -> float:
    """Share of the top k that two indices agree on, averaged over random tie-breaks.

    The two tie-breaks are independent, so the average intersection size is the
    sum over nodes of the product of the two inclusion probabilities. Summing that
    product IS the average shuffling would converge to, so the paper's "ties are
    broken at random" is computed here rather than sampled: same number, no seed
    and no draw count to report.
    """
    pa, pb = inclusion_prob(a, k), inclusion_prob(b, k)
    return sum(pa[v] * pb[v] for v in pa) / k


def determined_share(scores: dict[str, float], k: int) -> float:
    """Share of the k seats the index fixes outright, leaving the rest tied."""
    cut = sorted(scores.values(), reverse=True)[k - 1]
    return sum(1 for v in scores if scores[v] > cut) / k


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=60)
    ap.add_argument("--roots", type=int, default=6)
    ap.add_argument("--max-parents", type=int, default=3)
    ap.add_argument("--reps", type=int, default=20)
    ap.add_argument("--seed", type=int, default=11)
    ap.add_argument("--out", type=Path, default=None)
    args = ap.parse_args()

    levels = [1, 2, 3, 5, 8]
    k = max(1, args.n // 10)
    acc: dict[str, list[float]] = {}

    for rep in range(args.reps):
        rng = random.Random(args.seed + rep)
        topology = make_topology(args.n, args.roots, args.max_parents, rng)
        struct = structural_indices(topology)

        per_level: dict[int, dict[str, float]] = {}
        for n_cat in levels:
            # Same topology, same label RNG stream per level, fresh labels.
            project = label(topology, n_cat, random.Random(args.seed * 1000 + rep))
            per_level[n_cat] = propagation_index(project, make_config(n_cat))

        for n_cat in levels:
            cond = per_level[n_cat]
            ids = list(cond)
            acc.setdefault(f"omega_loss_mean_L{n_cat}", []).append(
                statistics.fmean(cond.values())
            )
            acc.setdefault(f"live_L{n_cat}", []).append(
                sum(1 for v in ids if cond[v] > 1.0 / args.n + 1e-12) / args.n
            )
            for name, score in struct.items():
                tau = kendalltau([cond[v] for v in ids],
                                 [score[v] for v in ids]).statistic
                acc.setdefault(f"tau_{name}_L{n_cat}", []).append(tau)
                acc.setdefault(f"top_{name}_L{n_cat}", []).append(
                    expected_overlap(cond, score, k)
                )

        # The headline: the SAME graph, scored under the two extreme readings.
        lo, hi = per_level[levels[0]], per_level[levels[-1]]
        ids = list(lo)
        acc.setdefault("tau_L1_vs_L8", []).append(
            kendalltau([lo[v] for v in ids], [hi[v] for v in ids]).statistic
        )
        acc.setdefault("top_L1_vs_L8", []).append(expected_overlap(lo, hi, k))
        for n_cat in levels:
            acc.setdefault(f"determined_L{n_cat}", []).append(
                determined_share(per_level[n_cat], k)
            )

    summary = {
        key: statistics.fmean([x for x in values if x == x])
        for key, values in acc.items()
        if any(x == x for x in values)
    }
    ci = {key: bootstrap_ci(values) for key, values in acc.items()
          if any(x == x for x in values)}

    print(f"Fixed topology: n={args.n}, roots={args.roots}, "
          f"max parents={args.max_parents}, {args.reps} replicates\n")
    print("Same graph, same edges, same degrees — only the category labels change.\n")
    print("Each cell is a mean over replicates.\n")
    indices = ("reach", "pagerank", "indeg", "outdeg", "betw")
    header = (f"{'L':>3} {'mean loss':>10} {'live':>6} "
              + " ".join(f"{'t_' + nm:>10}" for nm in indices))
    print(header)
    for n_cat in levels:
        row = (f"{n_cat:>3} {summary[f'omega_loss_mean_L{n_cat}']:>10.4f} "
               f"{summary[f'live_L{n_cat}']:>6.2f} ")
        row += " ".join(f"{summary[f'tau_{nm}_L{n_cat}']:>10.3f}" for nm in indices)
        print(row)

    tau_lo, tau_hi = ci["tau_L1_vs_L8"]
    top_lo, top_hi = ci["top_L1_vs_L8"]
    print(f"\nSame topology, L={levels[0]} vs L={levels[-1]}: "
          f"tau={summary['tau_L1_vs_L8']:+.3f} [{tau_lo:+.3f},{tau_hi:+.3f}], "
          f"top-{k} overlap={summary['top_L1_vs_L8']:.3f} "
          f"[{top_lo:.3f},{top_hi:.3f}]")
    print("Every structural index above is IDENTICAL in both cases, by construction.")

    if args.out:
        args.out.write_text(json.dumps(
            {"mean": summary, "ci95": {k: list(v) for k, v in ci.items()}}, indent=2))
        print(f"\nwrote {args.out}")


if __name__ == "__main__":
    main()
