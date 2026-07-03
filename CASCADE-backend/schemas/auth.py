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
    # The users.id UUID (as text). None in local-only mode (no database).
    # Lets DB writes (Analysis Log, activity uploads) reference the user row
    # without an extra lookup per request.
    db_id: Optional[str] = None
    # Populated from the DB (ADR-0010). Absent in local-only mode == unbounded.
    entitlement: Optional[Entitlement] = None


class TokenPair(BaseModel):
    access_token: str
    # None when the IdP does not issue one (e.g. a refresh grant without
    # rotation). Kept in sync with TokenPairSchema in app/lib/schemas/api.ts.
    refresh_token: Optional[str] = None
    # Seconds until the access_token expires. None when the IdP omits it.
    expires_in: Optional[int] = None
    # Widened from a "Bearer" literal: some IdPs return other casings/schemes.
    token_type: str = "Bearer"
