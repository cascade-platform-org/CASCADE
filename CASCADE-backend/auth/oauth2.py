"""
auth/oauth2.py — OIDC discovery, token verification, and JWKS caching.

When auth is disabled (no OIDC config) every call to verify_token returns
a synthetic anonymous user so the app works in local-only mode.

JWKS caching policy: keys are cached with a TTL (they rarely change) and
refetched immediately when a token arrives signed by an unknown `kid` —
that is what happens the moment the IdP rotates its signing keys. Without
the kid-miss refetch, a key rotation would break every login until the
backend restarts.
"""
from __future__ import annotations

import logging
import time
from typing import Any, Optional

import httpx
from jose import jwt

from config import get_settings

logger = logging.getLogger(__name__)

# Discovery documents are effectively static per deployment; cache forever.
_oidc_config: Optional[dict[str, Any]] = None

# JWKS: cached with a TTL + refreshed on unknown-kid (key rotation).
_JWKS_TTL_SECONDS = 3600.0
_jwks: Optional[dict[str, Any]] = None
_jwks_fetched_at: float = 0.0


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
        config: dict[str, Any] = resp.json()
    _oidc_config = config
    return config


async def fetch_jwks(force: bool = False) -> dict[str, Any]:
    """Return the cached JWKS, refetching when stale or `force` is set."""
    global _jwks, _jwks_fetched_at
    now = time.monotonic()
    if not force and _jwks is not None and (now - _jwks_fetched_at) < _JWKS_TTL_SECONDS:
        return _jwks
    oidc_cfg = await fetch_oidc_config()
    jwks_uri = oidc_cfg.get("jwks_uri")
    if not jwks_uri:
        return {"keys": []}
    async with httpx.AsyncClient() as client:
        resp = await client.get(jwks_uri, timeout=10)
        resp.raise_for_status()
        keys: dict[str, Any] = resp.json()
    _jwks = keys
    _jwks_fetched_at = time.monotonic()
    return keys


def _jwks_has_kid(jwks: dict[str, Any], kid: Optional[str]) -> bool:
    if kid is None:
        # No kid in the token header — let jose try every cached key.
        return True
    return any(k.get("kid") == kid for k in jwks.get("keys", []))


async def _decode_verified(token: str, audience: Optional[str]) -> dict[str, Any]:
    """Signature-, audience-, and issuer-verify a JWT and return its claims.

    Shared by verify_token (access token) and verify_id_token (id token); the
    two differ only in expected audience. Raises jose.JWTError / ValueError on
    an invalid, expired, wrong-audience, or wrong-issuer token.
    """
    if not audience:
        # No configured audience means jose would skip the aud check; fail
        # closed rather than accept a token minted for any other client.
        raise ValueError("No audience configured; cannot verify token.")

    kid = jwt.get_unverified_header(token).get("kid")
    jwks = await fetch_jwks()
    if not _jwks_has_kid(jwks, kid):
        # Unknown signing key — the IdP has likely rotated. Refetch once.
        logger.info("Token signed by unknown kid=%s; refreshing JWKS.", kid)
        jwks = await fetch_jwks(force=True)

    issuer = (await fetch_oidc_config()).get("issuer")
    if not issuer:
        # jose treats issuer=None as "do not validate iss"; fail closed instead
        # of silently dropping the issuer binding this function intends to enforce.
        raise ValueError("OIDC discovery document has no issuer; cannot verify token.")

    settings = get_settings()
    return jwt.decode(
        token,
        jwks,
        algorithms=[settings.jwt_algorithm],
        audience=audience,
        issuer=issuer,
        options={"verify_at_hash": False},
    )


async def verify_token(token: str) -> dict[str, Any]:
    """Validate an access-token JWT and return its decoded claims.

    Checks, beyond the signature: `aud` and `iss` (must match the discovery
    document's issuer).

    Note: `email_verified` is NOT enforced here — it is an id-token/userinfo
    claim and is normally absent from access tokens, so a check here would be a
    no-op. Email verification is enforced once, at login, in verify_id_token
    (called from the /callback exchange).

    Returns a synthetic admin claim set when auth is disabled (local-only mode).
    Raises jose.JWTError / ValueError on invalid or expired tokens.
    """
    settings = get_settings()
    if not settings.auth_enabled:
        return {
            "sub": "local-user",
            "email": "local@cascade.dev",
            "name": "Local User",
            "roles": ["admin"],
        }

    audience = settings.jwt_audience or settings.oidc_client_id
    return await _decode_verified(token, audience)


async def verify_id_token(id_token: str) -> dict[str, Any]:
    """Validate an OIDC id token (audience = client_id) and enforce that the
    email is verified. Called at login; the id token — unlike the access token —
    carries `email_verified`.

    The IdP login policy should already block unverified accounts, but a single
    misconfigured checkbox there must not grant access, so an explicitly
    unverified email (`email_verified: false`) is rejected here as defense in
    depth. Raises jose.JWTError / ValueError on invalid or unverified tokens.
    """
    settings = get_settings()
    claims = await _decode_verified(id_token, settings.oidc_client_id)
    if claims.get("email_verified") is False:
        raise ValueError("Email address is not verified.")
    return claims
