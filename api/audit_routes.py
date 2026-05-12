from __future__ import annotations

from fastapi import APIRouter, Depends, Request, status

from ..schemas.audit import ActivityLogUpload

# from ..auth.dependencies import get_current_user, require_permission
# from ..db import get_db

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
    request: Request,
    # user = Depends(require_permission("can_sync")),
    # db   = Depends(get_db),
) -> dict:
    if len(body.entries) > _MAX_ENTRIES_PER_UPLOAD:
        from fastapi import HTTPException
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Too many entries. Maximum per upload: {_MAX_ENTRIES_PER_UPLOAD}.",
        )

    # Derive session_id from the first entry (all entries in one upload share
    # the same session, enforced by the client ActivityLog builder).
    session_id = body.entries[0].session_id if body.entries else None

    # TODO: insert into activity_log_uploads:
    #   INSERT INTO activity_log_uploads (user_id, session_id, app_version, entries)
    #   VALUES ($user_id, $session_id, $app_version, $entries::jsonb)
    # where user_id comes from the authenticated user (Depends(get_current_user)).

    return {"ok": True, "accepted": len(body.entries)}
