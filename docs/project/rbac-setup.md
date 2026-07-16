# RBAC Setup Guide

## Overview

The platform uses **Role-Based Access Control (RBAC)** layered on top of **OAuth2/OIDC** for identity. This means:

- **Authentication** (who you are) is delegated to a self-hosted, open-source OIDC provider — **Zitadel** (chosen; see ADR-0009 context) — or any OIDC-compliant service. Proprietary paid providers (Auth0, Okta, Azure AD) are excluded by the 100%-open-source rule (CLAUDE.md §1).
- **Authorization** (what you can do) is enforced by the backend using roles and permissions stored in PostgreSQL.

The database stores identity records, role assignments, and run/audit logs; permission definitions are code-owned (`auth/rbac.py`). Project data reaches the database only for users who opt in to Server Sync (requirements.md §13.4).

---

## Roles & Permissions

### Default Roles

The platform ships with four built-in roles. Role definitions are code-owned (`auth/rbac.py`); adding a custom role means adding it there plus a `roles` row (with its Entitlement) via a migration.

| Role        | Description                                             | Permissions                                      |
| ----------- | -------------------------------------------------------- | ------------------------------------------------ |
| `viewer`  | Guest-preview / demotion role; cannot run Propagation     | none — plain-authenticated endpoints only        |
| `analyst` | Standard user (signup default) — can propagate and sync   | `can_propagate`, `can_sync`                      |
| `manager` | Analyst + manage team members' roles                      | `can_propagate`, `can_sync`, `can_manage_users`  |
| `admin`   | Full access                                               | `can_admin` (wildcard)                           |

### Permission Definitions

| Permission           | Grants                                                            |
| -------------------- | ----------------------------------------------------------------- |
| `can_propagate`    | Call `POST /api/propagate`                                      |
| `can_sync`         | Store and retrieve project files server-side                      |
| `can_manage_users` | List users, assign/change roles via admin API                     |
| `can_admin`        | Wildcard; also guards admin-role escalation/deletion              |

Permissions are additive (union across the user's roles). Every declared permission is enforced by at least one endpoint — a permission with nothing to guard is removed rather than kept as dead surface (client-side analysis needs none; role definitions are code-owned, so no "define roles" permission can exist).

---

## Database Schema

The RBAC data model is two tables in PostgreSQL (see `db/schema.sql` for the authoritative DDL):

-- Users: created on first OAuth2 login (default role 'analyst' — migration 005;
-- 'viewer' is the guest-preview/demotion role)
CREATE TABLE users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id VARCHAR(255) UNIQUE NOT NULL,   -- sub claim from OIDC
    email       VARCHAR(255) UNIQUE,            -- nullable: OIDC email claim is optional
    name        VARCHAR(255),
    role_name   VARCHAR(50) NOT NULL DEFAULT 'analyst',
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

Any OAuth2/OIDC provider works; the shipped stack self-hosts **Zitadel**. The
server needs a client ID (client secret optional — PKCE is the default), the
provider's discovery URL, and a registered redirect URI pointing at the
frontend's `/auth/callback` page.

The full step-by-step Zitadel setup (first admin login, app creation, redirect
URIs, SMTP + email verification, lockout, `.env` values) lives in
[deployment.md → Identity Provider (Zitadel) Setup](deployment.md); the
endpoint-level auth flow is documented in [api-reference.md](api-reference.md).
