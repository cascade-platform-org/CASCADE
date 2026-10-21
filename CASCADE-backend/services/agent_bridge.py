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
- one tab per user; a newer tab replaces the older, which is told so;
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
from typing import Any, Protocol

from starlette.websockets import WebSocketDisconnect

# How a peer going away surfaces: a clean disconnect, or a send/receive on a closed socket.
_GONE = (WebSocketDisconnect, RuntimeError)

logger = logging.getLogger(__name__)


class Socket(Protocol):
    async def send_text(self, data: str) -> None: ...
    async def receive_text(self) -> str: ...
    async def close(self, code: int = 1000) -> None: ...


@dataclass
class _Agent:
    socket: Socket
    name: str
    token_name: str
    approved: bool = False


@dataclass
class _User:
    tab: Socket | None = None
    agents: dict[str, _Agent] = field(default_factory=dict)


NO_TAB = "No CASCADE tab is paired: ask the person to open CASCADE and press Pair this tab in the Agent window."
WAITING = "The person has not approved this agent yet: ask them to press Approve in CASCADE's Agent window."


def _loads(text: str) -> dict[str, Any] | None:
    try:
        msg = json.loads(text)
    except ValueError:
        return None
    return msg if isinstance(msg, dict) else None


async def _send(socket: Socket, msg: dict[str, Any]) -> None:
    try:
        await socket.send_text(json.dumps(msg))
    except Exception:  # nosec B110 — a peer that went away is cleaned up by its own receive loop
        pass


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
        old = user.tab
        user.tab = socket
        if old is not None:
            await _send(old, {"type": "replaced"})
            try:
                await old.close()
            except Exception:  # nosec B110
                pass
        # Whatever was approved belonged to the old tab: this one decides afresh.
        for agent_id, a in user.agents.items():
            a.approved = False
            await _send(socket, {"type": "agent_connected", "agent": agent_id, "name": a.name, "token_name": a.token_name})
            await _send(a.socket, {"type": "status", "state": "waiting_approval"})
        try:
            while True:
                msg = _loads(await socket.receive_text())
                if msg is not None:
                    await self._from_tab(user, msg)
        except _GONE:
            pass  # the tab left; the finally below tells its agents
        finally:
            if user.tab is socket:
                user.tab = None
                for a in user.agents.values():
                    a.approved = False
                    await _send(a.socket, {"type": "status", "state": "no_tab"})
            self._forget_if_empty(key)

    async def _from_tab(self, user: _User, msg: dict[str, Any]) -> None:
        agent = user.agents.get(str(msg.get("agent", "")))
        if agent is None:
            return
        kind = msg.get("type")
        if kind == "approve":
            agent.approved = True
            await _send(agent.socket, {"type": "status", "state": "paired"})
        elif kind == "deny":
            agent.approved = False
            await _send(agent.socket, {"type": "status", "state": "denied"})
        elif kind == "result":
            out = {k: v for k, v in msg.items() if k != "agent"}
            await _send(agent.socket, out)

    # ---------------------------------------------------------------- agent

    async def serve_agent(self, key: str, socket: Socket, *, name: str, token_name: str) -> None:
        """Run one authenticated agent's connection until it closes."""
        user = self._user(key)
        agent_id = secrets.token_hex(4)
        user.agents[agent_id] = _Agent(socket=socket, name=name, token_name=token_name)
        if user.tab is not None:
            await _send(user.tab, {"type": "agent_connected", "agent": agent_id, "name": name, "token_name": token_name})
            await _send(socket, {"type": "status", "state": "waiting_approval"})
        else:
            await _send(socket, {"type": "status", "state": "no_tab"})
        try:
            while True:
                msg = _loads(await socket.receive_text())
                if msg is not None:
                    await self._from_agent(user, agent_id, msg)
        except _GONE:
            pass  # the agent left; the finally below tells the tab
        finally:
            user.agents.pop(agent_id, None)
            if user.tab is not None:
                await _send(user.tab, {"type": "agent_disconnected", "agent": agent_id})
            self._forget_if_empty(key)

    async def _from_agent(self, user: _User, agent_id: str, msg: dict[str, Any]) -> None:
        if msg.get("type") not in ("call", "list"):
            return
        agent = user.agents[agent_id]
        refusal = NO_TAB if user.tab is None else WAITING if not agent.approved else None
        if refusal is not None:
            await _send(agent.socket, {"type": "result", "id": msg.get("id"), "ok": False, "error": refusal})
            return
        assert user.tab is not None  # nosec B101 — narrowed by the refusal above
        await _send(user.tab, {**msg, "agent": agent_id})


bridge = AgentBridge()
