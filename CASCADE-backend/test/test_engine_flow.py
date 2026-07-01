"""Tests for engine/flow.py — priority min-cost max-flow per SourceToDemands category."""
from engine.flow import flow_category_candidates
from schemas.network import CategoryDependencyProfile, Edge, Node


def _source(nid, supply, func=3):
    return Node(id=nid, functionality=func, node_categories=["water"],
                supply_capacity={"water": supply})


def _consumer(nid, demand, func=3, priority=None, capacity=None):
    return Node(
        id=nid, functionality=func, node_categories=["water"],
        category_dependency_profiles={
            "water": CategoryDependencyProfile(
                dependency_level=3, demand=demand, priority=priority, capacity=capacity
            )
        },
    )


def _edge(eid, s, t, func=3, capacity=None):
    return Edge(id=eid, source=s, target=t, functionality=func, capacity=capacity)


def _solve(nodes, edges, n=3):
    node_func = {x.id: x.functionality for x in nodes}
    edge_func = {e.id: e.functionality for e in edges}
    return flow_category_candidates(
        "water", {x.id: x for x in nodes}, edges, node_func, edge_func, n
    )


def test_fully_served_consumer_not_degraded():
    nodes = [_source("s", 10), _consumer("c", 10)]
    edges = [_edge("e", "s", "c")]
    assert _solve(nodes, edges) == {}  # supply meets demand → no candidate


def test_undersupplied_consumer_degrades_by_ratio():
    # supply 5, demand 10, healthy source → served_ratio 0.5 → ceil(0.5*3)=2.
    nodes = [_source("s", 5), _consumer("c", 10)]
    edges = [_edge("e", "s", "c")]
    assert _solve(nodes, edges)["c"][0] == 2


def test_blame_includes_degraded_source():
    # source supply 7.5 at Functionality 2 (<N=3) → effective supply 5.0,
    # demand 10 → ratio 0.5 → level 2; the degraded source is blamed.
    nodes = [_source("s", 7.5, func=2), _consumer("c", 10)]
    edges = [_edge("e", "s", "c")]
    cands = _solve(nodes, edges)
    assert cands["c"][0] == 2
    assert cands["c"][1] == {"s": 1.0}


def test_zero_supply_consumer_critical():
    # supply 0 → served 0 → level max(1, ceil(0)) = 1.
    nodes = [_source("s", 0), _consumer("c", 10)]
    edges = [_edge("e", "s", "c")]
    assert _solve(nodes, edges)["c"][0] == 1


def test_priority_routes_scarce_supply_to_high_priority():
    # supply 10, two consumers demand 10 each; high priority should be served, low starved.
    nodes = [_source("s", 10), _consumer("hi", 10, priority=10), _consumer("lo", 10, priority=1)]
    edges = [_edge("eh", "s", "hi"), _edge("el", "s", "lo")]
    cands = _solve(nodes, edges)
    assert "hi" not in cands           # high priority fully served
    assert cands["lo"][0] == 1         # low priority starved


def test_edge_capacity_throttles_delivery():
    # supply 10, demand 10, but the edge caps flow at 5 → served 0.5 → level 2.
    nodes = [_source("s", 10), _consumer("c", 10)]
    edges = [_edge("e", "s", "c", capacity=5)]
    assert _solve(nodes, edges)["c"][0] == 2


def test_critical_edge_without_capacity_throttles_via_default():
    # Edge has no explicit capacity but is critical (func 1). It defaults to the
    # max source supply (10); a critical element carries 0% capacity (func_ratio),
    # so delivery is 0 -> level 1. Without the default it would stay infinite
    # and the consumer would not degrade.
    nodes = [_source("s", 10), _consumer("c", 10)]
    edges = [_edge("e", "s", "c", func=1)]  # critical edge, no capacity set
    assert _solve(nodes, edges)["c"][0] == 1


def test_healthy_edge_without_capacity_does_not_throttle():
    # Same graph, healthy edge (func 3): default capacity 10*3/3 = 10 >= demand,
    # so no artificial bottleneck.
    nodes = [_source("s", 10), _consumer("c", 10)]
    edges = [_edge("e", "s", "c", func=3)]
    assert _solve(nodes, edges) == {}


def test_no_demand_no_candidates():
    nodes = [_source("s", 10), _source("s2", 5)]
    edges = [_edge("e", "s", "s2")]
    assert _solve(nodes, edges) == {}


def test_blame_empty_when_supply_structural_not_degraded():
    # source at full functionality but supply simply too small → nobody upstream
    # is degraded, so blame is empty (structural under-supply).
    nodes = [_source("s", 5, func=3), _consumer("c", 10)]
    edges = [_edge("e", "s", "c")]
    cands = _solve(nodes, edges)
    assert cands["c"][0] == 2
    assert cands["c"][1] == {}  # source healthy (func==N) → not blamed


# --- integration: flow + logical composed through the engine -----------------

from engine.propagation import run  # noqa: E402
from schemas.config import (  # noqa: E402
    CategoryDefinition,
    ConfigMeta,
    FunctionalityScaleLevel,
    ModelConfiguration,
)
from schemas.network import Canvas, Graph, Project, ProjectMeta  # noqa: E402
from schemas.results import PropagationRequest  # noqa: E402


def _cfg(cats):
    return ModelConfiguration(
        version="1", meta=ConfigMeta(name="t"),
        functionality_scale=[FunctionalityScaleLevel(level=i, label=str(i), color="#000") for i in (1, 2, 3)],
        categories=[CategoryDefinition(name=k, category_type=v) for k, v in cats.items()],
    )


def _run(nodes, edges, cats):
    proj = Project(
        version="2.0", meta=ProjectMeta(name="p"),
        nodes={n.id: n for n in nodes}, edges={e.id: e for e in edges},
        canvases=[Canvas(id="c", graph=Graph(graph_type="g",
                  node_ids=[n.id for n in nodes], edge_ids=[e.id for e in edges]))],
    )
    return run(PropagationRequest(project=proj, config=_cfg(cats), scope="global"))


def test_engine_routes_source_to_demands_through_flow():
    # water is SourceToDemands -> flow. supply 5, demand 10 -> ratio .5 -> level 2.
    nodes = [_source("s", 5), _consumer("c", 10)]
    edges = [_edge("e", "s", "c")]
    res = _run(nodes, edges, {"water": "SourceToDemands"})
    by_id = {u.id: u for u in res.updates}
    assert by_id["c"].functionality == 2


def test_mixed_flow_and_logical_node_takes_worst():
    # 'c' is under-served on water (flow -> 2) AND fed by a critical Digital node
    # (logical -> 1). Intercategorical worst_of -> 1.
    s = _source("s", 5)
    c = _consumer("c", 10)
    c.node_categories = ["water", "Digital"]
    dig = Node(id="d", functionality=1, node_categories=["Digital"])
    nodes = [s, c, dig]
    edges = [_edge("e", "s", "c"), _edge("ed", "d", "c")]
    res = _run(nodes, edges, {"water": "SourceToDemands", "Digital": "Requisite"})
    by_id = {u.id: u for u in res.updates}
    assert by_id["c"].functionality == 1
    assert "d" in by_id["c"].responsibility_share  # Digital is the binding cause


# --- functionality -> capacity-ratio mapping --------------------------------

import pytest  # noqa: E402

from engine.flow import _func_ratio  # noqa: E402


@pytest.mark.parametrize(
    "func,n,expected",
    [
        (3, 3, 1.0), (1, 3, 0.0), (2, 3, 0.5),                 # N=3: 0, .5, 1
        (4, 4, 1.0), (1, 4, 0.0), (2, 4, 0.375), (3, 4, 0.625),  # N=4
        (5, 5, 1.0), (1, 5, 0.0), (3, 5, 0.5),                 # N=5 midpoint
        (1, 1, 1.0),                                            # degenerate N=1
    ],
)
def test_func_ratio_endpoints_pinned_middle_midpoints(func, n, expected):
    assert _func_ratio(func, n) == pytest.approx(expected)
