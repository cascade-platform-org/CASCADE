"""
main.py — CASCADE Propagation Platform backend entry point.

Start with:
    uvicorn main:app --host 0.0.0.0 --port 8000 --reload   (development)
    uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4  (production)
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, Response

from api import (
    admin_router,
    audit_router,
    auth_router,
    health_router,
    propagation_router,
)
from auth.oauth2 import fetch_oidc_config
from config import assert_production_safe, get_settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Lifespan — startup / shutdown tasks
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    logger.info("CASCADE backend starting (env=%s auth=%s)", settings.env, settings.auth_enabled)

    if settings.auth_enabled:
        try:
            cfg = await fetch_oidc_config()
            logger.info("OIDC discovery OK: issuer=%s", cfg.get("issuer", "unknown"))
        except Exception as exc:
            logger.warning("OIDC discovery failed at startup: %s", exc)

    yield

    logger.info("CASCADE backend shutting down.")


# ---------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------

def create_app() -> FastAPI:
    settings = get_settings()

    # Fail-closed guard: refuse to serve in production without auth.
    # Covers `uvicorn main:app --workers N` too — every worker imports main.
    assert_production_safe(settings)

    app = FastAPI(
        title="CASCADE Propagation Platform",
        description=(
            "Backend for the CASCADE multi-canvas failure-propagation platform. "
            "Exposes the propagation engine, RBAC-gated API routes, and optional "
            "server-side project sync."
        ),
        version="1.0.0",
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )

    # CORS — allow the Next.js frontend origin(s)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Routers
    app.include_router(health_router)
    app.include_router(propagation_router)
    app.include_router(auth_router)
    app.include_router(admin_router)
    app.include_router(audit_router)

    # Root → API docs (eliminates the 404 when a browser hits /)
    @app.get("/", include_in_schema=False)
    async def root() -> RedirectResponse:
        return RedirectResponse(url="/api/docs")

    # Silence favicon 404 — browsers always request it
    @app.get("/favicon.ico", include_in_schema=False)
    async def favicon() -> Response:
        return Response(status_code=204)

    return app


app = create_app()
