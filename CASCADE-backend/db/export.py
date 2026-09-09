"""
db/export.py — gather everything the server holds about one user.

Backs the GDPR right of access (Art. 15) and data portability (Art. 20): one
machine-readable JSON document per data subject, assembled in one place so the
answer to "what do you store about me?" cannot drift from what the tables
actually hold.

Rule for extending this: every table that carries a `user_id` (or otherwise
identifies a person) must appear here. If you add such a table and do not add it
to `export_user_data`, the export silently under-reports and the compliance
claim in docs/project/privacy-and-data-protection.md stops being true.
"""
from __future__ import annotations

import json
from typing import Any

from db.pool import DBConn


def _row(record: Any, *json_columns: str) -> dict[str, Any]:
    """asyncpg.Record -> dict, decoding the named JSONB columns.

    asyncpg hands JSONB back as a *string* unless a codec is registered (see
    db/projects.py, which json.loads for the same reason). Without this the
    export would nest escaped JSON inside JSON — readable by a human, but not
    the machine-readable form Art. 20 asks for.
    """
    out = dict(record)
    for column in json_columns:
        value = out.get(column)
        if isinstance(value, str):
            try:
                out[column] = json.loads(value)
            except json.JSONDecodeError:
                # Keep the raw text rather than dropping data from a rights
                # request; a malformed row is still the subject's data.
                pass
    return out


async def export_user_data(conn: DBConn, *, user_id: str, external_id: str) -> dict[str, Any]:
    """Return every server-side record tied to this user, as JSON-ready dicts.

    Ordered oldest-first within each section so the document reads as a history.
    Values come straight from the tables — no summarising, because a summary is
    not what Art. 15 asks for.
    """
    account = await conn.fetchrow(
        """
        SELECT id::text, external_id, email, name, role_name,
               created_at, updated_at
        FROM users WHERE id = $1::uuid
        """,
        user_id,
    )

    projects = await conn.fetch(
        """
        SELECT id::text, name, description, data, created_at, updated_at
        FROM projects WHERE owner_id = $1::uuid ORDER BY created_at
        """,
        user_id,
    )

    # Actions this user PERFORMED.
    audit = await conn.fetch(
        """
        SELECT id::text, action, details, occurred_at
        FROM audit_logs WHERE user_id = $1::uuid ORDER BY occurred_at
        """,
        user_id,
    )

    # Actions performed ON this user (an admin changing their role). These are
    # the subject's personal data too, so Art. 15 covers them — but the row also
    # names the ADMIN who acted, and Art. 15(4) says access must not adversely
    # affect the rights of others. So the actor's identity (user_id, user_email)
    # is deliberately not selected: the subject learns what happened to their
    # account, not who to go and confront.
    audit_about = await conn.fetch(
        """
        SELECT id::text, action, details, occurred_at
        FROM audit_logs
        WHERE details ->> 'target_user_id' = $1
          AND (user_id IS DISTINCT FROM $1::uuid)
        ORDER BY occurred_at
        """,
        user_id,
    )

    analysis = await conn.fetch(
        """
        SELECT id::text, role_name, scope, node_count, edge_count, canvas_count,
               category_names, functionality_scale_n, event_definition_count,
               rule_count, graph_types, engine_version, compute_time_ms,
               occurred_at
        FROM analysis_logs WHERE user_id = $1::uuid ORDER BY occurred_at
        """,
        user_id,
    )

    activity = await conn.fetch(
        """
        SELECT id::text, session_id::text, app_version, entries, uploaded_at
        FROM activity_log_uploads WHERE user_id = $1::uuid ORDER BY uploaded_at
        """,
        user_id,
    )

    return {
        # What the export is, so the file is self-describing when opened months
        # later or handed to another controller (Art. 20 portability).
        "export_format": "cascade.user-data-export.v1",
        "subject": {"user_id": user_id, "external_id": external_id},
        "note": (
            "Identity data (login credentials, email verification state, sign-in "
            "history) lives in the identity provider, not here — request it there. "
            "Project graphs are local-first: only versions you explicitly synced "
            "appear below."
        ),
        "account": dict(account) if account else None,
        "synced_projects": [_row(r, "data") for r in projects],
        "audit_entries": [_row(r, "details") for r in audit],
        "audit_entries_about_me": [_row(r, "details") for r in audit_about],
        "analysis_runs": [dict(r) for r in analysis],
        "activity_uploads": [_row(r, "entries") for r in activity],
    }
