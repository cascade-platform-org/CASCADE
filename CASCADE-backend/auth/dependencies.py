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
from schemas.auth import AuthUser, Entitlement

logger = logging.getLogger(__name__)

_bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> AuthUser:
    """Validate the Bearer token and resolve the caller's authorization.

    Identity comes from the OIDC token; the *role* comes from our own database
    (ADR-0010). On first sight a user is inserted with the least-privileged
    default (`viewer`, via migration 002); returning users keep their assigned
    role. When auth is disabled (local-only mode) a synthetic admin is returned
    and no database is required.
    """
    from config import get_settings
    settings = get_settings()

    if not settings.auth_enabled:
        # Local-only mode — no token or database required, synthetic admin.
        return AuthUser(
            sub="local-user",
            email="local@cascade.dev",
            display_name="Local User",
            roles=["admin"],
        )

    token = credentials.credentials if credentials else ""
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

    sub = claims.get("sub")
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token is missing the 'sub' claim.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # The email claim is optional (scope not granted / IdP without email).
    # Store NULL rather than "" — two empty-string emails would collide on the
    # UNIQUE constraint and lock the second user out.
    email = claims.get("email") or None
    display_name = claims.get("name") or claims.get("preferred_username") or ""

    # ADR-0010: authorization is owned by our DB, never trusted from the token.
    from db import pool as db_pool
    from db.users import get_role_entitlement, upsert_user

    try:
        async with db_pool.get_pool().acquire() as conn:
            db_user = await upsert_user(
                conn, external_id=sub, email=email, name=display_name or None
            )
            max_nodes, evals_per_minute = await get_role_entitlement(
                conn, db_user.role_name
            )
    except Exception as exc:
        logger.exception("Failed to resolve user from database: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authorization backend unavailable.",
        ) from exc

    return AuthUser(
        sub=db_user.external_id,
        email=db_user.email or "",
        display_name=display_name,
        roles=[db_user.role_name],
        db_id=db_user.id,
        entitlement=Entitlement(
            max_nodes=max_nodes, evals_per_minute=evals_per_minute
        ),
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
