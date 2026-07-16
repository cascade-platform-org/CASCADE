"""
experiments/algorithm_variants.py — A/B test alternative SourceToDemands
allocation algorithms against the worst-situations kits, WITHOUT touching any
shipped backend file.

Mechanism: engine/propagation.py does `from engine.flow import
flow_category_candidates`, binding its OWN local name in its namespace. This
script monkeypatches `engine.propagation.flow_category_candidates` at
runtime (restored in a finally block) so every other part of the real engine
— round iteration, guards, Requisite/logical mechanism, convergence, commit —
runs completely unmodified; only the flow-allocation math differs. No file on
disk is edited.

Variants, selected by a "graph_type name" string (per owner instruction):

  water_network                — the real algorithm (nx.max_flow_min_cost,
                                  priority-reward winner-take-all). Control:
                                  must reproduce engine_result.json exactly.
  water_network_proportional   — one-shot global-ratio water-filling: find
                                  the single scale factor theta such that
                                  scaling every consumer's demand cap by theta
                                  is simultaneously feasible, deliver theta*demand
                                  to everyone. Cheap (one bisection), ignores
                                  priority entirely.
  water_network_fairshare      — full iterative max-min fair-share
                                  (progressive water-filling): raise all
                                  consumers' rate in lockstep, freeze whoever
                                  hits a local bottleneck below the group
                                  rate, continue on the residual graph with
                                  the rest. The principled fix for the
                                  winner-take-all diagnosis (see conversation).

Priority axis (independent of algorithm, since priority is confirmed
irrelevant to fidelity but stays a real modeller-facing knob): "sweep"
(imported failure-order priorities, current default) vs "none" (uniform).

Usage: python experiments/algorithm_variants.py
Output: experiments/algorithm_variants_report.csv (60 rows: kit x algorithm x
priority_mode) and experiments/algorithm_variants_report.md (summary table).
"""
from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "CASCADE-backend"))

import networkx as nx  # noqa: E402

import engine.flow as _flow  # noqa: E402
import engine.propagation as _prop  # noqa: E402
from schemas.config import ModelConfiguration  # noqa: E402
from schemas.network import Project  # noqa: E402
from schemas.results import PropagationRequest  # noqa: E402

KITS_ROOT = Path(__file__).resolve().parent / "worst-situations"
BISECT_ITERS = 28
EPS = 1e-6

ALGORITHMS = ["water_network", "water_network_proportional", "water_network_fairshare"]
PRIORITY_MODES = ["sweep", "none"]


# --- shared graph construction (reuses engine.flow's own helpers — not a
#     reimplementation of their logic, just their public/private accessors,
#     so this can never silently drift from what the real capacity/supply/
#     throughput math does) -----------------------------------------------

def _build_base_graph(category, nodes, edges, node_func, edge_func, n):
    # sorted(), not a bare set -> list: Python's set iteration order for
    # strings depends on the per-process hash seed, which changes edge
    # insertion order into the DiGraph and can flip which member of a
    # degenerate max-flow solution set gets returned (the exact mechanism
    # behind the engine bug this whole investigation started from — see
    # ADR-0003's 2026-07-11 addendum). Sorting removes that confound from
    # comparisons WITHIN this harness; engine/flow.py has the same latent
    # property and is intentionally left untouched here.
    members = sorted({nid for nid, node in nodes.items() if _flow._in_category(node, category)})
    if not members:
        return None
    default_cap = _flow._max_source_supply(category, nodes)
    graph = nx.DiGraph()
    consumers: dict[str, int] = {}  # nid -> scaled demand cap
    for nid in members:
        node = nodes[nid]
        throughput = _flow._throughput(node, category, node_func[nid], n, default_cap)
        graph.add_edge((nid, "in"), (nid, "out"), capacity=throughput, weight=1)
        supply = _flow._effective_supply(node, category, node_func[nid], n)
        if supply is not None:
            graph.add_edge(_flow._SRC, (nid, "in"), capacity=supply, weight=0)
        demand = _flow._demand(node, category)
        if demand:
            consumers[nid] = _flow._scaled(demand)
    for edge in edges:
        if edge.source in members and edge.target in members:
            cap = _flow._edge_capacity(edge, edge_func[edge.id], n, default_cap)
            graph.add_edge((edge.source, "out"), (edge.target, "in"), capacity=cap, weight=1)
    if _flow._SRC not in graph or not consumers:
        return None
    return graph, members, consumers


def _candidates_from_delivered(delivered, nodes, category, n):
    candidates = {}
    for nid, amount in delivered.items():
        demand = _flow._demand(nodes[nid], category)
        if not demand:
            continue
        ratio = amount / _flow.SCALE / demand if demand > 0 else 1.0
        level = _flow._ratio_to_level(ratio, n)
        if level >= n:
            continue
        candidates[nid] = (level, {})  # responsibility not needed for this analysis
    return candidates


# --- variant 1: baseline (real algorithm, control) --------------------------

def _solve_baseline(category, nodes, edges, node_func, edge_func, n, allocation=None):  # allocation: engine-call compat; this solver IS a fixed algorithm
    built = _build_base_graph(category, nodes, edges, node_func, edge_func, n)
    if built is None:
        return {}
    graph, members, consumers = built
    big = len(nodes) + len(edges) + 10
    for nid, cap in consumers.items():
        reward = -_flow._priority(nodes[nid], category) * big
        graph.add_edge((nid, "in"), _flow._SINK, capacity=cap, weight=reward)
    if _flow._SINK not in graph:
        return {}
    flow = nx.max_flow_min_cost(graph, _flow._SRC, _flow._SINK)
    delivered = {nid: flow.get((nid, "in"), {}).get(_flow._SINK, 0) for nid in consumers}
    return _candidates_from_delivered(delivered, nodes, category, n)


# --- variant 2: single-shot proportional water-filling -----------------------

def _solve_proportional(category, nodes, edges, node_func, edge_func, n, allocation=None):  # allocation: engine-call compat
    built = _build_base_graph(category, nodes, edges, node_func, edge_func, n)
    if built is None:
        return {}
    graph, members, consumers = built

    def feasible_value(theta):
        g = graph.copy()
        for nid, cap in consumers.items():
            g.add_edge((nid, "in"), _flow._SINK, capacity=max(1, round(cap * theta)))
        if _flow._SINK not in g:
            return 0.0, {}
        value, flow_dict = nx.maximum_flow(g, _flow._SRC, _flow._SINK)
        return value, flow_dict

    lo, hi = 0.0, 1.0
    best_flow = {}
    for _ in range(BISECT_ITERS):
        mid = (lo + hi) / 2
        target = sum(consumers.values()) * mid
        value, flow_dict = feasible_value(mid)
        if value >= target - EPS * max(1, sum(consumers.values())):
            lo = mid
            best_flow = flow_dict
        else:
            hi = mid
    delivered = {nid: best_flow.get((nid, "in"), {}).get(_flow._SINK, 0) for nid in consumers}
    return _candidates_from_delivered(delivered, nodes, category, n)


# --- variant 3: max-min fair-share via ascending-demand sequential water-filling
#
# Standard technique for max-min fairness in a single-sink network: process
# consumers smallest-demand-first; for each, fix every already-processed
# consumer's sink-edge capacity at EXACTLY what it was given (a hard cap, not
# just a floor — nx.maximum_flow will saturate it whenever the graph still
# admits enough flow, which adding one more consumer never prevents), then
# run one plain max-flow with this consumer's own sink-edge capped at its full
# demand and read off what it actually received. One max-flow call per
# consumer, no bisection, no flow-decomposition ambiguity to resolve (each
# committed consumer's fixed cap makes its own achieved amount unambiguous).
# An earlier bisection-based version of this function suffered exactly that
# ambiguity — nx.maximum_flow's arbitrary flow decomposition made "did this
# consumer hit ITS OWN local bottleneck" unreadable from a shared-theta
# solve — replaced after producing an obviously-wrong FMS ~0 on kit 01
# (every consumer capped at the same global ratio instead of finding real
# per-consumer bottlenecks).

def _solve_fairshare(category, nodes, edges, node_func, edge_func, n, allocation=None):  # allocation: engine-call compat
    built = _build_base_graph(category, nodes, edges, node_func, edge_func, n)
    if built is None:
        return {}
    graph, members, consumers = built

    # Mutate ONE graph in place rather than graph.copy() per consumer — a
    # per-iteration deep copy of a several-hundred-node DiGraph dominated
    # runtime (1737s on Zampis/607 junctions before this fix). Each already-
    # processed consumer's sink edge, once frozen at its achieved amount,
    # never needs to change again, so there is nothing to protect by copying.
    order = sorted(consumers, key=lambda nid: consumers[nid])  # smallest demand first
    committed: dict[str, int] = {}
    for nid in order:
        graph.add_edge((nid, "in"), _flow._SINK, capacity=consumers[nid])
        _, flow_dict = nx.maximum_flow(graph, _flow._SRC, _flow._SINK)
        achieved = flow_dict.get((nid, "in"), {}).get(_flow._SINK, 0)
        committed[nid] = achieved
        graph[(nid, "in")][_flow._SINK]["capacity"] = achieved  # freeze in place

    return _candidates_from_delivered(committed, nodes, category, n)


_SOLVERS = {
    "water_network": _solve_baseline,
    "water_network_proportional": _solve_proportional,
    "water_network_fairshare": _solve_fairshare,
}


def run_variant(algorithm: str, priority_mode: str, project: Project, config: ModelConfiguration):
    proj = project.model_copy(deep=True)
    if priority_mode == "none":
        for node in proj.nodes.values():
            profile = (node.category_dependency_profiles or {}).get("water")
            if profile is not None:
                profile.priority = None

    solver = _SOLVERS[algorithm]
    original = _prop.flow_category_candidates
    _prop.flow_category_candidates = solver
    try:
        result = _prop.run(PropagationRequest(project=proj, config=config, scope="global"))
    finally:
        _prop.flow_category_candidates = original
    return proj, result


def compare(result, project, epanet_levels: dict[str, int]):
    by_node = {u.id: u.functionality for u in result.updates}
    inp_to_node = {
        (n.properties or {}).get("inp_id"): nid
        for nid, n in project.nodes.items() if (n.properties or {}).get("inp_id")
    }
    demands = {}
    for nid, node in project.nodes.items():
        profile = (node.category_dependency_profiles or {}).get("water")
        if profile is not None and profile.demand:
            demands[nid] = profile.demand

    too_pess = too_opt = matched = 0
    weighted_err = 0.0
    total_weight = 0.0
    n_levels = 3
    for jid, ep_level in epanet_levels.items():
        nid = inp_to_node.get(jid)
        if nid is None or nid not in demands:
            continue
        en_level = by_node.get(nid, project.nodes[nid].functionality)
        w = demands[nid]
        weighted_err += w * abs(en_level - ep_level)
        total_weight += w
        if en_level < ep_level:
            too_pess += 1
        elif en_level > ep_level:
            too_opt += 1
        else:
            matched += 1
    fms = 1.0 - (weighted_err / total_weight) / max(1, n_levels - 1) if total_weight > 0 else 1.0
    return fms, too_pess, too_opt, matched


def main():
    rows = []
    for kit in sorted(KITS_ROOT.iterdir()):
        if not kit.is_dir():
            continue
        bundle_path = kit / "scenario.bundle.json"
        epanet_path = kit / "epanet_result.json"
        if not bundle_path.exists() or not epanet_path.exists():
            continue
        bundle = json.loads(bundle_path.read_text())
        project = Project.model_validate(bundle["project"])
        config = ModelConfiguration.model_validate(bundle["config"])
        epanet_levels = json.loads(epanet_path.read_text())["levels"]

        for algorithm in ALGORITHMS:
            for priority_mode in PRIORITY_MODES:
                proj, result = run_variant(algorithm, priority_mode, project, config)
                fms, too_pess, too_opt, matched = compare(result, proj, epanet_levels)
                rows.append({
                    "kit": kit.name, "algorithm": algorithm, "priority_mode": priority_mode,
                    "fms": round(fms, 4), "too_pessimistic": too_pess, "too_optimistic": too_opt,
                    "matched": matched, "iterations": result.iterations,
                })
                print(f"{kit.name:32s} {algorithm:28s} prio={priority_mode:6s} "
                      f"FMS={fms:.3f} pess={too_pess:4d} opt={too_opt:3d}")

    out_csv = Path(__file__).resolve().parent / "algorithm_variants_report.csv"
    with out_csv.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    print(f"\nWrote {out_csv}")


if __name__ == "__main__":
    main()
