"""
db/migrate.py — apply the baseline schema, seed data, and numbered migrations.

Strategy (ADR-0009 → numbered-SQL migrations, no Alembic):
- `schema.sql` and `seed.sql` are the *baseline*. They are written to be
  idempotent (CREATE TABLE IF NOT EXISTS / INSERT ... ON CONFLICT DO NOTHING),
  so they are safe to run on every startup.
- Everything after the baseline is a numbered file in `db/migrations/` (e.g.
  `002_authorization.sql`). Each is applied exactly once and recorded in the
  `schema_migrations` table so it never runs twice.

The whole run happens inside a single transaction guarded by a Postgres
*advisory lock*. An advisory lock is an application-defined mutex living in the
database: if two backend processes start at once, only one runs the migrations;
the other blocks, then finds them already applied and does nothing. This makes
startup safe even if it is ever run with multiple workers.
"""
from __future__ import annotations

import logging
from pathlib import Path

import asyncpg

logger = logging.getLogger(__name__)

_DB_DIR = Path(__file__).resolve().parent
_MIGRATIONS_DIR = _DB_DIR / "migrations"

# Arbitrary constant identifying *this* migration process to pg_advisory_lock.
# Any two processes using the same key serialise against each other.
_ADVISORY_LOCK_KEY = 823_140_002

_TRACKING_TABLE_DDL = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   TEXT        PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""


def _baseline_sql() -> tuple[str, str]:
    """Read the baseline schema and seed files from disk."""
    schema = (_DB_DIR / "schema.sql").read_text(encoding="utf-8")
    seed = (_DB_DIR / "seed.sql").read_text(encoding="utf-8")
    return schema, seed


def _pending_migration_files(applied: set[str]) -> list[Path]:
    """Numbered .sql files not yet recorded, in lexical (== numeric) order."""
    if not _MIGRATIONS_DIR.is_dir():
        return []
    return [p for p in sorted(_MIGRATIONS_DIR.glob("*.sql")) if p.name not in applied]


async def run_migrations(pool: asyncpg.Pool) -> list[str]:
    """Bring the database up to date. Returns migrations applied *this* run.

    Idempotent: a second call with no new migration files returns [] and makes
    no changes.
    """
    schema_sql, seed_sql = _baseline_sql()
    applied_now: list[str] = []

    async with pool.acquire() as conn:
        async with conn.transaction():
            # Serialise concurrent starters; released automatically at tx end.
            await conn.execute("SELECT pg_advisory_xact_lock($1)", _ADVISORY_LOCK_KEY)

            # Baseline — idempotent, run every startup.
            await conn.execute(schema_sql)
            await conn.execute(seed_sql)
            await conn.execute(_TRACKING_TABLE_DDL)

            already = {
                r["filename"]
                for r in await conn.fetch("SELECT filename FROM schema_migrations")
            }
            for path in _pending_migration_files(already):
                logger.info("Applying migration %s", path.name)
                await conn.execute(path.read_text(encoding="utf-8"))
                await conn.execute(
                    "INSERT INTO schema_migrations (filename) VALUES ($1)", path.name
                )
                applied_now.append(path.name)

    if applied_now:
        logger.info("Applied %d migration(s): %s", len(applied_now), applied_now)
    else:
        logger.info("Database schema already up to date.")
    return applied_now
