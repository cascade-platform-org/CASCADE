"""
db/agent_tokens.py — personal tokens for the Agent Bridge (ADR-0024).

A token is `cas_` + 32 random bytes (URL-safe base64). Only its SHA-256 is
stored, so a database leak does not hand out working tokens; the plaintext is
returned once, by `create_token`. Everything is owner-scoped.
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from db.pool import DBConn
from schemas.agent import AgentToken

TOKEN_PREFIX = "cas_"  # nosec B105 — the public prefix that marks a CASCADE token, not a secret
TOKEN_LIFETIME = timedelta(days=30)

_COLUMNS = "id::text AS id, name, created_at, last_used_at, expires_at"


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_token() -> str:
    return TOKEN_PREFIX + secrets.token_urlsafe(32)


def _row(row) -> AgentToken:
    return AgentToken(
        id=row["id"],
        name=row["name"],
        created_at=row["created_at"],
        last_used_at=row["last_used_at"],
        expires_at=row["expires_at"],
    )


async def create_token(conn: DBConn, *, owner_id: str, name: str) -> tuple[AgentToken, str]:
    """A new token for `owner_id`: its record, and the plaintext (shown once)."""
    token = new_token()
    row = await conn.fetchrow(
        f"""
        INSERT INTO agent_tokens (owner_id, name, token_hash, expires_at)
        VALUES ($1::uuid, $2, $3, $4)
        RETURNING {_COLUMNS}
        """,  # nosec B608
        owner_id,
        name,
        hash_token(token),
        datetime.now(timezone.utc) + TOKEN_LIFETIME,
    )
    return _row(row), token


async def list_tokens(conn: DBConn, *, owner_id: str) -> list[AgentToken]:
    rows = await conn.fetch(
        f"SELECT {_COLUMNS} FROM agent_tokens WHERE owner_id = $1::uuid ORDER BY created_at",  # nosec B608
        owner_id,
    )
    return [_row(r) for r in rows]


async def delete_token(conn: DBConn, *, owner_id: str, token_id: str) -> bool:
    result = await conn.execute(
        "DELETE FROM agent_tokens WHERE id = $1::uuid AND owner_id = $2::uuid",
        token_id,
        owner_id,
    )
    return result.endswith(" 1")


async def owner_of(conn: DBConn, token: str) -> Optional[tuple[str, str]]:
    """The (owner id, token name) of a live token, recording its use; None when unknown or expired."""
    row = await conn.fetchrow(
        """
        UPDATE agent_tokens SET last_used_at = now()
        WHERE token_hash = $1 AND expires_at > now()
        RETURNING owner_id::text AS owner_id, name
        """,
        hash_token(token),
    )
    return (row["owner_id"], row["name"]) if row else None
