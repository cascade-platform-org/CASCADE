"""Integration tests for the database layer (db/pool.py, db/migrate.py).

These talk to a REAL PostgreSQL because asyncpg speaks the Postgres wire
protocol — there is no in-memory substitute. They are skipped unless
TEST_DATABASE_URL points at a throwaway database, e.g.:

    docker run -d --name cascade-test-pg -e POSTGRES_PASSWORD=pw \\
        -p 5433:5432 postgres:16
    TEST_DATABASE_URL=postgresql://postgres:pw@localhost:5433/postgres \\
        python -m pytest test/test_db.py

Each test runs against a freshly-wiped schema so they are order-independent.
"""
from __future__ import annotations

import pytest

from db import pool as db_pool
from db.migrate import run_migrations

# The `clean_db` fixture (in conftest.py) skips these when TEST_DATABASE_URL is
# unset, so no module-level skip is needed.


async def test_run_migrations_creates_core_tables(clean_db):
    applied = await run_migrations(clean_db)
    assert "002_authorization.sql" in applied

    async with clean_db.acquire() as conn:
        tables = {
            r["tablename"]
            for r in await conn.fetch(
                "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
            )
        }
    assert {
        "roles",
        "users",
        "projects",
        "audit_logs",
        "schema_migrations",
    } <= tables
    # role_permissions was dropped in migration 004 (the role→permission map
    # now lives in code, not the DB). Guard against it being reintroduced.
    assert "role_permissions" not in tables


async def test_seed_roles_present(clean_db):
    await run_migrations(clean_db)
    async with clean_db.acquire() as conn:
        names = {r["name"] for r in await conn.fetch("SELECT name FROM roles")}
    assert {"viewer", "analyst", "manager", "admin"} <= names


async def test_new_user_defaults_to_viewer(clean_db):
    """ADR-0010: a self-registered stranger must land at least privilege."""
    await run_migrations(clean_db)
    async with clean_db.acquire() as conn:
        await conn.execute(
            "INSERT INTO users (external_id, email) VALUES ($1, $2)",
            "sub-abc",
            "stranger@example.com",
        )
        role = await conn.fetchval(
            "SELECT role_name FROM users WHERE external_id = $1", "sub-abc"
        )
    assert role == "viewer"


async def test_entitlements_seeded(clean_db):
    """ADR-0008: each role carries max_nodes / evals_per_minute (NULL = unbounded)."""
    await run_migrations(clean_db)
    async with clean_db.acquire() as conn:
        rows = {
            r["name"]: (r["max_nodes"], r["evals_per_minute"])
            for r in await conn.fetch(
                "SELECT name, max_nodes, evals_per_minute FROM roles"
            )
        }
    # evals_per_minute recalibrated in migration 003 (ADR-0008) from measured cost.
    assert rows["viewer"] == (45, 10000)
    assert rows["analyst"] == (300, 5000)
    assert rows["manager"] == (300, 5000)
    assert rows["admin"] == (None, None)


async def test_migrations_are_idempotent(clean_db):
    first = await run_migrations(clean_db)
    second = await run_migrations(clean_db)

    assert "002_authorization.sql" in first
    assert second == []  # nothing new on the second pass

    async with clean_db.acquire() as conn:
        count = await conn.fetchval(
            "SELECT count(*) FROM schema_migrations WHERE filename = $1",
            "002_authorization.sql",
        )
    assert count == 1  # recorded exactly once


async def test_get_pool_raises_when_disconnected():
    await db_pool.disconnect()
    with pytest.raises(RuntimeError):
        db_pool.get_pool()
