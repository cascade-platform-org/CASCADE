# ADR-0010 — Authorization (role + entitlement) lives in the app DB, not the IdP

**Status:** accepted (amended 2026-07-06: default role `viewer` → `analyst`, see below)

For the public self-service deployment, Zitadel (the OIDC provider) is responsible
only for **authentication** — proving *who* a caller is. **Authorization** — what
role a user holds and which Entitlement (ADR-0008) that role grants — lives
exclusively in the application's Postgres `users` / `roles` tables. On a user's
first authenticated request the backend upserts them with the default role,
and request-time RBAC reads `users.role_name` from the DB, not
from a JWT claim. Promotion is a single `UPDATE`.

## Amendment (2026-07-06): default role is `analyst`, `viewer` is for guests

Originally new users landed as `viewer` and required manual promotion. In
practice sign-in already requires a **verified email** (the `/callback`
exchange rejects unverified id tokens), and the actual abuse defenses are the
per-role Entitlements (ADR-0008: `max_nodes` → 413, evals/minute bucket →
429) — the role gate added operator toil (promote every signup) without
adding safety. New posture (migration 005):

- **not signed in (guest)** → viewer experience, no DB row;
- **signed in (verified email)** → `analyst` by default — may propagate/sync
  within entitlement caps;
- `viewer` remains as an explicit demotion target and the guest preview role.

## Why

Signup is public and self-service, so strangers must land at a safe, bounded
default (safety comes from the Entitlement caps — see the amendment) and be
promotable without touching an external system. Keeping
authorization in one place we already control (the same DB that stores the seeded
RBAC roles) gives a single mental model, avoids configuring Zitadel roles /
custom claim mappers / management-API calls, and keeps the Entitlement numbers
(which have to be enforced app-side regardless) next to the roles they belong to.

## Considered and rejected

**IdP-owned roles** (roles injected into the token via Zitadel Actions/claims,
trusted by the backend). Rejected: it splits authorization across two systems
(roles in Zitadel, Entitlements still app-side), requires deeper Zitadel config,
and makes every role change an external console/API operation.

## Consequences

- Request-time RBAC is a DB lookup keyed by the OIDC `sub`
  (`auth/dependencies.py` → `db/users.py`), never a JWT claim.
- `users.role_name` defaults to `analyst` (migration 005, per the amendment
  above).
- The backend requires a live database to authorize any request (previously
  it could authorize from the token alone). This is acceptable — the DB is
  already a hard dependency of the public deployment.
