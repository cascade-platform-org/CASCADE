import { describe, expect, it } from "vitest";
import { agentKitFiles } from "./agent-kit";
import { AGENT_TOOLS } from "./agent-tools";
import { PLAIN_FORMAT } from "./model-text-v2";
import { DEFAULT_CONFIG } from "@/store/config-store";
import type { ProjectBundle } from "./schemas/bundle";

const bundle: ProjectBundle = {
  project: {
    version: "2.0",
    meta: { name: "Harbour Hospital" },
    nodes: { h: { id: "h", label: "Ward A", functionality: 3 } },
    edges: {},
    canvases: [{ id: "main", label: "Main", graph: { graph_type: "generic", node_ids: ["h"], edge_ids: [] } }],
    update_history: [],
    scorecard: [],
  },
  config: DEFAULT_CONFIG,
};

describe("the Agent Kit (ADR-0024)", () => {
  const files = agentKitFiles(bundle, { apiOrigin: "https://cascade.example" }, "// program");

  it("says who owns the model and names every tool", () => {
    const md = files["AGENTS.md"];
    expect(md).toContain("The organisation owns the model.");
    for (const t of AGENT_TOOLS) expect(md).toContain(`\`${t.name}\``);
    // The interview asks the six FRAM questions in plain words and says where each answer goes.
    expect(md).toContain("What must already be in place before it can start");
    expect(md).toContain("What steers it");
  });

  it("carries the references the tools serve, this project's context and the program", () => {
    expect(files["reference/changes.md"]).toContain(PLAIN_FORMAT);
    expect(files["project/context.md"]).toContain("Ward A");
    expect(files["mcp/cascade-mcp.mjs"]).toBe("// program");
    expect(JSON.parse(files["mcp/tools.json"])).toHaveLength(AGENT_TOOLS.length);
  });

  it("tells the person how to connect to this deployment", () => {
    expect(files["SETUP.md"]).toContain("node /path/to/cascade-mcp.mjs https://cascade.example");
  });
});
