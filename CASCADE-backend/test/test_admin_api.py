"""Route-level tests for api/admin_routes.py.

Real database + real route logic; only the caller's *identity* is faked by
overriding the get_current_user dependency with a chosen role. This exercises
require_permission and the admin-escalation guard exactly as in production.
"""
from __future__ import annotations

import httpx
from httpx import ASGITransport

from auth.dependencies import get_current_user
from db import users as db_users
from schemas.auth import AuthUser


def _client_as(roles: list[str]) -> httpx.AsyncClient:
    """An ASGI client whose caller has the given roles.

    ASGITransport does not run lifespan, so the pool from the `migrated_db`
    fixture (a module singleton) is what the routes use.
    """
    from main import create_app

    app = create_app()
    app.dependency_overrides[get_current_user] = lambda: AuthUser(
        sub="actor", email="actor@x", display_name="Actor", roles=roles
    )
    return httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://t"
    )


async def _make_user(pool, external_id: str, email: str) -> str:
    async with pool.acquire() as conn:
        u = await db_users.upsert_user(
            conn, external_id=external_id, email=email, name=None
        )
    return u.id


async def test_list_users_requires_manage_permission(migrated_db):
    async with _client_as(["viewer"]) as client:
        resp = await client.get("/api/admin/users")
    assert resp.status_code == 403


async def test_manager_lists_users(migrated_db):
    await _make_user(migrated_db, "s-1", "one@x")
    async with _client_as(["manager"]) as client:
        resp = await client.get("/api/admin/users")
    assert resp.status_code == 200
    emails = {u["email"] for u in resp.json()}
    assert "one@x" in emails


async def test_manager_can_assign_analyst(migrated_db):
    uid = await _make_user(migrated_db, "s-2", "two@x")
    async with _client_as(["manager"]) as client:
        resp = await client.patch(
            f"/api/admin/users/{uid}/role", json={"role": "analyst"}
        )
    assert resp.status_code == 200
    assert resp.json()["role"] == "analyst"


async def test_manager_cannot_mint_admin(migrated_db):
    uid = await _make_user(migrated_db, "s-3", "three@x")
    async with _client_as(["manager"]) as client:
        resp = await client.patch(
            f"/api/admin/users/{uid}/role", json={"role": "admin"}
        )
    assert resp.status_code == 403  # escalation guard


async def _make_admin(pool, external_id: str, email: str) -> str:
    async with pool.acquire() as conn:
        u = await db_users.upsert_user(
            conn, external_id=external_id, email=email, name=None
        )
        await db_users.set_user_role(conn, u.id, "admin")
    return u.id


async def test_manager_cannot_demote_admin(migrated_db):
    uid = await _make_admin(migrated_db, "s-adm", "adm@x")
    async with _client_as(["manager"]) as client:
        resp = await client.patch(
            f"/api/admin/users/{uid}/role", json={"role": "viewer"}
        )
    assert resp.status_code == 403  # removing admin also needs admin


async def test_admin_can_demote_admin(migrated_db):
    uid = await _make_admin(migrated_db, "s-adm2", "adm2@x")
    async with _client_as(["admin"]) as client:
        resp = await client.patch(
            f"/api/admin/users/{uid}/role", json={"role": "analyst"}
        )
    assert resp.status_code == 200
    assert resp.json()["role"] == "analyst"


async def test_admin_can_mint_admin(migrated_db):
    uid = await _make_user(migrated_db, "s-4", "four@x")
    async with _client_as(["admin"]) as client:
        resp = await client.patch(
            f"/api/admin/users/{uid}/role", json={"role": "admin"}
        )
    assert resp.status_code == 200
    assert resp.json()["role"] == "admin"


async def test_assign_unknown_role_rejected(migrated_db):
    uid = await _make_user(migrated_db, "s-5", "five@x")
    async with _client_as(["admin"]) as client:
        resp = await client.patch(
            f"/api/admin/users/{uid}/role", json={"role": "wizard"}
        )
    assert resp.status_code == 400


async def test_assign_role_missing_user_404(migrated_db):
    async with _client_as(["admin"]) as client:
        resp = await client.patch(
            "/api/admin/users/00000000-0000-0000-0000-000000000000/role",
            json={"role": "analyst"},
        )
    assert resp.status_code == 404
