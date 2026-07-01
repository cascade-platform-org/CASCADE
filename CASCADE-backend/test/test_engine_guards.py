"""Tests for Slice 2 guards: dependency_level attenuation and backup deferral.

Exercised end-to-end through engine.propagation.run on Requisite (logical)
graphs, where a critical source would otherwise drag the consumer to 1.
"""
from engine.propagation import run
from schemas.config import (
    CategoryDefinition,
    ConfigMeta,
    FunctionalityScaleLevel,
    ModelConfiguration,
)
from schemas.network import (
    CategoryDependencyProfile,
    Canvas,
    Edge,
    Graph,
    Node,
    Project,
    ProjectMeta,
)
from schemas.results import PropagationRequest

N = 3


def _cfg():
    return ModelConfiguration(
        version="1", meta=ConfigMeta(name="t"),
        functionality_scale=[FunctionalityScaleLevel(level=i, label=str(i), color="#000") for i in (1, 2, 3)],
        categories=[CategoryDefinition(name="digital", category_type="Requisite")],
    )


def _consumer(nid, *, dependency_level=N, backup=None, backup_duration=None, functionality_time=None):
    return Node(
        id=nid,
        functionality=N,
        node_categories=["digital"],
        functionality_time=functionality_time,
        category_dependency_profiles={
            "digital": CategoryDependencyProfile(
                dependency_level=dependency_level, backup=backup, backup_duration=backup_duration
            )
        },
    )


def _run(nodes, edges):
    proj = Project(
        version="2.0", meta=ProjectMeta(name="p"),
        nodes={x.id: x for x in nodes}, edges={e.id: e for e in edges},
        canvases=[Canvas(id="c", graph=Graph(graph_type="g",
                  node_ids=[x.id for x in nodes], edge_ids=[e.id for e in edges]))],
    )
    return {u.id: u for u in run(PropagationRequest(project=proj, config=_cfg(), scope="global")).updates}


def _src():
    return Node(id="src", functionality=1, node_categories=["digital"])  # critical source


def _edge():
    return Edge(id="e", source="src", target="c", functionality=N)


# --- dependency_level attenuation -------------------------------------------


def test_full_dependency_passes_whole_drop():
    by_id = _run([_src(), _consumer("c", dependency_level=3)], [_edge()])
    assert by_id["c"].functionality == 1  # dep=N → no attenuation


def test_no_dependency_neutralises_drop():
    by_id = _run([_src(), _consumer("c", dependency_level=1)], [_edge()])
    assert "c" not in by_id  # dep=1 → drop neutralised, no update


def test_partial_dependency_attenuates_drop():
    # dep=2, N=3: attenuate(1, 3, 2, 3) = min(3, 1 + (3-2)) = 2.
    by_id = _run([_src(), _consumer("c", dependency_level=2)], [_edge()])
    assert by_id["c"].functionality == 2


# --- backup deferral --------------------------------------------------------


def test_backup_defers_critical_into_functionality_time():
    by_id = _run(
        [_src(), _consumer("c", dependency_level=3, backup=True, backup_duration=24)],
        [_edge()],
    )
    update = by_id["c"]
    assert update.functionality == N            # held, not dropped this run
    assert update.functionality_time == 24       # countdown set instead


def test_backup_without_duration_does_not_defer():
    by_id = _run(
        [_src(), _consumer("c", dependency_level=3, backup=True, backup_duration=None)],
        [_edge()],
    )
    assert by_id["c"].functionality == 1  # no usable backup → drops normally


def test_draining_backup_not_refreshed():
    # A countdown already running (functionality_time=5) is left untouched, and
    # the node still holds (no drop) this run.
    by_id = _run(
        [_src(), _consumer("c", dependency_level=3, backup=True, backup_duration=24, functionality_time=5)],
        [_edge()],
    )
    # functionality held at N; functionality_time unchanged (still 5) → no update emitted.
    assert "c" not in by_id


def test_backup_defers_any_drop_not_only_critical():
    # Even a partial drop (level 2 via dep attenuation) is deferred: the reserve
    # keeps the node fully operational and starts the countdown.
    by_id = _run(
        [_src(), _consumer("c", dependency_level=2, backup=True, backup_duration=24)],
        [_edge()],
    )
    update = by_id["c"]
    assert update.functionality == N            # held, not dropped to 2
    assert update.functionality_time == 24
