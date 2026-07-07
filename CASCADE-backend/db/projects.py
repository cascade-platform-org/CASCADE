"""
db/projects.py — Server Sync data access (the `projects` table).

Every explicit save is a NEW row (requirements.md §13.4: "version list is
accessible across devices"), never an overwrite — mirrors the existing local
save-history convention (lib/file-io.ts, MAX_HISTORY = 10) exactly: after each
save, older versions past the cap for that (owner, name) pair are pruned
automatically rather than rejecting the save with a quota error.
"""
from __future__ import annotations

import json
from typing import Optional

from db.pool import DBConn
from schemas.sync import ProjectBundle, ProjectVersionDetail, ProjectVersionSummary

# Matches lib/file-io.ts's MAX_HISTORY for the equivalent local convention —
# one number the user experiences consistently whether saving locally or synced.
MAX_VERSIONS_PER_NAME = 10

_SUMMARY_COLUMNS = "id::text AS id, name, description, created_at, updated_at"


def _row_to_summary(row) -> ProjectVersionSummary:
    return ProjectVersionSummary(
        id=row["id"],
        name=row["name"],
        description=row["description"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


async def save_version(
    conn: DBConn,
    *,
    owner_id: str,
    name: str,
    description: Optional[str],
    data: ProjectBundle,
) -> ProjectVersionSummary:
    """Insert a new version, then prune old versions of the same name past
    MAX_VERSIONS_PER_NAME (oldest first) — same policy as the local history."""
    row = await conn.fetchrow(
        f"""
        INSERT INTO projects (owner_id, name, description, data)
        VALUES ($1::uuid, $2, $3, $4::jsonb)
        RETURNING {_SUMMARY_COLUMNS}
        """,  # nosec B608
        owner_id,
        name,
        description,
        data.model_dump_json(),
    )
    await conn.execute(
        """
        DELETE FROM projects
         WHERE id IN (
            SELECT id FROM projects
             WHERE owner_id = $1::uuid AND name = $2
             ORDER BY created_at DESC
             OFFSET $3
         )
        """,
        owner_id,
        name,
        MAX_VERSIONS_PER_NAME,
    )
    return _row_to_summary(row)


async def list_versions(conn: DBConn, *, owner_id: str) -> list[ProjectVersionSummary]:
    """All saved versions for this user, newest first. No bundle data (kept
    small — a user's synced history is meant to be listed, not downloaded, in
    one call)."""
    rows = await conn.fetch(
        f"""
        SELECT {_SUMMARY_COLUMNS} FROM projects
         WHERE owner_id = $1::uuid
         ORDER BY created_at DESC
        """,  # nosec B608
        owner_id,
    )
    return [_row_to_summary(r) for r in rows]


async def get_version(
    conn: DBConn, *, owner_id: str, version_id: str
) -> Optional[ProjectVersionDetail]:
    """Fetch one version's full bundle. Owner-scoped — returns None (not a
    403) for another user's version, so existence is never leaked."""
    row = await conn.fetchrow(
        f"""
        SELECT {_SUMMARY_COLUMNS}, data FROM projects
         WHERE id = $1::uuid AND owner_id = $2::uuid
        """,  # nosec B608
        version_id,
        owner_id,
    )
    if row is None:
        return None
    return ProjectVersionDetail(
        id=row["id"],
        name=row["name"],
        description=row["description"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        data=ProjectBundle.model_validate(json.loads(row["data"])),
    )


async def delete_version(conn: DBConn, *, owner_id: str, version_id: str) -> bool:
    """Owner-scoped delete. Returns whether a row was actually removed."""
    result = await conn.execute(
        "DELETE FROM projects WHERE id = $1::uuid AND owner_id = $2::uuid",
        version_id,
        owner_id,
    )
    return result != "DELETE 0"
