"""
api/auth_routes.py — OIDC login, callback, token refresh, and /me endpoint.

When auth is disabled (local-only mode) the /me endpoint returns the
synthetic admin user and the OIDC routes return 501.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from auth.dependencies import get_current_user
from auth.oauth2 import fetch_oidc_config
from config import get_settings
from schemas.auth import AuthUser

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])


class MeResponse(BaseModel):
    sub: str
    email: str
    display_name: str
    roles: list[str]
    auth_enabled: bool


@router.get("/me", response_model=MeResponse, summary="Current user")
async def me(user: AuthUser = Depends(get_current_user)) -> MeResponse:
    settings = get_settings()
    return MeResponse(
        sub=user.sub,
        email=user.email,
        display_name=user.display_name,
        roles=user.roles,
        auth_enabled=settings.auth_enabled,
    )


@router.get("/login", summary="Redirect to OIDC provider login page")
async def login() -> RedirectResponse:
    settings = get_settings()
    if not settings.auth_enabled:
        raise HTTPException(status_code=501, detail="Auth is disabled in local-only mode.")

    oidc_cfg = await fetch_oidc_config()
    auth_endpoint = oidc_cfg.get("authorization_endpoint")
    if not auth_endpoint:
        raise HTTPException(status_code=503, detail="OIDC provider unavailable.")

    scopes = settings.oidc_scopes.replace(",", " ")
    url = (
        f"{auth_endpoint}"
        f"?response_type=code"
        f"&client_id={settings.oidc_client_id}"
        f"&redirect_uri={settings.oidc_redirect_uri}"
        f"&scope={scopes}"
    )
    return RedirectResponse(url=url)


@router.get("/callback", summary="OIDC authorization code callback")
async def callback(code: str = Query(...)) -> dict:
    settings = get_settings()
    if not settings.auth_enabled:
        raise HTTPException(status_code=501, detail="Auth is disabled in local-only mode.")

    oidc_cfg = await fetch_oidc_config()
    token_endpoint = oidc_cfg.get("token_endpoint")
    if not token_endpoint:
        raise HTTPException(status_code=503, detail="OIDC provider unavailable.")

    import httpx
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            token_endpoint,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": settings.oidc_redirect_uri,
                "client_id": settings.oidc_client_id,
                "client_secret": settings.oidc_client_secret,
            },
            timeout=15,
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=400, detail="Token exchange failed.")
        tokens = resp.json()

    return {
        "access_token": tokens.get("access_token"),
        "refresh_token": tokens.get("refresh_token"),
        "expires_in": tokens.get("expires_in"),
        "token_type": tokens.get("token_type", "Bearer"),
    }
