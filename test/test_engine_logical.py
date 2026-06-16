"""Tests for the Slice 1 engine: logical heuristic + monotone round loop.

Exercises the public `engine.propagation.run` against small hand-built graphs:
single-supplier degradation, redundancy (best-of), intercategorical conjunction,
edge worst-of, and convergence.
"""
from engine.propagation import run
from schemas.config import (
    CategoryDefinition,
    ConfigMeta,
    FunctionalityScaleLevel,
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


def _node(nid, functionality, *, categories=None):
    # Dependency is graph-driven (ADR-0003): a node depends on whatever categories
    # its parents participate in. `categories` declares what this node
    # supplies/carries, so its children depend on it.
    return Node(
        id=nid,
        functionality=functionality,
        node_categories=categories,
    )


def _edge(eid, source, target, functionality=4):
    return Edge(id=eid, source=source, target=target, functionality=functionality)


def _config(categories):
    return ModelConfiguration(
        version="1.0",
        meta=ConfigMeta(name="test"),
        functionality_scale=[
            FunctionalityScaleLevel(level=1, label="critical", color="#000"),
            FunctionalityScaleLevel(level=2, label="time warning", color="#111"),
            FunctionalityScaleLevel(level=3, label="operational warning", color="#222"),
            FunctionalityScaleLevel(level=4, label="operational", color="#333"),
        ],
        categories=[
            CategoryDefinition(name=name, category_type=ctype)
            for name, ctype in categories.items()
        ],
    )


def _request(nodes, edges, categories):
    project = Project(
        version="2.0",
        meta=ProjectMeta(name="p"),
        nodes={n.id: n for n in nodes},
        edges={e.id: e for e in edges},
        canvases=[
            Canvas(
                id="c1",
                graph=Graph(
                    graph_type="generic",
                    node_ids=[n.id for n in nodes],
                    edge_ids=[e.id for e in edges],
                ),
            )
        ],
    )
    return PropagationRequest(
        project=project, config=_config(categories), scope="global"
    )


def _updates_by_id(result):
    return {u.id: u for u in result.updates}


def test_single_supplier_degrades_consumer():
    nodes = [
        _node("src", 2, categories=["water"]),
        _node("hosp", 4),
    ]
    edges = [_edge("e", "src", "hosp")]
    result = run(_request(nodes, edges, {"water": "Requisite"}))

    by_id = _updates_by_id(result)
    assert by_id["hosp"].functionality == 2          # worst_of(src=2, edge)
    assert by_id["hosp"].responsibility_share == {"src": 1.0}
    # edge degrades to its source level (ADR-0004), blamed on the source.
    assert by_id["e"].functionality == 2
    assert by_id["e"].responsibility_share == {"src": 1.0}


def test_redundancy_keeps_consumer_healthy():
    # Two water suppliers; one healthy (A=4) -> best_of keeps hospital at 4.
    nodes = [
        _node("A", 4, categories=["water"]),
        _node("B", 1, categories=["water"]),
        _node("hosp", 4),
    ]
    edges = [_edge("ea", "A", "hosp"), _edge("eb", "B", "hosp")]
    result = run(_request(nodes, edges, {"water": "Requisite"}))

    assert "hosp" not in _updates_by_id(result)  # redundancy protects it


def test_intercategorical_worst_of_blames_binding_category():
    # Hospital needs water (supplier=3) AND power (supplier=1) -> worst_of -> 1.
    nodes = [
        _node("w", 3, categories=["water"]),
        _node("p", 1, categories=["power"]),
        _node("hosp", 4),
    ]
    edges = [_edge("ew", "w", "hosp"), _edge("ep", "p", "hosp")]
    result = run(_request(nodes, edges, {"water": "Requisite", "power": "Requisite"}))

    hosp = _updates_by_id(result)["hosp"]
    assert hosp.functionality == 1
    assert hosp.responsibility_share == {"p": 1.0}  # power is the binding category


def test_healthy_supplier_causes_no_degradation():
    # b depends on water (its parent a participates), but a is healthy (4),
    # so b (3) gets a proposal of 4 — no worsening, no change.
    nodes = [_node("a", 4, categories=["water"]), _node("b", 3, categories=["water"])]
    edges = [_edge("e", "a", "b")]
    result = run(_request(nodes, edges, {"water": "Requisite"}))
    assert result.updates == []
    assert result.warnings == []


def test_consumer_tagged_untagged_feeder_degrades():
    # The category lives on the CONSUMER; the upstream feeder is untagged.
    # The untagged feeder supplies whatever the consumer needs, so v degrades.
    nodes = [_node("u", 1), _node("v", 4, categories=["digital"])]
    edges = [_edge("e", "u", "v")]
    result = run(_request(nodes, edges, {"digital": "Requisite"}))
    v = _updates_by_id(result)["v"]
    assert v.functionality == 1
    assert v.responsibility_share == {"u": 1.0}


def test_cross_category_parent_creates_intercategorical_dependency():
    # v is tagged 'digital' but is fed by a failed 'water' node. The water input
    # is a real intercategorical dependency, so v degrades to the water level.
    nodes = [_node("w", 1, categories=["water"]), _node("v", 3, categories=["digital"])]
    edges = [_edge("e", "w", "v")]
    result = run(_request(nodes, edges, {"digital": "Requisite", "water": "Requisite"}))
    v = _updates_by_id(result)["v"]
    assert v.functionality == 1
    assert v.responsibility_share == {"w": 1.0}


def test_node_with_no_parents_is_untouched():
    # An isolated node has no suppliers, so the logical heuristic makes no
    # proposal and it keeps its level regardless of how low it is.
    nodes = [_node("lonely", 2, categories=["water"])]
    result = run(_request(nodes, [], {"water": "Requisite"}))
    assert result.updates == []


def test_two_hop_cascade_converges():
    # src(1) -> mid(water) -> sink(water); degradation propagates two hops.
    nodes = [
        _node("src", 1, categories=["water"]),
        _node("mid", 4, categories=["water"]),
        _node("sink", 4),
    ]
    edges = [_edge("e1", "src", "mid"), _edge("e2", "mid", "sink")]
    result = run(_request(nodes, edges, {"water": "Requisite"}))

    by_id = _updates_by_id(result)
    assert by_id["mid"].functionality == 1
    assert by_id["sink"].functionality == 1
    assert by_id["sink"].responsibility_share == {"mid": 1.0}
    assert result.warnings == []  # converged within the round cap


def test_tie_unions_responsibility():
    # Two categories both bind at level 2 -> blame unions and splits.
    nodes = [
        _node("w", 2, categories=["water"]),
        _node("p", 2, categories=["power"]),
        _node("hosp", 4),
    ]
    edges = [_edge("ew", "w", "hosp"), _edge("ep", "p", "hosp")]
    result = run(_request(nodes, edges, {"water": "Requisite", "power": "Requisite"}))

    hosp = _updates_by_id(result)["hosp"]
    assert hosp.functionality == 2
    assert hosp.responsibility_share == {"w": 0.5, "p": 0.5}


def test_multi_category_parent_no_phantom_dependency():
    """A parent that carries both 'power' and 'digital' should not inject a
    spurious power dependency into a child that only declared 'digital' and has a
    redundant healthy digital supplier.

    Topology:
        dc_a  (power+digital, level=2) ──┐
                                          ├──> ops (digital, level=4)
        dc_b  (digital,       level=4) ──┘

    dc_a's power failure has already lowered its own level to 2. ops sees dc_a
    delivering digital at 2 and dc_b delivering digital at 4. The intracategorical
    best_of for digital = 4, so ops should NOT degrade.

    Before the category-intersection guard, the engine would also attribute a
    'power' category dependency to ops (inherited from dc_a's power tag), producing
    worst_of(power=2, digital=4)=2 and a spurious degradation.
    """
    nodes = [
        _node("dc_a", 2, categories=["power", "digital"]),
        _node("dc_b", 4, categories=["digital"]),
        _node("ops",  4, categories=["digital"]),
    ]
    edges = [_edge("e_da_ops", "dc_a", "ops"), _edge("e_db_ops", "dc_b", "ops")]
    result = run(_request(nodes, edges, {"power": "SourceToDemands", "digital": "Requisite"}))

    assert "ops" not in _updates_by_id(result), (
        "ops should be protected by its redundant healthy digital supplier dc_b; "
        "dc_a's power category must not create a phantom power dependency in ops"
    )


def test_universal_requisite_degrades_consumer_via_bad_link(
):
    """ADR-0005: the Universal Requisite pass covers SourceToDemands categories.

    Even when a SourceToDemands flow would fully serve a consumer (supply >> demand),
    a degraded link on the supply path makes the Requisite logical proposal worse
    than the flow result. The worst_of merge in propagation.py binds the logical
    result, degrading the consumer.

    Topology:
        water_src (water, level=4, supply=100) --[link func=2]--> consumer (demand=10)

    Flow alone: supply 100 >> demand 10 → consumer fully served → no degradation.
    Logical (Universal Requisite, no skip): min(source=4, link=2)=2 → water=2.
    Merge: worst_of(flow=4, logical=2) = 2 → consumer degrades to 2.
    """
    nodes = [
        Node(
            id="water_src", functionality=4,
            node_categories=["water"],
            supply_capacity={"water": 100},
        ),
        Node(
            id="consumer", functionality=4,
            node_categories=["water"],
            category_dependency_profiles={
                "water": CategoryDependencyProfile(demand=10, dependency_level=4),
            },
        ),
    ]
    edges = [_edge("e", "water_src", "consumer", functionality=2)]
    result = run(_request(nodes, edges, {"water": "SourceToDemands"}))

    by_id = _updates_by_id(result)
    assert "consumer" in by_id, (
        "consumer must degrade: Universal Requisite sees link=2 and proposes water=2; "
        "the flow alone would pass (supply >> demand) but the logical worst_of wins"
    )
    assert by_id["consumer"].functionality == 2
