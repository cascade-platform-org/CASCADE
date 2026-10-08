"""ADR-0019: a project's Temporal Simulation document, as the backend validates it.

The document rides inside every project save and sync, so a malformed one must
be refused there; and Pydantic ignores unknown keys unless told otherwise, so
these tests also pin that `Project` keeps the document instead of dropping it.
"""
import pytest
from pydantic import ValidationError

import schemas.results  # noqa: F401  (completes Project's forward reference)
from schemas.network import Project
from schemas.temporal_simulation import TemporalSimulation

DOC = {
    "format": "cascade.temporal-simulation/v1",
    "timeline": {
        "name": "Year",
        "steps": [
            {
                "label": "2023-01",
                "unit": "month",
                "repeat": 12,
                "phases": [
                    {"events": ["quake", {"event": "settle", "every": 3}]},
                    {"events": [], "propagate": False},
                ],
            }
        ],
    },
    "profile": {
        "2023-02": [{"element": "pool", "path": ["supply_capacity", "water"], "op": "mul", "value": 0.5}],
    },
    "metrics": [
        {
            "name": "Owed",
            "target": {"kind": "node", "node_type": "Worker"},
            "path": ["supply_capacity", "hours", "level"],
            "read": "state",
            "aggregate": "share_where",
            "value_filter": {"cmp": "<", "value": 0},
        }
    ],
}


def test_bare_event_id_reads_as_every_one():
    phase = TemporalSimulation.model_validate(DOC).timeline.steps[0].phases[0]
    assert [(e.event, e.every) for e in phase.events] == [("quake", 1), ("settle", 3)]


def test_defaults_fill_an_empty_profile_and_metrics():
    doc = TemporalSimulation.model_validate({"format": DOC["format"], "timeline": {"name": "t", "steps": []}})
    assert doc.profile == {} and doc.metrics == []


@pytest.mark.parametrize(
    "patch, message",
    [
        ({"format": "cascade.temporal-simulation/v0"}, "Input should be"),
        ({"timeline": {"name": "t", "steps": [], "typo": 1}}, "Extra inputs"),
        ({"timeline": {"name": "t", "steps": [{"label": "a", "unit": "fortnight", "phases": []}]}}, "Input should be"),
        ({"timeline": {"name": "t", "steps": [{"label": "a", "unit": "day", "repeat": 0, "phases": []}]}}, "greater than or equal"),
        ({"timeline": {"name": "t", "steps": [{"label": "a", "unit": "day", "phases": [{"events": [{"event": "e", "every": 0}]}]}]}}, "greater than or equal"),
        ({"profile": {"p": [{"path": ["x"], "op": "set", "value": 1}]}}, "exactly one of"),
        ({"metrics": [{**DOC["metrics"][0], "percentile": 120}]}, "less than or equal"),
    ],
)
def test_rejects_malformed_documents(patch, message):
    with pytest.raises(ValidationError, match=message):
        TemporalSimulation.model_validate({**DOC, **patch})


def test_project_keeps_its_simulations_through_a_dump():
    project = Project.model_validate(
        {"version": "2.0", "meta": {"name": "p"}, "temporal_simulations": [{**DOC, "id": "a"}, {**DOC, "id": "b"}]}
    )
    again = Project.model_validate(project.model_dump(mode="json", exclude_none=True))
    assert again.temporal_simulations == project.temporal_simulations
    assert [s.id for s in again.temporal_simulations] == ["a", "b"]
    assert again.temporal_simulations[0].metrics[0].value_filter is not None


def test_a_project_with_one_simulation_loads_it_as_the_list_entry():
    project = Project.model_validate({"version": "2.0", "meta": {"name": "p"}, "temporal_simulation": DOC})
    assert [s.id for s in project.temporal_simulations] == ["simulation-1"]
    assert project.temporal_simulations[0].timeline == TemporalSimulation.model_validate(DOC).timeline


def test_project_without_a_simulation_has_none():
    assert Project.model_validate({"version": "2.0", "meta": {"name": "p"}}).temporal_simulations == []


def test_scope_is_global_by_default_and_local_names_its_canvas():
    assert TemporalSimulation.model_validate(DOC).scope == "global"
    assert TemporalSimulation.model_validate({**DOC, "scope": "local", "canvas": "c1"}).canvas == "c1"
    with pytest.raises(ValidationError, match="needs `canvas`"):
        TemporalSimulation.model_validate({**DOC, "scope": "local"})
    with pytest.raises(ValidationError, match="only for a local scope"):
        TemporalSimulation.model_validate({**DOC, "canvas": "c1"})


def test_standard_metrics_default_to_all_three_and_take_only_known_ones():
    from schemas.temporal_simulation import TemporalSimulation

    base = {"format": "cascade.temporal-simulation/v1", "timeline": {"name": "t", "steps": []}}
    assert TemporalSimulation.model_validate(base).standard_metrics == ["operativity", "coverage", "stock_level"]
    assert TemporalSimulation.model_validate({**base, "standard_metrics": []}).standard_metrics == []
    with pytest.raises(ValidationError):
        TemporalSimulation.model_validate({**base, "standard_metrics": ["throughput"]})


def test_a_phase_lets_hours_pass_and_a_temporal_jump_event_is_dropped_on_load():
    from schemas.config import ConfigMeta, FunctionalityScaleLevel, ModelConfiguration
    from schemas.temporal_simulation import Phase

    assert Phase().advance_hours == 0
    assert Phase(advance_hours=24).advance_hours == 24
    with pytest.raises(ValidationError):
        Phase(advance_hours=-1)
    config = ModelConfiguration(
        version="1", meta=ConfigMeta(name="t"),
        functionality_scale=[FunctionalityScaleLevel(level=i, label=str(i), color="#000") for i in (1, 2)],
        categories=[],
        events=[{"id": "tj", "label": "+24 h", "type": "temporal_jump", "duration_hours": 24}, {"id": "q", "label": "Quake", "type": "hazard"}],
    )
    assert [e.id for e in config.events] == ["q"]


def test_a_saved_run_packs_its_periods_and_older_entries_load():
    from schemas.network import TemporalSimulationScorecardEntry

    head = {"type": "temporal_simulation", "id": "e", "label": "l", "created_at": "2023-01-01T00:00:00Z", "timeline_name": "t"}
    snapshot = {"nodes": {}, "edges": {}, "canvases": []}
    diff = {"nodes": [], "edges": [], "canvases": []}
    entry = TemporalSimulationScorecardEntry.model_validate({
        **head, "start": snapshot, "metric_min": {"x": 1}, "metric_mean": {"x": 2},
        "periods": [{"label": "p1", "diff": diff, "metrics": {"x": 1}}, {"label": "p2", "diff": diff, "metrics": {"x": 3}}],
    })
    assert [p.label for p in entry.periods] == ["p1", "p2"]
    with pytest.raises(ValidationError):
        TemporalSimulationScorecardEntry.model_validate({**head, "start": snapshot, "periods": []})

    # One period with its whole end state (saved before 2026-10-08).
    older = TemporalSimulationScorecardEntry.model_validate({
        **head, "period_label": "p", "snapshot": snapshot, "metrics": {"x": 1}, "level_reading": "level", "stock_values": [{"element": "a", "value": 2}],
    })
    assert (older.periods[0].label, older.periods[0].metrics, older.periods[0].stock_values) == ("p", {"x": 1}, [])

    # The hour-old form that diffed against a shared base is dropped, and so is the key.
    project = Project.model_validate({
        "version": "2.0", "meta": {"name": "p"}, "nodes": {}, "edges": {}, "canvases": [],
        "scorecard": [{**head, "period_label": "p", "base_id": "b", "diff": diff}], "scorecard_bases": {"b": snapshot},
    })
    assert project.scorecard == []
