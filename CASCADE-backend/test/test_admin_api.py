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


def _client_as(
    roles: list[str],
    sub: str = "actor",
    email: str = "actor@x",
    raise_app_exceptions: bool = True,
) -> httpx.AsyncClient:
    """An ASGI client whose caller has the given roles (and optional identity).

    ASGITransport does not run lifespan, so the pool from the `migrated_db`
    fixture (a module singleton) is what the routes use. Set
    raise_app_exceptions=False to observe the production 500 response instead of
    having an unhandled exception re-raised into the test.
    """
    from main import create_app

    app = create_app()
    app.dependency_overrides[get_current_user] = lambda: AuthUser(
        sub=sub, email=email, display_name="Actor", roles=roles
    )
    return httpx.AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=raise_app_exceptions),
        base_url="http://t",
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


async def test_role_change_writes_audit_entry(migrated_db):
    uid = await _make_user(migrated_db, "s-aud", "aud@x")
    async with _client_as(["manager"], email="mgr@x") as client:
        await client.patch(f"/api/admin/users/{uid}/role", json={"role": "analyst"})
    async with migrated_db.acquire() as conn:
        rows = await conn.fetch(
            "SELECT user_email, details FROM audit_logs WHERE action = 'role_change'"
        )
    assert len(rows) == 1
    assert rows[0]["user_email"] == "mgr@x"  # the actor
    assert '"new_role": "analyst"' in rows[0]["details"]


async def test_manager_can_delete_non_admin(migrated_db):
    uid = await _make_user(migrated_db, "s-del1", "del1@x")
    async with _client_as(["manager"]) as client:
        resp = await client.delete(f"/api/admin/users/{uid}")
    assert resp.status_code == 204
    async with migrated_db.acquire() as conn:
        assert await db_users.get_user_by_id(conn, uid) is None


async def test_manager_cannot_delete_admin(migrated_db):
    uid = await _make_admin(migrated_db, "s-del2", "del2@x")
    async with _client_as(["manager"]) as client:
        resp = await client.delete(f"/api/admin/users/{uid}")
    assert resp.status_code == 403  # removing admin needs admin


async def test_admin_can_delete_admin(migrated_db):
    uid = await _make_admin(migrated_db, "s-del3", "del3@x")
    async with _client_as(["admin"]) as client:
        resp = await client.delete(f"/api/admin/users/{uid}")
    assert resp.status_code == 204


async def test_delete_missing_user_404(migrated_db):
    async with _client_as(["admin"]) as client:
        resp = await client.delete(
            "/api/admin/users/00000000-0000-0000-0000-000000000000"
        )
    assert resp.status_code == 404


async def test_self_delete_via_me(migrated_db):
    async with migrated_db.acquire() as conn:
        await db_users.upsert_user(
            conn, external_id="self-sub", email="self@x", name=None
        )
    async with _client_as(["analyst"], sub="self-sub", email="self@x") as client:
        resp = await client.delete("/api/auth/me")
    assert resp.status_code == 204
    async with migrated_db.acquire() as conn:
        assert await db_users.get_user_by_external_id(conn, "self-sub") is None
        rows = await conn.fetch(
            "SELECT details FROM audit_logs WHERE action = 'account_delete'"
        )
    assert any('"self": true' in r["details"] for r in rows)


async def test_delete_aborts_when_idp_fails(migrated_db, monkeypatch):
    """A failed IdP deletion must NOT delete the app record (all-or-nothing)."""
    from auth.idp import IdPDeletionError

    async def boom(external_id):
        raise IdPDeletionError("zitadel unreachable")

    monkeypatch.setattr("api.admin_routes.delete_idp_user", boom)
    uid = await _make_user(migrated_db, "s-idpfail", "idpfail@x")
    async with _client_as(["admin"]) as client:
        resp = await client.delete(f"/api/admin/users/{uid}")
    assert resp.status_code == 502
    async with migrated_db.acquire() as conn:
        assert await db_users.get_user_by_id(conn, uid) is not None  # not deleted


async def test_self_delete_aborts_when_idp_fails(migrated_db, monkeypatch):
    from auth.idp import IdPDeletionError

    async def boom(external_id):
        raise IdPDeletionError("zitadel unreachable")

    monkeypatch.setattr("api.auth_routes.delete_idp_user", boom)
    async with migrated_db.acquire() as conn:
        await db_users.upsert_user(
            conn, external_id="self-idpfail", email="s@x", name=None
        )
    async with _client_as(["analyst"], sub="self-idpfail", email="s@x") as client:
        resp = await client.delete("/api/auth/me")
    assert resp.status_code == 502
    async with migrated_db.acquire() as conn:
        assert (
            await db_users.get_user_by_external_id(conn, "self-idpfail") is not None
        )


async def test_delete_rolls_back_when_audit_fails(migrated_db, monkeypatch):
    """If the audit write fails, the deletion is rolled back (single transaction)."""

    async def boom(*args, **kwargs):
        raise RuntimeError("audit backend down")

    monkeypatch.setattr("db.audit.record", boom)
    uid = await _make_user(migrated_db, "s-auditfail", "auditfail@x")
    async with _client_as(["admin"], raise_app_exceptions=False) as client:
        resp = await client.delete(f"/api/admin/users/{uid}")
    assert resp.status_code == 500
    async with migrated_db.acquire() as conn:
        assert await db_users.get_user_by_id(conn, uid) is not None  # rolled back


async def test_role_change_rolls_back_when_audit_fails(migrated_db, monkeypatch):
    async def boom(*args, **kwargs):
        raise RuntimeError("audit backend down")

    monkeypatch.setattr("db.audit.record", boom)
    uid = await _make_user(migrated_db, "s-rcfail", "rcfail@x")  # starts as analyst (migration 005)
    async with _client_as(["admin"], raise_app_exceptions=False) as client:
        resp = await client.patch(
            f"/api/admin/users/{uid}/role", json={"role": "manager"}
        )
    assert resp.status_code == 500
    async with migrated_db.acquire() as conn:
        u = await db_users.get_user_by_id(conn, uid)
    assert u.role_name == "analyst"  # role change rolled back with the audit failure
