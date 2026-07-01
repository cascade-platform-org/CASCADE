# Authorization (role + entitlement) lives in the app DB, not the IdP

**Status:** accepted

For the public self-service deployment, Zitadel (the OIDC provider) is responsible
only for **authentication** — proving *who* a caller is. **Authorization** — what
role a user holds and which Entitlement (ADR-0008) that role grants — lives
exclusively in the application's Postgres `users` / `roles` tables. On a user's
first authenticated request the backend upserts them with the least-privileged
role (`viewer`), and request-time RBAC reads `users.role_name` from the DB, not
from a JWT claim. Promotion is a single `UPDATE`.

## Why

Signup is public and self-service, so strangers must land at least privilege by
default and be promotable without touching an external system. Keeping
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

- The current code path reads roles from the JWT
  (`auth/dependencies.py` — `claims.get("roles", ...)`); it must change to a DB
  lookup keyed by the OIDC `sub`.
- `db/schema.sql` currently defaults new `users.role_name` to `analyst`; it must
  default to `viewer` to preserve least privilege for public signups.
- The backend now requires a live database to authorize any request (previously
  it could authorize from the token alone). This is acceptable — the DB is
  already a hard dependency of the public deployment.
