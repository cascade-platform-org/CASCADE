/**
 * agent-bridge.ts — this tab's end of the Agent Bridge (ADR-0024).
 *
 * "Pair this tab" opens one WebSocket to the relay with the session cookie. An
 * agent that connects with the person's token is announced and waits until the
 * person approves it; then its tool calls arrive here, run through
 * `runAgentTool` on the live stores, and the answer goes back. Closing the tab,
 * Disconnect, or a newer tab pairing ends it, and with it every approval.
 */

import { useAgentStore } from "@/store/agent-store";
import { agentBridgeTabUrl } from "@/lib/api-client";
import { runAgentTool } from "@/lib/agent-host";
import { toolList } from "@/lib/agent-tools";

/** An agent the relay announced, waiting for the person or approved. */
export interface BridgeAgent {
  id: string;
  name: string;
  tokenName: string;
  approved: boolean;
}

let socket: WebSocket | null = null;
const agents = new Map<string, BridgeAgent>();
const listeners = new Set<() => void>();

/** A stable list between changes, as useSyncExternalStore requires. */
let snapshot: BridgeAgent[] = [];
const notify = () => {
  snapshot = [...agents.values()];
  listeners.forEach((l) => l());
};

/** The agents the relay has announced to this tab, for the window to list. */
export const bridgeAgents = (): BridgeAgent[] => snapshot;
export function onBridgeChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function send(msg: Record<string, unknown>) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

function syncState() {
  const approved = [...agents.values()].find((a) => a.approved);
  const store = useAgentStore.getState();
  if (!socket) store.setBridge({ status: "off" });
  else if (socket.readyState === WebSocket.CONNECTING) store.setBridge({ status: "connecting" });
  else if (approved) store.setBridge({ status: "paired", agent: approved.name, since: new Date().toISOString() });
  else store.setBridge({ status: "open" });
  notify();
}

async function onMessage(raw: string) {
  let msg: Record<string, unknown>;
  try { msg = JSON.parse(raw); } catch { return; }
  const agent = typeof msg.agent === "string" ? msg.agent : "";
  switch (msg.type) {
    case "agent_connected":
      agents.set(agent, { id: agent, name: String(msg.name ?? "an agent"), tokenName: String(msg.token_name ?? ""), approved: false });
      useAgentStore.getState().log("bridge", `${String(msg.name ?? "an agent")} asks to connect`);
      return syncState();
    case "agent_disconnected":
      agents.delete(agent);
      return syncState();
    case "replaced":
      useAgentStore.getState().setBridge({ status: "error", message: "Another CASCADE tab was paired; this one is no longer." });
      agents.clear();
      socket = null;
      return notify();
    case "list":
      if (!agents.get(agent)?.approved) return;
      return send({ type: "result", agent, id: msg.id, ok: true, tools: toolList() });
    case "call": {
      if (!agents.get(agent)?.approved) return;
      const outcome = await runAgentTool(String(msg.tool ?? ""), msg.args);
      return send({ type: "result", agent, id: msg.id, ...outcome });
    }
  }
}

/** Open the tab's end of the bridge. */
export function pairTab(): void {
  if (socket) return;
  const ws = new WebSocket(agentBridgeTabUrl());
  socket = ws;
  let opened = false;
  ws.addEventListener("open", () => { opened = true; syncState(); });
  ws.addEventListener("message", (ev) => void onMessage(String(ev.data)));
  ws.addEventListener("close", () => {
    if (socket !== ws) return;
    socket = null;
    agents.clear();
    const store = useAgentStore.getState();
    // Closed before it ever opened: the server refused the tab (signed out, no permission, wrong origin).
    if (!opened) {
      store.setBridge({ status: "error", message: "CASCADE refused to pair this tab: sign in with an account allowed to Propagate." });
    } else store.setBridge({ status: "off" });
    notify();
  });
  syncState();
}

export function unpairTab(): void {
  const ws = socket;
  socket = null;
  agents.clear();
  ws?.close();
  syncState();
}

export function approveAgent(id: string): void {
  const a = agents.get(id);
  if (!a) return;
  agents.set(id, { ...a, approved: true });
  send({ type: "approve", agent: id });
  useAgentStore.getState().log("bridge", `approved ${a.name}`);
  syncState();
}

export function denyAgent(id: string): void {
  const a = agents.get(id);
  if (!a) return;
  agents.set(id, { ...a, approved: false });
  send({ type: "deny", agent: id });
  useAgentStore.getState().log("bridge", `declined ${a.name}`);
  syncState();
}
