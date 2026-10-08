"""The EPANET importer for a Temporal Simulation (core/importers/inp/temporal.py).

The synthetic net of test_inp_import, given a day of time data: an 8-hour run,
a pattern that changes every hour, a pump closed AT TIME 3 and reopened AT
CLOCKTIME 6 AM, and a level-based control that must be reported as skipped.
"""
from __future__ import annotations

import math

import pytest

from api.import_routes import _run_import
from core.importers.inp import FLOW_UNIT_SCALE, TANK_RESERVE_EVENT_ID
from schemas.import_inp import ImportInpRequest
from schemas.network import Stock
from test_inp_import import SYNTHETIC_INP

TIMED_INP = SYNTHETIC_INP.replace(
    "[END]",
    """[TIMES]
 Duration           8:00
 Hydraulic Timestep 1:00
 Pattern Timestep   1:00
 Start ClockTime    12 am

[CONTROLS]
 LINK P1 CLOSED AT TIME 3
 LINK P1 OPEN AT CLOCKTIME 6 AM
 LINK P1 OPEN IF NODE T1 BELOW 2

[END]""",
)


@pytest.fixture(scope="module")
def imported():
    return _run_import(ImportInpRequest(filename="timed.inp", content=TIMED_INP), 300, temporal=True)


def per_period(volume_m3: float) -> float:
    return round(volume_m3 / 3600 * FLOW_UNIT_SCALE, 3)


def test_a_tank_becomes_storage_filling_and_draining_through_its_pipes(imported):
    project = imported.bundle.project
    tank = project.nodes["T1"].supply_capacity["water"]
    assert isinstance(tank, Stock)
    area = math.pi / 4 * 10**2
    assert (tank.level, tank.min, tank.max) == (per_period(area * 5), per_period(0), per_period(area * 10))
    assert tank.rate == 0 and tank.max_fill is not None and tank.max_draw is not None
    assert tank.max_fill == tank.max_draw  # one pipe, both directions
    ends = {(e.source, e.target) for e in project.edges.values() if "T1" in (e.source, e.target)}
    assert ends == {("T1", "J1"), ("J1", "T1")}
    assert project.nodes["T1"].functionality_time is None
    assert TANK_RESERVE_EVENT_ID not in {e.id for e in imported.bundle.config.events}


def test_controls_become_events_in_their_hours_and_conditionals_are_skipped(imported):
    steps = imported.bundle.project.temporal_simulations[0].timeline.steps
    assert [(s.label, s.repeat, [e.event for e in s.phases[0].events]) for s in steps] == [
        ("2023-01-01T00", 3, []),
        ("2023-01-01T03", 1, ["control-control-1"]),
        ("2023-01-01T04", 2, []),
        ("2023-01-01T06", 1, ["control-control-2"]),
        ("2023-01-01T07", 1, []),
    ]
    events = {e.id: e for e in imported.bundle.config.events}
    close = events["control-control-1"]
    assert close.temporal_simulation_only
    assert {op.value for op in close.attribute_operations or []} == {1}
    assert {op.value for op in events["control-control-2"].attribute_operations or []} == {3}
    assert any("control 3" in w and "skipped" in w for w in imported.warnings)


def test_the_profile_sets_each_demand_in_every_hour_it_changes(imported):
    profile = imported.bundle.project.temporal_simulations[0].profile
    j2 = [(label, op.value) for label, ops in profile.items() for op in ops if op.element == "J2"]
    unit = 10 / 1000 * FLOW_UNIT_SCALE  # 10 L/s
    assert [v for _, v in j2] == [unit * m for m in (1.0, 2.0, 0.5, 1.0, 2.0, 0.5, 1.0, 2.0)]
    j3 = [label for label, ops in profile.items() for op in ops if op.element == "J3"]
    assert j3 == ["2023-01-01T00"]  # constant demand: set once


def test_the_published_importer_is_unchanged():
    plain = _run_import(ImportInpRequest(filename="timed.inp", content=TIMED_INP), 300)
    assert plain.bundle.project.temporal_simulations == []
    assert isinstance(plain.bundle.project.nodes["T1"].supply_capacity["water"], float)
