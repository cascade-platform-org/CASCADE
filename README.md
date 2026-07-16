# CASCADE

[![CI](https://github.com/Cristian-Curaba/CASCADE-app/actions/workflows/ci.yml/badge.svg)](https://github.com/Cristian-Curaba/CASCADE-app/actions/workflows/ci.yml)

A platform for modelling multi-canvas systems and analysing how failures cascade
across their Elements. See [CONTEXT.md](CONTEXT.md) for the domain glossary and
[CLAUDE.md](CLAUDE.md) for development guidelines.

## Layout

| Path              | What                                                        |
| ----------------- | ----------------------------------------------------------- |
| `CASCADE-app/`     | Next.js frontend (static-export SPA)                       |
| `CASCADE-backend/` | FastAPI backend + propagation engine                       |
| `deploy/`          | Docker Compose stack (db, backend, web/Caddy, Zitadel)     |
| `docs/`            | Project docs (`project/`) and decision records (`adr/`)    |

## Develop

Run the full stack locally (HTTP, auth disabled):

```bash
cd deploy
cp .env.example .env        # then edit; chmod 600 .env
docker compose up -d --build
#   app  http://localhost:8080     api  http://localhost:8080/api/health
```

See [docs/project/deployment.md](docs/project/deployment.md) for the production
(HTTPS + Zitadel) deployment and the go-live checklist.

## Test

```bash
# Backend. DB-integration tests need a Postgres; without one they skip.
cd CASCADE-backend
docker run -d --name pg -e POSTGRES_PASSWORD=pw -p 5433:5432 postgres:16
TEST_DATABASE_URL=postgresql://postgres:pw@localhost:5433/postgres python -m pytest -q
ruff check .

# Frontend
cd CASCADE-app && npm ci && npx tsc --noEmit && npm run build
```

## CI

Every push to `main` and every pull request runs
[`.github/workflows/ci.yml`](.github/workflows/ci.yml): backend lint + tests
(against a real Postgres) + Pydantic→JSON-Schema drift check, frontend
type-check + build, docs integrity + internal-link check, and Docker
image/compose validation.

**Recommended:** protect `main` so changes must pass CI before merging —
GitHub → *Settings → Branches → Add branch protection rule* for `main`, enable
*Require status checks to pass before merging*, and select the **Backend**,
**Frontend**, **Docs**, and **Docker** checks.
