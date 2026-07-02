"""
db/users.py — data-access for the `users` table (authorization source of truth).

Per ADR-0010 the identity provider only authenticates; a user's *role* lives
here. These are thin functions over asyncpg — no business logic — so the auth
layer and admin routes share one place that knows the SQL.
"""
from __future__ import annotations

import logging
import uuid
from typing import Optional

import asyncpg

from auth.models import DBUser

logger = logging.getLogger(__name__)

# Every query returns the same column shape so one row-mapper covers them all.
_USER_COLUMNS = "id::text AS id, external_id, email, name, role_name"


def _row_to_user(row: asyncpg.Record) -> DBUser:
    return DBUser(
        id=row["id"],
        external_id=row["external_id"],
        email=row["email"],
        name=row["name"],
        role_name=row["role_name"],
    )


async def get_user_by_external_id(
    conn: asyncpg.Connection, external_id: str
) -> Optional[DBUser]:
    row = await conn.fetchrow(
        f"SELECT {_USER_COLUMNS} FROM users WHERE external_id = $1", external_id
    )
    return _row_to_user(row) if row else None


async def get_user_by_id(
    conn: asyncpg.Connection, user_id: str
) -> Optional[DBUser]:
    """Fetch by primary key. Returns None if the id is malformed or not found."""
    try:
        uuid.UUID(user_id)
    except ValueError:
        return None
    row = await conn.fetchrow(
        f"SELECT {_USER_COLUMNS} FROM users WHERE id = $1::uuid", user_id
    )
    return _row_to_user(row) if row else None


async def upsert_user(
    conn: asyncpg.Connection,
    *,
    external_id: str,
    email: str,
    name: Optional[str],
) -> DBUser:
    """Insert the user on first sight, or refresh email/name on return visits.

    Identity is the OIDC `sub` (external_id); email is secondary. Behaviour:
    - First login: INSERT with the default role (`viewer`, migration 002).
    - Returning login, profile unchanged: NO write — return the stored row.
      (Avoids a user-row UPDATE on every request, which would otherwise hammer
      one row during a client-driven model-based analysis.)
    - Returning login, email/name changed: UPDATE those columns only. The role
      is never touched, so an admin's assignment survives.
    - Email now collides with a *different* account: keep the stored record
      rather than raising — a stale email must never lock a user out.
    """
    existing = await get_user_by_external_id(conn, external_id)

    if existing is None:
        try:
            row = await conn.fetchrow(
                f"""
                INSERT INTO users (external_id, email, name)
                VALUES ($1, $2, $3)
                RETURNING {_USER_COLUMNS}
                """,
                external_id,
                email,
                name,
            )
            return _row_to_user(row)
        except asyncpg.UniqueViolationError:
            # Lost a first-login race (external_id now exists) -> use that row.
            raced = await get_user_by_external_id(conn, external_id)
            if raced is not None:
                return raced
            # Otherwise the email belongs to another account; genuinely cannot
            # create a second account with a duplicate email.
            raise

    # Returning user — skip the write entirely when nothing changed.
    if existing.email == email and existing.name == name:
        return existing

    try:
        row = await conn.fetchrow(
            f"""
            UPDATE users
               SET email = $2, name = $3, updated_at = now()
             WHERE external_id = $1
            RETURNING {_USER_COLUMNS}
            """,
            external_id,
            email,
            name,
        )
        return _row_to_user(row)
    except asyncpg.UniqueViolationError:
        logger.warning(
            "Email %r for user %s collides with another account; keeping the "
            "stored email to avoid a lockout.",
            email,
            external_id,
        )
        return existing


async def list_users(conn: asyncpg.Connection) -> list[DBUser]:
    rows = await conn.fetch(
        f"SELECT {_USER_COLUMNS} FROM users ORDER BY created_at DESC"
    )
    return [_row_to_user(r) for r in rows]


async def delete_user(conn: asyncpg.Connection, user_id: str) -> Optional[DBUser]:
    """Delete by primary key. Returns the deleted row, or None if id is
    malformed / not found. FK cascades remove the user's owned rows; audit_logs
    keep the trail (ON DELETE SET NULL)."""
    try:
        uuid.UUID(user_id)
    except ValueError:
        return None
    row = await conn.fetchrow(
        f"DELETE FROM users WHERE id = $1::uuid RETURNING {_USER_COLUMNS}", user_id
    )
    return _row_to_user(row) if row else None


async def delete_user_by_external_id(
    conn: asyncpg.Connection, external_id: str
) -> Optional[DBUser]:
    """Delete by OIDC subject (used for self-service erasure)."""
    row = await conn.fetchrow(
        f"DELETE FROM users WHERE external_id = $1 RETURNING {_USER_COLUMNS}",
        external_id,
    )
    return _row_to_user(row) if row else None


async def get_role_entitlement(
    conn: asyncpg.Connection, role_name: str
) -> tuple[Optional[int], Optional[int]]:
    """Return (max_nodes, evals_per_minute) for a role; (None, None) if unknown.

    NULL columns mean "unbounded" (ADR-0008), so a missing role and an
    unbounded role both surface as (None, None) — safe either way because the
    caller treats None as no limit only for known privileged roles; an unknown
    role would already have failed the RBAC check.
    """
    row = await conn.fetchrow(
        "SELECT max_nodes, evals_per_minute FROM roles WHERE name = $1", role_name
    )
    if row is None:
        return None, None
    return row["max_nodes"], row["evals_per_minute"]


async def set_user_role(
    conn: asyncpg.Connection, user_id: str, role_name: str
) -> Optional[DBUser]:
    """Set a user's role. Returns None if the id is malformed or not found."""
    try:
        uuid.UUID(user_id)  # reject garbage before it reaches Postgres
    except ValueError:
        return None

    row = await conn.fetchrow(
        f"""
        UPDATE users
           SET role_name = $2, updated_at = now()
         WHERE id = $1::uuid
        RETURNING {_USER_COLUMNS}
        """,
        user_id,
        role_name,
    )
    return _row_to_user(row) if row else None
