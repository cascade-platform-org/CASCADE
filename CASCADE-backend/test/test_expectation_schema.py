"""Expectation schema (ADR-0023): the validators the Zod mirror also enforces."""

import pytest
from pydantic import ValidationError

from schemas.expectation import Expectation
from schemas.network import Project
from schemas.results import PropagationRequest  # noqa: F401  (defines PropagationResult, which Project needs)

SCENARIO = {"kind": "scenario", "events": ["cut"], "assertions": [{"element": "h", "cmp": "==", "value": "critical"}]}


def test_scenario_defaults():
    e = Expectation.model_validate({"id": "a", "statement": "s", "check": SCENARIO})
    assert e.check.kind == "scenario"
    assert e.check.advance_hours == 0
    assert e.check.assertions[0].path == ["functionality"]


@pytest.mark.parametrize("assertion", [
    {"cmp": "==", "value": 1},
    {"element": "h", "where": {}, "cmp": "==", "value": 1},
])
def test_assertion_names_one_target(assertion):
    with pytest.raises(ValidationError):
        Expectation.model_validate({"id": "a", "statement": "s", "check": {**SCENARIO, "assertions": [assertion]}})


def test_simulation_reads_period_or_statistic():
    base = {"kind": "simulation", "simulation": "sim", "column": "Payout", "cmp": "==", "value": 1}
    Expectation.model_validate({"id": "a", "statement": "s", "check": {**base, "period": "2025-06"}})
    for bad in ({}, {"period": "2025-06", "statistic": "end"}):
        with pytest.raises(ValidationError):
            Expectation.model_validate({"id": "a", "statement": "s", "check": {**base, **bad}})


def test_local_scope_needs_canvas():
    with pytest.raises(ValidationError):
        Expectation.model_validate({"id": "a", "statement": "s", "check": {**SCENARIO, "scope": "local"}})


def test_project_refuses_repeated_ids():
    e = {"id": "a", "statement": "s", "check": SCENARIO}
    with pytest.raises(ValidationError, match="used twice"):
        Project.model_validate({"version": "2.0", "meta": {"name": "p"}, "expectations": [e, e]})


def test_agent_provenance():
    e = Expectation.model_validate({"id": "a", "statement": "s", "check": SCENARIO, "provenance": {"origin": "agent"}})
    assert e.provenance is not None and e.provenance.confirmed is False
