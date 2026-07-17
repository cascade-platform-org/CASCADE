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


# --- backup covers only its own category (per-category deferral) -------------


def _cfg2():
    """Two Requisite categories, so one can be backed and the other not."""
    return ModelConfiguration(
        version="1", meta=ConfigMeta(name="t"),
        functionality_scale=[FunctionalityScaleLevel(level=i, label=str(i), color="#000") for i in (1, 2, 3)],
        categories=[
            CategoryDefinition(name="digital", category_type="Requisite"),
            CategoryDefinition(name="power", category_type="Requisite"),
        ],
    )


def _run2(nodes, edges):
    proj = Project(
        version="2.0", meta=ProjectMeta(name="p"),
        nodes={x.id: x for x in nodes}, edges={e.id: e for e in edges},
        canvases=[Canvas(id="c", graph=Graph(graph_type="g",
                  node_ids=[x.id for x in nodes], edge_ids=[e.id for e in edges]))],
    )
    return {u.id: u for u in run(PropagationRequest(project=proj, config=_cfg2(), scope="global")).updates}


def _consumer2(*, digital_backup_duration=None, power_backup_duration=None):
    def profile(duration):
        return CategoryDependencyProfile(
            dependency_level=N,
            backup=duration is not None,
            backup_duration=duration,
        )
    return Node(
        id="c", functionality=N, node_categories=["digital", "power"],
        category_dependency_profiles={
            "digital": profile(digital_backup_duration),
            "power": profile(power_backup_duration),
        },
    )


def _two_failed_sources(digital_level=1, power_level=1):
    return (
        [
            Node(id="sd", functionality=digital_level, node_categories=["digital"]),
            Node(id="sp", functionality=power_level, node_categories=["power"]),
        ],
        [
            Edge(id="ed", source="sd", target="c", functionality=N),
            Edge(id="ep", source="sp", target="c", functionality=N),
        ],
    )


def test_unbacked_category_drop_commits_despite_backup_on_other():
    # digital is backed, power is not; both sources critical (tie). The power
    # drop must commit NOW — the digital reserve covers only digital — while
    # the countdown still starts for the deferred digital drop.
    sources, edges = _two_failed_sources()
    by_id = _run2([*sources, _consumer2(digital_backup_duration=24)], edges)
    update = by_id["c"]
    assert update.functionality == 1             # power (no backup) drags it down now
    assert update.functionality_time == 24        # digital's reserve countdown runs


def test_partial_unbacked_drop_commits_while_backed_drop_defers():
    # digital critical (backed) would bind at 1; power at 2 (unbacked). The node
    # drops to 2 immediately (the worse UNBACKED level) and counts down toward
    # the deeper deferred digital drop.
    sources, edges = _two_failed_sources(digital_level=1, power_level=2)
    by_id = _run2([*sources, _consumer2(digital_backup_duration=24)], edges)
    update = by_id["c"]
    assert update.functionality == 2
    assert update.functionality_time == 24


def test_two_backed_categories_take_shortest_reserve():
    # Both categories backed, both critical: pure deferral holds Functionality,
    # and the countdown is the WORSE (shortest) reserve — the node degrades when
    # the first backup runs out.
    sources, edges = _two_failed_sources()
    by_id = _run2(
        [*sources, _consumer2(digital_backup_duration=24, power_backup_duration=6)],
        edges,
    )
    update = by_id["c"]
    assert update.functionality == N  # held
    assert update.functionality_time == 6
