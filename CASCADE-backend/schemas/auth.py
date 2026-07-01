from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class Entitlement(BaseModel):
    """Per-role quotas (ADR-0008). None means unbounded (e.g. admin)."""
    max_nodes: Optional[int] = None
    evals_per_minute: Optional[int] = None


class AuthUser(BaseModel):
    """Decoded OIDC claims for the authenticated user, plus DB-owned authz."""
    sub: str
    email: str
    display_name: str
    roles: list[str]
    # Populated from the DB (ADR-0010). Absent in local-only mode == unbounded.
    entitlement: Optional[Entitlement] = None


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    expires_in: int
    token_type: str = "Bearer"
