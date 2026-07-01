"""
api/admin_routes.py — User and role management (requires can_manage_users / can_admin).

Backed by the `users` table via db/users.py (ADR-0010: roles live in our DB).
"""
from __future__ import annotations

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from auth.dependencies import require_permission
from auth.rbac import ROLE_PERMISSIONS, has_permission
from db import users as db_users
from db.pool import get_connection
from schemas.auth import AuthUser

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
    conn: asyncpg.Connection = Depends(get_connection),
    actor: AuthUser = Depends(require_permission("can_manage_users")),
) -> list[UserSummary]:
    users = await db_users.list_users(conn)
    return [
        UserSummary(
            id=u.id, email=u.email, display_name=u.name or "", role=u.role_name
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
    conn: asyncpg.Connection = Depends(get_connection),
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

    # Escalation guard: any change that grants OR removes 'admin' requires admin
    # privileges. Otherwise a manager could mint admins, or strip every existing
    # admin (locking out the admin tier, since managers cannot restore it).
    touches_admin = body.role == "admin" or target.role_name == "admin"
    if touches_admin and not has_permission(actor.roles, "can_admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Granting or removing the 'admin' role requires admin privileges.",
        )

    updated = await db_users.set_user_role(conn, user_id, body.role)
    if updated is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No user with id '{user_id}'.",
        )
    return UserSummary(
        id=updated.id,
        email=updated.email,
        display_name=updated.name or "",
        role=updated.role_name,
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
