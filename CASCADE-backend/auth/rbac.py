"""
auth/rbac.py — Permission definitions and role-to-permission mapping.

This module is the SOLE source of truth for role -> permission mapping (the
former `role_permissions` table was dropped in migration 004 — two mappings
drifting apart was worse than one). `db/seed.sql` and `db/schema.sql` only
seed/store role *names* and their Entitlement quotas (ADR-0008); role
*assignment* per user lives in the `users` table (ADR-0010).
"""
from __future__ import annotations

# Canonical permission names — keep in sync with docs/project/rbac-setup.md.
# Every name here is enforced by at least one endpoint; a permission with no
# endpoint to guard does not belong in this set (add it when the endpoint ships).
PERMISSIONS = {
    "can_propagate",
    "can_sync",
    "can_manage_users",
    "can_admin",        # wildcard — implies all others
}

# Default role definitions (mirrored from db/seed.sql). `viewer` holds no
# server-side permission: it is the guest-preview/demotion role, limited to
# plain-authenticated endpoints (client-side analysis needs no permission).
ROLE_PERMISSIONS: dict[str, set[str]] = {
    "viewer":  set(),
    "analyst": {"can_propagate", "can_sync"},
    "manager": {"can_propagate", "can_sync", "can_manage_users"},
    "admin":   {"can_admin"},
}


def has_permission(roles: list[str], permission: str) -> bool:
    """Return True if any of the caller's roles grants the requested permission."""
    for role in roles:
        granted = ROLE_PERMISSIONS.get(role, set())
        if "can_admin" in granted or permission in granted:
            return True
    return False


def effective_permissions(roles: list[str]) -> set[str]:
    """The caller's full permission set, with the can_admin wildcard expanded.

    Returned by GET /api/auth/me so clients can test membership directly
    instead of mirroring the role→permission map (which drifts).
    """
    granted: set[str] = set()
    for role in roles:
        granted |= ROLE_PERMISSIONS.get(role, set())
    if "can_admin" in granted:
        granted |= PERMISSIONS
    return granted
