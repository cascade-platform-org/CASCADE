"""Served-ratio → Functionality level table (ADR-0003), configured project-wide
as `ModelConfiguration.flow_ratio_thresholds` — beside the Functionality scale
it is expressed in terms of (engine/propagation.py::_resolve_ratio_thresholds,
engine/flow.py).

Topology throughout: one source (supply 60) feeding two equal-priority
consumers that each demand 60. Total demand 120 against supply 60, a pure
shared bottleneck, so tiered fair share gives each exactly 30/60 = 0.5. The
served ratio is therefore **pinned at 0.5** and the only variable is which
level that ratio maps to — which is precisely what the table decides.

    src ──▶ a (demand 60)      ratio 0.5
    src ──▶ b (demand 60)      ratio 0.5

On the default N=3 linear split, 0.5 → ceil(1.5) = 2.
"""
from __future__ import annotations

import pytest

import schemas.results  # noqa: F401 -- rebuilds Project's forward refs
from engine.flow import parse_ratio_thresholds
from engine.propagation import run
from schemas.config import (
    CategoryDefinition,
    ConfigMeta,
    GraphTypeConfig,
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


def _project() -> Project:
    def consumer(nid: str) -> Node:
        return Node(
            id=nid, label=nid, functionality=N, node_type="Service",
            node_categories=["water"],
            category_dependency_profiles={
                "water": CategoryDependencyProfile(
                    dependency_level=N, demand=60.0, priority=5,
                )
            },
        )

    nodes = {
        "src": Node(
            id="src", label="src", functionality=N, node_type="Source",
            node_categories=["water"], supply_capacity={"water": 60.0},
        ),
        "a": consumer("a"),
        "b": consumer("b"),
    }
    edges = {
        "e_a": Edge(id="e_a", source="src", target="a", functionality=N, capacity=60.0),
        "e_b": Edge(id="e_b", source="src", target="b", functionality=N, capacity=60.0),
    }
    return Project(
        version="2.0", meta=ProjectMeta(name="thresholds"),
        nodes=nodes, edges=edges,
        canvases=[Canvas(
            id="c1", label="c1", color="#000000",
            graph=Graph(graph_type="water_network", node_ids=sorted(nodes), edge_ids=sorted(edges)),
        )],
    )


def _config(thresholds: object | None, *, levels: int = N) -> ModelConfiguration:
    scale = [
        {"level": i, "label": f"L{i}", "color": "#000000"} for i in range(1, levels + 1)
    ]
    return ModelConfiguration(
        version="1.0", meta=ConfigMeta(name="test"),
        functionality_scale=scale,
        flow_ratio_thresholds=thresholds,
        categories=[CategoryDefinition(name="water", category_type="SourceToDemands")],
        graph_types=[GraphTypeConfig(name="water_network", heuristics=[])],
    )


def _run(thresholds: object | None, *, levels: int = N):
    project = _project()
    result = run(PropagationRequest(
        project=project, config=_config(thresholds, levels=levels), scope="global",
    ))
    levels_by_id = {nid: node.functionality for nid, node in project.nodes.items()}
    levels_by_id.update({u.id: u.functionality for u in result.updates if u.id in levels_by_id})
    return levels_by_id, result.warnings


# --- the default, and the table that reproduces it -------------------------

def test_unset_is_the_linear_split():
    """No table → ceil(0.5 · 3) = 2. This is the behaviour every existing
    project has, and the reason the table is optional."""
    levels, warnings = _run(None)
    assert levels["a"] == 2 and levels["b"] == 2
    assert warnings == []


def test_linear_table_is_indistinguishable_from_unset():
    """`[k/N for k in 1..N-1]` IS the linear split — the default is a point in
    the configurable space, not a separate code path. If this ever diverges
    from the test above, the two mappings have drifted apart."""
    assert _run([1 / 3, 2 / 3])[0] == _run(None)[0]


# --- the table actually steering the level ---------------------------------

def test_strict_table_reads_half_delivery_as_critical():
    """Bounds at 0.5 and 0.9: a ratio of exactly 0.5 has passed NO bound
    (the bound is an inclusive upper edge), so it lands on level 1 instead of
    the default's 2. A demanding operator who calls half-service a failure."""
    levels, warnings = _run([0.5, 0.9])
    assert levels["a"] == 1 and levels["b"] == 1
    assert warnings == []


def test_lenient_table_reads_half_delivery_as_operational():
    """Bounds at 0.1 and 0.4: 0.5 has passed both, so it reads as fully
    operational and the consumers are not degraded at all — the flow pass
    emits no candidate, so they keep their authored Functionality."""
    levels, warnings = _run([0.1, 0.4])
    assert levels["a"] == N and levels["b"] == N
    assert warnings == []


def test_bound_is_an_inclusive_upper_edge():
    """A ratio exactly equal to a bound stays at that bound's level; only
    exceeding it promotes. Pinning this because an off-by-one here is silent:
    it shifts every reported level by one without failing anything else."""
    assert _run([0.5, 0.75])[0]["a"] == 1     # 0.5 passes nothing
    assert _run([0.49, 0.75])[0]["a"] == 2    # 0.5 passes the first bound only
    assert _run([0.2, 0.3])[0]["a"] == N      # 0.5 passes both


def test_repeated_bound_makes_a_level_unreachable():
    """Equal consecutive bounds collapse the level between them. Allowed on
    purpose: it is how a modeller says 'never report level 2'."""
    levels, _ = _run([0.4, 0.4])
    assert levels["a"] == N     # 0.5 passes both bounds at once, skipping 2


# --- malformed tables are reported, not silently dropped -------------------

@pytest.mark.parametrize("bad", [
    [0.5],                 # too short for a 3-level scale
    [0.2, 0.4, 0.6],       # too long
    [0.8, 0.2],            # descending
    [0.5, 1.5],            # out of range
    [],                    # empty
])
def test_malformed_table_falls_back_and_warns(bad):
    """A wrong table must not look like it was applied: behaviour reverts to
    the linear split AND the run carries a warning. These are hand-entered
    numbers whose required length depends on the Functionality scale, so a
    silent fallback would be indistinguishable from the table being honoured."""
    levels, warnings = _run(bad)
    assert levels["a"] == 2 and levels["b"] == 2          # linear split
    assert any("flow_ratio_thresholds" in w for w in warnings), warnings


def test_table_length_follows_the_configured_scale():
    """The required length is N−1, so the same table is valid or invalid
    depending on the project's Functionality scale — which is why the schema
    layer cannot check it and the engine must."""
    assert _run([0.3, 0.6], levels=3)[1] == []            # 2 entries, 3 levels: ok
    assert _run([0.3, 0.6], levels=4)[1] != []            # 2 entries, 4 levels: not


# --- the parser in isolation -----------------------------------------------

def test_parse_accepts_the_closed_unit_interval():
    assert parse_ratio_thresholds([0, 1], 3) == [0.0, 1.0]


def test_parse_rejects_what_the_schema_cannot_catch():
    """Length, range and ascent — the three relations a `list[float]` type
    does not constrain."""
    assert parse_ratio_thresholds([0.5], 3) is None          # wrong length
    assert parse_ratio_thresholds([-0.1, 0.5], 3) is None    # out of range
    assert parse_ratio_thresholds([0.6, 0.5], 3) is None     # descending
    assert parse_ratio_thresholds(None, 3) is None
