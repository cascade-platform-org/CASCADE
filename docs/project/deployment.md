# Deployment Guide

## Prerequisites

| Component        | Version | Purpose                           |
| ---------------- | ------- | --------------------------------- |
| Node.js          | 18+     | Frontend build                    |
| Python           | 3.11+   | Backend runtime                   |
| PostgreSQL       | 15+     | Users/RBAC, logs, opt-in Sync     |
| Docker + Compose | Latest  | Optional containerized deployment |

You also need an **OAuth2/OIDC provider** configured as described in [RBAC Setup](rbac-setup.md).

---

## Security Posture — Public v1

The first public deployment is **self-service (anyone may register)**, single small
EU VM (~4 vCPU), and deliberately minimal in what it stores. The decisions below
are fixed for v1; revisit them before scaling out.

- **Authentication vs authorization split (ADR-0010, amended).** Zitadel proves
  *who* a user is; the app's Postgres owns *what they may do*. On first login the
  backend upserts the user as **`analyst`** (migration 005) — sign-in already
  requires a verified email, and the entitlement caps below (not the role gate)
  are the abuse defense. `viewer` is the guest-preview/demotion role; not-signed-in
  visitors hold no DB row at all. RBAC reads the role from the DB (not the token);
  role changes are an admin `UPDATE`.
- **Entitlement enforcement is mandatory before go-live (ADR-0008).** Public +
  unbounded engine = DoS/cost risk. Enforce per-role `max_nodes` and a per-user,
  per-minute engine-evaluation **token bucket** *before* calling the engine.
  Because the bucket is in-process, **run exactly one backend instance** in v1;
  cap Shapley permutations hard so a single allowed run can't peg the 4-vCPU box.
- **Signup gating.** Require **email verification** before an account can act, and
  enable Zitadel **brute-force lockout**. Email verification needs outbound SMTP
  (a free tier such as Brevo/Mailgun, or an institutional SMTP relay).
- **Data posture: local-first, Sync opt-in per user.** By default the server
  stores only accounts and anonymous metadata (the Analysis Log, ADR-0007);
  users' networks stay in local JSON. **Server Sync** (`/api/projects`,
  requirements.md §13.4) lets any `can_sync`-permitted user (analyst and above)
  explicitly push versions to the server — each save is a new version, up to 10
  kept per project name, older ones pruned. This is the one place actual
  network data (not just metadata) is stored server-side, strictly opt-in and
  owner-scoped (not even an admin reads another user's synced projects back).
  `projects.owner_id` cascades on user deletion, so GDPR erasure (`DELETE
  /api/auth/me`, admin delete) removes synced projects automatically.
- **Edge.** Caddy is the only internet-facing process (auto-TLS); CORS is locked
  to the exact frontend origin; the VM firewall exposes only 80/443 + SSH (key
  only). Caddy also rate-limits the auth endpoints per IP and caps `/api`
  request bodies at 10MB (a huge JSON body would otherwise be buffered in the
  backend's memory).
- **Engine runaway guard.** A single Propagation is hard-capped at 30s wall
  clock (`ENGINE_TIMEOUT_SECONDS`); the request fails with 504 instead of
  wedging an engine worker forever.
- **Backend token checks.** JWT validation checks `aud` and `iss`, rejects
  `email_verified: false` tokens (belt-and-braces on top of the Zitadel login
  policy), and refreshes JWKS on key rotation automatically.

---

## Environment Variables

For the Docker Compose deployment (Option 1) every value below lives in one
file, **`deploy/.env`** — start from `deploy/.env.example`. The lists here are
the reference for what each variable does; a manual deployment (Option 2) splits
the same values across the two `.env` files named in the headings.

### Backend (`CASCADE-backend/.env`)

```bash
# Server
HOST=0.0.0.0
PORT=8000
ENV=production
CORS_ORIGINS=https://app.your-domain.com     # exact frontend origin, no wildcard

# Database (users/RBAC, logs; project data only for opt-in Sync users).
# Under Compose the backend builds this from POSTGRES_USER/PASSWORD/DB instead.
DATABASE_URL=postgresql://user:pass@db-host:5432/cascade

# OAuth2 / OIDC
OIDC_DISCOVERY_URL=https://id.your-domain.com/.well-known/openid-configuration
OIDC_CLIENT_ID=<application client id>
OIDC_CLIENT_SECRET=                          # optional — leave empty for PKCE
OIDC_REDIRECT_URI=https://app.your-domain.com/auth/callback
OIDC_SCOPES=openid profile email
JWT_ALGORITHM=RS256
JWT_AUDIENCE=<the same application client id>
OIDC_GOOGLE_IDP_ID=                          # optional — see "Continue with Google"

# Account erasure reaches the IdP (without these, erasure is incomplete)
ZITADEL_MGMT_URL=https://id.your-domain.com
ZITADEL_MGMT_TOKEN=<service-account PAT with user-delete scope>

# Optional error reporting. Unset = no client initialised, nothing leaves the box.
SENTRY_DSN=
```

Rate limiting has no env var: it is enforced per user via role Entitlements — an
engine-evaluation token bucket (ADR-0008). `auth/entitlement.py`
(`TokenBucketLimiter`) and `api/propagation_routes.py` reject over-`max_nodes`
with 413 and over-budget with 429 before any engine work. The bucket is
in-process, so **run a single backend instance** (see Scaling Notes).

### Frontend (`CASCADE-app/.env.local`)

```bash
# Base origin only — the client appends /api/... itself.
NEXT_PUBLIC_API_URL=https://api.your-domain.com
# Public origin for absolute metadata URLs (canonical, hreflang, og:image, and
# the sitemap's own entries). Under Docker this comes from deploy/.env's
# SITE_URL as a build arg, not from this file. Set it to the apex the public
# website is served from — e.g. https://cascade-platform.org — because it is
# the origin search engines are told to index.
NEXT_PUBLIC_SITE_URL=https://your-domain.com
```

### What lives at which path

One build serves both the public website and the editor:

| Path | What |
|---|---|
| `/` | Landing page, English — indexable |
| `/it` | Landing page, Italian — indexable |
| `/robots.txt`, `/sitemap.xml` | Generated at build time from `NEXT_PUBLIC_SITE_URL` |
| `/app` | The Canvas Editor (`noindex`) |
| `/admin` | User management (`noindex`) |
| `/auth/callback` | The OIDC callback (`noindex`) |
| `/api/*` | Reverse-proxied to the backend |

**The OIDC redirect URI does not change** when upgrading a deployment that
predates the website: the callback keeps its path, `/auth/callback`. The
**post-logout** URI stays `https://<domain>/` and now lands a signed-out user on
the landing page, which is where a product site should leave them; the backend
derives it from `OIDC_REDIRECT_URI` (`api/auth_routes.py`), so there is nothing
to configure. Anyone who bookmarked the old editor URL — the bare origin — now
arrives at the landing page and reaches the editor from its "Open the platform"
button.

These two are the **only** variables the frontend reads. It holds no OIDC client
id and no map-tile URL: login is brokered entirely by the backend (the browser
receives httpOnly session cookies, never a token — api-reference.md), and the
MapLibre tile styles are the fixed OpenFreeMap set chosen in the geo canvas.

### Deployment topology (`deploy/.env`, Option 1 only)

```bash
APP_DOMAIN=your-domain.com       # Caddy vhost for the website, the editor and /api.
                                 # Since the landing page is served from its root,
                                 # this is normally the apex you want indexed.
ID_DOMAIN=id.your-domain.com     # Caddy vhost for Zitadel
SITE_URL=https://your-domain.com # MUST be https://$APP_DOMAIN. Baked into the
                                 # frontend image at build time; the origin the
                                 # website's canonical, hreflang, Open Graph and
                                 # sitemap URLs are all built from.
ZITADEL_VERSION=<pinned tag>     # never :latest — see the service table below
```

### Backups (`deploy/.env`, consumed by `deploy/backup.sh`)

```bash
BACKUP_DIR=backups
BACKUP_RETENTION_DAYS=14
BACKUP_GPG_RECIPIENT=            # optional — encrypts each dump
BACKUP_RCLONE_REMOTE=            # optional — copies dumps off the VM
```

---

## Option 1: Docker Compose (Recommended)

All Compose files live in **`deploy/`**. Services run on a single VM behind
Caddy (auto-TLS, the only internet-facing process):

| Service         | Image / build                      | Role                                             |
| --------------- | ----------------------------------- | ------------------------------------------------ |
| `web`           | `deploy/web.Dockerfile`            | Caddy — TLS + static frontend + reverse proxy    |
| `backend`       | `CASCADE-backend/Dockerfile`       | FastAPI + engine (single instance — ADR-0008)    |
| `db`            | `postgres:16`                      | Postgres — CASCADE app DB **and** the Zitadel DB |
| `zitadel`       | `ghcr.io/zitadel/zitadel`          | Self-hosted OIDC identity provider (API + admin console) |
| `zitadel-login` | `ghcr.io/zitadel/zitadel-login`    | **Production only.** Zitadel v3+ split its login screen into this separate Next.js app ("Login V2"); Caddy routes `/ui/v2/login*` on `ID_DOMAIN` to it. Absent in dev (local dev keeps the classic embedded login). |

`ZITADEL_VERSION` **must be pinned** in `.env` (no `:latest`) — `zitadel` and
`zitadel-login` must run matching, tested versions. Check available tags at
[github.com/zitadel/zitadel/releases](https://github.com/zitadel/zitadel/releases).

The stack is a base file plus two overlays:
`docker-compose.yml` (definitions, no host ports) + `docker-compose.override.yml`
(dev conveniences, **auto-loaded**) + `docker-compose.prod.yml` (prod: only Caddy
publishes 80/443, Zitadel switched to HTTPS, adds `zitadel-login`).

The database schema is applied **automatically** on backend startup (idempotent
baseline + numbered migrations under `CASCADE-backend/db/migrations/`), and the
`zitadel` database is created on first boot by `deploy/db-init/`. There is no
manual schema step.

### Configure

```bash
cd deploy
cp .env.example .env
# Edit .env: set a strong POSTGRES_PASSWORD, a 32-char ZITADEL_MASTERKEY,
# a ZITADEL_DB_PASSWORD (dedicated least-privilege Postgres role for Zitadel),
# ENV=production, APP_DOMAIN, ID_DOMAIN, CORS_ORIGINS=https://<APP_DOMAIN>,
# SITE_URL=https://<APP_DOMAIN> (baked into the frontend image at build time —
# it is what link previews resolve og:image against).
# Leave OIDC_* blank for now — you fill them after creating the Zitadel app
# (see "Identity Provider (Zitadel) Setup" below). chmod 600 .env
```

### Development (local, HTTP, auth disabled)

```bash
cd deploy
docker compose up -d --build
#   app      http://localhost:8080      api  http://localhost:8080/api/health
#   zitadel  http://localhost:8081      db   localhost:5433
```

### Production (behind the real domain, HTTPS)

```bash
cd deploy
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

DNS must already point `app.<domain>` and `id.<domain>` at the VM's IP so Caddy
can obtain Let's Encrypt certificates. See "Identity Provider Setup" and the
"VM Hardening" checklist below before exposing the box.

### Create the First Admin

New users self-register as `analyst` (ADR-0010 amendment). To bootstrap yourself: register
through the app once, then promote your account (the script only promotes an
EXISTING user — running it before registering is refused, because a pre-created
placeholder row would permanently break that email's first login):

```bash
docker compose exec backend python scripts/create_admin.py --email you@yourorg.com
```

---

## Identity Provider (Zitadel) Setup

Do this once, after `id.<domain>` resolves and the stack is up in production.

1. **First admin console login.** Browse to `https://id.<domain>`. Admin
   credentials are the `ZITADEL_ADMIN_USERNAME`/`ZITADEL_ADMIN_EMAIL`/
   `ZITADEL_ADMIN_PASSWORD` you set in `.env` — Zitadel's `FIRSTINSTANCE_ORG_HUMAN_*`
   bootstrap vars apply them on the very first `start-from-init` run. These only
   take effect against a **fresh** `zitadel` database; if you're re-bootstrapping
   after a failed attempt, drop and recreate that database first (see Backup &
   Recovery's restore procedure for the drop/create commands, applied to `zitadel`
   instead of the app DB).
2. **Create a project** (e.g. "CASCADE").
3. **Create an application** inside it:
   - Type: **Web**, auth method **PKCE** (or Code + client secret).
   - **Redirect URI:** `https://app.<domain>/auth/callback` (the frontend
     callback page — it exchanges the code with the backend and stores the session)
   - **Post-logout URI:** `https://<domain>/` — the landing page. Signing out
     leaves a user on the public site, which is where a product site should
     leave them; the backend derives this from `OIDC_REDIRECT_URI`.
4. **Enable self-service registration** and, under the org's Login Policy,
   turn on **email verification required** and **lockout** (failed-attempt
   limits). Configure **SMTP** (Settings → Notifications) so verification mail
   is actually sent — email verification does nothing without a working sender.
   Prefer the **verification code** (OTP) template over link-only, so the code
   still works when the mail is opened on another device.
5. **Copy the credentials into `deploy/.env`** and restart the backend:
   - `OIDC_DISCOVERY_URL=https://id.<domain>/.well-known/openid-configuration`
   - `OIDC_CLIENT_ID=<application client id>`
   - `OIDC_CLIENT_SECRET=<secret, if using Code auth>`
   - `OIDC_REDIRECT_URI=https://app.<domain>/auth/callback`
   - `JWT_AUDIENCE=<the application client id>` (the `aud` the tokens carry)
   - `OIDC_GOOGLE_IDP_ID=<zitadel idp id>` — optional; enables the "Continue
     with Google" shortcut (see below)

   With OIDC set and `ENV=production`, the backend enforces auth (it refuses to
   start otherwise) and reads each user's role from its own DB (ADR-0010).

### Login-experience checklist (Zitadel console, click-ops)

The sign-in/registration form is Zitadel's **hosted Login V2** — a separate app
(`ghcr.io/zitadel/zitadel-login`), not CASCADE code. CASCADE only forwards
`prompt=create` and `ui_locales` on the authorize request (api-reference.md).
Everything else is Zitadel configuration; do this pass once so users don't feel
they left the product:

- **Branding** (Settings → Branding): upload the CASCADE logo (light + dark),
  set the primary colour to the brand token, set the favicon, and enable
  **"hide Zitadel watermark"**. Biggest perceived-quality win — without it users
  bounce to a purple Zitadel-branded page mid-flow.
- **Email as username** (Settings → Login Behavior): turn **off** the separate
  "username must not be the email / must include org domain" requirements so
  registration only asks for an email and users never meet a "nome di accesso"
  field. Login already accepts email *or* username regardless.
- **Username enumeration** (Settings → Login Behavior → "Ignore unknown
  usernames"): for a small research deployment, leaving this **off** gives the
  friendlier "no account found — register?" on the first step instead of a fake
  password prompt. Turn it **on** only if enumeration is a real concern.
- **Languages** (Settings → Languages): enable Italian and English, set the
  instance default. Review **Settings → Login Texts** per language — the
  machine-translated defaults read awkwardly.
- **Passkeys / WebAuthn** (Login Policy): enable for one-tap return logins.
- **Session lifetime** (Login Policy): set generously so users aren't
  re-authenticating daily; the app's refresh-cookie is 30 days.

### Optional: "Continue with Google"

Zitadel acts as the broker — CASCADE never sees Google credentials and never
talks to Google directly, so this stays §1-safe (no paid or proprietary
dependency; Google is a *recipient* of sign-in data, not a component).

**Before enabling it, read
[privacy-and-data-protection.md §1](privacy-and-data-protection.md): Google
becomes a named recipient of personal data and must appear in your privacy
notice.** Leave `OIDC_GOOGLE_IDP_ID` unset and the button does not exist — no
request to Google is ever made (the button's Google mark is inlined SVG, so even
rendering the gate contacts nobody).

1. **Google Cloud Console** → *APIs & Services* → *Credentials* → *Create
   credentials* → **OAuth client ID**, type **Web application**.
   - Authorised redirect URI: `https://id.<domain>/ui/v2/login/idp/google/callback`
     (Zitadel's console shows the exact callback for your version — copy it from
     there rather than trusting this line).
   - Configure the OAuth consent screen; for anything beyond your own
     organisation Google requires verification before the app leaves "testing".
2. **Zitadel console** → *Settings* → *Identity Providers* → **Google**. Paste
   the client ID and secret, scopes `openid profile email`, and tick
   **automatic creation** + **automatic update** so a first Google sign-in
   provisions the Zitadel user instead of dead-ending.
3. Activate the provider on the **Login Policy** so it appears on the hosted
   login page.
4. Copy the provider's **id** from the Zitadel console URL (the numeric segment)
   into `deploy/.env` and restart the backend:

   ```
   OIDC_GOOGLE_IDP_ID=<zitadel idp id>
   ```

   The app then advertises `google_login: true` on `GET /api/auth/config` and
   the gate shows **Continue with Google**, which jumps straight past Zitadel's
   own form. The id itself never reaches the browser.

Verify: sign in with a Google account, then confirm the user appears in
`GET /api/admin/users` with role `analyst`.

---

## VM Hardening

Minimum checklist before the box is internet-facing:

- **Firewall** — allow only what's needed: `ufw allow 22`, `ufw allow 80`,
  `ufw allow 443`, `ufw enable`. Everything else (Postgres, backend, Zitadel)
  is reachable only inside the Docker network.
- **SSH** — key-only auth: in `/etc/ssh/sshd_config` set
  `PasswordAuthentication no` and `PermitRootLogin prohibit-password`, then
  `systemctl restart ssh`. Consider moving SSH off port 22.
- **Automatic security updates** — `apt install unattended-upgrades` and enable
  it, so the OS patches itself.
- **Secrets** — `deploy/.env` holds every credential; `chmod 600 deploy/.env`
  and never commit it (it is gitignored).
- **Single instance** — do not scale the backend horizontally in v1 (the
  rate-limiter is in-process; see Scaling Notes).

---

## Option 2: Manual Deployment

For a host where you supply your own process manager, reverse proxy, and
certificates.

### Backend

```bash
cd CASCADE-backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# SINGLE worker — see the note below
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1
```

The database schema applies **itself** on startup (idempotent baseline plus the
numbered migrations under `db/migrations/`, fail-closed: a failed migration
aborts startup rather than serving a half-migrated schema). There is no manual
`psql -f schema.sql` step in any deployment mode.

> **Run exactly one worker/instance in v1.** The engine-evaluation budget
> (ADR-0008) is an *in-process* token bucket, so each extra worker gives every
> user another full budget — N workers = N× the intended limit. Scaling out
> requires moving the bucket to a shared store (e.g. Redis) first.

Place it behind a reverse proxy with TLS termination.

### Frontend

The app is a **static-export SPA** (`output: "export"`), so `npm run build`
writes a finished `out/` directory — there is no Node server to run and no
separate export step.

```bash
cd CASCADE-app
npm ci
npm run build          # writes out/
```

Serve `out/` with any static file server, and point `NEXT_PUBLIC_API_URL` at the
backend origin. Because it is a single-page app, the server must fall back to
`index.html` for unknown paths (`deploy/Caddyfile` shows the shipped rule).

---

## Data Erasure (GDPR) & Audit Trail

- **Account deletion.** A user can erase their own account via
  `DELETE /api/auth/me`; a platform admin can delete any user via
  `DELETE /api/admin/users/{id}` (deleting an `admin` requires `admin`). Both
  remove the app record and its owned rows.
- **Full erasure needs the IdP.** The identity PII (email, name, credentials)
  lives in Zitadel. Set `ZITADEL_MGMT_URL` + `ZITADEL_MGMT_TOKEN` (a service
  account with user-delete scope) so deletion also removes the Zitadel user —
  **without this the account can silently re-register on next login and erasure
  is incomplete.**
- **Data export.** A user can download everything the server holds about them
  via `GET /api/auth/me/export` ("Download my data" in the account menu) —
  GDPR Art. 15/20.
- **Audit trail.** Sensitive actions (`role_change`, `account_delete`) are
  appended to the `audit_logs` table with the actor's email (denormalised so the
  trail survives the actor's own deletion). It is append-only within its
  retention window.
- **Retention.** Log tables are time-boxed (audit 730 d, analysis 365 d,
  activity uploads 180 d). Enforce them from cron — a declared window that
  nothing enforces is not a window:

  ```bash
  # dry run first; then schedule the --apply form nightly
  docker compose exec backend python scripts/purge_expired.py
  0 3 * * * cd /opt/cascade/deploy && docker compose exec -T backend \
      python scripts/purge_expired.py --apply >> /var/log/cascade-purge.log 2>&1
  ```

- **The full picture** — processing record, lawful bases, recipients, cookies,
  and the operator checklist (privacy notice, DPA, breach procedure) — is in
  [privacy-and-data-protection.md](privacy-and-data-protection.md). Work through
  its checklist before opening signup to the public.

## Engine Capacity & Entitlement Calibration

The entitlement caps (ADR-0008) must fit the VM. Run the benchmark **on the
actual box** and set the numbers from real measurements:

```bash
docker compose exec backend python scripts/benchmark_engine.py
```

A single propagation is cheap (ms); the binding cost is model-based analysis
(`permutations × N` evaluations). Size `evals_per_minute` to a fraction of the
box's CPU-seconds/minute (a migration seeds sane defaults; adjust via a new
numbered migration).

---

## Health Checks

`GET /api/health` returns `200` with `{ "status": "healthy" }` — use it for
uptime monitoring, load-balancer probes, or a Compose healthcheck:

```yaml
backend:
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:8000/api/health"]
    interval: 30s
    timeout: 5s
    retries: 3
```

The frontend has no health route: it is static files, so Caddy serving them is
itself the signal. `deploy/Caddyfile` is the reference routing config for a
manual proxy — it covers TLS, the `/api` reverse proxy, the SPA fallback, the
auth-endpoint rate limits, and the 10MB request-body cap.

---

## Scaling Notes

The backend stores no project content and holds no user session, **but it is not
fully stateless in v1**: the per-user engine-evaluation budget (ADR-0008) lives
in-process. This constrains scaling:

- **Run a single backend instance/worker for v1.** Because the rate-limiter
  state is in-process, multiple instances/workers each grant a separate budget,
  weakening the limit N-fold. **Horizontal scaling requires first moving the
  token bucket to a shared store (e.g. Redis).** Until then, no load balancer /
  multi-instance deployment.
- **No sticky sessions** are needed for identity (auth is JWT-based), but the
  rate-limiter still pins you to one instance until it is externalised.
- **Database load is minimal.** Per authenticated request the backend does a
  user lookup + entitlement read (a write only on first login or a changed
  email/name). A single small PostgreSQL instance handles many concurrent users.
- **Engine compute** is the bottleneck. Scale *up* (a bigger box), not *out*,
  until the rate-limiter is externalised.

---

## Backup & Recovery

The Postgres instance holds two databases that **must both** be backed up:

- the **CASCADE app DB** — accounts, roles, entitlements, audit/analysis logs,
  and any **Server Sync** project versions users have opted in to push;
- the **`zitadel` DB** — all identity data (users, password hashes, verification
  state). If this is lost, every user is locked out permanently.

By default project graph data is local-first — JSON on each user's machine (see
[Local-First Guide](local-first-guide.md)); only users who opted in to Server
Sync have project versions in the app DB.

### Nightly backups

`deploy/backup.sh` dumps both databases (gzip, optional GPG encryption) and,
when `BACKUP_RCLONE_REMOTE` is set, copies them **off the VM** — the only copy
that survives losing the machine. Configure it via `deploy/.env`
(`BACKUP_DIR`, `BACKUP_RETENTION_DAYS`, `BACKUP_GPG_RECIPIENT`,
`BACKUP_RCLONE_REMOTE`) and run it from cron:

```cron
# 03:15 UTC nightly
15 3 * * *  cd /opt/cascade/deploy && ./backup.sh >> /var/log/cascade-backup.log 2>&1
```

### Restore (tested procedure)

Restore into a **fresh, empty** database. Example for the app DB:

```bash
cd deploy
set -a && . ./.env && set +a          # load POSTGRES_USER / POSTGRES_DB
docker compose stop backend                 # release its connections
docker compose exec -T db psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE \"$POSTGRES_DB\";"
docker compose exec -T db psql -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE \"$POSTGRES_DB\";"
gunzip -c "backups/${POSTGRES_DB}_<timestamp>.sql.gz" | docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
docker compose start backend
```

The same pattern restores the `zitadel` database (stop the `zitadel` service
first). **Test a restore before go-live** — an untested backup is not a backup.

---

## Checklist

Before going live, verify:

- [ ] `deploy/.env` populated with production values and `chmod 600` (strong
      `POSTGRES_PASSWORD`, 32-char `ZITADEL_MASTERKEY`, `ENV=production`)
- [ ] DNS: `app.<domain>` and `id.<domain>` point at the VM; Caddy obtained certs
- [ ] Zitadel app created; `OIDC_*` + `JWT_AUDIENCE` set; email verification +
      SMTP + lockout enabled
- [ ] First admin created (`scripts/create_admin.py`) after self-registering
- [ ] `CORS_ORIGINS` = `https://app.<domain>` only
- [ ] `ZITADEL_DB_PASSWORD` set (Zitadel runs as `zitadel_user`, not the superuser)
- [ ] **Entitlement enforcement checked**: an over-`max_nodes` propagate returns
      413; exceeding the per-minute budget returns 429
- [ ] Backend runs as a **single instance/worker** (in-process rate-limiter)
- [ ] Health endpoint responding (`/api/health`); `docker compose logs` clean
- [ ] `deploy/backup.sh` scheduled AND a restore has been tested once
- [ ] VM hardening done (firewall, key-only SSH, unattended-upgrades)
- [ ] Entitlement caps calibrated: `benchmark_engine.py` run on the VM, numbers set
- [ ] Account erasure complete: `ZITADEL_MGMT_URL`/`ZITADEL_MGMT_TOKEN` set so
      deletion also removes the Zitadel identity
- [ ] Audit tooling clean: `CASCADE-backend/scripts/audit.sh` and
      `npm run lint && npm run type-check && npm run audit:deadcode && npm run audit:circular`
      (see CLAUDE.md §8a)
