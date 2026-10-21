#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Cristian Curaba
/**
 * cascade-mcp.mjs — connect an agent to the CASCADE tab you have open (ADR-0024).
 *
 * An MCP server over stdio (JSON-RPC 2.0, one message per line) that your agent
 * starts. It connects to CASCADE's Agent Bridge with your personal token and
 * passes the agent's tool calls to your open tab, where they run with your
 * session; this program holds no model and decides nothing. No dependencies:
 * Node.js 22 or newer (its built-in WebSocket), so there is nothing to install
 * and nothing third-party to trust.
 *
 *   CASCADE_TOKEN=<token> node cascade-mcp.mjs https://cascade-platform.org
 *
 * The token comes from CASCADE → Agent → Personal tokens. The tab must be
 * paired (Agent → Pair this tab) and the person must approve this agent.
 */

import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "cascade", version: "1.2.0" };

/** The bridge's address for a CASCADE origin: https → wss, at /api/agent/bridge/agent. */
export function bridgeUrl(origin) {
  const u = new URL(origin);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = "/api/agent/bridge/agent";
  u.search = "";
  return u.toString();
}

/** What the relay's status means, for the agent to tell the person. */
export const STATUS_TEXT = {
  no_tab: "No CASCADE tab is paired: ask the person to open CASCADE and press Pair this tab in the Agent window.",
  waiting_approval: "Connected; waiting for the person to press Approve in CASCADE's Agent window.",
  paired: "Paired with the person's CASCADE tab.",
  denied: "The person declined this agent in CASCADE.",
  unauthorized: "CASCADE refused the token: it is wrong, expired or revoked. Create a new one in CASCADE → Agent → Personal tokens.",
  disconnected: "The connection to CASCADE closed.",
};

/**
 * The MCP side, given a relay with `request(msg) → Promise<result>` and the
 * fallback tool list. Returns the JSON-RPC response for one message, or null
 * for a notification.
 */
export function createHandler({ relay, fallbackTools }) {
  return async function handle(msg) {
    const { id, method, params } = msg ?? {};
    const reply = (result) => ({ jsonrpc: "2.0", id, result });
    const fail = (code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
    if (id === undefined || id === null) return null; // a notification: nothing to answer
    switch (method) {
      case "initialize":
        return reply({
          protocolVersion: params?.protocolVersion ?? PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
          instructions: "CASCADE: model an organisation's dependencies with the person. Read AGENTS.md from the Agent Kit first. You never change the model: propose_change creates a Proposal the person applies.",
        });
      case "ping":
        return reply({});
      case "tools/list": {
        const r = await relay.request({ type: "list" });
        return reply({ tools: r.ok && Array.isArray(r.tools) ? r.tools : fallbackTools });
      }
      case "tools/call": {
        const r = await relay.request({ type: "call", tool: params?.name, args: params?.arguments ?? {} });
        // A refusal already says what to do: the relay's, and this program's own (STATUS_TEXT).
        return reply({ content: [{ type: "text", text: r.ok ? r.text : r.error }], isError: !r.ok });
      }
      default:
        return fail(-32601, `Method not found: ${method}`);
    }
  };
}

/** The relay connection: one WebSocket, requests matched to results by id. */
export function connectRelay(url, token, agentName, log) {
  let state = "disconnected";
  let socket = null;
  let next = 1;
  const pending = new Map();

  const settleAll = (error) => {
    for (const [, resolve] of pending) resolve({ ok: false, error });
    pending.clear();
  };

  function open() {
    socket = new WebSocket(url);
    socket.addEventListener("open", () => socket.send(JSON.stringify({ type: "auth", token, name: agentName() })));
    socket.addEventListener("message", (ev) => {
      let msg;
      try { msg = JSON.parse(String(ev.data)); } catch { return; }
      if (msg.type === "status") {
        state = msg.state;
        log(STATUS_TEXT[state] ?? state);
      } else if (msg.type === "result" && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    });
    socket.addEventListener("close", () => {
      if (state !== "unauthorized") state = "disconnected";
      settleAll(STATUS_TEXT[state]);
      log(STATUS_TEXT[state]);
    });
    socket.addEventListener("error", () => log(`Cannot reach ${url}.`));
  }

  return {
    status: () => state,
    start: open,
    request(msg) {
      if (!socket || socket.readyState === WebSocket.CLOSED) {
        if (state !== "unauthorized") open();
        return Promise.resolve({ ok: false, error: `${STATUS_TEXT.disconnected} Reconnecting; try again in a moment.` });
      }
      const id = next++;
      const sent = new Promise((resolve) => pending.set(id, resolve));
      const send = () => socket.send(JSON.stringify({ ...msg, id }));
      // Still connecting: the auth message goes first on open, then this one.
      if (socket.readyState === WebSocket.CONNECTING) socket.addEventListener("open", send, { once: true });
      else send();
      return sent;
    },
  };
}

function main() {
  const origin = process.argv[2] ?? process.env.CASCADE_URL;
  const token = process.env.CASCADE_TOKEN;
  const log = (line) => process.stderr.write(`[cascade] ${line}\n`);
  if (!origin || !token) {
    log("Usage: CASCADE_TOKEN=<token> node cascade-mcp.mjs <CASCADE address, e.g. https://cascade-platform.org>");
    process.exit(2);
  }
  if (typeof WebSocket === "undefined") {
    log("Node.js 22 or newer is needed (it has WebSocket built in).");
    process.exit(2);
  }
  let fallbackTools = [];
  try {
    fallbackTools = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "tools.json"), "utf8"));
  } catch {
    log("tools.json not found beside this file; the tool list comes from the paired tab only.");
  }

  let clientName = "an agent";
  const relay = connectRelay(bridgeUrl(origin), token, () => clientName, log);
  const handle = createHandler({ relay, fallbackTools });
  // Connect once the agent has said who it is (MCP initialize), so the person sees its name.
  let started = false;

  const rl = createInterface({ input: process.stdin });
  rl.on("line", async (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch {
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`);
      return;
    }
    if (msg.method === "initialize" && msg.params?.clientInfo?.name) clientName = String(msg.params.clientInfo.name).slice(0, 80);
    if (!started && msg.method === "initialize") { started = true; relay.start(); }
    const response = await handle(msg);
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  });
  rl.on("close", () => process.exit(0));
}

// Run when started as a program; stay importable for the tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
