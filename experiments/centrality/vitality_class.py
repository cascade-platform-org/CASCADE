"""
experiments/centrality/vitality_class.py — when the requirements are computed.

The paper's model reads a node's required services off the network once
(paper §3):

    C(v) = { kappa(u) : u -> v }

and that set belongs to the network's description from then on. §4's index removes
a node and measures the operativity lost, with C at those values. This script runs
the engine over the two ways of handling C under a removal:

  COMPUTED ONCE   C is fixed at what the network as given produced. The model.
  RE-DERIVED      C is recomputed from whatever links survive the removal, which
                  is what an index working from the links alone must do, since the
                  reduced network is all it has.

A centrality is a VITALITY INDEX when some invariant function f of the network
satisfies c(v) = f(G) - f(G - v)  (Koschuetzki 2005; Skibski 2021). Take f = N,
the number of operational nodes at the fixpoint. Two things are checked.

WITH C COMPUTED ONCE the index ranks, and removing a node gives the same value as
holding it present and failed, because C is already fixed and neither operation
disturbs it.

RE-DERIVED, every service in C'(w) arrived from a surviving link and so still has
a supplier: V is a fixpoint, N = |V| for every network, and every node scores
1/|V|. This is §4's proposition.

THE ENGINE DERIVES REQUIREMENTS FROM PARENTS (engine/logical.py, ADR-0003), which
is the RE-DERIVED column. To hold C fixed under removal without
reimplementing any propagation, each (consumer w, required service c) gets a
placeholder supplier of c pinned to failed. Disjunction within a service then does
exactly the right thing:

    live real supplier + failed placeholder -> best_of = operational
    real supplier removed, placeholder only -> best_of = failed

so the requirement outlives the link that first witnessed it. Placeholders are
excluded from every count. All propagation is the engine's.

Run from CASCADE-backend/:
    python ../experiments/centrality/vitality_class.py

Dev-only paper harness importing engine.* directly, so that it measures the
engine's real logic rather than a reimplementation of it. No import-linter
carve-out is required: the contract's `root_packages` (pyproject.toml) cover the
backend tree only, so a harness under `experiments/` is outside the analysed
modules.
"""
from __future__ import annotations

import argparse
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "CASCADE-backend"))

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

Labels = dict[str, str]          # node -> the service it provides (kappa)
Links = list[tuple[str, str]]
Requires = dict[str, set[str]]   # node -> the services it requires (C)


def make_config(n_services: int) -> ModelConfiguration:
    return ModelConfiguration(
        version="1.0",
        meta=ConfigMeta(name="vitality-class"),
        functionality_scale=[
            FunctionalityScaleLevel(level=FAILED, label="failed", color="#ef4444"),
            FunctionalityScaleLevel(level=OK, label="operational", color="#22c55e"),
        ],
        categories=[
            CategoryDefinition(name=f"c{i}", category_type="Requisite")
            for i in range(n_services)
        ],
    )


def recovered(labels: Labels, links: Links) -> Requires:
    """C(v) = {kappa(u) : u -> v}, computed on the network as given."""
    req: Requires = {v: set() for v in labels}
    for u, v in links:
        req[v].add(labels[u])
    return req


def operational(labels: Labels, links: Links, config: ModelConfiguration,
                req: Requires | None = None, condemned: str | None = None) -> int:
    """N: operational REAL nodes at the fixpoint.

    `req` present  -> C computed once, pinned by placeholders so it survives removal.
    `req` absent   -> C re-derived by the engine from the surviving links.
    `condemned`    -> that node starts failed (holding it present and failed).
    """
    nodes: dict[str, Node] = {}
    edges: dict[str, Edge] = {}
    for nid, service in labels.items():
        nodes[nid] = Node(id=nid,
                          functionality=FAILED if nid == condemned else OK,
                          node_categories=[service])
    k = 0
    for u, v in links:
        edges[f"e{k}"] = Edge(id=f"e{k}", source=u, target=v, functionality=OK)
        k += 1
    if req is not None:
        for w, services in req.items():
            if w not in labels:
                continue
            for service in services:
                ph = f"__req_{w}_{service}"
                nodes[ph] = Node(id=ph, functionality=FAILED,
                                 node_categories=[service])
                edges[f"e{k}"] = Edge(id=f"e{k}", source=ph, target=w,
                                      functionality=OK)
                k += 1

    project = Project(
        version="2.0", meta=ProjectMeta(name="vc"), nodes=nodes, edges=edges,
        canvases=[Canvas(id="cv", graph=Graph(graph_type="generic",
                                              node_ids=list(nodes),
                                              edge_ids=list(edges)))],
    )
    res = run(PropagationRequest(project=project, config=config, scope="global"))
    level = {nid: node.functionality for nid, node in project.nodes.items()}
    for update in res.updates:
        if update.id in level:
            level[update.id] = update.functionality
    return sum(level[nid] - FAILED for nid in labels)


def index(labels: Labels, links: Links, victim: str, config: ModelConfiguration,
          req: Requires | None) -> int:
    """Count form of the vitality index: N(D) - N(D - victim)."""
    if victim not in labels:
        return 0
    kept, kept_links, kept_req = without(labels, links, req, victim)
    return (operational(labels, links, config, req)
            - operational(kept, kept_links, config, kept_req))


def conditioned(labels: Labels, links: Links, victim: str,
                config: ModelConfiguration, req: Requires | None) -> int:
    """N(D) - N(D | f0(victim) = 0): hold the node present and failed."""
    if victim not in labels:
        return 0
    return (operational(labels, links, config, req)
            - operational(labels, links, config, req, condemned=victim))


def without(labels: Labels, links: Links, req: Requires | None,
            victim: str) -> tuple[Labels, Links, Requires | None]:
    """D - v: drop the node and its links. C is carried, so it only restricts."""
    return (
        {nid: s for nid, s in labels.items() if nid != victim},
        [(u, v) for u, v in links if u != victim and v != victim],
        None if req is None else {w: s for w, s in req.items() if w != victim},
    )


def random_network(n: int, n_services: int, max_parents: int,
                   rng: random.Random) -> tuple[Labels, Links]:
    labels = {f"n{i}": f"c{rng.randrange(n_services)}" for i in range(n)}
    links = [(f"n{j}", f"n{i}")
             for i in range(1, n)
             for j in rng.sample(range(i), min(rng.randint(1, max_parents), i))]
    return labels, links


# The smallest network on which the two descriptions disagree: one supplier, two
# consumers, a single service. Small enough to check by hand.
WITNESS_LABELS: Labels = {"n0": "c0", "n1": "c0", "n2": "c0"}
WITNESS_LINKS: Links = [("n0", "n1"), ("n0", "n2")]


def report_witness(config: ModelConfiguration) -> None:
    """n0 -> n1, n0 -> n2, one service. Remove n0 and the two consumers lose the
    only supplier of the service they require. With C computed once they
    fail; re-derived, the requirement leaves with the link."""
    print("Witness: n0 -> n1, n0 -> n2, one service\n")
    print(f"  {'C':<16} {'N(G)':>5} {'N(G-n0)':>8} "
          f"{'c(n0)':>6} {'c(n1)':>6} {'c(n2)':>6}")
    for name, req in (("computed once", recovered(WITNESS_LABELS, WITNESS_LINKS)),
                      ("re-derived", None)):
        kept, kept_links, kept_req = without(WITNESS_LABELS, WITNESS_LINKS,
                                             req, "n0")
        scores = [index(WITNESS_LABELS, WITNESS_LINKS, v, config, req)
                  for v in WITNESS_LABELS]
        print(f"  {name:<16} "
              f"{operational(WITNESS_LABELS, WITNESS_LINKS, config, req):>5} "
              f"{operational(kept, kept_links, config, kept_req):>8} "
              + " ".join(f"{s:>6}" for s in scores))
    print("\n  Computed once, the three nodes are ranked. Re-derived, n1 and n2 stop")
    print("  requiring c0 the moment n0 goes, every network stays fully operational,")
    print("  and the invariant is the node count.\n")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=7)
    ap.add_argument("--services", type=int, default=3)
    ap.add_argument("--max-parents", type=int, default=3)
    ap.add_argument("--reps", type=int, default=30)
    ap.add_argument("--seed", type=int, default=11)
    args = ap.parse_args()
    config = make_config(args.services)

    print("When the required services are computed")
    print("=" * 66 + "\n")
    report_witness(config)

    rng = random.Random(args.seed)
    stats = {name: dict(disagree=0, nodes=0, distinct=0.0, full_N=0, constant=0)
             for name in ("computed once", "re-derived")}

    for _ in range(args.reps):
        labels, links = random_network(args.n, args.services,
                                       args.max_parents, rng)
        for name, req in (("computed once", recovered(labels, links)),
                          ("re-derived", None)):
            s = stats[name]
            scores = {v: index(labels, links, v, config, req) for v in labels}
            s["nodes"] += len(labels)
            s["distinct"] += len(set(scores.values()))
            s["constant"] += len(set(scores.values())) == 1
            s["full_N"] += operational(labels, links, config, req) == len(labels)
            for v in labels:
                if scores[v] != conditioned(labels, links, v, config, req):
                    s["disagree"] += 1

    print(f"Random networks: n={args.n}, {args.services} services, "
          f"<= {args.max_parents} parents, {args.reps} replicates\n")
    print(f"  {'C':<16} {'removal = conditioning':>23} "
          f"{'distinct scores':>17} {'constant index':>16}")
    for name in ("computed once", "re-derived"):
        s = stats[name]
        agree = s["nodes"] - s["disagree"]
        print(f"  {name:<16} {agree:>9} / {s['nodes']:<11} "
              f"{s['distinct'] / args.reps:>17.2f} "
              f"{s['constant']:>7} / {args.reps}")

    baseline = all(stats[n]["full_N"] == args.reps for n in stats)
    print("\n  Row 1: with C computed once, removal and conditioning coincide and")
    print("  the index ranks.")
    print("  Row 2 is the proposition: re-derived, every network stays fully")
    print("  operational, so every node receives the same score.")
    print(f"\n  Both agree on the network as given "
          f"({'all' if baseline else 'some'} replicates fully operational either way).")
    print("  They part under removal, which is the operation the index performs.")

    if stats["computed once"]["disagree"]:
        raise SystemExit("C computed once: the index should rank and match conditioning")
    if stats["re-derived"]["constant"] != args.reps:
        raise SystemExit("proposition failed: a re-derived index should be constant")
    if stats["re-derived"]["full_N"] != args.reps:
        raise SystemExit("proposition failed: N should equal |V| when C is re-derived")


if __name__ == "__main__":
    main()
