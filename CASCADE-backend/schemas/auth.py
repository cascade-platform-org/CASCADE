from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class AuthUser(BaseModel):
    """Decoded OIDC claims for the authenticated user."""
    sub: str
    email: str
    display_name: str
    roles: list[str]


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    expires_in: int
    token_type: str = "Bearer"
