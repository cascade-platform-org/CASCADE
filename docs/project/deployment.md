# Deployment Guide

## Prerequisites

| Component        | Version | Purpose                           |
| ---------------- | ------- | --------------------------------- |
| Node.js          | 18+     | Frontend build                    |
| Python           | 3.11+   | Backend runtime                   |
| PostgreSQL       | 15+     | User/RBAC storage only            |
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

### Backend (`CASCADE-backend/.env`)

# Server

HOST=0.0.0.0
PORT=8000
ENV=production
CORS_ORIGINS=https://your-frontend-domain.com

# Database (users & RBAC only — no project data)

DATABASE_URL=postgresql://user:pass@db-host:5432/propagation_rbac

# OAuth2 / OIDC

OIDC_DISCOVERY_URL=https://provider/.well-known/openid-configuration
OIDC_CLIENT_ID=xxx
OIDC_CLIENT_SECRET=xxx
OIDC_REDIRECT_URI=https://your-domain.com/auth/callback
OIDC_SCOPES=openid profile email
JWT_ALGORITHM=RS256
JWT_AUDIENCE=your-api-audience

# Rate limiting: enforced per-user via role Entitlements — an engine-evaluation
# token bucket (ADR-0008), not a global flag. In v1 the bucket is in-process, so
# run a SINGLE backend instance (the default for the single-VM deployment below).
# Implemented: auth/entitlement.py (TokenBucketLimiter) + api/propagation_routes.py
# reject over-max_nodes with 413 and over-budget with 429 before any engine work.

### Frontend (`CASCADE-app/.env.local`)

# Base origin only — the client appends /api/... itself.
NEXT_PUBLIC_API_URL=https://your-backend-domain.com
NEXT_PUBLIC_OIDC_CLIENT_ID=xxx
NEXT_PUBLIC_OIDC_AUTHORITY=https://provider
NEXT_PUBLIC_MAPLIBRE_STYLE=https://tiles.example.com/style.json

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
# ENV=production, APP_DOMAIN, ID_DOMAIN, CORS_ORIGINS=https://<APP_DOMAIN>.
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
   - **Post-logout URI:** `https://app.<domain>/`
4. **Enable self-service registration** and, under the org's Login Policy,
   turn on **email verification required** and **lockout** (failed-attempt
   limits). Configure **SMTP** (Settings → Notifications) so verification mail
   is actually sent — email verification does nothing without a working sender.
5. **Copy the credentials into `deploy/.env`** and restart the backend:
   - `OIDC_DISCOVERY_URL=https://id.<domain>/.well-known/openid-configuration`
   - `OIDC_CLIENT_ID=<application client id>`
   - `OIDC_CLIENT_SECRET=<secret, if using Code auth>`
   - `OIDC_REDIRECT_URI=https://app.<domain>/auth/callback`
   - `JWT_AUDIENCE=<the application client id>` (the `aud` the tokens carry)

   With OIDC set and `ENV=production`, the backend enforces auth (it refuses to
   start otherwise) and reads each user's role from its own DB (ADR-0010).

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

### Backend

cd CASCADE-backend

# Create virtual environment

python -m venv .venv
source .venv/bin/activate

# Install dependencies

pip install -r requirements.txt

# Apply database schema

psql $DATABASE_URL -f db/schema.sql
psql $DATABASE_URL -f db/seed.sql

# Start the server (SINGLE worker — see note below)

uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1

> **Run exactly one worker/instance in v1.** The engine-evaluation budget
> (ADR-0008) is an *in-process* token bucket, so each extra worker gives every
> user another full budget — N workers = N× the intended limit. Scaling out
> requires moving the bucket to a shared store (e.g. Redis) first.

For production, place behind a reverse proxy (nginx, Caddy) with TLS termination.

### Frontend

cd CASCADE-app

# Install dependencies

npm install

# Build for production

npm run build

# Option A: Run with Node

npm start

# Option B: Export as static site and serve with nginx

npx next export

# Serve the 'out/' directory with any static file server

---

## Option 3: Cloud Deployment

### Backend on Railway / Render / Fly.io

All three support Python apps with a `Procfile` or `Dockerfile`.

**Procfile:** (single worker — the rate-limiter is in-process; see Scaling Notes)
web: uvicorn main:app --host 0.0.0.0 --port $PORT --workers 1

Set the environment variables in the platform's dashboard. Attach a managed PostgreSQL instance for the RBAC database.

### Frontend on Vercel / Netlify / Cloudflare Pages

The Next.js frontend deploys to any static/SSR hosting:

# Vercel

vercel --prod

# Netlify

netlify deploy --prod --dir=out

Set `NEXT_PUBLIC_API_URL` to point to your deployed backend.

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
- **Audit trail.** Sensitive actions (`role_change`, `account_delete`) are
  appended to the `audit_logs` table with the actor's email (denormalised so the
  trail survives the actor's own deletion). It is append-only.

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

## Reverse Proxy Configuration (nginx)

> **Superseded for the recommended (Option 1) deployment.** Caddy in the `web`
> service handles TLS + routing via `deploy/Caddyfile`; you do not need nginx.
> The example below is retained only for a manual (Option 2) deployment where
> you supply your own proxy and certificates.

If co-hosting frontend and backend on the same domain:

server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate     /etc/ssl/certs/your-cert.pem;
    ssl_certificate_key /etc/ssl/private/your-key.pem;

    # Frontend
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Backend API
    location /api/ {
        proxy_pass http://localhost:8000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

---

## Health Checks

Both services expose health endpoints for monitoring:

- **Backend:** `GET /api/health` — returns `200` with `{ "status": "healthy" }`.
- **Frontend:** no health route exists yet. When co-hosted behind Caddy the static app is served directly; add a trivial Next.js `/api/health` route if an app-level probe is needed.

Use these with your load balancer, Docker health checks, or uptime monitoring.

# docker-compose.yml health check example

backend:
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:8000/api/health"]
    interval: 30s
    timeout: 5s
    retries: 3

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

- the **CASCADE app DB** — accounts, roles, entitlements;
- the **`zitadel` DB** — all identity data (users, password hashes, verification
  state). If this is lost, every user is locked out permanently.

Project graph data is **not** stored server-side in v1 (local-first; Sync
deferred) — it lives as JSON on each user's machine (see
[Local-First Guide](local-first-guide.md)).

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
