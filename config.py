"""
config.py — Runtime Configuration for the CASCADE backend.

Loaded from environment variables (or .env via python-dotenv).
All settings have sane development defaults so the server starts
without a database or OIDC provider in local-only mode.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Literal, Optional

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ---- Server ----
    host: str = "0.0.0.0"
    port: int = 8000
    # Literal (not free string) so a typo like ENV=prod fails LOUDLY at startup
    # instead of silently not matching the == "production" checks below — a
    # mismatch there would disable the production auth guard (fail-open).
    env: Literal["development", "production"] = "development"
    cors_origins: str = "http://localhost:3000"

    # ---- Database ----
    database_url: Optional[str] = None

    # ---- OAuth2 / OIDC ----
    oidc_discovery_url: Optional[str] = None
    oidc_client_id: Optional[str] = None
    oidc_client_secret: Optional[str] = None
    oidc_redirect_uri: str = "http://localhost:3000/api/auth/callback"
    oidc_scopes: str = "openid profile email"
    jwt_algorithm: str = "RS256"
    jwt_audience: Optional[str] = None

    # NOTE: no rate-limiting setting exists yet — deliberately. A flag that is
    # read by nothing would let an operator "enable" a control with no effect.
    # Reintroduce the setting in the same commit as the enforcing middleware.

    # ---- Derived ----
    @property
    def is_dev(self) -> bool:
        return self.env == "development"

    @property
    def auth_enabled(self) -> bool:
        """Auth is disabled in local-only mode (no OIDC config)."""
        return bool(self.oidc_discovery_url and self.oidc_client_id)

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @field_validator("database_url", mode="before")
    @classmethod
    def _blank_to_none(cls, v: object) -> object:
        return v or None

    @field_validator("env", mode="before")
    @classmethod
    def _normalize_env(cls, v: object) -> object:
        """Tolerate case/whitespace ('Production', 'PRODUCTION ') but nothing
        else — 'prod' etc. still fails loudly via the Literal type."""
        return v.strip().lower() if isinstance(v, str) else v


def assert_production_safe(settings: Settings) -> None:
    """Refuse to SERVE in production without auth configured.

    When OIDC is not configured every request is treated as a synthetic admin
    user (local-only mode). That is intentional on a developer machine but
    catastrophic on a public server. This check lives at the serving
    entrypoint (main.create_app), not on Settings itself, so maintenance
    scripts that only need e.g. DATABASE_URL (scripts/create_admin.py) still
    run on a production host that hasn't wired up its IdP yet.
    """
    if settings.env == "production" and not settings.auth_enabled:
        raise RuntimeError(
            "ENV=production requires auth: set OIDC_DISCOVERY_URL and "
            "OIDC_CLIENT_ID (auth-disabled local mode grants admin to "
            "every request and must never serve in production)."
        )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
