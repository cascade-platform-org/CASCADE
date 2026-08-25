"""
experiments/centrality/regime_probe.py — how far a topological ranking is right.

A topological index reads nodes and links and reconstructs what each node needs
from the links that reach it. That reconstruction is exactly the model at one
setting: every dependency link carries failure unconditionally, which is the
series reading. This script sweeps away from that setting and measures what the
reading costs.

  rho = the share of required services supplied by exactly one node.
        rho = 1  every dependency link is a series element
        rho = 0  every required service has two suppliers (parallel structure)

At rho = 1 plain reachability reproduces the model's ranking exactly. As rho
falls, redundancy absorbs single failures and the two part company. Reported
beside every correlation is the live fraction — the share of nodes whose failure
reaches beyond themselves — because at low rho most of the vector is tied and a
correlation there is measuring the tie-break.

The script also carries the two indices of the paper's §4: `c_cond` holds a node
present and failed (the full description, where a node's required services travel
with the network) and `c_del` removes it (the topological description, where they
are recovered from the links). `eff_ranks_del` reports how many distinct values
the second one takes.

Run from CASCADE-backend/ (same sys.path convention as scripts/benchmark_engine.py):
    python ../experiments/centrality/regime_probe.py --n 60 --reps 20

`--reps 20` is the paper's setting: every table row pools 40 replicates, 20 at
each of the two conjunction settings p. At `--reps 10` the cells shift by a few
hundredths and tau(betw) at rho=0 changes sign.

Dev-only paper harness importing engine.* directly, so that it measures the
engine's real logic rather than a reimplementation of it. No import-linter
carve-out is required: the contract's `root_packages` (pyproject.toml) cover the
backend tree only, so a harness under `experiments/` is outside the analysed
modules. A script with this same need placed under CASCADE-backend/scripts/
WOULD need one (CLAUDE.md §8a).
"""
from __future__ import annotations

import argparse
import itertools
import json
import math
import random
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

FAILED, OK = 1, 2  # binary functionality scale



def bootstrap_ci(values: list[float], level: float = 0.95, draws: int = 5000,
                 seed: int = 0) -> tuple[float, float]:
    """Percentile bootstrap interval for the mean of `values`.

    Every cell in the paper's tables is a mean over replicates, and a mean with
    no dispersion beside it invites the reader to trust a digit that may be
    noise. Resampling the replicates with replacement is the assumption-free way
    to put an interval on it.
    """
    clean = [x for x in values if x == x]
    if len(clean) < 2:
        return (float("nan"), float("nan"))
    rng = random.Random(seed)
    n = len(clean)
    means = sorted(
        sum(clean[rng.randrange(n)] for _ in range(n)) / n
        for _ in range(draws)
    )
    lo = means[int((1 - level) / 2 * draws)]
    hi = means[min(draws - 1, int((1 + level) / 2 * draws))]
    return (lo, hi)

def make_config(n_categories: int) -> ModelConfiguration:
    """All-Requisite categories on a 2-level scale = the paper's Boolean model."""
    return ModelConfiguration(
        version="1.0",
        meta=ConfigMeta(name="regime-probe"),
        functionality_scale=[
            FunctionalityScaleLevel(level=FAILED, label="failed", color="#ef4444"),
            FunctionalityScaleLevel(level=OK, label="operational", color="#22c55e"),
        ],
        categories=[
            CategoryDefinition(name=f"c{i}", category_type="Requisite")
            for i in range(n_categories)
        ],
    )


def generate(n: int, n_categories: int, n_roots: int, rho: float, p: float,
             rng: random.Random) -> Project:
    """Layered service-dependency DAG.

    Each node PROVIDES one category and CONSUMES the categories of its parents.
    rho = P(a consumed category is supplied by exactly one node) — the
    sole-supplier knob. p = P(a node consumes two categories) — the conjunction
    knob. Roots are exogenous (no suppliers) so Omega can move for reasons other
    than the perturbation.
    """
    provides = [f"c{rng.randrange(n_categories)}" for _ in range(n)]
    nodes: dict[str, Node] = {}
    edges: dict[str, Edge] = {}

    for i in range(n):
        nodes[f"n{i}"] = Node(
            id=f"n{i}", functionality=OK, node_categories=[provides[i]]
        )

    eid = 0
    for i in range(n_roots, n):
        n_consumed = 2 if rng.random() < p else 1
        wanted = rng.sample(range(n_categories), min(n_consumed, n_categories))
        for cat_idx in wanted:
            cat = f"c{cat_idx}"
            pool = [j for j in range(i) if provides[j] == cat]
            if not pool:
                continue
            r = 1 if rng.random() < rho else 2
            for j in rng.sample(pool, min(r, len(pool))):
                edges[f"e{eid}"] = Edge(id=f"e{eid}", source=f"n{j}", target=f"n{i}",
                                        functionality=OK)
                eid += 1

    return Project(
        version="2.0",
        meta=ProjectMeta(name="probe"),
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
    """Mean binary operativity, normalised over the ORIGINAL node count."""
    return sum(level - FAILED for level in func.values()) / denominator


def condition(project: Project, victim: str) -> Project:
    nodes = dict(project.nodes)
    nodes[victim] = nodes[victim].model_copy(update={"functionality": FAILED})
    return project.model_copy(update={"nodes": nodes})


def delete(project: Project, victim: str) -> Project:
    nodes = {nid: nd for nid, nd in project.nodes.items() if nid != victim}
    edges = {eid: e for eid, e in project.edges.items()
             if e.source != victim and e.target != victim}
    canvas = project.canvases[0].model_copy(
        update={"graph": Graph(graph_type="generic", node_ids=list(nodes),
                               edge_ids=list(edges))}
    )
    return project.model_copy(update={"nodes": nodes, "edges": edges,
                                      "canvases": [canvas]})


def cut_graph(project: Project, baseline: dict[str, int],
              live_suppliers_only: bool = False) -> nx.DiGraph:
    """The order-1 min-cut graph: edge ``v -> w`` iff v is w's SOLE supplier of
    some category.

    This is the structure the propagation actually travels along when a single
    node fails: with every other supplier of a redundant category still up, the
    only conjuncts a lone failure can break are those with a one-element
    supplier set. Mirrors `engine/logical.py` category derivation — a target's
    categories are the union of its parents' (all Requisite here), and a parent
    supplies a category when it carries that category.
    """
    cats_of = {nid: set(nd.node_categories or []) for nid, nd in project.nodes.items()}
    by_target: dict[str, list[str]] = {}
    for e in project.edges.values():
        by_target.setdefault(e.target, []).append(e.source)

    g = nx.DiGraph()
    g.add_nodes_from(project.nodes)
    for target, parents in by_target.items():
        if baseline[target] == FAILED:
            continue
        per_cat: dict[str, set[str]] = {}
        for src in parents:
            # An already-failed supplier is not holding anything up, so it does
            # not count toward redundancy. Switching this on makes the proxy
            # baseline-aware: a 2-supplier category with one supplier already
            # down is, for a single further failure, a sole-supplier category.
            if live_suppliers_only and baseline[src] == FAILED:
                continue
            for cat in cats_of[src]:
                per_cat.setdefault(cat, set()).add(src)
        for suppliers in per_cat.values():
            if len(suppliers) == 1:
                g.add_edge(next(iter(suppliers)), target)
    return g


def sole_suppliers(project: Project, baseline: dict[str, int]) -> set[str]:
    """Nodes that are the unique supplier of some category to an operational node."""
    g = cut_graph(project, baseline)
    return {v for v in g if g.out_degree(v) > 0}


def effective_ranks(values: list[float]) -> float:
    """exp(Shannon entropy) over the multiset of index values.

    1.0 = every node carries the same score (no ranking at all); |V| = all
    distinct. A distinct-value COUNT calls 44/1/1/1/1/1/1 "seven values"; this
    calls it ~1.6, which is what a practitioner reading the ranking experiences.
    """
    counts: dict[float, int] = {}
    for x in values:
        counts[round(x, 9)] = counts.get(round(x, 9), 0) + 1
    total = len(values)
    entropy = 0.0
    for c in counts.values():
        p = c / total
        entropy -= p * math.log(p)
    return math.exp(entropy)


def seed_failures(project: Project, k: int, n_roots: int,
                  rng: random.Random) -> Project:
    """Pre-fail k non-root nodes, moving the baseline off all-operational.

    Proposition 1 assumes f0 = 1 everywhere. This is the knob that tests how
    load-bearing that hypothesis is.
    """
    ids = [nid for nid in project.nodes][n_roots:]
    nodes = dict(project.nodes)
    for nid in rng.sample(ids, min(k, len(ids))):
        nodes[nid] = nodes[nid].model_copy(update={"functionality": FAILED})
    return project.model_copy(update={"nodes": nodes})


def analyse_replicate(project: Project, config: ModelConfiguration) -> dict:
    n = len(project.nodes)
    base_func = solve(project, config)
    base_omega = omega(base_func, n)

    ids = list(project.nodes)
    c_cond, c_del = {}, {}
    for v in ids:
        c_cond[v] = base_omega - omega(solve(condition(project, v), config), n)
        c_del[v] = base_omega - omega(solve(delete(project, v), config), n)

    digraph = nx.DiGraph()
    digraph.add_nodes_from(ids)
    digraph.add_edges_from((e.source, e.target) for e in project.edges.values())

    # The category-BLIND proxies: what a structural analyst computes without
    # knowing which dependencies are redundant.
    proxies = {
        "reach": {v: len(nx.descendants(digraph, v)) for v in ids},
        "outdeg": dict(digraph.out_degree()),
        "betw": nx.betweenness_centrality(digraph),
        "pagerank": nx.pagerank(digraph.reverse(copy=True)),
    }
    # The category-AWARE proxy: reachability restricted to sole-supplier edges.
    # Same O(V+E) cost, but it reads the redundancy structure off the graph.
    # This is the baseline that decides whether propagation earns its keep.
    cutg = cut_graph(project, base_func)
    proxies["cutreach"] = {v: len(nx.descendants(cutg, v)) for v in ids}
    # Baseline-aware variant: redundancy is counted over LIVE suppliers only.
    cutg_op = cut_graph(project, base_func, live_suppliers_only=True)
    proxies["cutreach_op"] = {v: len(nx.descendants(cutg_op, v)) for v in ids}

    cond_vec = [c_cond[v] for v in ids]
    del_vec = [c_del[v] for v in ids]

    # Prop 1 row 1: deletion never exceeds conditioning.
    domination = all(c_del[v] <= c_cond[v] + 1e-12 for v in ids)
    # Prop 2: divergence only at sole suppliers.
    soles = {v for v in cutg if cutg.out_degree(v) > 0}
    divergent = {v for v in ids if abs(c_cond[v] - c_del[v]) > 1e-12}
    prop2 = divergent <= soles

    # "Live" = v's failure reaches beyond v itself.
    live = [v for v in ids if c_cond[v] > 1.0 / n + 1e-12]

    # Top-k agreement: would a proxy pick the same hardening set?
    k = max(1, n // 10)
    top_cond = set(sorted(ids, key=lambda v: -c_cond[v])[:k])
    # The practitioner's question: harden the top 10% by vitality — how many of
    # the nodes propagation would have chosen do you actually get? Ties are
    # broken at random, so a constant index scores at chance (~k/n).
    shuffled = list(ids)
    random.Random(0).shuffle(shuffled)
    top_del = set(sorted(shuffled, key=lambda v: -c_del[v])[:k])

    out = {
        "tau_del": kendalltau(cond_vec, del_vec).statistic,
        "c_del_distinct": len({round(x, 9) for x in del_vec}),
        "live_fraction": len(live) / n,
        "cond_max": max(cond_vec),
        "cond_mean": sum(cond_vec) / n,
        "base_omega": base_omega,
        "domination_ok": domination,
        "prop2_ok": prop2,
        "n_divergent": len(divergent),
        f"top{k}_del": len(top_cond & top_del) / k,
        "eff_ranks_del": effective_ranks(del_vec),
        "eff_ranks_cond": effective_ranks(cond_vec),
        # Is the reduction an IDENTITY? c_cond(v) counts v plus everything its
        # failure reaches; cutreach counts v's descendants in the order-1
        # min-cut graph. Where they disagree, a single failure took out BOTH
        # suppliers of some redundant category.
        "reduction_exact": sum(
            abs(c_cond[v] * n - 1 - len(nx.descendants(cutg, v))) < 1e-9 for v in ids
        ) / n,
        "reduction_exact_op": sum(
            abs(c_cond[v] * n - 1 - len(nx.descendants(cutg_op, v))) < 1e-9
            for v in ids
        ) / n,
    }
    for name, score in proxies.items():
        out[f"tau_{name}"] = kendalltau(cond_vec, [score[v] for v in ids]).statistic
        top_proxy = set(sorted(ids, key=lambda v: -score[v])[:k])
        out[f"top{k}_{name}"] = len(top_cond & top_proxy) / k
        # tau over the LIVE nodes only. At low rho the full-vector tau is
        # dominated by ties among inert nodes and reports agreement that is
        # really just shared silence.
        if len(live) >= 3:
            out[f"taulive_{name}"] = kendalltau(
                [c_cond[v] for v in live], [score[v] for v in live]
            ).statistic
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=60)
    ap.add_argument("--categories", type=int, default=3)
    ap.add_argument("--roots", type=int, default=6)
    ap.add_argument("--reps", type=int, default=10)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--seed-failures", type=int, default=0,
                    help="pre-fail this many non-root nodes (baseline sensitivity)")
    ap.add_argument("--out", type=Path, default=None)
    args = ap.parse_args()

    config = make_config(args.categories)
    rhos = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0]
    ps = [0.0, 0.5]
    rows = []
    # Replicate-level values pooled across the conjunction setting p, so the
    # paper's table (which reports one row per rho) can carry an interval built
    # from every replicate behind that row rather than from half of them.
    pooled: dict[tuple[float, str], list] = {}

    for rho, p in itertools.product(rhos, ps):
        acc: dict[str, list] = {}
        for rep in range(args.reps):
            rng = random.Random(hash((args.seed, rho, p, rep)) & 0xFFFFFFFF)
            project = generate(args.n, args.categories, args.roots, rho, p, rng)
            if args.seed_failures:
                project = seed_failures(project, args.seed_failures, args.roots, rng)
            for key, value in analyse_replicate(project, config).items():
                acc.setdefault(key, []).append(value)
                if not isinstance(value, bool):
                    pooled.setdefault((rho, key), []).append(value)
        row = {"rho": rho, "p": p}
        for key, values in acc.items():
            if isinstance(values[0], bool):
                row[key] = all(values)
            else:
                clean = [x for x in values if x == x]
                row[key] = sum(clean) / len(clean) if clean else float("nan")
                lo, hi = bootstrap_ci(values)
                row[f"{key}_ci95"] = [lo, hi]
        rows.append(row)
        k = max(1, args.n // 10)
        print(
            f"rho={rho:.1f} p={p:.1f} | live={row['live_fraction']:.2f} "
            f"| tau reach={row['tau_reach']:+.2f}"
            f"[{row['tau_reach_ci95'][0]:+.2f},{row['tau_reach_ci95'][1]:+.2f}] "
            f"pr={row['tau_pagerank']:+.2f} "
            f"betw={row['tau_betw']:+.2f} CUTREACH={row['tau_cutreach']:+.2f} "
            f"| live-only cut={row.get('taulive_cutreach', float('nan')):+.2f} "
            f"reach={row.get('taulive_reach', float('nan')):+.2f} "
            f"| top{k} cut={row[f'top{k}_cutreach']:.2f} "
            f"reach={row[f'top{k}_reach']:.2f} "
            f"| effranks del={row['eff_ranks_del']:.2f} cond={row['eff_ranks_cond']:.2f} "
            f"dom={row['domination_ok']} prop2={row['prop2_ok']}",
            flush=True,
        )

    metrics = ("tau_reach", "tau_pagerank", "tau_betw", "live_fraction")
    print("\nPooled over the conjunction setting, 95% percentile bootstrap over "
          f"all {args.reps * len(ps)} replicates per cell:\n")
    print(f"  {'metric':<14} " + " ".join(f"{r:>21.1f}" for r in rhos))
    pooled_out: dict[str, dict[str, list]] = {}
    for metric in metrics:
        cells = []
        for rho in rhos:
            vals = pooled.get((rho, metric), [])
            clean = [x for x in vals if x == x]
            mean = sum(clean) / len(clean) if clean else float("nan")
            lo, hi = bootstrap_ci(vals)
            cells.append(f"{mean:.3f}[{lo:.3f},{hi:.3f}]")
            pooled_out.setdefault(metric, {})[str(rho)] = [mean, lo, hi]
        print(f"  {metric:<14} " + " ".join(f"{c:>21}" for c in cells))

    if args.out:
        args.out.write_text(json.dumps({"rows": rows, "pooled": pooled_out},
                                       indent=2))
        print(f"\nwrote {args.out}")


if __name__ == "__main__":
    main()
