"""
scripts/paper_shapley_vs_centrality.py — quantitative backing for the IJDRR
paper's §4.4 (centrality vs. Shapley) claim that structural centrality and
operational (Shapley) criticality diverge.

Reproduces, in Python, the exact Monte Carlo truncated-permutation Shapley
estimator implemented client-side in
CASCADE-app/components/analysis/section-model-based.tsx (`runShapley`):
nodes only, coalition size capped at k_max, failed nodes forced to
functionality=1, marginal contribution accumulated along a random
permutation restricted to its first k_max entries, normalised by the number
of completed samples. Baseline is the network exactly as authored (no
hazard applied), matching the paper's "static dependency graph" comparison.

Centrality is computed with networkx on the same directed dependency graph
(tail -> head, "provides to").

    python scripts/paper_shapley_vs_centrality.py --network ../CASCADE-app/samples/public/Palmanova_Complete.json --samples 500 --kmax 3

IMPORTANT: run from CASCADE-backend/ (same sys.path convention as
scripts/benchmark_engine.py). This is a dev-only analysis harness for the
paper, not part of the API request path — see CLAUDE.md §7/§8a and the
import-linter carve-out this script requires.
"""
from __future__ import annotations

import argparse
import json
import random
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import networkx as nx  # noqa: E402
from scipy.stats import spearmanr  # noqa: E402

from engine.propagation import run  # noqa: E402
from schemas.config import ModelConfiguration  # noqa: E402
from schemas.network import Project  # noqa: E402
from schemas.results import PropagationRequest  # noqa: E402


def load(network_path: Path) -> tuple[Project, ModelConfiguration]:
    data = json.loads(network_path.read_text())
    return Project.model_validate(data["project"]), ModelConfiguration.model_validate(data["config"])


def operativity_score(project: Project, config: ModelConfiguration) -> float:
    """Ω(s) = 100 * sum(w_i f_i) / (N * sum(w_i)), uniform weight w_i=1."""
    req = PropagationRequest(project=project, config=config, scope="global")
    res = run(req)
    func = {nid: n.functionality for nid, n in project.nodes.items()}
    for u in res.updates:
        if u.id in func:
            func[u.id] = u.functionality
    n_scale = len(config.functionality_scale)
    return 100.0 * sum(func.values()) / (n_scale * len(func))


def with_failed(project: Project, failed_ids: set[str]) -> Project:
    nodes = dict(project.nodes)
    for fid in failed_ids:
        nodes[fid] = nodes[fid].model_copy(update={"functionality": 1})
    return project.model_copy(update={"nodes": nodes})


def shapley_values(
    project: Project, config: ModelConfiguration, k_max: int, samples: int, seed: int, max_time_secs: float
) -> dict[str, float]:
    node_ids = list(project.nodes.keys())
    k_max = min(k_max, len(node_ids))
    rng = random.Random(seed)  # nosec B311

    baseline_oi = operativity_score(project, config)
    phi = {nid: 0.0 for nid in node_ids}
    cache: dict[tuple[str, ...], float] = {}

    started = time.time()
    actual_samples = 0
    for _ in range(samples):
        if time.time() - started > max_time_secs:
            break
        actual_samples += 1
        order = node_ids[:]
        rng.shuffle(order)
        failed: set[str] = set()
        prev_oi = baseline_oi
        for nid in order[:k_max]:
            failed.add(nid)
            key = tuple(sorted(failed))
            if key in cache:
                cur_oi = cache[key]
            else:
                cur_oi = operativity_score(with_failed(project, failed), config)
                cache[key] = cur_oi
            phi[nid] += prev_oi - cur_oi
            prev_oi = cur_oi

    if actual_samples == 0:
        return {nid: 0.0 for nid in node_ids}
    return {nid: v / actual_samples for nid, v in phi.items()}


def centrality(project: Project) -> tuple[dict[str, float], dict[str, float]]:
    g = nx.DiGraph()
    g.add_nodes_from(project.nodes.keys())
    for e in project.edges.values():
        g.add_edge(e.source, e.target)
    # Directed graph, matching the app's centrality module (topological-analysis.ts,
    # buildDirectedGraph): dependency edges are directional (tail supplies head).
    # Power-iteration eigenvector centrality (not eigenvector_centrality_numpy)
    # tolerates the disconnected/sink-heavy structure typical of a dependency DAG.
    eig = nx.eigenvector_centrality(g, max_iter=10_000, tol=1e-8)
    btw = nx.betweenness_centrality(g)
    return eig, btw


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--network", type=Path, required=True)
    p.add_argument("--samples", type=int, default=500)
    p.add_argument("--kmax", type=int, default=3)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--max-time-secs", type=float, default=300.0)
    p.add_argument("--top", type=int, default=15)
    args = p.parse_args()

    project, config = load(args.network)

    t0 = time.time()
    phi = shapley_values(project, config, args.kmax, args.samples, args.seed, args.max_time_secs)
    shapley_secs = time.time() - t0
    eig, btw = centrality(project)

    labels = {nid: n.label for nid, n in project.nodes.items()}
    node_ids = list(project.nodes.keys())

    shapley_rank = sorted(node_ids, key=lambda i: -phi[i])
    eig_rank = sorted(node_ids, key=lambda i: -eig[i])
    btw_rank = sorted(node_ids, key=lambda i: -btw[i])

    rho_eig, p_eig = spearmanr([phi[i] for i in node_ids], [eig[i] for i in node_ids])
    rho_btw, p_btw = spearmanr([phi[i] for i in node_ids], [btw[i] for i in node_ids])
    rho_eig_btw, p_eig_btw = spearmanr([eig[i] for i in node_ids], [btw[i] for i in node_ids])

    print(f"Shapley computation: {shapley_secs:.1f}s, {len(node_ids)} nodes, "
          f"k_max={args.kmax}, samples requested={args.samples}\n")

    print(f"Spearman rho(Shapley, Eigenvector) = {rho_eig:.3f} (p={p_eig:.3g})")
    print(f"Spearman rho(Shapley, Betweenness) = {rho_btw:.3f} (p={p_btw:.3g})")
    print(f"Spearman rho(Eigenvector, Betweenness) = {rho_eig_btw:.3f} (p={p_eig_btw:.3g})\n")

    print(f"{'Rank':<5}{'Shapley (phi)':<30}{'Eigenvector':<30}{'Betweenness':<30}")
    for i in range(args.top):
        s_id, e_id, b_id = shapley_rank[i], eig_rank[i], btw_rank[i]
        print(
            f"{i+1:<5}"
            f"{labels[s_id] + f' ({phi[s_id]:.4f})':<30}"
            f"{labels[e_id] + f' ({eig[e_id]:.4f})':<30}"
            f"{labels[b_id] + f' ({btw[b_id]:.4f})':<30}"
        )

    out = {
        "meta": {
            "samples_requested": args.samples,
            "k_max": args.kmax,
            "seed": args.seed,
            "shapley_wall_secs": shapley_secs,
            "n_nodes": len(node_ids),
        },
        "spearman": {
            "shapley_vs_eigenvector": {"rho": rho_eig, "p": p_eig},
            "shapley_vs_betweenness": {"rho": rho_btw, "p": p_btw},
            "eigenvector_vs_betweenness": {"rho": rho_eig_btw, "p": p_eig_btw},
        },
        "per_node": [
            {
                "id": nid,
                "label": labels[nid],
                "shapley": phi[nid],
                "eigenvector": eig[nid],
                "betweenness": btw[nid],
                "shapley_rank": shapley_rank.index(nid) + 1,
                "eigenvector_rank": eig_rank.index(nid) + 1,
                "betweenness_rank": btw_rank.index(nid) + 1,
            }
            for nid in node_ids
        ],
    }
    out_path = Path(__file__).resolve().parents[2] / "experiments" / "shapley_vs_centrality.json"
    out_path.write_text(json.dumps(out, indent=2))
    print(f"\nFull per-node results written to {out_path}")


if __name__ == "__main__":
    main()
