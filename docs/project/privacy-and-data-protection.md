# Privacy and Data Protection (GDPR)

What CASCADE stores about people, why, for how long, and what a deployment must
do to be lawful. This is the engineering record — it is **not** the privacy
notice you publish to users; see "Operator checklist" for that.

Related: [deployment.md](deployment.md) (erasure, backups, retention cron),
[api-reference.md](api-reference.md) (the endpoints), ADR-0007 (why Propagation
results are never persisted).

---

## 1. Roles

Whoever runs a CASCADE instance is the **data controller**. CASCADE is
self-hosted software on a single VM; the authors of the software are not a
processor for your deployment and never receive your users' data.

Recipients of personal data, per deployment:

| Recipient | When | What reaches them |
| --- | --- | --- |
| Zitadel (self-hosted, same VM) | Always | Email, name, credentials, sign-in events |
| Google | **Only if** you enable "Continue with Google" | The sign-in itself: Google learns the user authenticated to your instance, and returns their email/name |
| SMTP provider | Verification and notification mail | Recipient address, message content |

Enabling Google login adds a recipient outside the EU/EEA. That is lawful (SCCs
+ the EU–US Data Privacy Framework, on which Google self-certifies), but it must
be **named in your privacy notice** before you switch it on. If you would rather
not have that recipient, leave `OIDC_GOOGLE_IDP_ID` unset — the button then does
not exist and no request to Google is ever made. The Google mark on the sign-in
button is inlined SVG precisely so that a visitor who never presses it has no
contact with Google at all.

---

## 2. What is stored (Art. 30 record)

Project graphs are **local-first**: nodes, edges, canvases and results live in
the browser and in files on the user's machine. The server stores them only for
users who explicitly use Server Sync.

| Data | Where | Purpose | Lawful basis | Retention |
| --- | --- | --- | --- | --- |
| Email, name, credentials, verification state | Zitadel | Authenticate the user | Contract (Art. 6(1)(b)) | Until account deletion |
| `users`: OIDC `sub`, email, name, role | App DB | Authorization (ADR-0010) | Contract | Until account deletion |
| `projects`: synced project bundles | App DB | The user's own opt-in server copies | Contract | Until the user deletes them |
| `project_working_copies`: auto-saved bundles | App DB | The live copy of a project the user opted into auto-save (ADR-0017) | Contract | Until the user turns auto-save off for that project, or deletes the account |
| `audit_logs`: role changes, account deletions, actor email | App DB | Security and integrity record | Legitimate interest (Art. 6(1)(f)) | **730 days** |
| `analysis_logs`: run shape and timing, no content | App DB | Capacity planning, entitlement calibration | Legitimate interest | **365 days** |
| `activity_log_uploads`: client action metadata | App DB | Support and debugging, user-initiated | Consent | **180 days** |
| Caddy access logs (IP, path, timestamp) | VM | Operations, abuse and rate limiting | Legitimate interest | Per your log rotation |

**Not stored anywhere on the server:** Propagation results, hazard scenarios,
Element names and locations, and any georeferenced content. ADR-0007 makes this
a hard boundary — `analysis_logs` may record that a run had 412 nodes, never
what they were. The backend keeps no IP addresses of its own; only the reverse
proxy sees them. A speculative `batch_propagation_jobs` table would have
persisted Propagation results; migration 006 dropped it rather than carve out an
exception for a feature nobody had built.

The table above is the whole list, and `db/schema.sql` is where it is kept
honest: a new table carrying a `user_id` belongs in this table, in
`db/export.py`, and — if it is a log — in `scripts/purge_expired.py`.

`audit_logs.user_email` is kept **after** the user is deleted, deliberately: an
integrity record that erases the actor stops being an integrity record. It is
time-boxed to the retention window above rather than kept forever, which is what
makes it defensible under Art. 5(1)(e).

---

## 3. Data subject rights — how each one is served

| Right | Mechanism |
| --- | --- |
| Access (Art. 15) | `GET /api/auth/me/export` — "Download my data" in the account menu. JSON, every table keyed to the caller, including actions an admin took **on** their account (`audit_entries_about_me`). Those rows omit the acting admin's identity: Art. 15(4) — access must not adversely affect the rights of others. |
| Portability (Art. 20) | Same endpoint; the export is machine-readable and self-describing (`export_format`). Project files are already the user's own JSON. |
| Erasure (Art. 17) | `DELETE /api/auth/me` — "Delete account". Deletes the Zitadel identity **first**, then the app record. `projects`, `project_working_copies` and `activity_log_uploads` are `ON DELETE CASCADE` and go with it; `analysis_logs` and `audit_logs` are `ON DELETE SET NULL`, so those rows survive **anonymised** — no `user_id`, no name, and (for analysis) never any content to begin with. They then expire on the §5 retention windows. |
| Rectification (Art. 16) | Email/name are edited in Zitadel's account page; the app re-reads them at next login. |
| Restriction / objection (Art. 18, 21) | No automated flow — handle by hand and record it. |

The export is scoped to the caller: it takes no user id, so it cannot be aimed
at another person. Any new table carrying a `user_id` must be added to
`db/export.py` and to the table in §2 in the same session, or both become
untrue.

---

## 4. Cookies and local storage

No consent banner is required, because nothing here is used for tracking or
analytics:

- `cascade_access` / `cascade_refresh` — httpOnly session cookies. Strictly
  necessary for authentication (ePrivacy exemption).
- `cascade.auth` (localStorage) — the user's own session choice and display
  name, so the identity gate is not shown on every reload.
- `cascade.oidc.*` (sessionStorage) — single-use CSRF state and PKCE verifier,
  deleted the moment the login completes.

There are no third-party cookies, no analytics, no ad or tracking scripts, and
no external font or asset CDNs on the sign-in path.

---

## 5. Retention is enforced, not just declared

```bash
python scripts/purge_expired.py            # dry run — prints what would go
python scripts/purge_expired.py --apply    # enforce the windows in §2
```

Run it from cron (see deployment.md). Windows live in one place —
`RETENTION` in that script — and must match §2.

**Backups.** `deploy/backup.sh` snapshots the database, so an erased account
survives in backups until they roll off (`BACKUP_RETENTION_DAYS`). This is
accepted practice: restoring a backup is an exceptional event, and the erasure
is re-applied afterwards. State your backup window in your privacy notice.

---

## 6. Security measures (Art. 32)

Authentication is OIDC with PKCE against a self-hosted Zitadel; sessions are
httpOnly, `Secure`, `SameSite=Lax` cookies that page JavaScript cannot read.
Authorization is server-side RBAC with per-role entitlement quotas. TLS is
terminated by Caddy with Let's Encrypt certificates, and the auth endpoints are
rate-limited per client IP. The database runs under a least-privilege role, and
backups are GPG-encrypted. Dependencies are scanned on every audit run
(`scripts/audit.sh`: bandit, pip-audit, detect-secrets).

---

## 7. Operator checklist — what the software cannot do for you

The platform ships the technical and organisational measures GDPR asks of the
software itself: purpose-limited collection, a documented processing record,
enforced retention, self-service access, portability and erasure, and
security-by-default in the session and authorization design. **A deployment is
compliant once the operator also does the following** — these are legal and
operational acts, not code:

- [ ] Publish a **privacy notice** (Art. 13) at the point of registration:
      your identity as controller, the §2 table in plain language, retention,
      rights, and your contact address. Link it from the sign-in page.
- [ ] Name **Google** in that notice if you enable Google login; name your SMTP
      provider.
- [ ] Decide and record whether you need a **DPO** and whether the processing
      warrants a **DPIA** (unlikely at research scale, but record the decision).
- [ ] Put a **breach procedure** in place — 72 hours to notify the supervisory
      authority (Art. 33).
- [ ] Sign a **DPA** with any provider that processes data on your behalf
      (SMTP, VM hosting).
- [ ] Schedule `purge_expired.py --apply` and confirm it runs.
- [ ] Set `ZITADEL_MGMT_URL` / `ZITADEL_MGMT_TOKEN`, or erasure is incomplete —
      the app record goes and the identity stays.
- [ ] Keep a **register of rights requests** you handle manually (restriction,
      objection).

Nothing in this document is legal advice; a controller in a regulated sector or
handling data beyond §2 should have it reviewed.
