"""ADR-0020 §1c and §3: storage, served_ratio, and the engine's refusal of a Stock.

The network is a pumped town with tanks on a junction:

    pump P ─▶ J ─▶ town C        tank T (and U) ◀─▶ J

Edges carry no capacity, so they default to the category's largest supply and
never bind; what binds is supply, demand, draw and fill.
"""
import pytest
from pydantic import ValidationError

from engine.flow import solve_category
from engine.propagation import run
from schemas.config import CategoryDefinition, ConfigMeta, FunctionalityScaleLevel, ModelConfiguration
from schemas.network import Canvas, CategoryDependencyProfile, Edge, Graph, Node, Project, ProjectMeta, Stock
from schemas.results import PropagationRequest

N = 3


def _node(nid, supply=None, demand=None, func=N):
    return Node(
        id=nid, functionality=func, node_categories=["water"],
        supply_capacity={"water": supply} if supply is not None else None,
        category_dependency_profiles=(
            {"water": CategoryDependencyProfile(dependency_level=N, demand=demand)} if demand else None
        ),
    )


def _edge(eid, s, t):
    return Edge(id=eid, source=s, target=t, functionality=N)


def _run(pump, town, tanks, pump_func=N, tank_func=N):
    """`tanks`: {id: (draw, fill)}. Returns the PropagationResult."""
    nodes = [_node("P", supply=pump, func=pump_func), _node("J"), _node("C", demand=town)]
    edges = [_edge("pj", "P", "J"), _edge("jc", "J", "C")]
    for tid, (draw, _fill) in tanks.items():
        nodes.append(_node(tid, supply=draw, func=tank_func))
        edges += [_edge(f"{tid}j", tid, "J"), _edge(f"j{tid}", "J", tid)]
    project = Project(
        version="2.0", meta=ProjectMeta(name="p"),
        nodes={x.id: x for x in nodes}, edges={e.id: e for e in edges},
        canvases=[Canvas(id="c", graph=Graph(graph_type="g", node_ids=[x.id for x in nodes], edge_ids=[e.id for e in edges]))],
    )
    config = ModelConfiguration(
        version="1", meta=ConfigMeta(name="t"),
        functionality_scale=[FunctionalityScaleLevel(level=i, label=str(i), color="#000") for i in range(1, N + 1)],
        categories=[CategoryDefinition(name="water", category_type="SourceToDemands")],
    )
    storage = {tid: {"water": fill} for tid, (_draw, fill) in tanks.items()}
    return run(PropagationRequest(project=project, config=config, scope="global", storage=storage or None))


def _stored(result, tid):
    amount = result.stored[tid]["water"]
    return round(amount.filled, 2), round(amount.drawn, 2)


def test_stored_water_is_used_last():
    result = _run(pump=100, town=150, tanks={"T": (300, 200)})
    assert result.served_ratio["C"]["water"] == 1.0
    assert _stored(result, "T") == (0.0, 50.0)  # the pump gives all it has first


def test_storage_fills_last_from_what_consumers_leave():
    result = _run(pump=300, town=150, tanks={"T": (300, 200)})
    assert result.served_ratio["C"]["water"] == 1.0
    assert _stored(result, "T") == (150.0, 0.0)


def test_a_full_tank_takes_nothing():
    assert _stored(_run(pump=300, town=150, tanks={"T": (300, 0)}), "T") == (0.0, 0.0)


def test_a_pump_outage_drains_the_tank_at_the_demand_pace():
    result = _run(pump=300, town=150, tanks={"T": (300, 200)}, pump_func=1)
    assert result.served_ratio["C"]["water"] == 1.0
    assert _stored(result, "T") == (0.0, 150.0)


def test_tanks_on_one_zone_draw_and_fill_by_the_same_fraction():
    drawing = _run(pump=0, town=150, tanks={"T": (300, 0), "U": (150, 0)})
    assert (_stored(drawing, "T")[1], _stored(drawing, "U")[1]) == (100.0, 50.0)
    filling = _run(pump=300, town=100, tanks={"T": (0, 200), "U": (0, 100)})
    assert (_stored(filling, "T")[0], _stored(filling, "U")[0]) == (133.33, 66.67)


def test_storage_is_deterministic():
    tanks = {"T": (300, 120), "U": (150, 80)}
    first = _run(pump=120, town=200, tanks=tanks)
    second = _run(pump=120, town=200, tanks=tanks)
    assert first.stored == second.stored
    assert first.served_ratio == second.served_ratio


def test_damage_to_the_tank_scales_its_draw():
    # Functionality 2 of 3 carries (2 − 0.5)/3 = 50%: the tank offers 150 of 300.
    result = _run(pump=0, town=200, tanks={"T": (300, 0)}, tank_func=2)
    assert _stored(result, "T")[1] == 150.0
    assert result.served_ratio["C"]["water"] == 0.75


def test_served_ratio_reports_fully_served_consumers_too():
    result = _run(pump=300, town=150, tanks={})
    assert result.served_ratio == {"C": {"water": 1.0}}
    assert result.stored == {}


def test_a_request_carrying_a_stock_is_refused():
    with pytest.raises(ValidationError, match="is a Stock; send its supply number"):
        _run(pump=Stock(rate=10, level=5), town=5, tanks={})


def test_the_engine_fails_loudly_on_a_stray_stock():
    nodes = {"P": _node("P", supply=Stock(rate=10, level=5)), "C": _node("C", demand=5)}
    edges = [_edge("pc", "P", "C")]
    with pytest.raises(TypeError, match="the engine reads only numbers"):
        solve_category("water", nodes, edges, {"P": N, "C": N}, {"pc": N}, N)
