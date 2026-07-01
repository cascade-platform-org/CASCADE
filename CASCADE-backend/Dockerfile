# CASCADE backend image — FastAPI + propagation engine.
#
# A Docker image is a self-contained snapshot of the app and everything it needs
# to run (Python, dependencies, code). The container that runs from it is
# disposable: all durable state lives in Postgres, never in the container.
#
# IMPORTANT: build with the REPO ROOT as context (not CASCADE-backend/), because
# the backend bundles the shared Rule DSL grammar authored under CASCADE-app/.
# Compose does this for you (see deploy/docker-compose.yml).

FROM python:3.12-slim

# PYTHONUNBUFFERED: log lines appear immediately (not buffered) so `docker logs`
# is live. PYTHONDONTWRITEBYTECODE: don't litter .pyc files in the image.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Install dependencies first, as their own layer. Docker caches layers, so this
# expensive step is only re-run when requirements.txt changes — not on every
# code edit.
COPY CASCADE-backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Application code (the .dockerignore at the repo root keeps caches/venv/tests
# out of the image).
COPY CASCADE-backend/ .

# Bundle a build-time copy of the shared grammar (canonical source lives in the
# frontend tree). core/rule_grammar.py looks for it here at /app/shared/.
COPY CASCADE-app/shared/rule-grammar.json ./shared/rule-grammar.json

# Run as an unprivileged user: if the process is ever compromised, it has no
# root inside the container.
RUN useradd --create-home appuser && chown -R appuser /app
USER appuser

EXPOSE 8000

# Liveness probe used by Compose. slim has no curl, so use Python's urllib.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health')" || exit 1

# ONE worker on purpose: the engine-evaluation budget (ADR-0008) is an in-process
# token bucket, so multiple workers would multiply every user's limit. Scaling
# out requires externalising that state first (see deployment.md → Scaling Notes).
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
