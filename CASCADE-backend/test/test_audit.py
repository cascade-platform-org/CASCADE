"""Tests for the audit trail (db/audit.py)."""
from __future__ import annotations

import json

from db import audit as db_audit


async def test_record_appends_entry(migrated_db):
    async with migrated_db.acquire() as conn:
        await db_audit.record(
            conn,
            action="role_change",
            user_email="actor@x",
            details={"old_role": "viewer", "new_role": "analyst"},
        )
        rows = await conn.fetch(
            "SELECT action, user_email, details FROM audit_logs"
        )
    assert len(rows) == 1
    assert rows[0]["action"] == "role_change"
    assert rows[0]["user_email"] == "actor@x"
    assert json.loads(rows[0]["details"])["new_role"] == "analyst"


async def test_record_allows_null_user_id_and_empty_details(migrated_db):
    async with migrated_db.acquire() as conn:
        await db_audit.record(conn, action="account_delete", user_email=None)
        row = await conn.fetchrow(
            "SELECT user_id, user_email, details FROM audit_logs"
        )
    assert row["user_id"] is None
    assert row["user_email"] is None
    assert json.loads(row["details"]) == {}
