"""
auth/dependencies.py — FastAPI dependency-injection helpers for auth/RBAC.

Usage in a route:
    @router.get("/protected")
    async def route(user = Depends(get_current_user)):
        ...

    @router.post("/propagate")
    async def route(user = Depends(require_permission("can_propagate"))):
        ...
"""
from __future__ import annotations

import logging
from typing import Annotated, Any

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from auth.oauth2 import verify_token
from auth.rbac import has_permission
from schemas.auth import AuthUser

logger = logging.getLogger(__name__)

_bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> AuthUser:
    """Extract and validate the Bearer token; return an AuthUser.

    When auth is disabled (local-only mode) the token is optional and
    verify_token returns a synthetic admin user.
    """
    from config import get_settings
    settings = get_settings()

    token = credentials.credentials if credentials else ""

    if not settings.auth_enabled and not token:
        # Local-only mode — no token required, synthetic admin
        return AuthUser(
            sub="local-user",
            email="local@cascade.dev",
            display_name="Local User",
            roles=["admin"],
        )

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        claims: dict[str, Any] = await verify_token(token)
    except Exception as exc:
        logger.debug("Token validation failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    roles: list[str] = claims.get("roles", claims.get("groups", ["viewer"]))
    return AuthUser(
        sub=claims["sub"],
        email=claims.get("email", ""),
        display_name=claims.get("name", claims.get("preferred_username", "")),
        roles=roles,
    )


def require_permission(permission: str):
    """Return a FastAPI dependency that enforces a specific permission."""

    async def _check(user: AuthUser = Depends(get_current_user)) -> AuthUser:
        if not has_permission(user.roles, permission):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission required: {permission}",
            )
        return user

    return _check
