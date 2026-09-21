"""services/propagation_service.py — the worker-slot pool and timeout.

This is the trickiest code at the ADR-0009 engine seam: a shared counter
(`_slots_in_use`) guarded by a lock, released from a callback that fires on
the WORKER thread rather than the event loop, with one subtle invariant the
module docstring states but nothing previously checked — a run that hits
ENGINE_TIMEOUT_SECONDS keeps its slot, because a Python thread cannot be
killed and is still burning that worker until it actually returns.

Same no-database, no-HTTP style as test_epanet_mode.py: call propagate()
directly against services.propagation_service, not through the API.
"""
from __future__ import annotations

import asyncio
import threading
from datetime import datetime, timezone

import pytest

from schemas.results import PropagationRequest, PropagationResult
from services import propagation_service


@pytest.fixture(autouse=True)
def _reset_slot_counter():
    # _slots_in_use is a module-level global shared across every test in the
    # process; a test that raises before its slot is released would otherwise
    # leak state into the next one.
    propagation_service._slots_in_use = 0
    yield
    propagation_service._slots_in_use = 0


def _project_and_config():
    from schemas.config import (
        CategoryDefinition,
        ConfigMeta,
        FunctionalityScaleLevel,
        ModelConfiguration,
    )
    from schemas.network import Canvas, Edge, Graph, Node, Project, ProjectMeta

    nodes = [Node(id="n0", label="n0", functionality=4, node_categories=["water"]),
             Node(id="n1", label="n1", functionality=4, node_categories=["water"])]
    edges = [Edge(id="e0", source="n0", target="n1", functionality=4)]
    config = ModelConfiguration(
        version="1.0",
        meta=ConfigMeta(name="t"),
        functionality_scale=[
            FunctionalityScaleLevel(level=lvl, label=str(lvl), color="#000")
            for lvl in range(1, 5)
        ],
        categories=[CategoryDefinition(name="water", category_type="Requisite")],
    )
    project = Project(
        version="2.0",
        meta=ProjectMeta(name="p"),
        nodes={n.id: n for n in nodes},
        edges={e.id: e for e in edges},
        canvases=[Canvas(id="c1", graph=Graph(
            graph_type="generic", node_ids=[n.id for n in nodes], edge_ids=[e.id for e in edges],
        ))],
    )
    return project, config


def _request() -> PropagationRequest:
    project, config = _project_and_config()
    return PropagationRequest(project=project, config=config, scope="global")


def _blocking_engine_run(release: threading.Event):
    """Stand-in for engine.propagation.run: blocks until `release` is set,
    then returns a minimal, valid PropagationResult."""

    def _run(request: PropagationRequest) -> PropagationResult:
        release.wait()
        return PropagationResult(
            scope=request.scope, updates=[], computed_at=datetime.now(timezone.utc),
            iterations=1, warnings=[],
        )

    return _run


async def _wait_until(predicate, timeout=2.0, interval=0.01):
    """Poll for an eventually-consistent condition set from a worker thread."""
    elapsed = 0.0
    while not predicate():
        await asyncio.sleep(interval)
        elapsed += interval
        if elapsed > timeout:
            raise AssertionError("condition not met within timeout")


async def test_slot_is_released_after_normal_completion(monkeypatch):
    release = threading.Event()
    release.set()  # let the engine "run" complete immediately
    monkeypatch.setattr(propagation_service._engine, "run", _blocking_engine_run(release))

    assert propagation_service._slots_in_use == 0
    await propagation_service.propagate(_request())
    assert propagation_service._slots_in_use == 0


async def test_busy_error_raised_without_queueing_when_all_slots_are_held(monkeypatch):
    monkeypatch.setattr(propagation_service, "_MAX_WORKERS", 1)
    release = threading.Event()
    monkeypatch.setattr(propagation_service._engine, "run", _blocking_engine_run(release))

    first = asyncio.create_task(propagation_service.propagate(_request()))
    # Slot acquisition is synchronous, before the engine call is submitted —
    # give the task a tick to reach that point and occupy the only slot.
    await _wait_until(lambda: propagation_service._slots_in_use == 1)

    with pytest.raises(propagation_service.EngineBusyError):
        await propagation_service.propagate(_request())

    # The busy rejection must not have consumed a slot of its own.
    assert propagation_service._slots_in_use == 1

    release.set()
    await first
    assert propagation_service._slots_in_use == 0


async def test_timed_out_run_keeps_its_slot_until_the_thread_actually_returns(monkeypatch):
    monkeypatch.setattr(propagation_service, "ENGINE_TIMEOUT_SECONDS", 0.05)
    release = threading.Event()  # never set before the timeout fires
    monkeypatch.setattr(propagation_service._engine, "run", _blocking_engine_run(release))

    with pytest.raises(propagation_service.EngineTimeoutError):
        await propagation_service.propagate(_request())

    # The awaiting request gave up, but the worker thread is still blocked on
    # release.wait() — the documented invariant is that the slot stays held.
    assert propagation_service._slots_in_use == 1

    release.set()
    await _wait_until(lambda: propagation_service._slots_in_use == 0)
