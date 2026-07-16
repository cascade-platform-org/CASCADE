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


async def test_me_returns_effective_permissions():
    """/me carries the wildcard-expanded permission list — the client gates UI
    on this instead of mirroring the role→permission map (which drifts).
    Local-only mode authenticates as the synthetic admin, so the list must be
    every declared permission."""
    from auth.rbac import PERMISSIONS
    from main import create_app

    app = create_app()
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://t"
    ) as client:
        resp = await client.get("/api/auth/me")

    assert resp.status_code == 200
    body = resp.json()
    assert body["roles"] == ["admin"]
    assert body["permissions"] == sorted(PERMISSIONS)


def test_effective_permissions_per_role():
    """viewer holds nothing (guest-preview role); analyst/manager get exactly
    their declared set; admin's wildcard expands to every declared permission."""
    from auth.rbac import PERMISSIONS, effective_permissions

    assert effective_permissions(["viewer"]) == set()
    assert effective_permissions(["analyst"]) == {"can_propagate", "can_sync"}
    assert effective_permissions(["manager"]) == {
        "can_propagate", "can_sync", "can_manage_users",
    }
    assert effective_permissions(["admin"]) == PERMISSIONS
    assert effective_permissions([]) == set()


async def test_metrics_endpoint_exposed():
    """The serving app exposes Prometheus metrics at /metrics (internal only)."""
    from main import app  # the singleton serving app is instrumented on import

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://t"
    ) as client:
        resp = await client.get("/metrics")

    assert resp.status_code == 200
    # Prometheus text exposition format.
    assert "# HELP" in resp.text
