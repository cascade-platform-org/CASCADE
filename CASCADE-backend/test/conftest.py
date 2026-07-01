"""Shared pytest fixtures for the CASCADE backend test suite."""
from __future__ import annotations

import os

import pytest

from config import get_settings

TEST_DB_URL = os.environ.get("TEST_DATABASE_URL")


@pytest.fixture(autouse=True)
def _clear_settings_cache() -> None:
    """Clear the get_settings() lru_cache before every test.

    get_settings() is cached so the Settings object is built once per process.
    Without this fixture, any test (or import-time side effect from importing
    main.py) that populates the cache poisons the environment for subsequent
    tests that monkeypatch env vars and call get_settings() expecting fresh
    values. The fixture runs automatically for every test in the suite.
    """
    get_settings.cache_clear()


@pytest.fixture
async def clean_db(monkeypatch):
    """A connected asyncpg pool over a freshly-wiped `public` schema.

    Skips when TEST_DATABASE_URL is unset. Each test gets an empty schema so
    the DB tests are order-independent.
    """
    if not TEST_DB_URL:
        pytest.skip("TEST_DATABASE_URL not set; skipping database test")

    from db import pool as db_pool

    monkeypatch.setenv("DATABASE_URL", TEST_DB_URL)
    get_settings.cache_clear()  # pick up the patched DATABASE_URL

    await db_pool.disconnect()  # drop any singleton left by a previous test
    pool = await db_pool.connect()
    async with pool.acquire() as conn:
        await conn.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    try:
        yield pool
    finally:
        await db_pool.disconnect()


@pytest.fixture
async def migrated_db(clean_db):
    """Like `clean_db`, but with the schema + seed + migrations applied."""
    from db.migrate import run_migrations

    await run_migrations(clean_db)
    return clean_db
