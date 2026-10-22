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

from auth.dependencies import ACCESS_COOKIE, require_db_id, require_permission, resolve_agent_token, resolve_user
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
# WebSocket close codes: the request broke the endpoint's policy; and the tab's
# refusals, 4000 + the HTTP status they stand for, each with its reason in words.
_POLICY = 1008
_NOT_SIGNED_IN = 4401
_FORBIDDEN = 4403


def bridge_key(user: AuthUser) -> str:
    """One switchboard slot per person: their database id, or the local user."""
    return user.db_id or user.sub


async def _token_owner(user: AuthUser = Depends(require_permission(PERMISSION))) -> str:
    return require_db_id(user, "Personal tokens", "In local-only mode an agent connects with the token 'local'.")


@router.post("/tokens", response_model=CreatedAgentToken, summary="Create a personal token for the Agent Bridge")
async def create_token(
    body: CreateAgentTokenRequest,
    conn: DBConn = Depends(get_connection),
    owner_id: str = Depends(_token_owner),
) -> CreatedAgentToken:
    record, token = await db_tokens.create_token(conn, owner_id=owner_id, name=body.name)
    return CreatedAgentToken(token=token, record=record)


@router.get("/tokens", response_model=list[AgentToken], summary="List my personal tokens")
async def list_tokens(
    conn: DBConn = Depends(get_connection),
    owner_id: str = Depends(_token_owner),
) -> list[AgentToken]:
    return await db_tokens.list_tokens(conn, owner_id=owner_id)


@router.delete("/tokens/{token_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Revoke a personal token")
async def delete_token(
    token_id: str,
    conn: DBConn = Depends(get_connection),
    owner_id: str = Depends(_token_owner),
) -> None:
    if not await db_tokens.delete_token(conn, owner_id=owner_id, token_id=token_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such token.")


async def _tab_refusal(ws: WebSocket) -> tuple[int, str] | AuthUser:
    """The tab's user, or the close code and reason it is refused with."""
    # A browser sends its cookies on a WebSocket from ANY page, so a hostile
    # site could otherwise open this socket as the user (cross-site WebSocket
    # hijacking). Only the app's own origins, the CORS list, may.
    if ws.headers.get("origin") not in get_settings().cors_origins_list:
        return _FORBIDDEN, "This page's address is not one CASCADE serves."
    try:
        user = await resolve_user(ws.cookies.get(ACCESS_COOKIE, ""))
    except HTTPException:
        return _NOT_SIGNED_IN, "Sign in to pair this tab."
    if not has_permission(user.roles, PERMISSION):
        return _FORBIDDEN, "Your account is not allowed to Propagate, which an agent's runs need."
    return user


@router.websocket("/bridge/tab")
async def tab_socket(ws: WebSocket) -> None:
    # Accepted first, so a refusal reaches the tab as a close code with its
    # reason; nothing is sent or served before the checks pass.
    await ws.accept()
    user = await _tab_refusal(ws)
    if isinstance(user, tuple):
        await ws.close(code=user[0], reason=user[1])
        return
    await bridge.serve_tab(bridge_key(user), ws)


@router.websocket("/bridge/agent")
async def agent_socket(ws: WebSocket) -> None:
    await ws.accept()
    try:
        first = json.loads(await ws.receive_text())
    except Exception:
        await ws.close(code=_POLICY)
        return
    token = first.get("token") if isinstance(first, dict) and first.get("type") == "auth" else None
    resolved = await resolve_agent_token(token) if isinstance(token, str) and token else None
    if resolved is None or not has_permission(resolved[0].roles, PERMISSION):
        await ws.send_text(json.dumps({"type": "status", "state": "unauthorized"}))
        await ws.close(code=_POLICY)
        return
    name = first.get("name")
    user, token_name = resolved
    await bridge.serve_agent(bridge_key(user), ws, name=name[:80] if isinstance(name, str) and name else "an agent", token_name=token_name)
