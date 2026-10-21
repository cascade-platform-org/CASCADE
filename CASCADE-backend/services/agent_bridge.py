"""
services/agent_bridge.py — the Agent Bridge relay (ADR-0024).

A switchboard, per user: on one side that user's open CASCADE tab, on the
other the agents they started with a personal token (cascade-mcp). The relay
pairs them and passes messages through. It never reads a message beyond its
routing fields (`type`, `agent`, `id`) and never stores or logs one: tool
calls and their answers carry the user's model, which ADR-0007 keeps off the
server's disk. The tools themselves run in the tab, with the tab's session,
so the relay grants an agent nothing the person's own tab could not do.

Rules:
- one tab per user; a newer tab replaces the older, which is closed with
  `REPLACED` and the reason;
- an agent can do nothing until the person approves it in the tab, and every
  approval ends with the tab (a new tab asks again);
- a call while no tab is paired, or before approval, is answered at once
  with why, so an agent never waits on nobody.

State is in memory, which assumes the single backend instance ADR-0008
already assumes for the Entitlement meter.
"""
from __future__ import annotations

import json
import logging
import secrets
from dataclasses import dataclass, field
from collections.abc import Awaitable, Callable
from typing import Any, Protocol

from starlette.websockets import WebSocketDisconnect

# How a peer going away surfaces: a clean disconnect, or a send/receive on a closed socket.
_GONE = (WebSocketDisconnect, RuntimeError)

logger = logging.getLogger(__name__)


class Socket(Protocol):
    async def send_text(self, data: str) -> None: ...
    async def receive_text(self) -> str: ...
    async def close(self, code: int = 1000, reason: str | None = None) -> None: ...


@dataclass
class _Agent:
    socket: Socket
    name: str
    token_name: str
    # The tab that approved it: an approval ends with that tab.
    approved_by: Socket | None = None


@dataclass
class _User:
    tab: Socket | None = None
    agents: dict[str, _Agent] = field(default_factory=dict)

    def approved(self, agent: _Agent) -> bool:
        return self.tab is not None and agent.approved_by is self.tab


NO_TAB = "No CASCADE tab is paired: ask the person to open CASCADE and press Pair this tab in the Agent window."
WAITING = "The person has not approved this agent yet: ask them to press Approve in CASCADE's Agent window."
# The close code an older tab gets when a newer one pairs (4000 + HTTP 409 Conflict).
REPLACED = 4409


def _loads(text: str) -> dict[str, Any] | None:
    try:
        msg = json.loads(text)
    except ValueError:
        return None
    return msg if isinstance(msg, dict) else None


async def _send(socket: Socket, msg: dict[str, Any] | str) -> None:
    try:
        await socket.send_text(msg if isinstance(msg, str) else json.dumps(msg))
    except Exception:  # nosec B110 — a peer that went away is cleaned up by its own receive loop
        pass


async def _pump(socket: Socket, handle: Callable[[dict[str, Any], str], Awaitable[None]]) -> None:
    """Hand each message a socket sends to `handle`, parsed and raw, until it goes away."""
    try:
        while True:
            raw = await socket.receive_text()
            msg = _loads(raw)
            if msg is not None:
                await handle(msg, raw)
    except _GONE:
        pass


def _announce(agent_id: str, agent: _Agent) -> dict[str, Any]:
    return {"type": "agent_connected", "agent": agent_id, "name": agent.name, "token_name": agent.token_name}


class AgentBridge:
    def __init__(self) -> None:
        self._users: dict[str, _User] = {}

    def _user(self, key: str) -> _User:
        return self._users.setdefault(key, _User())

    def _forget_if_empty(self, key: str) -> None:
        u = self._users.get(key)
        if u and u.tab is None and not u.agents:
            del self._users[key]

    # ------------------------------------------------------------------ tab

    async def serve_tab(self, key: str, socket: Socket) -> None:
        """Run one tab's connection until it closes."""
        user = self._user(key)
        old, user.tab = user.tab, socket
        if old is not None:
            try:
                await old.close(code=REPLACED, reason="Another CASCADE tab was paired; this one is no longer.")
            except Exception:  # nosec B110
                pass
        # Whatever was approved belonged to the old tab: this one decides afresh.
        for agent_id, a in user.agents.items():
            await _send(socket, _announce(agent_id, a))
            await _send(a.socket, {"type": "status", "state": "waiting_approval"})
        try:
            await _pump(socket, lambda msg, raw: self._from_tab(user, msg, raw))
        finally:
            if user.tab is socket:
                user.tab = None
                for a in user.agents.values():
                    await _send(a.socket, {"type": "status", "state": "no_tab"})
            self._forget_if_empty(key)

    async def _from_tab(self, user: _User, msg: dict[str, Any], raw: str) -> None:
        agent = user.agents.get(str(msg.get("agent", "")))
        if agent is None:
            return
        kind = msg.get("type")
        if kind == "approve":
            agent.approved_by = user.tab
            await _send(agent.socket, {"type": "status", "state": "paired"})
        elif kind == "deny":
            agent.approved_by = None
            await _send(agent.socket, {"type": "status", "state": "denied"})
        elif kind == "result":
            # Passed through as it came: a result can be large, and the agent ignores the routing field.
            await _send(agent.socket, raw)

    # ---------------------------------------------------------------- agent

    async def serve_agent(self, key: str, socket: Socket, *, name: str, token_name: str) -> None:
        """Run one authenticated agent's connection until it closes."""
        user = self._user(key)
        agent_id = secrets.token_hex(4)
        agent = user.agents[agent_id] = _Agent(socket=socket, name=name, token_name=token_name)
        if user.tab is not None:
            await _send(user.tab, _announce(agent_id, agent))
            await _send(socket, {"type": "status", "state": "waiting_approval"})
        else:
            await _send(socket, {"type": "status", "state": "no_tab"})
        try:
            await _pump(socket, lambda msg, _raw: self._from_agent(user, agent_id, msg))
        finally:
            user.agents.pop(agent_id, None)
            if user.tab is not None:
                await _send(user.tab, {"type": "agent_disconnected", "agent": agent_id})
            self._forget_if_empty(key)

    async def _from_agent(self, user: _User, agent_id: str, msg: dict[str, Any]) -> None:
        if msg.get("type") not in ("call", "list"):
            return
        agent = user.agents[agent_id]
        if user.tab is None:
            await _send(agent.socket, {"type": "result", "id": msg.get("id"), "ok": False, "error": NO_TAB})
        elif not user.approved(agent):
            await _send(agent.socket, {"type": "result", "id": msg.get("id"), "ok": False, "error": WAITING})
        else:
            await _send(user.tab, {**msg, "agent": agent_id})


bridge = AgentBridge()
