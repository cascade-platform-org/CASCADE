# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Cristian Curaba
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

import sentry_sdk
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse, Response
from prometheus_fastapi_instrumentator import Instrumentator
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

from api import (
    admin_router,
    audit_router,
    auth_router,
    health_router,
    import_router,
    propagation_router,
    sync_router,
)
from auth.oauth2 import fetch_oidc_config
from config import assert_production_safe, get_settings
from db import pool as db_pool
from db.migrate import run_migrations

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

    # Database: create the pool and bring the schema up to date. When no
    # DATABASE_URL is configured we run in local-only mode without a database.
    db_ready = False
    if settings.database_url:
        pool = await db_pool.connect()          # fail-closed: a bad URL aborts startup
        try:
            applied = await run_migrations(pool)
        except Exception:
            # Don't leak the pool if bringing the schema up to date fails.
            await db_pool.disconnect()
            raise
        logger.info(
            "Database ready (migrations applied this run: %s).", applied or "none"
        )
        db_ready = True
    else:
        logger.warning(
            "DATABASE_URL not set — running WITHOUT a database (local-only mode)."
        )

    # ADR-0010: authorization is read from the database. Auth without a DB would
    # fail open, so refuse to serve in that configuration.
    if settings.auth_enabled and not db_ready:
        raise RuntimeError(
            "Auth is enabled but no database is available — authorization cannot "
            "function (ADR-0010). Set DATABASE_URL."
        )

    try:
        yield
    finally:
        await db_pool.disconnect()
        logger.info("CASCADE backend shutting down.")


# ---------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------

def create_app() -> FastAPI:
    settings = get_settings()

    # Fail-closed guard: refuse to serve in production without auth.
    # Covers `uvicorn main:app --workers N` too — every worker imports main.
    assert_production_safe(settings)

    # Error tracking — only active when SENTRY_DSN is set (works with Sentry or a
    # self-hosted GlitchTip). No-op otherwise, so local/dev is unaffected.
    if settings.sentry_dsn:
        sentry_sdk.init(
            dsn=settings.sentry_dsn,
            environment=settings.env,
            traces_sample_rate=settings.sentry_traces_sample_rate,
        )
        logger.info("Sentry error tracking enabled.")

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

    # Global unhandled-exception catcher. Registered via `app.add_middleware`
    # (not `@app.exception_handler(Exception)` — Starlette special-cases a
    # handler keyed on `Exception`/500 to run inside ServerErrorMiddleware,
    # which is the OUTERMOST layer, added above every user middleware
    # including CORS: its response bypasses CORSMiddleware entirely, so a
    # bare `@app.exception_handler(Exception)` here would still ship a 500
    # with no CORS headers — the browser's fetch() treats that as a network
    # failure ("Failed to fetch"), hiding the real status and body. This
    # middleware is added BEFORE CORSMiddleware below, which — because
    # `add_middleware` prepends — places it INSIDE (closer to the router
    # than) CORSMiddleware, so the 500 response it builds still passes
    # through CORSMiddleware's `send` wrapper on the way out and gets the
    # Access-Control-Allow-Origin header like any other response. Sentry
    # (below) still captures the exception for observability; this only
    # controls what the client receives. Order matters: keep this add_middleware
    # call above the CORSMiddleware one.
    class UnhandledExceptionMiddleware(BaseHTTPMiddleware):
        async def dispatch(
            self, request: Request, call_next: RequestResponseEndpoint
        ) -> Response:
            try:
                return await call_next(request)
            except Exception:
                logger.exception(
                    "Unhandled exception on %s %s", request.method, request.url.path
                )
                return JSONResponse(status_code=500, content={"detail": "Internal server error."})

    app.add_middleware(UnhandledExceptionMiddleware)

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
    app.include_router(sync_router)
    app.include_router(import_router)

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

# Prometheus metrics at /metrics (request counts/latency/etc.). Instrumented on
# the singleton serving app only — NOT inside create_app(), because tests build
# many apps and re-registering the collectors would raise duplicate-timeseries
# errors on Prometheus's global registry. Not under /api, so Caddy never proxies
# it to the internet — scrape it internally.
Instrumentator().instrument(app).expose(app, include_in_schema=False)
