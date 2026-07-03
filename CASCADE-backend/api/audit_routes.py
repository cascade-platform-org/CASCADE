"""
api/audit_routes.py — client-side activity log uploads (opt-in).

Stores action metadata only (action type, timestamps, counts) in the
`activity_log_uploads` table — never raw graph data (ADR-0007 persistence
boundary applies to this path too).
"""
from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, status

from auth.dependencies import require_permission
from db.pool import DBConn, get_connection
from schemas.audit import ActivityLogUpload
from schemas.auth import AuthUser

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/audit", tags=["audit"])

_MAX_ENTRIES_PER_UPLOAD = 1_000


@router.post(
    "/activity",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Upload client-side activity log",
    description=(
        "Accepts a batch of client-side activity log entries and stores them "
        "server-side. Requires can_sync permission. No raw graph data is "
        "accepted — only action metadata (action type, timestamps, counts)."
    ),
)
async def upload_activity_log(
    body: ActivityLogUpload,
    user: AuthUser = Depends(require_permission("can_sync")),
    conn: DBConn = Depends(get_connection),
) -> dict:
    if len(body.entries) > _MAX_ENTRIES_PER_UPLOAD:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Too many entries. Maximum per upload: {_MAX_ENTRIES_PER_UPLOAD}.",
        )
    if not body.entries:
        return {"ok": True, "accepted": 0}
    if user.db_id is None:
        # Local-only mode has no users table to attach the upload to.
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="Activity upload requires a database (not available in local-only mode).",
        )

    await conn.execute(
        """
        INSERT INTO activity_log_uploads (user_id, session_id, app_version, entries)
        VALUES ($1::uuid, $2::uuid, $3, $4::jsonb)
        """,
        user.db_id,
        body.entries[0].session_id,
        body.app_version,
        json.dumps([e.model_dump() for e in body.entries]),
    )
    return {"ok": True, "accepted": len(body.entries)}
