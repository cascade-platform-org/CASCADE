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

# Allocation strategies for scarce supply (selected per graph type via the
# "source-to-demands-flow" heuristic's `allocation` param; see
# engine/propagation.py's resolver):
#
#   tiered_fair_share (DEFAULT) — strict priority preemption BETWEEN tiers,
#     max-min fairness WITHIN a tier: higher-priority consumers take their
#     full feasible amount first; consumers of equal priority spread the
#     remaining scarcity as evenly as the network physically allows. Models
#     "hospitals first; everyone else shares the pain equally."
#   priority_greedy — the single min-cost max-flow LP with priority rewards.
#     Under a shared bottleneck it is winner-take-all: an LP optimum may
#     serve one of two equal-priority consumers 100% and the other 0%.
#     Models strict triage; also the cheapest (one solve per category).
ALLOCATIONS = ("tiered_fair_share", "priority_greedy")
DEFAULT_ALLOCATION = "tiered_fair_share"


def flow_category_candidates(
    category: str,
    nodes: dict[str, Node],
    edges: list[Edge],
    node_func: dict[str, int],
    edge_func: dict[str, int],
    n: int,
    allocation: str = DEFAULT_ALLOCATION,
) -> dict[str, tuple[int, dict[str, float]]]:
    """Flow proposal for one `SourceToDemands` category.

    Returns `{consumer_id -> (level, responsibility)}` for every demanding node
    that ends up under-served (level < N). Fully-served consumers are omitted
    (they impose no constraint). Responsibility uses the provisional v1
    uniform-blame rule (ADR-0003). `allocation` picks how scarcity is shared
    (see ALLOCATIONS above); both strategies solve over the same graph.
    """
    # sorted: node iteration order decides edge-insertion order into the
    # solver graph, and an unsorted set's order depends on the per-process
    # hash seed — under a degenerate optimum (scarcity ties) that can flip
    # which consumer a solver happens to favour between runs.
    members = sorted(nid for nid, node in nodes.items() if _in_category(node, category))
    if not members:
        return {}

    # Default capacity for unspecified infrastructure throughput and edges: the
    # maximum supply of any source in this category. This makes those capacities
    # finite (not infinite), so when an edge/node degrades its scaled capacity
    # actually throttles flow and the shortage propagates downstream.
    default_cap = _max_source_supply(category, nodes)

    graph = nx.DiGraph()
    consumers: dict[str, int] = {}  # nid -> scaled demand (sink-edge capacity)

    for nid in members:
        node = nodes[nid]
        throughput = _throughput(node, category, node_func[nid], n, default_cap)
        graph.add_edge((nid, "in"), (nid, "out"), capacity=throughput, weight=1)

        supply = _effective_supply(node, category, node_func[nid], n)
        if supply is not None:
            graph.add_edge(_SRC, (nid, "in"), capacity=supply, weight=0)

        demand = _demand(node, category)
        if demand:
            consumers[nid] = _scaled(demand)

    for edge in edges:
        if edge.source in members and edge.target in members:
            cap = _edge_capacity(edge, edge_func[edge.id], n, default_cap)
            graph.add_edge((edge.source, "out"), (edge.target, "in"), capacity=cap, weight=1)

    if not consumers or _SRC not in graph:
        return {}  # no demand or no supply — nothing to allocate

    if allocation == "priority_greedy":
        delivered = _allocate_priority_greedy(graph, consumers, nodes, edges, category)
    else:
        delivered = _allocate_tiered_fair_share(graph, consumers, nodes, category)

    candidates: dict[str, tuple[int, dict[str, float]]] = {}
    for nid in consumers:
        # Ratio against the TRUE float demand, not the scaled integer: a
        # demand small enough to round to a zero-capacity sink edge must read
        # as ratio 0 (permanently starved — the documented symptom the
        # importer's FLOW_UNIT_SCALE guards against), not divide-by-zero
        # "fully served". `demand` is truthy for every consumers[] entry.
        demand = _demand(nodes[nid], category)
        served_ratio = delivered.get(nid, 0) / SCALE / demand if demand else 1.0
        level = _ratio_to_level(served_ratio, n)
        if level >= n:
            continue  # fully (or near-fully) served — no degradation proposed
        candidates[nid] = (level, _blame(nid, category, nodes, edges, node_func, edge_func, n))
    return candidates


def _allocate_priority_greedy(
    graph: nx.DiGraph,
    consumers: dict[str, int],
    nodes: dict[str, Node],
    edges: list[Edge],
    category: str,
) -> dict[str, int]:
    """One min-cost max-flow with priority rewards on the demand-sink edges —
    the reward dominates path friction, so scarce supply routes to
    higher-priority consumers first (and winner-take-all among equals)."""
    big = len(nodes) + len(edges) + 10  # priority reward dominates path friction
    for nid, cap in consumers.items():
        reward = -_priority(nodes[nid], category) * big
        graph.add_edge((nid, "in"), _SINK, capacity=cap, weight=reward)
    flow = nx.max_flow_min_cost(graph, _SRC, _SINK)
    return {nid: flow.get((nid, "in"), {}).get(_SINK, 0) for nid in consumers}


def _allocate_tiered_fair_share(
    graph: nx.DiGraph,
    consumers: dict[str, int],
    nodes: dict[str, Node],
    category: str,
) -> dict[str, int]:
    """Priority tiers descending; true max-min-fair water-filling within a
    tier. One graph mutated in place throughout — a consumer's sink edge,
    once FROZEN at its final amount, never changes again (a hard cap: later
    tiers can reroute around it but never take it away).

    Fast path per tier: add the tier's sink edges at full demand; if one
    max-flow saturates EVERY sink edge in the graph, the whole tier is fully
    served — one solve per occupied tier on a healthy network.

    Scarce tier → water-filling: bisect the largest common allotment λ such
    that giving every active consumer min(λ, demand) is simultaneously
    feasible; consumers with demand ≤ λ are fully served, and of the rest,
    exactly those with no residual (augmenting) path from the super-source in
    the λ-solve are genuinely bottlenecked — frozen at λ — while reachable
    ones can still grow and go another round with the frozen ones fixed.
    The residual-reachability test is what makes per-consumer amounts
    well-defined despite max-flow's arbitrary flow decomposition under ties
    (asking "who is stuck" of the residual graph instead of reading amounts
    off one arbitrary decomposition).
    """
    delivered: dict[str, int] = {}
    tiers: dict[int, list[str]] = {}
    for nid in consumers:
        tiers.setdefault(_priority(nodes[nid], category), []).append(nid)

    frozen_total = 0  # sum of already-frozen sink capacities

    def _set_active_caps(active: list[str], lam: int) -> int:
        """Point every active consumer's sink edge at min(λ, demand);
        returns the total of those caps."""
        total = 0
        for nid in active:
            cap = min(lam, consumers[nid])
            graph.add_edge((nid, "in"), _SINK, capacity=cap)
            total += cap
        return total

    for priority in sorted(tiers, reverse=True):
        tier = sorted(tiers[priority])  # deterministic order
        tier_total = _set_active_caps(tier, max(consumers[nid] for nid in tier))
        value, _ = nx.maximum_flow(graph, _SRC, _SINK)
        if value >= frozen_total + tier_total:
            for nid in tier:
                delivered[nid] = consumers[nid]  # edge already at demand = frozen
            frozen_total += tier_total
            continue

        active = list(tier)
        for nid in active:
            graph.remove_edge((nid, "in"), _SINK)
        lam = 0
        while active:
            # Max-min λ is non-decreasing across rounds: the previous round's
            # solve already delivered min(λ, demand) to every consumer still
            # active (with the newly-frozen fixed), so seed the bisection with
            # that proven-feasible floor instead of re-proving from 0.
            lo, hi = lam, max(consumers[nid] for nid in active)
            flow_at_lo: dict = {}  # a solved flow_dict is never empty
            while lo < hi:  # largest feasible common allotment
                mid = (lo + hi + 1) // 2
                target = frozen_total + _set_active_caps(active, mid)
                value, flow_dict = nx.maximum_flow(graph, _SRC, _SINK)
                if value >= target:
                    lo, flow_at_lo = mid, flow_dict
                else:
                    hi = mid - 1
            lam = lo
            _set_active_caps(active, lam)  # restore caps to the λ solution
            if not flow_at_lo:  # the seeded floor was never re-solved above
                _, flow_at_lo = nx.maximum_flow(graph, _SRC, _SINK)

            reachable = _residual_reachable(graph, flow_at_lo)
            still_active: list[str] = []
            for nid in active:
                if consumers[nid] <= lam:
                    delivered[nid] = consumers[nid]  # fully served
                    frozen_total += consumers[nid]
                elif (nid, "in") in reachable:
                    still_active.append(nid)  # can grow next round
                    graph.remove_edge((nid, "in"), _SINK)
                else:
                    delivered[nid] = lam  # bottlenecked: freeze at fair share
                    graph[(nid, "in")][_SINK]["capacity"] = lam
                    frozen_total += lam
            if len(still_active) == len(active):
                # cannot happen at a maximal λ (someone must be stuck), but a
                # guard beats an infinite loop on a solver anomaly
                for nid in still_active:
                    delivered[nid] = lam
                    graph.add_edge((nid, "in"), _SINK, capacity=lam)
                    frozen_total += lam
                break
            active = still_active

    return delivered


def _residual_reachable(graph: nx.DiGraph, flow_dict: dict) -> set:
    """Vertices reachable from the super-source in the residual graph of
    `flow_dict`: forward along edges with spare capacity, backward along
    edges carrying flow. A consumer's `in` vertex being unreachable means no
    augmenting path exists — it physically cannot receive more than the
    current solution gives it."""
    seen = {_SRC}
    queue = [_SRC]
    while queue:
        u = queue.pop()
        for v, attrs in graph[u].items():
            if v not in seen and flow_dict.get(u, {}).get(v, 0) < attrs["capacity"]:
                seen.add(v)
                queue.append(v)
        for v in graph.predecessors(u):
            if v not in seen and flow_dict.get(v, {}).get(u, 0) > 0:
                seen.add(v)
                queue.append(v)
    return seen


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
