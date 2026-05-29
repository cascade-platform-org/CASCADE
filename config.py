"""
config.py — Runtime Configuration for the CASCADE backend.

Loaded from environment variables (or .env via python-dotenv).
All settings have sane development defaults so the server starts
without a database or OIDC provider in local-only mode.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Optional

from pydantic import Field, field_validator
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
    env: str = "development"
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

    # ---- Rate limiting ----
    rate_limit_enabled: bool = False

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


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
