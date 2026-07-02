"""
db/audit.py — append-only accountability trail (the `audit_logs` table).

This is the "who did what" record for sensitive actions (role changes, account
deletion). It is distinct from the Analysis Log (engine run metadata) and from
application logs. Rows are never updated or deleted; `user_email` is denormalised
so the trail survives the actor's own deletion.
"""
from __future__ import annotations

import json
from typing import Any, Optional

import asyncpg


async def record(
    conn: asyncpg.Connection,
    *,
    action: str,
    user_email: Optional[str],
    user_id: Optional[str] = None,
    details: Optional[dict[str, Any]] = None,
) -> None:
    """Append one audit entry. `action` e.g. 'role_change', 'account_delete'."""
    await conn.execute(
        """
        INSERT INTO audit_logs (user_id, user_email, action, details)
        VALUES ($1::uuid, $2, $3, $4::jsonb)
        """,
        user_id,
        user_email,
        action,
        json.dumps(details or {}),
    )
