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

- **Authentication vs authorization split (ADR-0010).** Zitadel proves *who* a
  user is; the app's Postgres owns *what they may do*. On first login the backend
  upserts the user with the least-privileged role **`viewer`**, and RBAC reads the
  role from the DB (not the token). Promotion to `analyst` is an admin `UPDATE`.
  *Prerequisite:* the DB must be wired (asyncpg) and `db/schema.sql`'s new-user
  default changed from `analyst` to `viewer`.
- **Entitlement enforcement is mandatory before go-live (ADR-0008).** Public +
  unbounded engine = DoS/cost risk. Enforce per-role `max_nodes` and a per-user,
  per-minute engine-evaluation **token bucket** *before* calling the engine.
  Because the bucket is in-process, **run exactly one backend instance** in v1;
  cap Shapley permutations hard so a single allowed run can't peg the 4-vCPU box.
- **Signup gating.** Require **email verification** before an account can act, and
  enable Zitadel **brute-force lockout**. Email verification needs outbound SMTP
  (a free tier such as Brevo/Mailgun, or an institutional SMTP relay).
- **Data posture: local-first, Sync OFF.** The server stores only accounts and
  anonymous metadata (the Analysis Log, ADR-0007). Users' actual networks stay in
  local JSON on their machines. Server **Sync is deferred** — the sync routes are
  intentionally unbuilt for v1, which keeps the GDPR/breach surface minimal.
- **Edge.** Caddy is the only internet-facing process (auto-TLS); CORS is locked
  to the exact frontend origin; the VM firewall exposes only 80/443 + SSH (key
  only).

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
OIDC_REDIRECT_URI=https://your-domain.com/api/auth/callback
OIDC_SCOPES=openid profile email
JWT_ALGORITHM=RS256
JWT_AUDIENCE=your-api-audience

# Rate limiting: enforced per-user via role Entitlements — an engine-evaluation
# token bucket (ADR-0008), not a global flag. In v1 the bucket is in-process, so
# run a SINGLE backend instance (the default for the single-VM deployment below).
# Not yet implemented in code; see the DB-layer slice.

### Frontend (`CASCADE-app/.env.local`)

# Base origin only — the client appends /api/... itself.
NEXT_PUBLIC_API_URL=https://your-backend-domain.com
NEXT_PUBLIC_OIDC_CLIENT_ID=xxx
NEXT_PUBLIC_OIDC_AUTHORITY=https://provider
NEXT_PUBLIC_MAPLIBRE_STYLE=https://tiles.example.com/style.json

---

## Option 1: Docker Compose (Recommended)

> **Status: decided, not yet written (ADR-0009).** The target is a single EU-based VM (e.g. Hetzner) running **four** services via Compose behind **Caddy** (auto-TLS, the only internet-facing process): `frontend` (static export served by Caddy), `backend` (FastAPI + engine, single instance), `db` (PostgreSQL), and `idp` (**Zitadel**, self-hosted OIDC — itself backed by the `db`). Dev vs prod is a `docker-compose.override.yml` / `docker-compose.prod.yml` split driven by `ENV` (see ADR-0009). Until the files exist, use Option 2 (manual deployment).

### Build & Start

cd propagation-platform

# Copy env files

cp CASCADE-backend/.env.example CASCADE-backend/.env

# Edit CASCADE-backend/.env with your values

docker compose up --build -d

### Service Map

| Service      | Port | Description                                   |
| ------------ | ---- | --------------------------------------------- |
| `frontend` | 3000 | Next.js app (static export served by nginx)   |
| `backend`  | 8000 | FastAPI server                                |
| `db`       | 5432 | PostgreSQL (internal, not exposed by default) |

### Initialize the Database

On first run, apply the schema and seed the default roles:

docker compose exec backend python -c "
import psycopg2, os
conn = psycopg2.connect(os.environ['DATABASE_URL'])
cur = conn.cursor()
cur.execute(open('db/schema.sql').read())
cur.execute(open('db/seed.sql').read())
conn.commit()
"

Or connect directly:

docker compose exec db psql -U user -d propagation_rbac -f /docker-entrypoint-initdb.d/schema.sql

### Create the First Admin

docker compose exec backend python scripts/create_admin.py --email admin@yourorg.com

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

## Reverse Proxy Configuration (nginx)

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

The database always contains user/RBAC data. When server sync is enabled by users, their project versions are stored here too.

# Backup (covers both RBAC data and any synced project files)

pg_dump $DATABASE_URL > backup_$(date +%Y%m%d).sql

# Restore

psql $DATABASE_URL < backup_20250615.sql

For users operating in local-only mode (sync disabled), project data lives exclusively on their machines as JSON files. Encourage them to version-control their files with Git (see [Local-First Guide](local-first-guide.md)).

---

## Checklist

Before going live, verify:

- [ ] Backend `.env` is populated with production values
- [ ] PostgreSQL schema and seed applied
- [ ] Admin user created
- [ ] OIDC redirect URI registered with provider
- [ ] CORS set to frontend origin only
- [ ] TLS/HTTPS configured on reverse proxy
- [ ] Health check endpoints responding
- [ ] Rate limiting enabled
- [ ] `docker compose logs` shows no errors on startup
