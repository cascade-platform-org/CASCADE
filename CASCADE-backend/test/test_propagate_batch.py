"""POST /api/propagate/batch — one Project, many coalitions.

Two things are worth testing here and nothing else is: that a batched Scenario
is indistinguishable from the same Scenario run on its own (otherwise the
endpoint is a second, quietly different propagation path), and that it is
charged one engine evaluation per coalition (ADR-0008 — charging it as one
request would turn the budget into a request limit over unbounded compute).

Same no-database harness as test_propagate_entitlement.py.
"""
from __future__ import annotations

import httpx
import pytest
from httpx import ASGITransport

from auth.dependencies import get_current_user
from auth.entitlement import get_limiter
from schemas.auth import AuthUser, Entitlement
from schemas.results import MAX_COALITIONS_PER_BATCH


def _project_and_config(num_nodes: int):
    from schemas.config import (
        CategoryDefinition,
        ConfigMeta,
        FunctionalityScaleLevel,
        ModelConfiguration,
    )
    from schemas.network import Canvas, Edge, Graph, Node, Project, ProjectMeta

    nodes = [
        Node(id=f"n{i}", label=f"n{i}", functionality=4, node_categories=["water"])
        for i in range(num_nodes)
    ]
    # A chain, so failing an upstream node has something downstream to reach.
    edges = [
        Edge(id=f"e{i}", source=f"n{i}", target=f"n{i + 1}", functionality=4)
        for i in range(num_nodes - 1)
    ]
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
        canvases=[
            Canvas(
                id="c1",
                graph=Graph(
                    graph_type="generic",
                    node_ids=[n.id for n in nodes],
                    edge_ids=[e.id for e in edges],
                ),
            )
        ],
    )
    return project, config


def _batch_json(num_nodes: int, coalitions: list[list[str]]) -> dict:
    from schemas.results import BatchPropagationRequest

    project, config = _project_and_config(num_nodes)
    req = BatchPropagationRequest(
        project=project, config=config, scope="global", coalitions=coalitions
    )
    return req.model_dump(mode="json")


def _single_json(num_nodes: int, failed: list[str]) -> dict:
    from core.graph import with_failed_elements
    from schemas.results import PropagationRequest

    project, config = _project_and_config(num_nodes)
    req = PropagationRequest(
        project=with_failed_elements(project, failed), config=config, scope="global"
    )
    return req.model_dump(mode="json")


def _client_as(sub: str, entitlement: Entitlement | None) -> httpx.AsyncClient:
    from main import create_app

    app = create_app()
    app.dependency_overrides[get_current_user] = lambda: AuthUser(
        sub=sub, email=f"{sub}@x", display_name=sub,
        roles=["analyst"], entitlement=entitlement,
    )
    return httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://t")


def _levels(result: dict) -> dict[str, int]:
    return {u["id"]: u["functionality"] for u in result["updates"]}


# --- the batch is not a second propagation path ------------------------------

async def test_batched_scenario_matches_the_same_scenario_run_alone():
    """The property that makes the endpoint safe to introduce at all."""
    get_limiter().reset()
    coalitions = [[], ["n0"], ["n1", "n2"]]
    async with _client_as("same-user", None) as client:
        batched = await client.post("/api/propagate/batch",
                                    json=_batch_json(5, coalitions))
        singles = [
            await client.post("/api/propagate", json=_single_json(5, c))
            for c in coalitions
        ]

    assert batched.status_code == 200
    results = batched.json()["results"]
    assert len(results) == len(coalitions)
    for batch_result, single in zip(results, singles, strict=True):
        assert single.status_code == 200
        assert _levels(batch_result) == _levels(single.json())


async def test_results_are_positionally_aligned_with_the_coalitions_sent():
    """Callers index by position; a reordered or deduplicated reply is silent
    corruption of a Shapley run rather than a visible error."""
    get_limiter().reset()
    coalitions = [["n0"], [], ["n0"]]  # repeated on purpose
    async with _client_as("order-user", None) as client:
        resp = await client.post("/api/propagate/batch",
                                 json=_batch_json(4, coalitions))

    results = resp.json()["results"]
    assert len(results) == 3
    assert _levels(results[0]) == _levels(results[2])   # same coalition, same answer
    assert _levels(results[1]) != _levels(results[0])   # the baseline differs


async def test_each_coalition_starts_from_the_untouched_project():
    """Failures must not accumulate across the batch. If coalition k's damage
    leaked into k+1, a Shapley run would credit Elements for losses caused by
    an earlier permutation entirely."""
    get_limiter().reset()
    async with _client_as("leak-user", None) as client:
        resp = await client.post(
            "/api/propagate/batch",
            json=_batch_json(4, [["n0", "n1", "n2", "n3"], []]),
        )

    all_failed, baseline = resp.json()["results"]
    assert min(_levels(all_failed).values(), default=4) < 4
    assert all(level == 4 for level in _levels(baseline).values()) or not _levels(baseline)


async def test_unknown_element_ids_are_ignored_not_fatal():
    get_limiter().reset()
    async with _client_as("ghost-user", None) as client:
        resp = await client.post("/api/propagate/batch",
                                 json=_batch_json(3, [["does-not-exist"]]))
    assert resp.status_code == 200


# --- ADR-0008: one evaluation per coalition ----------------------------------

async def test_batch_is_charged_one_evaluation_per_coalition():
    """A batch of 3 must spend 3 units, not 1. Charging per request would let a
    caller buy unbounded engine work with a single token."""
    get_limiter().reset()
    ent = Entitlement(max_nodes=100, evals_per_minute=3)
    async with _client_as("cost-user", ent) as client:
        first = await client.post("/api/propagate/batch",
                                  json=_batch_json(3, [[], ["n0"], ["n1"]]))
        # Budget is now exactly spent; even a single Propagation must be refused.
        after = await client.post("/api/propagate", json=_single_json(3, []))

    assert first.status_code == 200
    assert after.status_code == 429


async def test_batch_larger_than_budget_is_refused_before_any_engine_work():
    get_limiter().reset()
    ent = Entitlement(max_nodes=100, evals_per_minute=2)
    async with _client_as("over-user", ent) as client:
        resp = await client.post("/api/propagate/batch",
                                 json=_batch_json(3, [[], ["n0"], ["n1"]]))
    assert resp.status_code == 429
    assert resp.headers.get("Retry-After") == "5"


async def test_node_cap_applies_to_the_batch_too():
    get_limiter().reset()
    ent = Entitlement(max_nodes=1, evals_per_minute=1000)
    async with _client_as("cap-user", ent) as client:
        resp = await client.post("/api/propagate/batch",
                                 json=_batch_json(3, [[]]))
    assert resp.status_code == 413


# --- bounds ------------------------------------------------------------------

@pytest.mark.parametrize(
    "coalitions",
    [
        [],                                              # empty batch
        [[] for _ in range(MAX_COALITIONS_PER_BATCH + 1)],  # over the cap
    ],
)
async def test_batch_size_is_bounded(coalitions):
    """The cap is what keeps one request from holding an engine worker for the
    length of a whole Shapley run; the caller chunks instead."""
    get_limiter().reset()
    project, config = _project_and_config(3)
    body = {
        "project": project.model_dump(mode="json"),
        "config": config.model_dump(mode="json"),
        "scope": "global",
        "coalitions": coalitions,
    }
    async with _client_as("bounds-user", None) as client:
        resp = await client.post("/api/propagate/batch", json=body)
    assert resp.status_code == 422
