/**
 * agent-bridge.ts — this tab's end of the Agent Bridge (ADR-0024).
 *
 * "Pair this tab" opens one WebSocket to the relay with the session cookie. An
 * agent that connects with the person's token is announced and waits until the
 * person approves it; then its tool calls arrive here, run through
 * `runAgentTool` on the live stores, and the answer goes back. Closing the tab,
 * Disconnect, or a newer tab pairing ends it, and with it every approval. The
 * connection and the announced agents live in agent-store.
 */

import { useAgentStore, type BridgeAgent } from "@/store/agent-store";
import { agentBridgeTabUrl } from "@/lib/api-client";
import { runAgentTool } from "@/lib/agent-host";
import { toolList } from "@/lib/agent-tools";

let socket: WebSocket | null = null;

const store = () => useAgentStore.getState();
const approved = (id: string): boolean => store().agents.some((a) => a.id === id && a.approved);

function send(msg: Record<string, unknown>) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

async function onMessage(raw: string) {
  let msg: Record<string, unknown>;
  try { msg = JSON.parse(raw); } catch { return; }
  const agent = typeof msg.agent === "string" ? msg.agent : "";
  switch (msg.type) {
    case "agent_connected": {
      const announced: BridgeAgent = { id: agent, name: String(msg.name ?? "an agent"), tokenName: String(msg.token_name ?? ""), approved: false };
      store().setAgents((as) => [...as.filter((a) => a.id !== agent), announced]);
      return store().log("bridge", `${announced.name} asks to connect`);
    }
    case "agent_disconnected":
      return store().setAgents((as) => as.filter((a) => a.id !== agent));
    case "list":
      if (!approved(agent)) return;
      return send({ type: "result", agent, id: msg.id, ok: true, tools: toolList() });
    case "call": {
      if (!approved(agent)) return;
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
  store().setBridge({ status: "connecting" });
  ws.addEventListener("open", () => store().setBridge({ status: "open" }));
  ws.addEventListener("message", (ev) => void onMessage(String(ev.data)));
  ws.addEventListener("close", (ev) => {
    if (socket !== ws) return;
    socket = null;
    store().setAgents(() => []);
    // The relay refuses or replaces a tab with a 4xxx code and its reason in words.
    if (ev.code >= 4000) store().setBridge({ status: "error", message: ev.reason || "CASCADE refused to pair this tab." });
    else if (ev.code === 1000) store().setBridge({ status: "off" });
    else store().setBridge({ status: "error", message: "The connection to the Agent Bridge closed or could not be made." });
  });
}

export function unpairTab(): void {
  const ws = socket;
  socket = null;
  store().setAgents(() => []);
  store().setBridge({ status: "off" });
  ws?.close();
}

/** The person approves or declines an announced agent. */
export function decideAgent(id: string, approve: boolean): void {
  const a = store().agents.find((x) => x.id === id);
  if (!a) return;
  store().setAgents((as) => as.map((x) => (x.id === id ? { ...x, approved: approve } : x)));
  send({ type: approve ? "approve" : "deny", agent: id });
  store().log("bridge", `${approve ? "approved" : "declined"} ${a.name}`);
}
