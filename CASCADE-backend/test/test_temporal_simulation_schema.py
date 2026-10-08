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


def test_project_keeps_the_document_through_a_dump():
    project = Project.model_validate(
        {"version": "2.0", "meta": {"name": "p"}, "temporal_simulation": DOC}
    )
    again = Project.model_validate(project.model_dump(mode="json", exclude_none=True))
    assert again.temporal_simulation == project.temporal_simulation
    assert again.temporal_simulation is not None
    assert again.temporal_simulation.metrics[0].value_filter is not None


def test_project_without_a_simulation_has_none():
    assert Project.model_validate({"version": "2.0", "meta": {"name": "p"}}).temporal_simulation is None


def test_standard_metrics_default_to_all_three_and_take_only_known_ones():
    from schemas.temporal_simulation import TemporalSimulation

    base = {"format": "cascade.temporal-simulation/v1", "timeline": {"name": "t", "steps": []}}
    assert TemporalSimulation.model_validate(base).standard_metrics == ["operativity", "coverage", "stock_level"]
    assert TemporalSimulation.model_validate({**base, "standard_metrics": []}).standard_metrics == []
    with pytest.raises(ValidationError):
        TemporalSimulation.model_validate({**base, "standard_metrics": ["throughput"]})
