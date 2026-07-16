"""Scarcity-allocation strategies of the SourceToDemands flow pass
(engine/flow.py: tiered_fair_share default vs priority_greedy, selected per
graph type via the "source-to-demands-flow" heuristic's `allocation` param —
engine/propagation.py::_resolve_flow_allocation).

Topology used throughout: one source (supply 60) feeding two consumers that
each demand 60 — total demand 120 vs supply 60, a pure shared bottleneck with
no path asymmetry, so the only question is HOW the shortage is split:

    src ──▶ a (demand 60)
    src ──▶ b (demand 60)

  equal priority + tiered_fair_share   → both at 30/60 = 0.5 → level 2 each
  equal priority + priority_greedy     → LP optimum is winner-take-all:
                                         one at 60 (level 3), other at 0 (level 1)
  a priority 10, b priority 1 (both)   → strict preemption: a full, b starved
"""
from __future__ import annotations


import schemas.results  # noqa: F401 -- rebuilds Project's forward refs
from engine.propagation import run
from schemas.config import (
    CategoryDefinition,
    ConfigMeta,
    GraphTypeConfig,
    HeuristicConfig,
    ModelConfiguration,
)
from schemas.network import (
    Canvas,
    CategoryDependencyProfile,
    Edge,
    Graph,
    Node,
    Project,
    ProjectMeta,
)
from schemas.results import PropagationRequest

N = 3


def _bottleneck_project(priority_a: int | None, priority_b: int | None, graph_type: str = "water_network") -> Project:
    def consumer(nid: str, priority: int | None) -> Node:
        return Node(
            id=nid, label=nid, functionality=N, node_type="Service",
            node_categories=["water"],
            category_dependency_profiles={
                "water": CategoryDependencyProfile(
                    dependency_level=N, demand=60.0, priority=priority,
                )
            },
        )

    nodes = {
        "src": Node(
            id="src", label="src", functionality=N, node_type="Source",
            node_categories=["water"], supply_capacity={"water": 60.0},
        ),
        "a": consumer("a", priority_a),
        "b": consumer("b", priority_b),
    }
    edges = {
        "e_a": Edge(id="e_a", source="src", target="a", functionality=N, capacity=60.0),
        "e_b": Edge(id="e_b", source="src", target="b", functionality=N, capacity=60.0),
    }
    return Project(
        version="2.0", meta=ProjectMeta(name="bottleneck"),
        nodes=nodes, edges=edges,
        canvases=[Canvas(
            id="c1", label="c1", color="#000000",
            graph=Graph(graph_type=graph_type, node_ids=sorted(nodes), edge_ids=sorted(edges)),
        )],
    )


def _config(allocation: str | None) -> ModelConfiguration:
    heuristics = []
    if allocation is not None:
        heuristics.append(HeuristicConfig(id="source-to-demands-flow", params={"allocation": allocation}))
    return ModelConfiguration(
        version="1.0", meta=ConfigMeta(name="test"),
        functionality_scale=[
            {"level": 1, "label": "critical", "color": "#ef4444"},
            {"level": 2, "label": "warning", "color": "#f97316"},
            {"level": 3, "label": "operational", "color": "#22c55e"},
        ],
        categories=[CategoryDefinition(name="water", category_type="SourceToDemands")],
        graph_types=[GraphTypeConfig(name="water_network", heuristics=heuristics)],
    )


def _levels(project: Project, config: ModelConfiguration) -> dict[str, int]:
    result = run(PropagationRequest(project=project, config=config, scope="global"))
    levels = {nid: node.functionality for nid, node in project.nodes.items()}
    levels.update({u.id: u.functionality for u in result.updates if u.id in levels})
    return levels


def test_default_is_tiered_fair_share_equal_split():
    """No allocation param anywhere (the common case, e.g. every imported
    bundle) → tiered fair share: two equal-priority consumers on a shared
    bottleneck each get half, never one-everything-one-nothing."""
    levels = _levels(_bottleneck_project(5, 5), _config(None))
    assert levels["a"] == 2 and levels["b"] == 2  # 30/60 = 0.5 → level 2 each


def test_priority_greedy_is_winner_take_all():
    """Same bottleneck, but b's path is one hop longer, so the LP's friction
    tie-break makes the winner deterministic: everything routes to a (the
    cheaper path), b gets exactly nothing. (A perfectly symmetric graph is a
    degenerate LP tie — the optimum may legally be ANY split — so asymmetry
    is what makes winner-take-all assertable.) Fair share ignores path cost:
    same topology under the default still splits 30/30 — see
    test_default_is_tiered_fair_share_equal_split's sibling assert below."""
    project = _bottleneck_project(5, 5)
    project.nodes["m"] = Node(
        id="m", label="m", functionality=N, node_type="Infrastructure",
        node_categories=["water"],
    )
    del project.edges["e_b"]
    project.edges["e_m"] = Edge(id="e_m", source="src", target="m", functionality=N, capacity=60.0)
    project.edges["e_mb"] = Edge(id="e_mb", source="m", target="b", functionality=N, capacity=60.0)
    project.canvases[0].graph.node_ids.append("m")
    project.canvases[0].graph.edge_ids = sorted(project.edges)

    levels = _levels(project, _config("priority_greedy"))
    assert levels["a"] == 3 and levels["b"] == 1  # shorter path takes all

    fair = _levels(project, _config(None))
    assert fair["a"] == 2 and fair["b"] == 2  # fairness ignores path length


def test_tiers_preempt_strictly():
    """Between DIFFERENT priorities both strategies agree: the higher tier
    takes its full feasible amount first."""
    for allocation in (None, "priority_greedy"):
        levels = _levels(_bottleneck_project(10, 1), _config(allocation))
        assert levels["a"] == 3, allocation  # priority 10: fully served
        assert levels["b"] == 1, allocation  # priority 1: nothing left


def test_unknown_allocation_falls_back_to_default():
    levels = _levels(_bottleneck_project(5, 5), _config("does_not_exist"))
    assert levels["a"] == 2 and levels["b"] == 2


def test_fair_share_respects_local_bottleneck():
    """Fairness never gives a consumer more than its OWN path can carry:
    plenty of supply, but b's edge is halved → b limited to 30 (level 2),
    a stays full — not dragged down in the name of equality."""
    project = _bottleneck_project(5, 5)
    project.nodes["src"].supply_capacity = {"water": 120.0}
    project.edges["e_b"].capacity = 30.0
    levels = _levels(project, _config(None))
    assert levels["a"] == 3
    assert levels["b"] == 2


def test_within_tier_waterfill_is_max_min_fair():
    """Three equal-priority consumers (demands 10, 40, 60) against supply 60:
    max-min water-filling raises a common allotment λ until the pool is
    exhausted — λ = 25, so the small consumer (10 ≤ λ) is fully served and
    the two larger ones get exactly 25 each. No consumer's identity or
    insertion order matters, only demand and physics."""
    project = _bottleneck_project(5, 5)
    project.nodes["c"] = Node(
        id="c", label="c", functionality=N, node_type="Service",
        node_categories=["water"],
        category_dependency_profiles={
            "water": CategoryDependencyProfile(dependency_level=N, demand=10.0, priority=5)
        },
    )
    project.edges["e_c"] = Edge(id="e_c", source="src", target="c", functionality=N, capacity=60.0)
    project.nodes["a"].category_dependency_profiles["water"].demand = 40.0
    project.canvases[0].graph.node_ids.append("c")
    project.canvases[0].graph.edge_ids.append("e_c")
    levels = _levels(project, _config(None))
    assert levels["c"] == N          # 10 ≤ λ=25: fully served
    assert levels["a"] == 2          # 25/40 = 0.625 → level 2
    assert levels["b"] == 2          # 25/60 ≈ 0.417 → level 2


def test_epanet_graph_type_untouched_by_allocation_param():
    """The reserved 'epanet' graph type never reaches the engine at all
    (services dispatch, ADR-0013) — just assert the resolver ignores configs
    for graph types the project doesn't use."""
    config = _config("priority_greedy")
    config.graph_types[0].name = "some_other_type"  # no canvas uses it
    levels = _levels(_bottleneck_project(5, 5), config)
    assert levels["a"] == 2 and levels["b"] == 2  # default fair share
