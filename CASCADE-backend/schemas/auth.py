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

# TokenPair was removed when tokens moved into httpOnly cookies: no endpoint
# returns tokens in a response body anymore (/callback and /refresh return
# {"ok": true} and set cookies), so a token response schema has nothing to
# describe on either side of the boundary.
