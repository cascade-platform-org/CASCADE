"""
auth/rbac.py — Permission definitions and role-to-permission mapping.

Roles and their permissions are also stored in PostgreSQL (db/seed.sql).
This module defines the same mapping in Python so the dependency injection
layer can check permissions without a DB round-trip in common cases.
"""
from __future__ import annotations

# Canonical permission names — keep in sync with db/seed.sql
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
