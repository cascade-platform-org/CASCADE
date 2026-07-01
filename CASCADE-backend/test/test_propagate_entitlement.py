"""Route-level entitlement enforcement on POST /api/propagate (ADR-0008).

No database is needed: the caller's identity + entitlement is injected by
overriding get_current_user, and the propagation service itself touches no DB.
The engine runs on a trivial graph, so the 200 paths are cheap.
"""
from __future__ import annotations

import httpx
from httpx import ASGITransport

from auth.dependencies import get_current_user
from auth.entitlement import get_limiter
from schemas.auth import AuthUser, Entitlement


def _request_json(num_nodes: int) -> dict:
    from schemas.config import (
        CategoryDefinition,
        ConfigMeta,
        FunctionalityScaleLevel,
        ModelConfiguration,
    )
    from schemas.network import Canvas, Graph, Node, Project, ProjectMeta
    from schemas.results import PropagationRequest

    nodes = [
        Node(id=f"n{i}", functionality=4, node_categories=["water"])
        for i in range(num_nodes)
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
        edges={},
        canvases=[
            Canvas(
                id="c1",
                graph=Graph(
                    graph_type="generic",
                    node_ids=[n.id for n in nodes],
                    edge_ids=[],
                ),
            )
        ],
    )
    req = PropagationRequest(project=project, config=config, scope="global")
    return req.model_dump(mode="json")


def _client_as(sub: str, entitlement: Entitlement | None) -> httpx.AsyncClient:
    from main import create_app

    app = create_app()
    app.dependency_overrides[get_current_user] = lambda: AuthUser(
        sub=sub,
        email=f"{sub}@x",
        display_name=sub,
        roles=["analyst"],  # grants can_propagate
        entitlement=entitlement,
    )
    return httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://t")


async def test_over_max_nodes_rejected_with_413():
    get_limiter().reset()
    ent = Entitlement(max_nodes=1, evals_per_minute=1000)
    async with _client_as("cap-user", ent) as client:
        resp = await client.post("/api/propagate", json=_request_json(3))
    assert resp.status_code == 413
    assert "nodes" in resp.json()["detail"].lower()


async def test_budget_exhaustion_returns_429_after_first_call():
    get_limiter().reset()
    ent = Entitlement(max_nodes=100, evals_per_minute=1)  # one eval per minute
    async with _client_as("budget-user", ent) as client:
        first = await client.post("/api/propagate", json=_request_json(1))
        second = await client.post("/api/propagate", json=_request_json(1))
    assert first.status_code == 200
    assert second.status_code == 429
    assert second.headers.get("Retry-After") == "5"


async def test_unbounded_entitlement_never_throttled():
    get_limiter().reset()
    async with _client_as("admin-user", None) as client:  # None == unbounded
        for _ in range(5):
            resp = await client.post("/api/propagate", json=_request_json(2))
            assert resp.status_code == 200


async def test_within_limits_succeeds():
    get_limiter().reset()
    ent = Entitlement(max_nodes=45, evals_per_minute=10000)
    async with _client_as("ok-user", ent) as client:
        resp = await client.post("/api/propagate", json=_request_json(2))
    assert resp.status_code == 200
