"""The Agent Bridge (ADR-0024): pairing, approval, routing, and who may connect.

Run in local-only mode (no OIDC), where the tab and an agent with the token
`local` both belong to the local user; token storage is covered by the DB tests
at the end, which skip without TEST_DATABASE_URL.
"""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

ORIGIN = "http://localhost:3000"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv("OIDC_DISCOVERY_URL", raising=False)
    monkeypatch.delenv("OIDC_CLIENT_ID", raising=False)
    monkeypatch.setenv("CORS_ORIGINS", ORIGIN)
    monkeypatch.setenv("DATABASE_URL", "")
    from config import get_settings
    get_settings.cache_clear()
    from main import app
    return TestClient(app)


def recv(ws) -> dict:
    return json.loads(ws.receive_text())


def send(ws, msg: dict) -> None:
    ws.send_text(json.dumps(msg))


def test_a_tab_from_another_origin_is_refused(client):
    for headers in ({"origin": "https://evil.example"}, {}):
        with pytest.raises(WebSocketDisconnect) as refused:
            with client.websocket_connect("/api/agent/bridge/tab", headers=headers) as ws:
                ws.receive_text()
        assert refused.value.code == 4403 and "address" in (refused.value.reason or "")


def test_an_agent_without_auth_is_refused(client):
    with client.websocket_connect("/api/agent/bridge/agent") as agent:
        send(agent, {"type": "call", "id": 1, "tool": "describe_model", "args": {}})
        assert recv(agent) == {"type": "status", "state": "unauthorized"}


def test_local_mode_opens_only_with_the_token_local(client):
    with client.websocket_connect("/api/agent/bridge/agent") as agent:
        send(agent, {"type": "auth", "token": "cas_guess"})
        assert recv(agent) == {"type": "status", "state": "unauthorized"}


def test_no_tab_then_approval_then_a_call_round_trip(client):
    with client.websocket_connect("/api/agent/bridge/agent") as agent:
        send(agent, {"type": "auth", "token": "local", "name": "Claude Code"})
        assert recv(agent) == {"type": "status", "state": "no_tab"}
        # A call with no tab is answered at once, never left waiting.
        send(agent, {"type": "call", "id": 1, "tool": "describe_model", "args": {}})
        r = recv(agent)
        assert r["id"] == 1 and r["ok"] is False and "Pair this tab" in r["error"]

        with client.websocket_connect("/api/agent/bridge/tab", headers={"origin": ORIGIN}) as tab:
            hello = recv(tab)
            assert hello["type"] == "agent_connected" and hello["name"] == "Claude Code"
            assert recv(agent) == {"type": "status", "state": "waiting_approval"}

            # Before approval nothing reaches the tab.
            send(agent, {"type": "call", "id": 2, "tool": "describe_model", "args": {}})
            r = recv(agent)
            assert r["ok"] is False and "Approve" in r["error"]

            send(tab, {"type": "approve", "agent": hello["agent"]})
            assert recv(agent) == {"type": "status", "state": "paired"}

            send(agent, {"type": "call", "id": 3, "tool": "describe_model", "args": {}})
            call = recv(tab)
            assert call == {"type": "call", "id": 3, "tool": "describe_model", "args": {}, "agent": hello["agent"]}
            send(tab, {"type": "result", "agent": hello["agent"], "id": 3, "ok": True, "text": "# Harbour"})
            assert recv(agent) == {"type": "result", "agent": hello["agent"], "id": 3, "ok": True, "text": "# Harbour"}

        # The tab closed: the approval ends with it.
        assert recv(agent) == {"type": "status", "state": "no_tab"}


def test_a_denied_agent_stays_out_and_a_new_tab_asks_again(client):
    with client.websocket_connect("/api/agent/bridge/tab", headers={"origin": ORIGIN}) as tab:
        with client.websocket_connect("/api/agent/bridge/agent") as agent:
            send(agent, {"type": "auth", "token": "local"})
            hello = recv(tab)
            assert hello["name"] == "an agent"
            assert recv(agent)["state"] == "waiting_approval"
            send(tab, {"type": "deny", "agent": hello["agent"]})
            assert recv(agent) == {"type": "status", "state": "denied"}
            send(agent, {"type": "list", "id": "l"})
            assert recv(agent)["ok"] is False

            with client.websocket_connect("/api/agent/bridge/tab", headers={"origin": ORIGIN}) as newer:
                with pytest.raises(WebSocketDisconnect) as replaced:
                    tab.receive_text()
                assert replaced.value.code == 4409
                again = recv(newer)
                assert again["type"] == "agent_connected" and again["agent"] == hello["agent"]
                assert recv(agent)["state"] == "waiting_approval"
                send(newer, {"type": "approve", "agent": again["agent"]})
                assert recv(agent)["state"] == "paired"


def test_a_tab_hears_when_its_agent_leaves(client):
    with client.websocket_connect("/api/agent/bridge/tab", headers={"origin": ORIGIN}) as tab:
        with client.websocket_connect("/api/agent/bridge/agent") as agent:
            send(agent, {"type": "auth", "token": "local"})
            hello = recv(tab)
        assert recv(tab) == {"type": "agent_disconnected", "agent": hello["agent"]}


def test_tokens_need_a_database_in_local_mode(client):
    assert client.post("/api/agent/tokens", json={"name": "laptop"}).status_code == 501


# ---------------------------------------------------------------- database


async def test_token_lifecycle(migrated_db):
    from db import agent_tokens as db_tokens
    from db.users import upsert_user

    async with migrated_db.acquire() as conn:
        user = await upsert_user(conn, external_id="sub-1", email="a@example.org", name="A")
        record, token = await db_tokens.create_token(conn, owner_id=user.id, name="laptop")
        assert token.startswith(db_tokens.TOKEN_PREFIX)
        assert await db_tokens.owner_of(conn, token) == (user.id, "laptop")
        assert await db_tokens.owner_of(conn, token + "x") is None
        listed = await db_tokens.list_tokens(conn, owner_id=user.id)
        assert [t.name for t in listed] == ["laptop"] and listed[0].last_used_at is not None
        stored = await conn.fetchval("SELECT token_hash FROM agent_tokens")
        assert stored == db_tokens.hash_token(token) and token not in stored
        assert await db_tokens.delete_token(conn, owner_id=user.id, token_id=record.id)
        assert await db_tokens.owner_of(conn, token) is None


async def test_an_expired_token_opens_nothing(migrated_db):
    from db import agent_tokens as db_tokens
    from db.users import upsert_user

    async with migrated_db.acquire() as conn:
        user = await upsert_user(conn, external_id="sub-2", email="b@example.org", name="B")
        _, token = await db_tokens.create_token(conn, owner_id=user.id, name="old")
        await conn.execute("UPDATE agent_tokens SET expires_at = now() - interval '1 day'")
        assert await db_tokens.owner_of(conn, token) is None
