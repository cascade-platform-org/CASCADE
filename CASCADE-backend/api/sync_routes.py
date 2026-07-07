"""
api/sync_routes.py — Server Sync (requirements.md §13.4, opt-in, can_sync only).

POST   /api/projects       — save a new version (never overwrites; see db/projects.py)
GET    /api/projects       — list this user's saved versions (no bundle data)
GET    /api/projects/{id}  — fetch one version's full bundle (for Load)
DELETE /api/projects/{id}  — delete one version

Everything here is owner-scoped: a user only ever sees their own projects.
This is a stronger boundary than the Analysis Log (ADR-0007) — that log is
operator-only metadata; this is the user's actual network data, opted into
Sync, and nobody else (not even another user's admin role) reads it back.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from auth.dependencies import require_permission
from db import projects as db_projects
from db.pool import DBConn, get_connection
from schemas.auth import AuthUser
from schemas.sync import ProjectVersionDetail, ProjectVersionSummary, SaveProjectRequest

router = APIRouter(prefix="/api/projects", tags=["sync"])


def _require_db_id(user: AuthUser) -> str:
    """Local-only mode has no users table row to attach a save to — same
    guard shape as api/audit_routes.py's can_sync path."""
    if user.db_id is None:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="Server Sync requires a database (not available in local-only mode).",
        )
    return user.db_id


@router.post("", response_model=ProjectVersionSummary, summary="Save a new project version")
async def save_project(
    body: SaveProjectRequest,
    conn: DBConn = Depends(get_connection),
    user: AuthUser = Depends(require_permission("can_sync")),
) -> ProjectVersionSummary:
    owner_id = _require_db_id(user)
    return await db_projects.save_version(
        conn, owner_id=owner_id, name=body.name, description=body.description, data=body.data
    )


@router.get("", response_model=list[ProjectVersionSummary], summary="List my saved versions")
async def list_projects(
    conn: DBConn = Depends(get_connection),
    user: AuthUser = Depends(require_permission("can_sync")),
) -> list[ProjectVersionSummary]:
    owner_id = _require_db_id(user)
    return await db_projects.list_versions(conn, owner_id=owner_id)


@router.get(
    "/{version_id}",
    response_model=ProjectVersionDetail,
    # Serialise the bundle null-free so it round-trips the *identical* shape the
    # frontend produces on a local save (JSON.stringify drops `undefined` keys).
    # Pydantic otherwise emits every unset Optional as explicit `null`, which the
    # frontend Zod schema's `.optional()` fields reject on Load. See §13.4.
    response_model_exclude_none=True,
    summary="Load one saved version",
)
async def get_project(
    version_id: str,
    conn: DBConn = Depends(get_connection),
    user: AuthUser = Depends(require_permission("can_sync")),
) -> ProjectVersionDetail:
    owner_id = _require_db_id(user)
    version = await db_projects.get_version(conn, owner_id=owner_id, version_id=version_id)
    if version is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"No saved version '{version_id}'."
        )
    return version


@router.delete(
    "/{version_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete one saved version"
)
async def delete_project(
    version_id: str,
    conn: DBConn = Depends(get_connection),
    user: AuthUser = Depends(require_permission("can_sync")),
) -> None:
    owner_id = _require_db_id(user)
    deleted = await db_projects.delete_version(conn, owner_id=owner_id, version_id=version_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"No saved version '{version_id}'."
        )
