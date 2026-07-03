"""
db/pool.py — process-wide asyncpg connection pool lifecycle.

A connection *pool* is a small set of already-open database connections that
requests borrow and return, instead of paying the cost of opening a fresh TCP +
auth handshake on every query. The pool is created once at application startup
(see main.lifespan) and closed at shutdown.

Only identity / RBAC data lives in this database (ADR-0007 persistence boundary);
project graphs are local-first and never stored here unless the user opts into
Sync (deferred for v1).
"""
from __future__ import annotations

import logging
from typing import AsyncIterator, Optional, Union

import asyncpg

from config import get_settings

# What `pool.acquire()` actually yields (a PoolConnectionProxy, which proxies
# every Connection method via __getattr__ at runtime) is not a subtype of
# Connection in asyncpg's type stubs. Every route/repo function that receives
# a request-scoped connection via Depends(get_connection) should type its
# parameter as DBConn, not bare asyncpg.Connection, to match what is actually
# passed at runtime.
DBConn = Union[asyncpg.Connection, asyncpg.pool.PoolConnectionProxy]

logger = logging.getLogger(__name__)

# Module-level singleton. There is exactly one pool per process; every request
# acquires a connection from it and releases it back.
_pool: Optional[asyncpg.Pool] = None


async def connect() -> asyncpg.Pool:
    """Create the pool (idempotent). Requires DATABASE_URL to be set.

    Returns the existing pool if already connected, so calling this twice is
    harmless.
    """
    global _pool
    if _pool is not None:
        return _pool

    settings = get_settings()
    if not settings.database_url:
        raise RuntimeError(
            "DATABASE_URL is not set; cannot create a database connection pool."
        )

    _pool = await asyncpg.create_pool(
        dsn=settings.database_url,
        min_size=1,
        max_size=10,
        # Fail fast if the DB is unreachable rather than hanging a request.
        command_timeout=30,
    )
    logger.info("Database connection pool created.")
    return _pool


async def disconnect() -> None:
    """Close the pool and drop the singleton (idempotent)."""
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
        logger.info("Database connection pool closed.")


def is_connected() -> bool:
    """True when the pool has been created and not yet closed."""
    return _pool is not None


def get_pool() -> asyncpg.Pool:
    """Return the live pool, or raise if startup hasn't created it.

    Routes should depend on `get_connection` (below) rather than calling this
    directly; this exists for startup code and tests.
    """
    if _pool is None:
        raise RuntimeError(
            "Database pool is not initialised. Is DATABASE_URL set and has "
            "application startup completed?"
        )
    return _pool


async def get_connection() -> AsyncIterator[DBConn]:
    """FastAPI dependency: borrow a connection for the lifetime of one request.

    Usage:
        @router.get("/thing")
        async def route(conn = Depends(get_connection)):
            row = await conn.fetchrow("SELECT ...")
    """
    pool = get_pool()
    async with pool.acquire() as conn:
        yield conn
