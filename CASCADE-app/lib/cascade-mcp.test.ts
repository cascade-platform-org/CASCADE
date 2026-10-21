/**
 * The Agent Kit's MCP server (public/agent/cascade-mcp.mjs, ADR-0024): its
 * JSON-RPC handling, without a relay. Loaded by path because it is a plain
 * .mjs shipped as a download, not a module of the app.
 */

import { describe, expect, it } from "vitest";

type Relay = { request(msg: Record<string, unknown>): Promise<Record<string, unknown>> };
type Rpc = Record<string, unknown>;
interface McpModule {
  bridgeUrl(origin: string): string;
  STATUS_TEXT: Record<string, string>;
  createHandler(o: { relay: Relay; fallbackTools: unknown[] }): (msg: Rpc) => Promise<Rpc | null>;
}

const PATH = "../public/agent/cascade-mcp.mjs";
const load = async () => (await import(/* @vite-ignore */ PATH)) as McpModule;

const sent: Record<string, unknown>[] = [];
const relay = (answer: (msg: Record<string, unknown>) => Record<string, unknown>): Relay => ({
  request: async (msg) => {
    sent.push(msg);
    return answer(msg);
  },
});

describe("cascade-mcp", () => {
  it("derives the bridge's address from the CASCADE origin", async () => {
    const m = await load();
    expect(m.bridgeUrl("https://cascade-platform.org")).toBe("wss://cascade-platform.org/api/agent/bridge/agent");
    expect(m.bridgeUrl("http://localhost:8080/app?x=1")).toBe("ws://localhost:8080/api/agent/bridge/agent");
  });

  it("initializes as a tools server and answers no notification", async () => {
    const handle = (await load()).createHandler({ relay: relay(() => ({ ok: true })), fallbackTools: [] });
    const init = await handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    expect(init).toMatchObject({ id: 1, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "cascade" } } });
    expect(await handle({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    expect(await handle({ jsonrpc: "2.0", id: 2, method: "resources/list" })).toMatchObject({ error: { code: -32601 } });
  });

  it("lists the tab's tools, or the shipped ones when no tab answers", async () => {
    const m = await load();
    const live = m.createHandler({ relay: relay(() => ({ ok: true, tools: [{ name: "describe_model" }] })), fallbackTools: [{ name: "old" }] });
    expect(await live({ id: 3, method: "tools/list" })).toMatchObject({ result: { tools: [{ name: "describe_model" }] } });
    const none = m.createHandler({ relay: relay(() => ({ ok: false, error: "no tab" })), fallbackTools: [{ name: "old" }] });
    expect(await none({ id: 4, method: "tools/list" })).toMatchObject({ result: { tools: [{ name: "old" }] } });
  });

  it("passes a call to the tab and returns its text, or the refusal with what to do", async () => {
    const m = await load();
    sent.length = 0;
    const ok = m.createHandler({ relay: relay(() => ({ ok: true, text: "# Harbour" })), fallbackTools: [] });
    expect(await ok({ id: 5, method: "tools/call", params: { name: "describe_model", arguments: {} } })).toMatchObject({
      result: { content: [{ type: "text", text: "# Harbour" }], isError: false },
    });
    expect(sent).toEqual([{ type: "call", tool: "describe_model", args: {} }]);
    const waiting = m.createHandler({ relay: relay(() => ({ ok: false, error: "The person has not approved this agent yet." })), fallbackTools: [] });
    const r = (await waiting({ id: 6, method: "tools/call", params: { name: "describe_model" } })) as { result: { content: { text: string }[]; isError: boolean } };
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toBe("The person has not approved this agent yet.");
  });
});
