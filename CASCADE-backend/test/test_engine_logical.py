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


def test_requisite_parent_category_not_swallowed_by_shared_category():
    """A parent's Requisite category must reach the target even when the parent
    ALSO shares a category with the target (unlike a SourceToDemands category,
    which is legitimately excluded in that situation — see
    test_multi_category_parent_no_phantom_dependency).

    Topology (mirrors the .inp importer's inline pump, ADR-0012):
        pump  (water+pumping, level=1) ──> junction (water, level=4)

    pump has failed (level=1) on its Requisite "pumping" category. Even though
    pump and junction share the "water" category, junction must still see the
    "pumping" dependency and degrade to pump's level — a threshold dependency
    can never be silently dropped just because a shared category also exists.
    """
    nodes = [
        _node("pump", 1, categories=["water", "pumping"]),
        _node("junction", 4, categories=["water"]),
    ]
    edges = [_edge("e_pump_junction", "pump", "junction")]
    result = run(
        _request(nodes, edges, {"water": "SourceToDemands", "pumping": "Requisite"})
    )

    junction = _updates_by_id(result)["junction"]
    assert junction.functionality == 1
    assert junction.responsibility_share == {"pump": 1.0}


def test_nested_intercategorical_rule_uses_its_own_grouping_not_flat_worst_of():
    """A rule whose outer function nests another function (e.g.
    worst_of(best_of(A, B), C)) must evaluate that grouping, not the flat
    (operator, categories) dispatch every other intercategorical rule uses —
    the two disagree whenever the nested group's best_of hides a worse category.

    hosp depends on three categories at levels water=3, power=1, digital=2.
    Flat worst_of(water, power, digital) = 1. The rule instead computes
    worst_of(best_of(water, power), digital) = worst_of(max(3, 1), 2) = 2 —
    a distinct, verifiable result that can only come from evaluating the
    nested grouping (engine.logical.eval_nested_func_ast), not the fallback.
    """
    hosp = Node(
        id="hosp",
        functionality=4,
        rules=["worst_of(best_of(water, power), digital) propagates to hosp"],
    )
    nodes = [
        _node("w", 3, categories=["water"]),
        _node("p", 1, categories=["power"]),
        _node("d", 2, categories=["digital"]),
        hosp,
    ]
    edges = [_edge("ew", "w", "hosp"), _edge("ep", "p", "hosp"), _edge("ed", "d", "hosp")]
    result = run(_request(
        nodes, edges, {"water": "Requisite", "power": "Requisite", "digital": "Requisite"}
    ))

    assert result.warnings == []
    updated = _updates_by_id(result)["hosp"]
    assert updated.functionality == 2

