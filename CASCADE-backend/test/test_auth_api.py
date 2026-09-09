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
    # dev/local default: no OIDC configured, so no sign-in and no Google shortcut.
    assert body == {"auth_enabled": False, "google_login": False}


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


async def test_login_redirect_forwards_prompt_and_ui_locales(monkeypatch):
    """The /login redirect forwards `prompt` only for an allow-listed value and
    `ui_locales` only when it looks like a BCP-47 tag list — so the frontend's
    "Create account" button (prompt=create) and browser-language pass-through
    reach Zitadel, while junk is dropped rather than echoed into the redirect."""
    from urllib.parse import parse_qs, urlsplit

    import config
    from api import auth_routes

    settings = config.get_settings().model_copy(
        update={
            "oidc_discovery_url": "https://id.example/.well-known/openid-configuration",
            "oidc_client_id": "cascade-app",
            "oidc_redirect_uri": "https://app.example/auth/callback",
            "oidc_scopes": "openid profile email",
        }
    )
    monkeypatch.setattr(auth_routes, "get_settings", lambda: settings)
    monkeypatch.setattr(
        auth_routes,
        "fetch_oidc_config",
        lambda: _async({"authorization_endpoint": "https://id.example/oauth/v2/authorize"}),
    )

    resp = await auth_routes.login(
        state="abc",
        code_challenge="x" * 20,
        code_challenge_method="S256",
        prompt="create",
        ui_locales="it en-US",
    )
    q = parse_qs(urlsplit(resp.headers["location"]).query)
    assert q["prompt"] == ["create"]
    assert q["ui_locales"] == ["it en-US"]

    resp2 = await auth_routes.login(
        state="abc",
        code_challenge="x" * 20,
        code_challenge_method="S256",
        prompt="evil",
        ui_locales="../../etc/passwd",
    )
    q2 = parse_qs(urlsplit(resp2.headers["location"]).query)
    assert "prompt" not in q2
    assert "ui_locales" not in q2


async def test_login_google_shortcut_adds_zitadel_idp_scope(monkeypatch):
    """`idp=google` maps SERVER-SIDE to Zitadel's IdP scope, so the browser can
    request the shortcut without ever learning (or being able to substitute) the
    provider id. With no id configured the parameter is silently ignored — a
    missing shortcut must degrade to the normal login form, never to an error."""
    from urllib.parse import parse_qs, urlsplit

    import config
    from api import auth_routes

    base = config.get_settings().model_copy(
        update={
            "oidc_discovery_url": "https://id.example/.well-known/openid-configuration",
            "oidc_client_id": "cascade-app",
            "oidc_redirect_uri": "https://app.example/auth/callback",
            "oidc_scopes": "openid profile email",
        }
    )
    monkeypatch.setattr(
        auth_routes,
        "fetch_oidc_config",
        lambda: _async({"authorization_endpoint": "https://id.example/oauth/v2/authorize"}),
    )

    configured = base.model_copy(update={"oidc_google_idp_id": "3021"})
    monkeypatch.setattr(auth_routes, "get_settings", lambda: configured)
    resp = await auth_routes.login(
        state="s",
        code_challenge="c",
        code_challenge_method="S256",
        prompt="",
        ui_locales="",
        idp="google",
    )
    scope = parse_qs(urlsplit(resp.headers["location"]).query)["scope"][0]
    assert "urn:zitadel:iam:org:idp:id:3021" in scope
    assert "openid" in scope  # the base scopes survive

    monkeypatch.setattr(auth_routes, "get_settings", lambda: base)
    resp2 = await auth_routes.login(
        state="s",
        code_challenge="c",
        code_challenge_method="S256",
        prompt="",
        ui_locales="",
        idp="google",
    )
    scope2 = parse_qs(urlsplit(resp2.headers["location"]).query)["scope"][0]
    assert "urn:zitadel" not in scope2


async def test_auth_config_advertises_google_only_when_configured(monkeypatch):
    """/config exposes a BOOLEAN, never the Zitadel IdP id itself — the client
    has no use for the id, so it stays server-side."""
    import config
    from api import auth_routes

    enabled = config.get_settings().model_copy(
        update={
            "oidc_discovery_url": "https://id.example/.well-known/openid-configuration",
            "oidc_client_id": "cascade-app",
            "oidc_google_idp_id": "3021",
        }
    )
    monkeypatch.setattr(auth_routes, "get_settings", lambda: enabled)
    body = (await auth_routes.auth_config()).model_dump()
    assert body == {"auth_enabled": True, "google_login": True}
    assert "3021" not in str(body)


async def test_unverified_email_is_a_distinct_error_from_config_failures(monkeypatch):
    """The /callback route maps EmailNotVerifiedError to an actionable 403 and
    everything else to an opaque one. That split only holds if the unverified
    case has its OWN type — matching on the message text would also catch
    `_decode_verified`'s "No audience configured…", which both misleads the user
    and leaks server configuration to an unauthenticated caller."""
    import pytest

    from auth import oauth2

    monkeypatch.setattr(
        oauth2, "_decode_verified", lambda _t, _a: _async({"sub": "s", "email_verified": False})
    )
    with pytest.raises(oauth2.EmailNotVerifiedError):
        await oauth2.verify_id_token("tok")

    # A configuration failure must NOT look like an unverified email.
    def _config_boom(_t, _a):
        raise ValueError("No audience configured; cannot verify token.")

    monkeypatch.setattr(oauth2, "_decode_verified", _config_boom)
    with pytest.raises(ValueError) as caught:
        await oauth2.verify_id_token("tok")
    assert not isinstance(caught.value, oauth2.EmailNotVerifiedError)


def _async(value):
    async def _coro():
        return value

    return _coro()


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
