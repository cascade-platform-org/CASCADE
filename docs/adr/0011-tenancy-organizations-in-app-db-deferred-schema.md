# ADR-0011 — Tenancy: organizations owned by the app DB, schema lands with its first consumer

**Status:** accepted (amended 2026-09-09: Server Sync shipped owner-scoped, not org-scoped — see the amendment below)

CASCADE serves **both** standalone individuals (researchers, solo consultants)
and **organizations** with teams (B2B critical-infrastructure customers). We need
a tenancy model that supports both without forcing a painful retrofit once shared
data exists — but at the time of this decision we were **local-first with server
Sync deferred** (ADR-0007), so the server held no shareable data and there was
nothing yet to isolate between customers. (Sync has since shipped, owner-scoped —
see the amendment above.)

## Amendment (2026-09-09): Sync shipped owner-scoped; the org constraint re-arms later

The constraint below said the first server-stored shareable resource "MUST be
org-scoped from its first line of code". Server Sync (requirements.md §13.4)
then shipped **owner-scoped**: `projects.owner_id UUID NOT NULL REFERENCES
users(id) ON DELETE CASCADE`, no `org_id` column, and no `organizations` table.
This amendment records that deviation and why it is accepted rather than a debt.

**What shipped is strictly narrower than what the constraint protects against.**
Sync has no sharing path at all — every one of the four data-access functions in
`db/projects.py` (`save_version`, `list_versions`, `get_version`,
`delete_version`) takes `owner_id` as a required keyword and carries
`owner_id = $1` in its `WHERE` clause; `db/export.py` does the same. The routes
derive `owner_id` from the authenticated session (`sync_routes.py` →
`_require_db_id(user)`), never from the request body, and a version belonging to
someone else returns `404`, not `403`. Not even an `admin` can read another
user's bundles. Nothing is visible across users, so there is no cross-tenant
visibility question for an org scope to answer yet.

**The centralisation requirement is satisfied in substance.** The original worry
was tenant scoping threaded ad hoc through call sites. `db/projects.py` is the
only module that queries the `projects` table, and every query there already
routes through one explicit owner parameter. Adding an org axis later means
editing the `WHERE` clauses in that single file plus a migration — not chasing
scoping logic across the codebase, which is the cost the constraint existed to
avoid.

**The constraint re-arms unchanged for the first genuinely *shared* resource** —
a team-visible project, a shared scorecard, anything one user can read because
another put it there. That resource must land with `organizations`,
`users.org_id`, and a single centralised "what may this user see" helper handling
the `org_id IS NULL` individual case, exactly as decided below.

## Decisions

- **Organizations are owned by the app database**, parallel to how roles are
  owned (ADR-0010). Zitadel stays a pure authenticator and carries no tenancy.
  Rejected: delegating orgs to Zitadel's native Organizations feature — it would
  split authorization across two systems again (the thing ADR-0010 removed) and
  deepen IdP lock-in. Per-org SSO / email-domain auto-join can be revisited if a
  specific enterprise customer requires it.
- **Membership is nullable**: a user either belongs to one organization
  (`users.org_id`) or is a standalone individual (`org_id IS NULL`). We
  explicitly did **not** adopt the "personal org of one" pattern; the cost we
  accept is that every tenant-scoped query and permission check must handle the
  `NULL` case, so that scoping logic MUST be centralised in one place rather than
  branched ad hoc across call sites.
- **Roles remain global *platform* roles in v1.** Today's `viewer`/`analyst`/
  `manager`/`admin` (and `create_admin.py`, and the admin-escalation guard) are
  **platform-level**: `admin` is the deployment operator, not a customer's team
  admin. **Org-scoped roles** (e.g. `org_admin` vs `member`, managing only their
  own org) are **deferred** until there is something org-scoped to manage — i.e.
  until Sync / team sharing lands. Conflating platform-admin with org-admin is a
  known tenancy trap; we keep them separate by not introducing org roles early.
- **No schema now.** The `organizations` table and `users.org_id` land together
  with the **first feature that actually scopes by them** (server Sync), not
  speculatively. The painful part of tenancy is threading tenant-scoping through
  every query, which a column nothing reads does not solve; the valuable artifact
  today is this decision, so Sync is designed org-aware from day one.

## Consequences / constraints for future work

- **The first server-stored shareable resource (synced projects) MUST be
  org-scoped from its first line of code**, with a single centralised helper that
  resolves "what may this user see" and handles the `org_id IS NULL` individual
  case. Do not add a shareable server resource without that scoping.
- When org roles arrive, they are a *second* RBAC axis (membership role within an
  org), separate from the platform roles of ADR-0008/0010 — not a replacement.
- GDPR/account deletion must eventually cascade correctly for org membership
  (removing a user vs. deleting an org).
