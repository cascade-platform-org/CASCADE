"""Tests for db/users.py — the users table data-access (ADR-0010)."""
from __future__ import annotations

from db import users as db_users


async def test_upsert_new_user_defaults_to_viewer(migrated_db):
    async with migrated_db.acquire() as conn:
        user = await db_users.upsert_user(
            conn, external_id="sub-1", email="a@example.com", name="Ada"
        )
    assert user.role_name == "viewer"  # least privilege by default
    assert user.email == "a@example.com"
    assert user.external_id == "sub-1"


async def test_upsert_returning_user_keeps_role_and_updates_profile(migrated_db):
    async with migrated_db.acquire() as conn:
        first = await db_users.upsert_user(
            conn, external_id="sub-2", email="old@example.com", name="Old"
        )
        # An admin promotes them...
        await db_users.set_user_role(conn, first.id, "analyst")
        # ...then they log in again with a changed email/name.
        again = await db_users.upsert_user(
            conn, external_id="sub-2", email="new@example.com", name="New"
        )
    assert again.id == first.id            # same user
    assert again.role_name == "analyst"    # role preserved across logins
    assert again.email == "new@example.com"  # profile refreshed
    assert again.name == "New"


async def test_list_users_orders_newest_first(migrated_db):
    async with migrated_db.acquire() as conn:
        await db_users.upsert_user(conn, external_id="s-a", email="a@x", name="A")
        await db_users.upsert_user(conn, external_id="s-b", email="b@x", name="B")
        users = await db_users.list_users(conn)
    externals = [u.external_id for u in users]
    assert externals[:2] == ["s-b", "s-a"]  # most recent first


async def test_set_user_role_updates(migrated_db):
    async with migrated_db.acquire() as conn:
        u = await db_users.upsert_user(conn, external_id="s-c", email="c@x", name="C")
        updated = await db_users.set_user_role(conn, u.id, "manager")
    assert updated is not None
    assert updated.role_name == "manager"


async def test_set_user_role_unknown_id_returns_none(migrated_db):
    async with migrated_db.acquire() as conn:
        # Well-formed UUID that doesn't exist.
        result = await db_users.set_user_role(
            conn, "00000000-0000-0000-0000-000000000000", "analyst"
        )
    assert result is None


async def test_set_user_role_malformed_id_returns_none(migrated_db):
    async with migrated_db.acquire() as conn:
        result = await db_users.set_user_role(conn, "not-a-uuid", "analyst")
    assert result is None  # rejected before hitting Postgres


async def test_upsert_noop_does_not_write(migrated_db):
    """A returning user with an unchanged profile must not trigger a row write."""
    async with migrated_db.acquire() as conn:
        u = await db_users.upsert_user(
            conn, external_id="s-noop", email="n@x", name="N"
        )
        before = await conn.fetchval(
            "SELECT updated_at FROM users WHERE external_id = $1", "s-noop"
        )
        again = await db_users.upsert_user(
            conn, external_id="s-noop", email="n@x", name="N"
        )
        after = await conn.fetchval(
            "SELECT updated_at FROM users WHERE external_id = $1", "s-noop"
        )
    assert again.id == u.id
    assert after == before  # updated_at unchanged => no UPDATE was issued


async def test_upsert_profile_change_writes(migrated_db):
    async with migrated_db.acquire() as conn:
        await db_users.upsert_user(conn, external_id="s-chg", email="a@x", name="A")
        changed = await db_users.upsert_user(
            conn, external_id="s-chg", email="b@x", name="A"
        )
    assert changed.email == "b@x"  # email refreshed on change


async def test_upsert_email_collision_keeps_existing(migrated_db):
    """A returning user whose email now collides must not be locked out."""
    async with migrated_db.acquire() as conn:
        await db_users.upsert_user(
            conn, external_id="s-A", email="taken@x", name="A"
        )
        b = await db_users.upsert_user(
            conn, external_id="s-B", email="bmail@x", name="B"
        )
        # B's IdP email changes to one already owned by A.
        result = await db_users.upsert_user(
            conn, external_id="s-B", email="taken@x", name="B"
        )
    assert result.id == b.id
    assert result.email == "bmail@x"  # stored (non-colliding) email retained
