"""Parameters, Series and the operand's factors (ADR-0019/0021 revised 2026-10-12)."""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from schemas.config import AttributeOperation, EventDefinition
from schemas.network import Project
from schemas.results import PropagationRequest
from schemas.temporal_simulation import TemporalSimulation

TIMELINE = {"name": "t", "steps": [{"label": "2023-01", "unit": "month", "phases": []}]}


def _project(**extra: object) -> Project:
    return Project.model_validate({"version": "2.0", "meta": {"name": "p"}, **extra})


def test_an_operation_reads_a_parameter_and_a_series_with_a_number_factor() -> None:
    op = AttributeOperation(element="e", path=["x"], op="add", value=-1, parameter="art8_share", series="worked_h", of=["y"])
    assert (op.parameter, op.series) == ("art8_share", "worked_h")
    with pytest.raises(ValidationError, match="value is the factor"):
        AttributeOperation(element="e", path=["x"], op="set", value="a", series="worked_h")
    with pytest.raises(ValidationError, match="value is the factor"):
        AttributeOperation(element="e", path=["x"], op="set", value=True, parameter="share")


@pytest.mark.parametrize("name", ["1share", "has space", "a-b", "", "x" * 65, "__proto__"])
def test_an_operand_name_is_an_identifier(name: str) -> None:
    with pytest.raises(ValidationError):
        AttributeOperation(element="e", path=["x"], op="add", value=1, parameter=name)


def test_an_event_declares_finite_parameter_defaults() -> None:
    event = EventDefinition(id="art8", label="Art. 8", type="restorative", parameter_defaults={"art8_share": 0.5})
    assert event.parameter_defaults == {"art8_share": 0.5}
    with pytest.raises(ValidationError):
        EventDefinition(id="e", label="e", type="restorative", parameter_defaults={"x": float("inf")})


def test_a_simulation_declares_uniquely_named_parameters() -> None:
    doc = {"format": "cascade.temporal-simulation/v1", "timeline": TIMELINE}
    sim = TemporalSimulation.model_validate({**doc, "parameters": [{"name": "threshold", "value": 0.2, "description": "of a month"}]})
    assert sim.parameters[0].value == 0.2
    assert TemporalSimulation.model_validate(doc).parameters == []
    with pytest.raises(ValidationError, match="used twice"):
        TemporalSimulation.model_validate({**doc, "parameters": [{"name": "a", "value": 1}, {"name": "a", "value": 2}]})
    with pytest.raises(ValidationError):
        TemporalSimulation.model_validate({**doc, "parameters": [{"name": "a", "value": float("nan")}]})


def test_a_project_keeps_series_through_a_dump() -> None:
    project = _project(series=[{"name": "worked_h", "unit": "h", "rows": {"act-pul": {"2023-01": 21555.0}, "*": {"2023-01": 0}}}])
    again = Project.model_validate_json(project.model_dump_json())
    assert again.series == project.series


@pytest.mark.parametrize(
    "bad",
    [
        {"series": [{"name": "a"}, {"name": "a"}]},
        {"series": [{"name": "s", "rows": {"e": {"2023-01": float("inf")}}}]},
    ],
)
def test_a_project_refuses_bad_series(bad: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        _project(**bad)


def test_a_propagation_request_accepts_events_reading_parameters_and_series() -> None:
    """Events travel with every Propagation, so their new operand fields must validate there."""
    event = {"id": "art8", "label": "Art. 8", "type": "restorative", "parameter_defaults": {"art8_share": 0.5},
             "attribute_operations": [{"where": {"kind": "edge"}, "path": ["capacity", "level"], "op": "add", "value": 1,
                                       "parameter": "art8_share", "of": ["properties", "opening_owed_h"]}]}
    config = {"version": "1.0", "meta": {"name": "c"}, "functionality_scale": [{"level": 1, "label": "a", "color": "red"}, {"level": 2, "label": "b", "color": "green"}],
              "categories": [], "events": [event], "graph_types": []}
    request = PropagationRequest.model_validate({"project": {"version": "2.0", "meta": {"name": "p"}}, "config": config, "scope": "global"})
    assert request.config.events[0].attribute_operations[0].parameter == "art8_share"  # type: ignore[index]
