"""Tests for public auth endpoints (api/auth_routes.py)."""
from __future__ import annotations

import httpx
from httpx import ASGITransport


async def test_auth_config_is_public_and_reports_disabled_in_dev():
    """GET /api/auth/config must be reachable WITHOUT a token, so a guest can
    discover whether sign-in is required (the token-gated /me cannot reveal it)."""
    from main import create_app

    app = create_app()
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://t"
    ) as client:
        resp = await client.get("/api/auth/config")

    assert resp.status_code == 200
    body = resp.json()
    assert body == {"auth_enabled": False}  # dev/local default (no OIDC configured)
