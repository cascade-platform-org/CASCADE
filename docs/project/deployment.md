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

# Rate limiting: no setting exists yet (nothing enforces one). Add the flag
# together with its middleware before any multi-user deployment.

### Frontend (`CASCADE-app/.env.local`)

# Base origin only — the client appends /api/... itself.
NEXT_PUBLIC_API_URL=https://your-backend-domain.com
NEXT_PUBLIC_OIDC_CLIENT_ID=xxx
NEXT_PUBLIC_OIDC_AUTHORITY=https://provider
NEXT_PUBLIC_MAPLIBRE_STYLE=https://tiles.example.com/style.json

---

## Option 1: Docker Compose (Recommended)

> **Status: not yet implemented.** No `docker-compose.yml` exists in the repo yet (an empty placeholder was removed in June 2026). This section is the target design for when it is written: three services — `frontend`, `backend`, and `db`. Until then, use Option 2 (manual deployment).

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

# Start the server

uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4

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

**Procfile:**
web: uvicorn main:app --host 0.0.0.0 --port $PORT --workers 2

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
- **Frontend:** `GET /api/health` (Next.js API route) — confirms the frontend is reachable.

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

The backend is **stateless** — it holds no session data and stores no project content. This means:

- **Horizontal scaling** is straightforward. Run multiple backend instances behind a load balancer.
- **No sticky sessions** required. Any instance can handle any request.
- **Database load is minimal.** The only DB queries are for user lookup and RBAC checks (~1-2 queries per request). A single small PostgreSQL instance handles thousands of concurrent users.
- **Engine compute** is the bottleneck. For large networks, consider deploying backend instances on compute-optimized machines (e.g., `c6i.xlarge` on AWS, `c2-standard-4` on GCP).

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
