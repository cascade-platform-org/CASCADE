"""Route-level tests for api/sync_routes.py — Server Sync (requirements.md §13.4).

Real database + real route logic; only the caller's identity is faked by
overriding get_current_user, matching test_admin_api.py's pattern.
"""
from __future__ import annotations

import httpx
from httpx import ASGITransport

from auth.dependencies import get_current_user
from db import users as db_users
from schemas.auth import AuthUser


def _minimal_bundle_json(name: str = "p") -> dict:
    from schemas.config import (
        CategoryDefinition,
        ConfigMeta,
        FunctionalityScaleLevel,
        ModelConfiguration,
    )
    from schemas.network import Canvas, Graph, Project, ProjectMeta

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
        meta=ProjectMeta(name=name),
        nodes={},
        edges={},
        canvases=[Canvas(id="c1", graph=Graph(graph_type="generic", node_ids=[], edge_ids=[]))],
    )
    return {"project": project.model_dump(mode="json"), "config": config.model_dump(mode="json")}


async def _client_as(pool, roles: list[str], sub: str = "u-sync", email: str = "sync@x") -> tuple[httpx.AsyncClient, str]:
    """A client authenticated as a real DB user with the given roles (roles
    drive permission, but db_id must be real for the owner-scoped queries)."""
    async with pool.acquire() as conn:
        user = await db_users.upsert_user(conn, external_id=sub, email=email, name=None)
        await db_users.set_user_role(conn, user.id, roles[0])

    from main import create_app

    app = create_app()
    app.dependency_overrides[get_current_user] = lambda: AuthUser(
        sub=sub, email=email, display_name="Sync Test", roles=roles, db_id=user.id
    )
    client = httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://t")
    return client, user.id


async def test_viewer_cannot_save(migrated_db):
    client, _ = await _client_as(migrated_db, ["viewer"])
    async with client:
        resp = await client.post(
            "/api/projects",
            json={"name": "p", "data": _minimal_bundle_json()},
        )
    assert resp.status_code == 403


async def test_analyst_can_save_list_load_delete(migrated_db):
    client, _ = await _client_as(migrated_db, ["analyst"])
    async with client:
        save_resp = await client.post(
            "/api/projects",
            json={"name": "p1", "description": "first", "data": _minimal_bundle_json("p1")},
        )
        assert save_resp.status_code == 200
        version_id = save_resp.json()["id"]

        list_resp = await client.get("/api/projects")
        assert list_resp.status_code == 200
        names = [v["name"] for v in list_resp.json()]
        assert "p1" in names

        get_resp = await client.get(f"/api/projects/{version_id}")
        assert get_resp.status_code == 200
        assert get_resp.json()["data"]["project"]["meta"]["name"] == "p1"

        del_resp = await client.delete(f"/api/projects/{version_id}")
        assert del_resp.status_code == 204

        get_after_delete = await client.get(f"/api/projects/{version_id}")
        assert get_after_delete.status_code == 404


async def test_load_omits_null_optionals(migrated_db):
    """Regression: the frontend Zod schema uses `.optional()` (accepts an absent
    key, rejects `null`). Pydantic otherwise serialises every unset Optional as
    explicit `null`, which broke Load. The detail route sets
    response_model_exclude_none=True so the bundle round-trips null-free — the
    same shape a local file save produces. See §13.4."""
    from schemas.network import Edge, Node

    bundle = _minimal_bundle_json("nulls")
    # A node and an edge that leave every Optional field unset.
    node = Node(id="n1", functionality=4)
    edge = Edge(id="e1", source="n1", target="n1", functionality=4)
    bundle["project"]["nodes"] = {"n1": node.model_dump(mode="json")}
    bundle["project"]["edges"] = {"e1": edge.model_dump(mode="json")}

    client, _ = await _client_as(migrated_db, ["analyst"])
    async with client:
        save_resp = await client.post(
            "/api/projects", json={"name": "nulls", "description": None, "data": bundle}
        )
        assert save_resp.status_code == 200
        version_id = save_resp.json()["id"]

        get_resp = await client.get(f"/api/projects/{version_id}")
        assert get_resp.status_code == 200
        loaded = get_resp.json()

        # No `null` anywhere in the typed node/edge maps (free-form dicts aside).
        def null_paths(obj, path=""):
            found = []
            if isinstance(obj, dict):
                for k, v in obj.items():
                    p = f"{path}.{k}" if path else k
                    if v is None:
                        found.append(p)
                    else:
                        found += null_paths(v, p)
            elif isinstance(obj, list):
                for i, v in enumerate(obj):
                    found += null_paths(v, f"{path}[{i}]")
            return found

        got_edge = loaded["data"]["project"]["edges"]["e1"]
        assert "capacity" not in got_edge  # excluded, not null
        assert "sourceHandle" not in got_edge
        assert null_paths(loaded["data"]["project"]["nodes"]) == []
        assert null_paths(loaded["data"]["project"]["edges"]) == []


async def test_save_never_overwrites_creates_new_version(migrated_db):
    client, _ = await _client_as(migrated_db, ["analyst"])
    async with client:
        first = await client.post(
            "/api/projects", json={"name": "same-name", "data": _minimal_bundle_json()}
        )
        second = await client.post(
            "/api/projects", json={"name": "same-name", "data": _minimal_bundle_json()}
        )
        assert first.json()["id"] != second.json()["id"]

        listed = (await client.get("/api/projects")).json()
        same_name_versions = [v for v in listed if v["name"] == "same-name"]
        assert len(same_name_versions) == 2


async def test_old_versions_pruned_past_cap(migrated_db):
    """MAX_VERSIONS_PER_NAME = 10: an 11th save for the same name must prune
    the oldest, not grow unbounded."""
    client, _ = await _client_as(migrated_db, ["analyst"], sub="u-prune", email="prune@x")
    async with client:
        ids = []
        for _ in range(11):
            resp = await client.post(
                "/api/projects", json={"name": "pruned", "data": _minimal_bundle_json()}
            )
            ids.append(resp.json()["id"])

        listed = (await client.get("/api/projects")).json()
        pruned_versions = [v for v in listed if v["name"] == "pruned"]
        assert len(pruned_versions) == 10
        # The very first save (oldest) must be gone.
        remaining_ids = {v["id"] for v in pruned_versions}
        assert ids[0] not in remaining_ids
        assert ids[-1] in remaining_ids


async def test_cannot_load_or_delete_another_users_version(migrated_db):
    owner_client, _ = await _client_as(migrated_db, ["analyst"], sub="owner", email="owner@x")
    async with owner_client:
        save_resp = await owner_client.post(
            "/api/projects", json={"name": "private", "data": _minimal_bundle_json()}
        )
    version_id = save_resp.json()["id"]

    other_client, _ = await _client_as(migrated_db, ["analyst"], sub="intruder", email="intruder@x")
    async with other_client:
        get_resp = await other_client.get(f"/api/projects/{version_id}")
        assert get_resp.status_code == 404  # not 403 — existence is not leaked

        del_resp = await other_client.delete(f"/api/projects/{version_id}")
        assert del_resp.status_code == 404


async def test_local_only_mode_returns_501(migrated_db):
    """A user with no db_id (local-only mode's synthetic identity) gets a
    clear 501, not a crash trying to insert a null owner_id."""
    from main import create_app

    app = create_app()
    app.dependency_overrides[get_current_user] = lambda: AuthUser(
        sub="local-user", email="local@cascade.dev", display_name="Local", roles=["admin"]
    )
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://t"
    ) as client:
        resp = await client.post(
            "/api/projects", json={"name": "p", "data": _minimal_bundle_json()}
        )
    assert resp.status_code == 501
