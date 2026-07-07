"""
api/admin_routes.py — User and role management (requires can_manage_users / can_admin).

Backed by the `users` table via db/users.py (ADR-0010: roles live in our DB).
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from auth.dependencies import require_permission
from auth.idp import IdPDeletionError, delete_idp_user
from auth.rbac import ROLE_PERMISSIONS, has_permission
from db import audit as db_audit
from db import users as db_users
from db.pool import DBConn, get_connection
from schemas.auth import AuthUser

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin"])


class UserSummary(BaseModel):
    id: str
    email: str
    display_name: str
    role: str


class RoleSummary(BaseModel):
    name: str
    permissions: list[str]


class RoleAssignment(BaseModel):
    role: str


@router.get(
    "/users",
    response_model=list[UserSummary],
    summary="List users",
)
async def list_users(
    conn: DBConn = Depends(get_connection),
    actor: AuthUser = Depends(require_permission("can_manage_users")),
) -> list[UserSummary]:
    users = await db_users.list_users(conn)
    return [
        UserSummary(
            id=u.id, email=u.email or "", display_name=u.name or "", role=u.role_name
        )
        for u in users
    ]


@router.patch(
    "/users/{user_id}/role",
    response_model=UserSummary,
    summary="Assign a role to a user",
)
async def assign_role(
    user_id: str,
    body: RoleAssignment,
    conn: DBConn = Depends(get_connection),
    actor: AuthUser = Depends(require_permission("can_manage_users")),
) -> UserSummary:
    if body.role not in ROLE_PERMISSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown role '{body.role}'. Valid: {sorted(ROLE_PERMISSIONS)}",
        )

    target = await db_users.get_user_by_id(conn, user_id)
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No user with id '{user_id}'.",
        )

    # Self-lockout guard: an admin demoting THEIR OWN account (e.g. the only
    # admin clicking their own row) leaves nothing in the UI able to grant
    # admin back — the escalation guard below requires can_admin, which they
    # just gave up. Recovery would need SSH + scripts/create_admin.py. Refuse
    # outright: changing your own role is not this route's job (this incident
    # happened in production before this guard existed).
    if target.external_id == actor.sub:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot change your own role. Ask another admin, or use "
            "scripts/create_admin.py if none remain.",
        )

    # Escalation guard: any change that grants OR removes 'admin' requires admin
    # privileges. Otherwise a manager could mint admins, or strip every existing
    # admin (locking out the admin tier, since managers cannot restore it).
    touches_admin = body.role == "admin" or target.role_name == "admin"
    if touches_admin and not has_permission(actor.roles, "can_admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Granting or removing the 'admin' role requires admin privileges.",
        )

    # Action + audit in one transaction so a change is never left unaudited.
    async with conn.transaction():
        updated = await db_users.set_user_role(conn, user_id, body.role)
        if updated is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"No user with id '{user_id}'.",
            )
        await db_audit.record(
            conn,
            action="role_change",
            user_email=actor.email,
            details={
                "target_user_id": user_id,
                "target_email": updated.email,
                "old_role": target.role_name,
                "new_role": updated.role_name,
            },
        )
    return UserSummary(
        id=updated.id,
        email=updated.email or "",
        display_name=updated.name or "",
        role=updated.role_name,
    )


@router.delete(
    "/users/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a user (account erasure)",
)
async def delete_user(
    user_id: str,
    conn: DBConn = Depends(get_connection),
    actor: AuthUser = Depends(require_permission("can_manage_users")),
) -> None:
    target = await db_users.get_user_by_id(conn, user_id)
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No user with id '{user_id}'.",
        )
    # Self-deletion has its own dedicated, self-service route (DELETE
    # /api/auth/me) with its own audit trail (self=True). This admin route is
    # for acting on OTHERS; the same self-lockout reasoning as assign_role
    # applies (an only-admin deleting themselves here leaves no one to recover
    # the account, and no admin to grant a fresh one).
    if target.external_id == actor.sub:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Use 'Delete account' in your own profile menu to delete "
            "your own account, not this admin route.",
        )
    # Same escalation guard as role changes: removing an admin needs admin.
    if target.role_name == "admin" and not has_permission(actor.roles, "can_admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Deleting an 'admin' user requires admin privileges.",
        )

    # Erase in the IdP first (prevents re-registration on next login). If that
    # fails, abort BEFORE touching the app DB so erasure stays all-or-nothing.
    try:
        await delete_idp_user(target.external_id)
    except IdPDeletionError as exc:
        logger.warning("IdP deletion failed for %s: %s", target.external_id, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Identity provider deletion failed; account not deleted. Please retry.",
        ) from exc

    # App-record delete + audit atomically.
    async with conn.transaction():
        await db_users.delete_user(conn, user_id)
        await db_audit.record(
            conn,
            action="account_delete",
            user_email=actor.email,
            details={
                "target_email": target.email,
                "target_external_id": target.external_id,
                "self": False,
            },
        )


@router.get(
    "/roles",
    response_model=list[RoleSummary],
    summary="List roles and their permissions",
)
async def list_roles(
    user: AuthUser = Depends(require_permission("can_manage_users")),
) -> list[RoleSummary]:
    return [
        RoleSummary(name=name, permissions=sorted(perms))
        for name, perms in ROLE_PERMISSIONS.items()
    ]
