"""
auth/rbac.py — Permission definitions and role-to-permission mapping.

This module is the SOLE source of truth for role -> permission mapping (the
former `role_permissions` table was dropped in migration 004 — two mappings
drifting apart was worse than one). `db/seed.sql` and `db/schema.sql` only
seed/store role *names* and their Entitlement quotas (ADR-0008); role
*assignment* per user lives in the `users` table (ADR-0010).
"""
from __future__ import annotations

# Canonical permission names — keep in sync with docs/project/rbac-setup.md
PERMISSIONS = {
    "can_propagate",
    "can_view_analysis",
    "can_sync",
    "can_manage_users",
    "can_define_roles",
    "can_admin",        # wildcard — implies all others
}

# Default role definitions (mirrored from db/seed.sql)
ROLE_PERMISSIONS: dict[str, set[str]] = {
    "viewer":  {"can_view_analysis"},
    "analyst": {"can_propagate", "can_view_analysis", "can_sync"},
    "manager": {"can_propagate", "can_view_analysis", "can_sync", "can_manage_users"},
    "admin":   {"can_admin"},
}


def has_permission(roles: list[str], permission: str) -> bool:
    """Return True if any of the caller's roles grants the requested permission."""
    for role in roles:
        granted = ROLE_PERMISSIONS.get(role, set())
        if "can_admin" in granted or permission in granted:
            return True
    return False
