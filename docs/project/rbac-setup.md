# RBAC Setup Guide

## Overview

The platform uses **Role-Based Access Control (RBAC)** layered on top of **OAuth2/OIDC** for identity. This means:

- **Authentication** (who you are) is delegated to a self-hosted, open-source OIDC provider — **Zitadel** (chosen; see ADR-0009 context) — or any OIDC-compliant service. Proprietary paid providers (Auth0, Okta, Azure AD) are excluded by the 100%-open-source rule (CLAUDE.md §1).
- **Authorization** (what you can do) is enforced by the backend using roles and permissions stored in PostgreSQL.

No project data touches the database. Only identity records and role assignments are stored server-side; permission definitions are code-owned (`auth/rbac.py`).

---

## Roles & Permissions

### Default Roles

The platform ships with four built-in roles. Role definitions are code-owned (`auth/rbac.py`); adding a custom role means adding it there plus a `roles` row (with its Entitlement) via a migration.

| Role        | Description                                            | Permissions                                                   |
| ----------- | ------------------------------------------------------ | ------------------------------------------------------------- |
| `viewer`  | Can view shared results but cannot run Propagation     | `can_view_analysis`                                                      |
| `analyst` | Standard user — can propagate and analyze              | `can_propagate`, `can_view_analysis`, `can_sync`                        |
| `manager` | Can propagate and manage team members' roles            | `can_propagate`, `can_view_analysis`, `can_sync`, `can_manage_users`  |
| `admin`   | Full access including role/permission definitions      | `*` (wildcard)                                                           |

### Permission Definitions

| Permission            | Grants                                                    |
| --------------------- | --------------------------------------------------------- |
| `can_propagate`     | Call `POST /api/propagate`                            |
| `can_view_analysis` | Access analysis endpoints (future expansion)              |
| `can_sync`          | Store and retrieve project files server-side              |
| `can_manage_users`  | List users, assign/change roles via admin API             |
| `can_define_roles`  | Create or modify role definitions (admin-only by default) |

Permissions are additive. A user's effective permissions are the union of all permissions granted by their role.

---

## Database Schema

The RBAC data model is two tables in PostgreSQL (see `db/schema.sql` for the authoritative DDL):

-- Users: created on first OAuth2 login (default role 'viewer' — migration 002)
CREATE TABLE users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id VARCHAR(255) UNIQUE NOT NULL,   -- sub claim from OIDC
    email       VARCHAR(255) UNIQUE,            -- nullable: OIDC email claim is optional
    name        VARCHAR(255),
    role_name   VARCHAR(50) NOT NULL DEFAULT 'viewer',
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now(),
    FOREIGN KEY (role_name) REFERENCES roles(name)
);

-- Roles: names + Entitlement quotas (ADR-0008). NULL = unbounded.
CREATE TABLE roles (
    name             VARCHAR(50) PRIMARY KEY,
    description      TEXT,
    max_nodes        INT,
    evals_per_minute INT,
    created_at       TIMESTAMPTZ DEFAULT now()
);

The **role→permission mapping lives in code** (`auth/rbac.py`), not in a table — one source of truth the API enforces; the former `role_permissions` table was dropped in migration 004. `db/seed.sql` populates the four default roles on first deployment; migrations 002/003 seed and calibrate their Entitlements.

---

## Identity Provider Setup

### General Requirements

Any OAuth2/OIDC provider works. The server needs:

1. **Client ID** and **Client Secret** from the provider.
2. The provider's **discovery URL** (e.g., `https://your-provider/.well-known/openid-configuration`).
3. A registered **redirect URI** pointing to `https://,[object Object]
