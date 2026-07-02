"""
auth/oauth2.py — OIDC discovery, token verification, and JWKS caching.

When auth is disabled (no OIDC config) every call to verify_token returns
a synthetic anonymous user so the app works in local-only mode.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

import httpx
from jose import jwt

from config import get_settings

logger = logging.getLogger(__name__)

_oidc_config: Optional[dict[str, Any]] = None
_jwks: Optional[dict[str, Any]] = None


async def fetch_oidc_config() -> dict[str, Any]:
    global _oidc_config
    if _oidc_config is not None:
        return _oidc_config
    settings = get_settings()
    if not settings.oidc_discovery_url:
        return {}
    async with httpx.AsyncClient() as client:
        resp = await client.get(settings.oidc_discovery_url, timeout=10)
        resp.raise_for_status()
        _oidc_config = resp.json()
    return _oidc_config


async def fetch_jwks() -> dict[str, Any]:
    global _jwks
    if _jwks is not None:
        return _jwks
    oidc_cfg = await fetch_oidc_config()
    jwks_uri = oidc_cfg.get("jwks_uri")
    if not jwks_uri:
        return {"keys": []}
    async with httpx.AsyncClient() as client:
        resp = await client.get(jwks_uri, timeout=10)
        resp.raise_for_status()
        _jwks = resp.json()
    return _jwks


async def verify_token(token: str) -> dict[str, Any]:
    """Validate a JWT and return its decoded claims.

    Returns a synthetic admin claim set when auth is disabled (local-only mode).
    Raises jose.JWTError on invalid / expired tokens.
    """
    settings = get_settings()
    if not settings.auth_enabled:
        return {
            "sub": "local-user",
            "email": "local@cascade.dev",
            "name": "Local User",
            "roles": ["admin"],
        }

    jwks = await fetch_jwks()
    audience = settings.jwt_audience or settings.oidc_client_id

    claims = jwt.decode(
        token,
        jwks,
        algorithms=[settings.jwt_algorithm],
        audience=audience,
        options={"verify_at_hash": False},
    )
    return claims
