"""
api/agent_routes.py — the Agent Bridge (ADR-0024).

POST   /api/agent/tokens          — create a personal token (its value is returned once)
GET    /api/agent/tokens          — list mine (never their values)
DELETE /api/agent/tokens/{id}     — revoke one
WS     /api/agent/bridge/tab      — the user's open tab (session cookie; Origin checked)
WS     /api/agent/bridge/agent    — an agent (cascade-mcp); first message {type: auth, token, name}

A personal token authenticates only the agent socket: no other endpoint
accepts one, and the tools an agent calls run in the tab with the tab's own
session. Both ends require `can_propagate` (analyst and above), the
permission an agent's runs need anyway.
"""
from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, WebSocket, status

from auth.dependencies import LOCAL_USER, require_permission, resolve_user
from auth.rbac import has_permission
from config import get_settings
from db import agent_tokens as db_tokens
from db.pool import DBConn, get_connection
from schemas.agent import AgentToken, CreateAgentTokenRequest, CreatedAgentToken
from schemas.auth import AuthUser
from services.agent_bridge import bridge

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/agent", tags=["agent"])

PERMISSION = "can_propagate"
_ACCESS_COOKIE = "cascade_access"
# A WebSocket close code: the request broke the endpoint's policy.
_POLICY = 1008


def bridge_key(user: AuthUser) -> str:
    """One switchboard slot per person: their database id, or the local user."""
    return user.db_id or user.sub


def _require_db_id(user: AuthUser) -> str:
    if user.db_id is None:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="Personal tokens need a database; in local-only mode an agent connects with the token 'local'.",
        )
    return user.db_id


@router.post("/tokens", response_model=CreatedAgentToken, summary="Create a personal token for the Agent Bridge")
async def create_token(
    body: CreateAgentTokenRequest,
    conn: DBConn = Depends(get_connection),
    user: AuthUser = Depends(require_permission(PERMISSION)),
) -> CreatedAgentToken:
    record, token = await db_tokens.create_token(conn, owner_id=_require_db_id(user), name=body.name)
    return CreatedAgentToken(token=token, record=record)


@router.get("/tokens", response_model=list[AgentToken], summary="List my personal tokens")
async def list_tokens(
    conn: DBConn = Depends(get_connection),
    user: AuthUser = Depends(require_permission(PERMISSION)),
) -> list[AgentToken]:
    return await db_tokens.list_tokens(conn, owner_id=_require_db_id(user))


@router.delete("/tokens/{token_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Revoke a personal token")
async def delete_token(
    token_id: str,
    conn: DBConn = Depends(get_connection),
    user: AuthUser = Depends(require_permission(PERMISSION)),
) -> None:
    if not await db_tokens.delete_token(conn, owner_id=_require_db_id(user), token_id=token_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such token.")


@router.websocket("/bridge/tab")
async def tab_socket(ws: WebSocket) -> None:
    # A browser sends its cookies on a WebSocket from ANY page, so a hostile
    # site could otherwise open this socket as the user (cross-site WebSocket
    # hijacking). Only the app's own origins, the CORS list, may.
    if ws.headers.get("origin") not in get_settings().cors_origins_list:
        await ws.close(code=_POLICY)
        return
    try:
        user = await resolve_user(ws.cookies.get(_ACCESS_COOKIE, ""))
    except HTTPException:
        await ws.close(code=_POLICY)
        return
    if not has_permission(user.roles, PERMISSION):
        await ws.close(code=_POLICY)
        return
    await ws.accept()
    await bridge.serve_tab(bridge_key(user), ws)


async def _agent_owner(token: str) -> tuple[str, str] | None:
    """The bridge key and token name a token opens, or None."""
    settings = get_settings()
    if not settings.auth_enabled:
        return bridge_key(LOCAL_USER), "local"
    from db import pool as db_pool
    from db.users import get_user_by_id

    async with db_pool.get_pool().acquire() as conn:
        owner = await db_tokens.owner_of(conn, token)
        if owner is None:
            return None
        db_user = await get_user_by_id(conn, owner[0])
    if db_user is None or not has_permission([db_user.role_name], PERMISSION):
        return None
    return db_user.id, owner[1]


@router.websocket("/bridge/agent")
async def agent_socket(ws: WebSocket) -> None:
    await ws.accept()
    try:
        first = json.loads(await ws.receive_text())
    except Exception:
        await ws.close(code=_POLICY)
        return
    token = first.get("token") if isinstance(first, dict) and first.get("type") == "auth" else None
    owner = await _agent_owner(token) if isinstance(token, str) and token else None
    if owner is None:
        await ws.send_text(json.dumps({"type": "status", "state": "unauthorized"}))
        await ws.close(code=_POLICY)
        return
    name = first.get("name")
    await bridge.serve_agent(owner[0], ws, name=name[:80] if isinstance(name, str) and name else "an agent", token_name=owner[1])
