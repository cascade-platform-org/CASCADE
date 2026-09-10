"""
scripts/paper_shapley_vs_centrality.py — quantitative backing for the IJDRR
paper's §4.4 (centrality vs. Shapley) claim that structural centrality and
operational (Shapley) criticality diverge.

WHAT THIS SCRIPT DOES NOT DO ANY MORE. It used to carry its own Monte Carlo
truncated-permutation Shapley estimator, a second implementation of
`CASCADE-app/lib/model-based-analysis.ts`. Two implementations of one estimator
drift, and they did: the client shuffled with `sort(() => Math.random() - 0.5)`
— neither uniform nor seeded — while this script drew uniform permutations, so
the published numbers were not the numbers the product computed and neither run
could be replayed. The estimator now lives in ONE place, the app, and this
script consumes its exported result. What is left here is the part that was
never duplicated: networkx centralities, the Spearman comparison, and the
per-node table behind §4.4.

The trade is deliberate: reproducing §4.4 now takes a run of the Analysis page
(Model-based → Shapley Values → Export Shapley values) rather than a single
command. In exchange, the paper's φ̂ are by construction the φ̂ the product
computes.

    # 1. In the app: load the network, run Model-based → Shapley Values,
    #    then "Export Shapley values (JSON)".
    # 2. From CASCADE-backend/:
    python scripts/paper_shapley_vs_centrality.py \
        --network ../CASCADE-app/samples/public/Palmanova_Complete.json \
        --shapley ~/Downloads/shapley-Palmanova_Complete-seed4242.json

Centrality is computed with networkx on the same directed dependency graph
(tail -> head, "provides to").

IMPORTANT: run from CASCADE-backend/ (same sys.path convention as
scripts/benchmark_engine.py). This is a dev-only analysis harness for the
paper, not part of the API request path. It no longer imports `engine.*` and
therefore no longer needs an import-linter carve-out (CLAUDE.md §7/§8a).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import networkx as nx  # noqa: E402
from scipy.stats import spearmanr  # noqa: E402

from schemas.network import Project  # noqa: E402
from schemas.results import PropagationResult  # noqa: E402,F401

# `Project.scorecard` carries a forward reference to PropagationResult, declared
# under TYPE_CHECKING in schemas/network.py. Importing the name and rebuilding
# resolves it; without this, model_validate raises PydanticUserError.
Project.model_rebuild()

EXPORT_FORMAT = "cascade.shapley-export"
EXPORT_VERSION = 1


def load_project(network_path: Path) -> Project:
    data = json.loads(network_path.read_text())
    return Project.model_validate(data["project"])


def load_shapley(export_path: Path, project: Project) -> tuple[dict[str, float], dict]:
    """
    Read an app-exported Shapley document and return (phi_by_node_id, params).

    Every check here guards a way the join can go quietly wrong. A document from
    a different network, or from a run over a different Element set, would still
    produce a Spearman number — just a meaningless one. Fail instead.
    """
    doc = json.loads(export_path.read_text())

    if doc.get("format") != EXPORT_FORMAT:
        raise SystemExit(
            f"{export_path} is not a CASCADE Shapley export "
            f"(format={doc.get('format')!r}, expected {EXPORT_FORMAT!r})."
        )
    if doc.get("version") != EXPORT_VERSION:
        raise SystemExit(
            f"{export_path} is export version {doc.get('version')!r}; "
            f"this script reads version {EXPORT_VERSION}."
        )
    if doc.get("operativity_scale") != "fraction":
        # φ̂ from the retired Python estimator were on the 0-100 Operativity
        # scale. Ranks would survive a rescale; the plotted values would not.
        raise SystemExit(
            f"{export_path} reports operativity_scale="
            f"{doc.get('operativity_scale')!r}; expected 'fraction'."
        )

    if not doc["params"].get("nodes_only", True):
        # §4.4 compares node Shapley against node centrality, so the coalition
        # game must be over nodes. A run that let edges fail too is a different
        # game and shifts every node's φ̂ — the edge entries are dropped below,
        # but the node values they were computed alongside are not comparable.
        print(
            f"WARNING: {export_path} came from a run with 'Nodes only' unchecked. "
            "Its node φ̂ are from a node+edge game, not the node game §4.4 reports.",
            file=sys.stderr,
        )

    phi = {e["id"]: float(e["value"]) for e in doc["shapley"] if e["kind"] == "node"}

    node_ids = set(project.nodes)
    missing = node_ids - set(phi)
    unknown = set(phi) - node_ids
    if unknown:
        raise SystemExit(
            f"{export_path} scores {len(unknown)} node(s) absent from the --network project: "
            f"{sorted(unknown)[:5]}. The export and the network are different models."
        )
    if missing:
        # A scoped run (a single Canvas) legitimately covers fewer nodes than the
        # file. Say so loudly — §4.4 compares over the whole network.
        raise SystemExit(
            f"{export_path} is missing φ̂ for {len(missing)} node(s), e.g. "
            f"{sorted(missing)[:5]}. Re-run the export with scope 'global' and "
            f"'Nodes only' unchecked."
        )

    return phi, doc["params"]



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
    p.add_argument(
        "--shapley",
        type=Path,
        required=True,
        help="Shapley export written by the Analysis page (Model-based -> Export).",
    )
    p.add_argument("--top", type=int, default=15)
    p.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parents[2] / "experiments" / "shapley_vs_centrality.json",
        help="Where to write the per-node results. Defaults to the git-tracked paper artifact, "
             "so point this elsewhere when trying the script out.",
    )
    args = p.parse_args()

    project = load_project(args.network)
    phi, params = load_shapley(args.shapley, project)
    eig, btw = centrality(project)

    labels = {nid: n.label for nid, n in project.nodes.items()}
    node_ids = list(project.nodes.keys())

    shapley_rank = sorted(node_ids, key=lambda i: -phi[i])
    eig_rank = sorted(node_ids, key=lambda i: -eig[i])
    btw_rank = sorted(node_ids, key=lambda i: -btw[i])

    rho_eig, p_eig = spearmanr([phi[i] for i in node_ids], [eig[i] for i in node_ids])
    rho_btw, p_btw = spearmanr([phi[i] for i in node_ids], [btw[i] for i in node_ids])
    rho_eig_btw, p_eig_btw = spearmanr([eig[i] for i in node_ids], [btw[i] for i in node_ids])

    print(f"Shapley from {args.shapley.name}: {len(node_ids)} nodes, "
          f"k_max={params['k_max']}, samples used={params['samples_used']}"
          f"/{params['samples_requested']}, seed={params['seed']}, "
          f"engine calls={params['evaluations']}\n")

    print(f"Spearman rho(Shapley, Eigenvector) = {rho_eig:.3f} (p={p_eig:.3g})")
    print(f"Spearman rho(Shapley, Betweenness) = {rho_btw:.3f} (p={p_btw:.3g})")
    print(f"Spearman rho(Eigenvector, Betweenness) = {rho_eig_btw:.3f} (p={p_eig_btw:.3g})\n")

    print(f"{'Rank':<5}{'Shapley (phi)':<30}{'Eigenvector':<30}{'Betweenness':<30}")
    for i in range(min(args.top, len(node_ids))):
        s_id, e_id, b_id = shapley_rank[i], eig_rank[i], btw_rank[i]
        print(
            f"{i+1:<5}"
            f"{labels[s_id] + f' ({phi[s_id]:.4f})':<30}"
            f"{labels[e_id] + f' ({eig[e_id]:.4f})':<30}"
            f"{labels[b_id] + f' ({btw[b_id]:.4f})':<30}"
        )

    out = {
        "meta": {
            # φ̂ are Operativity Score FRACTIONS (0-1). Runs recorded before the
            # estimator was consolidated into the app used the 0-100 scale and
            # are therefore 100x larger. Spearman rho is rank-based and unaffected.
            "operativity_scale": "fraction",
            "shapley_source": args.shapley.name,
            "samples_requested": params["samples_requested"],
            "samples_used": params["samples_used"],
            "k_max": params["k_max"],
            "seed": params["seed"],
            "engine_calls": params["evaluations"],
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
    args.out.write_text(json.dumps(out, indent=2))
    print(f"\nFull per-node results written to {args.out}")


if __name__ == "__main__":
    main()
