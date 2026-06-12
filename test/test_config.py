"""Tests for config.py — env normalization and the fail-closed serving guard.

The dangerous failure mode: serving with ENV=production but no OIDC
configuration silently grants synthetic-admin to every request. These tests
pin three properties of the guard:

1. `assert_production_safe` raises for production-without-auth and passes
   for production-with-auth — and it guards SERVING, not construction, so
   maintenance scripts (scripts/create_admin.py) can still build Settings
   on a production host that hasn't wired up its IdP yet.
2. ENV is a closed vocabulary: case/whitespace variants normalize, but a
   typo like ENV=prod fails loudly instead of silently bypassing the
   `env == "production"` checks (which would re-open the fail-open hole).
3. Local-only development mode stays available with no configuration.
"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from config import Settings, assert_production_safe


def _clear_oidc_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Make sure ambient env vars / .env values can't leak into the test."""
    for var in ("ENV", "OIDC_DISCOVERY_URL", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"):
        monkeypatch.delenv(var, raising=False)


def _production_settings(**overrides: object) -> Settings:
    return Settings(env="production", _env_file=None, **overrides)


def test_serving_in_production_without_auth_refuses(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_oidc_env(monkeypatch)
    settings = _production_settings()
    with pytest.raises(RuntimeError, match="ENV=production requires auth"):
        assert_production_safe(settings)


def test_serving_in_production_with_auth_passes(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_oidc_env(monkeypatch)
    settings = _production_settings(
        oidc_discovery_url="https://idp.example.org/.well-known/openid-configuration",
        oidc_client_id="cascade-backend",
    )
    assert settings.auth_enabled is True
    assert_production_safe(settings)  # must not raise


def test_settings_construction_never_blocks_scripts(monkeypatch: pytest.MonkeyPatch) -> None:
    """scripts/create_admin.py only needs DATABASE_URL; building Settings on a
    production host without OIDC must work — only SERVING is forbidden."""
    _clear_oidc_env(monkeypatch)
    settings = _production_settings(database_url="postgresql://u:p@localhost/db")
    assert settings.database_url is not None
    assert settings.auth_enabled is False


@pytest.mark.parametrize("raw", ["Production", "PRODUCTION", " production "])
def test_env_normalizes_case_and_whitespace(monkeypatch: pytest.MonkeyPatch, raw: str) -> None:
    _clear_oidc_env(monkeypatch)
    settings = Settings(env=raw, _env_file=None)
    assert settings.env == "production"


@pytest.mark.parametrize("raw", ["prod", "staging", "live"])
def test_unknown_env_value_fails_loudly(monkeypatch: pytest.MonkeyPatch, raw: str) -> None:
    """ENV=prod must be a startup error, not a silent bypass of the guard."""
    _clear_oidc_env(monkeypatch)
    with pytest.raises(ValidationError):
        Settings(env=raw, _env_file=None)


def test_development_without_auth_is_local_only_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear_oidc_env(monkeypatch)
    settings = Settings(env="development", _env_file=None)
    assert settings.auth_enabled is False
    assert settings.is_dev is True
    assert_production_safe(settings)  # dev mode never raises
