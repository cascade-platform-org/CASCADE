# Tenancy: organizations owned by the app DB, schema lands with its first consumer

**Status:** accepted

CASCADE serves **both** standalone individuals (researchers, solo consultants)
and **organizations** with teams (B2B critical-infrastructure customers). We need
a tenancy model that supports both without forcing a painful retrofit once shared
data exists — but we are **local-first with server Sync deferred** (ADR-0007), so
today the server holds no shareable data and there is nothing yet to isolate
between customers.

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
