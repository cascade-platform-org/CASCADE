"""
api/admin_routes.py — User and role management (requires can_manage_users / can_admin).

These endpoints are stubs that return appropriate responses without a live
database connection. Wire them to asyncpg queries when a DB is available.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from auth.dependencies import require_permission
from auth.rbac import ROLE_PERMISSIONS
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
    user: AuthUser = Depends(require_permission("can_manage_users")),
) -> list[UserSummary]:
    # TODO: SELECT id, email, name, role_name FROM users ORDER BY created_at DESC
    return []


@router.patch(
    "/users/{user_id}/role",
    response_model=UserSummary,
    summary="Assign a role to a user",
)
async def assign_role(
    user_id: str,
    body: RoleAssignment,
    actor: AuthUser = Depends(require_permission("can_manage_users")),
) -> UserSummary:
    if body.role not in ROLE_PERMISSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown role '{body.role}'. Valid: {sorted(ROLE_PERMISSIONS)}",
        )
    # TODO: UPDATE users SET role_name = $role WHERE id = $user_id RETURNING *
    raise HTTPException(status_code=501, detail="DB not connected.")


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
