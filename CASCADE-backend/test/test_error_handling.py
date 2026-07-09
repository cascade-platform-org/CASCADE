"""Regression test for the global unhandled-exception handler (main.py).

Without a registered handler, an uncaught exception propagates past
CORSMiddleware to Starlette's outermost ServerErrorMiddleware, whose default
500 response carries no CORS headers — the browser's fetch() then rejects
with a network-level "Failed to fetch" instead of surfacing the real status
and body. This is what actually happened for EPANET .inp imports containing a
PBV/GPV valve (see core/inp_skeleton.py and core/inp_sim.py): skeletonization
crashed with an uncaught NotImplementedError, and the resulting response had
no `access-control-allow-origin` header for the cross-origin frontend.
"""
from __future__ import annotations

import httpx
from fastapi import APIRouter
from httpx import ASGITransport

from main import create_app


def test_unhandled_exception_keeps_cors_headers():
    app = create_app()

    # A route that deliberately raises an exception type nothing in the app
    # ever registers a handler for — stands in for any future bug, not just
    # the PBV valve case (which is now caught, see test_inp_import.py).
    boom_router = APIRouter()

    @boom_router.get("/api/__test/boom")
    async def boom() -> None:
        raise RuntimeError("deliberate failure for the regression test")

    app.include_router(boom_router)

    async def run() -> httpx.Response:
        # raise_app_exceptions=False: matches real uvicorn serving, where an
        # exception handler's response is what the client gets — the default
        # (True) instead re-raises in-process for debugging, bypassing the
        # exact behavior this test exists to verify.
        transport = ASGITransport(app=app, raise_app_exceptions=False)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            return await client.get(
                "/api/__test/boom", headers={"Origin": "http://localhost:3000"}
            )

    import asyncio

    response = asyncio.run(run())

    assert response.status_code == 500
    assert response.json() == {"detail": "Internal server error."}
    # The header a browser's CORS check requires to accept the response.
    assert response.headers.get("access-control-allow-origin") == "http://localhost:3000"
