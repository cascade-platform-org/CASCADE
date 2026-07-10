"""
engine/flow.py — Priority min-cost max-flow heuristic (PRIVATE IP).

Implements the flow proposal of ADR-0003 for a single `SourceToDemands`
category: build a priority-aware capacitated flow network, solve a min-cost
max-flow, and map each consumer's served ratio to a proposed Functionality level.

Construction (ADR-0003 → Flow proposal):
  - every member node is split in→out with an internal edge capped by its
    per-category throughput (`category_dependency_profiles[g].capacity`,
    unbounded if absent), scaled by the node's Functionality;
  - a super-source feeds each source node's `in` with its effective supply
    (`supply_capacity[g]` scaled by Functionality);
  - each demanding node's `in` drains to a super-sink with capacity = its
    `demand`, at a reward (negative cost) scaled by `priority`;
  - original edges (source `out` → target `in`) are capped by the edge's
    capacity scaled by its (post worst-of) Functionality.

max-flow maximises total delivery; the min-cost tie-break (priority rewards vs a
small uniform friction) routes scarce supply to higher-priority consumers and
along shorter paths. `served_ratio = delivered / demand` maps to a level.

Capacities/weights are integers (networkx min-cost flow requires it), so all
quantities are scaled by `SCALE` and rounded; the served ratio is scale-invariant.
"""
from __future__ import annotations

import math

import networkx as nx

from core.topology import incoming_closure
from schemas.network import Edge, Node

SCALE = 1000          # float quantities → integers for the solver
INF_CAP = 10**12      # stand-in for "unbounded" capacity

_SRC = "__source__"
_SINK = "__sink__"


def flow_category_candidates(
    category: str,
    nodes: dict[str, Node],
    edges: list[Edge],
    node_func: dict[str, int],
    edge_func: dict[str, int],
    n: int,
) -> dict[str, tuple[int, dict[str, float]]]:
    """Flow proposal for one `SourceToDemands` category.

    Returns `{consumer_id -> (level, responsibility)}` for every demanding node
    that ends up under-served (level < N). Fully-served consumers are omitted
    (they impose no constraint). Responsibility uses the provisional v1
    uniform-blame rule (ADR-0003).
    """
    members = {nid for nid, node in nodes.items() if _in_category(node, category)}
    if not members:
        return {}

    # Default capacity for unspecified infrastructure throughput and edges: the
    # maximum supply of any source in this category. This makes those capacities
    # finite (not infinite), so when an edge/node degrades its scaled capacity
    # actually throttles flow and the shortage propagates downstream.
    default_cap = _max_source_supply(category, nodes)

    big = len(nodes) + len(edges) + 10  # priority reward dominates path friction
    graph = nx.DiGraph()

    for nid in members:
        node = nodes[nid]
        throughput = _throughput(node, category, node_func[nid], n, default_cap)
        graph.add_edge((nid, "in"), (nid, "out"), capacity=throughput, weight=1)

        supply = _effective_supply(node, category, node_func[nid], n)
        if supply is not None:
            graph.add_edge(_SRC, (nid, "in"), capacity=supply, weight=0)

        demand = _demand(node, category)
        if demand:
            reward = -_priority(node, category) * big
            graph.add_edge((nid, "in"), _SINK, capacity=_scaled(demand), weight=reward)

    for edge in edges:
        if edge.source in members and edge.target in members:
            cap = _edge_capacity(edge, edge_func[edge.id], n, default_cap)
            graph.add_edge((edge.source, "out"), (edge.target, "in"), capacity=cap, weight=1)

    if _SINK not in graph or _SRC not in graph:
        return {}  # no demand or no supply — nothing to allocate

    flow = _min_cost_max_flow(graph, _SRC, _SINK)

    candidates: dict[str, tuple[int, dict[str, float]]] = {}
    for nid in members:
        demand = _demand(nodes[nid], category)
        if not demand:
            continue
        delivered = flow.get((nid, "in"), {}).get(_SINK, 0) / SCALE
        served_ratio = delivered / demand if demand > 0 else 1.0
        level = _ratio_to_level(served_ratio, n)
        if level >= n:
            continue  # fully (or near-fully) served — no degradation proposed
        candidates[nid] = (level, _blame(nid, category, nodes, edges, node_func, edge_func, n))
    return candidates


def _min_cost_max_flow(graph: nx.DiGraph, src: str, sink: str) -> dict:
    """Solve the same problem `nx.max_flow_min_cost(graph, src, sink)` solves,
    without its expensive two-phase implementation.

    `nx.max_flow_min_cost` first runs a full max-flow computation
    (`preflow_push`) just to learn the max-flow *value*, then re-solves the
    whole problem as a min-cost flow constrained to exactly that value
    (`network_simplex`). Profiled on a 3,300-junction imported network:
    preflow_push alone was 83% of one Propagation's total wall-clock time,
    dwarfing the ~12% actually spent on the min-cost step that produces the
    answer this function needs.

    This graph doesn't need that two-phase approach. Every demand-sink edge
    already carries a reward (`reward = -priority * big` at the call site
    above) sized so `big` dominates any possible accumulated path friction
    (`weight=1` per edge, at most `len(nodes)+len(edges)` edges on any
    simple path — `big` is set to exceed that bound). So *any* min-cost
    solution that leaves deliverable flow unrouted is strictly improvable by
    routing it — cost minimization and flow maximization are not competing
    objectives here, they're the same objective, by construction. Turning
    the src→sink flow problem into a min-cost *circulation* (add a
    zero-cost, effectively-unbounded sink→src return edge, so flow can
    "complete the loop" instead of needing an explicit demand target) lets
    one `network_simplex` call find the jointly-optimal answer directly —
    same optimum, one phase instead of two.

    Verified byte-identical to `nx.max_flow_min_cost`'s per-consumer
    delivered amounts on every situation in `test/test_engine_samples.py`
    plus the real-network validation suite (Net1/Net3/Net6 and three
    imported aqueducts, `scripts/validate_faithfulness.py`) before this
    replaced the direct call — not an approximation, the same LP optimum
    reached without paying for a max-flow value this construction doesn't
    need. ~5x faster per solve, ~4x faster end-to-end on a 3,300-junction
    network (`scripts/benchmark_engine.py --networks Net6`)."""
    circulation = graph.copy()
    circulation.add_edge(sink, src, capacity=INF_CAP, weight=0)
    for node in circulation.nodes:
        circulation.nodes[node]["demand"] = 0
    return nx.min_cost_flow(circulation)


# --- network quantities -----------------------------------------------------

def _in_category(node: Node, category: str) -> bool:
    """A node belongs to a category's flow subgraph if it supplies, demands, or
    is tagged with it."""
    if node.supply_capacity and category in node.supply_capacity:
        return True
    if node.category_dependency_profiles and category in node.category_dependency_profiles:
        return True
    return bool(node.node_categories and category in node.node_categories)


def _scaled(value: float) -> int:
    return max(0, round(value * SCALE))


def _func_ratio(func: int, n: int) -> float:
    """Convert a Functionality level to the fraction of capacity it carries.

    The top level carries 100%, the bottom level 0%, and each intermediate level
    the midpoint of its associated interval: `(func − 0.5)/N`. So a critical
    element passes no flow (0%) and a fully-operational one passes everything,
    while degraded-but-not-critical levels sit symmetrically in between
    (e.g. N=4 → 0, 0.375, 0.625, 1.0).
    """
    if n <= 1 or func >= n:
        return 1.0
    if func <= 1:
        return 0.0
    return (func - 0.5) / n


def _max_source_supply(category: str, nodes: dict[str, Node]) -> float | None:
    """The largest supply any source declares for this category, or None if the
    category has no source. Used as the default capacity for unspecified
    infrastructure throughput and edges."""
    supplies = [
        node.supply_capacity[category]
        for node in nodes.values()
        if node.supply_capacity and category in node.supply_capacity
    ]
    return max(supplies) if supplies else None


def _effective_supply(node: Node, category: str, func: int, n: int) -> int | None:
    cap = (node.supply_capacity or {}).get(category)
    if cap is None:
        return None
    return _scaled(cap * _func_ratio(func, n))


def _throughput(
    node: Node, category: str, func: int, n: int, default_cap: float | None
) -> int:
    profile = (node.category_dependency_profiles or {}).get(category)
    cap = profile.capacity if profile is not None and profile.capacity is not None else default_cap
    if cap is None:
        return INF_CAP
    return _scaled(cap * _func_ratio(func, n))


def _demand(node: Node, category: str) -> float | None:
    profile = (node.category_dependency_profiles or {}).get(category)
    if profile is not None and profile.demand:
        return profile.demand
    return None


def _priority(node: Node, category: str) -> int:
    profile = (node.category_dependency_profiles or {}).get(category)
    if profile is not None and profile.priority:
        return profile.priority
    return 5


def _edge_capacity(edge: Edge, func: int, n: int, default_cap: float | None) -> int:
    cap = edge.capacity if edge.capacity is not None else default_cap
    if cap is None:
        return INF_CAP
    return _scaled(cap * _func_ratio(func, n))


def _ratio_to_level(served_ratio: float, n: int) -> int:
    """Map served ratio to an integer level. Default linear split (ADR-0003):
    `max(1, ceil(ratio · N))`. Configurable thresholds land in a later revision."""
    return max(1, min(n, math.ceil(served_ratio * n)))


# --- responsibility (provisional v1 uniform-blame, ADR-0003) ----------------

def _blame(
    consumer: str,
    category: str,
    nodes: dict[str, Node],
    edges: list[Edge],
    node_func: dict[str, int],
    edge_func: dict[str, int],
    n: int,
) -> dict[str, float]:
    """Uniform blame over the degraded, same-category elements in the consumer's
    transitive incoming closure. Empty when nothing upstream is degraded
    (pure competition / structural under-supply)."""
    closure = incoming_closure(consumer, edges)
    edges_by_id = {e.id: e for e in edges}

    degraded: list[str] = []
    for nid in closure.node_ids:
        node = nodes.get(nid)
        if node is not None and _in_category(node, category) and node_func[nid] < n:
            degraded.append(nid)
    for eid in closure.edge_ids:
        edge = edges_by_id.get(eid)
        if edge is None:
            continue
        endpoints_in = _in_category(nodes[edge.source], category) if edge.source in nodes else False
        if endpoints_in and edge_func[eid] < n:
            degraded.append(eid)

    if not degraded:
        return {}
    share = 1.0 / len(degraded)
    return {elem: share for elem in degraded}
