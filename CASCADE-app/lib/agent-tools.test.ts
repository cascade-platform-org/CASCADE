import { describe, expect, it } from "vitest";
import { AGENT_TOOLS, callTool, toolList, type AgentHost } from "./agent-tools";
import { runExpectations } from "./expectations";
import { checkDesignText } from "./llm-design-check";
import { PLAIN_FORMAT } from "./model-text-v2";
import { DEFAULT_CONFIG } from "@/store/config-store";
import type { ProjectBundle } from "./schemas/bundle";
import type { GraphSnapshot } from "./schemas/network";
import type { Proposal } from "@/store/agent-store";

const N = DEFAULT_CONFIG.functionality_scale.length;

function bundle(): ProjectBundle {
  return {
    project: {
      version: "2.0",
      meta: { name: "Harbour" },
      nodes: {
        grid: { id: "grid", label: "Grid", functionality: N, node_type: "Source", vulnerability_levels: { cut: N - 1 } },
        clinic: { id: "clinic", label: "Clinic", functionality: N, node_type: "Service" },
      },
      edges: { e1: { id: "e1", source: "grid", target: "clinic", functionality: N } },
      canvases: [{ id: "main", label: "Main", graph: { graph_type: "generic", node_ids: ["grid", "clinic"], edge_ids: ["e1"] } }],
      update_history: [],
      scorecard: [],
      expectations: [{ id: "x1", statement: "The clinic fails with the grid", check: { kind: "scenario", events: ["cut"], advance_hours: 0, scope: "global", assertions: [{ element: "clinic", quantifier: "all", path: ["functionality"], cmp: "==", value: 1 }] } }],
    },
    config: structuredClone({ ...DEFAULT_CONFIG, events: [{ id: "cut", label: "Grid cut", type: "disservice" as const, frequency_per_10y: 1 }] }),
  };
}

/** The clinic follows the grid down. */
function engine(s: GraphSnapshot): GraphSnapshot {
  if (s.nodes.grid.functionality >= N) return s;
  return { ...s, nodes: { ...s.nodes, clinic: { ...s.nodes.clinic, functionality: s.nodes.grid.functionality, responsibility_share: { grid: 1 } } } };
}

function host(b = bundle()) {
  const proposals: Proposal[] = [];
  const shown: string[] = [];
  const env = () => ({
    start: { nodes: b.project.nodes, edges: b.project.edges, canvases: b.project.canvases },
    config: b.config,
    series: [],
    simulations: [],
    propagate: async (snapshot: GraphSnapshot) => ({ snapshot: engine(snapshot), flow: { served_ratio: {}, stored: {} } }),
  });
  const h: AgentHost = {
    bundle: () => b,
    env,
    propose: (text, notes) => {
      const p: Proposal = { id: `p${proposals.length + 1}`, text, notes, createdAt: "", status: "pending", leftOut: [] };
      proposals.push(p);
      return p;
    },
    proposal: (id) => proposals.find((p) => p.id === id),
    runExpectations: (ids) => runExpectations((b.project.expectations ?? []).filter((e) => !ids || ids.includes(e.id)), env()),
    show: (ids) => { shown.push(...ids); return ids.length; },
  };
  return { h, proposals, shown };
}

const text = async (name: string, args: unknown, h: AgentHost) => {
  const r = await callTool(name, args, h);
  if (!r.ok) throw new Error(r.error);
  return r.text;
};

describe("the tool list", () => {
  it("names each tool once, each with a JSON Schema an MCP client reads", () => {
    const list = toolList();
    expect(new Set(list.map((t) => t.name)).size).toBe(AGENT_TOOLS.length);
    for (const t of list) expect(t.inputSchema).toMatchObject({ type: "object" });
  });

  it("refuses an unknown tool and bad arguments without throwing", async () => {
    const { h } = host();
    expect(await callTool("delete_everything", {}, h)).toMatchObject({ ok: false });
    expect(await callTool("run_scenario", { events: "cut" }, h)).toMatchObject({ ok: false });
  });
});

describe("reading", () => {
  it("describes the model by id and name, with its Expectations", async () => {
    const out = await text("describe_model", {}, host().h);
    expect(out).toContain("# Harbour");
    expect(out).toContain("- clinic — Clinic — Service");
    expect(out).toContain('- x1: "The clinic fails with the grid"');
  });

  it("gives an Element as stored, by id or filter", async () => {
    const out = await text("get_elements", { where: { node_type: "Service" } }, host().h);
    expect(out).toMatch(/^1 of 1 Elements/);
    expect(out).toContain('"label": "Clinic"');
    expect(await text("get_elements", { ids: ["nope"] }, host().h)).toContain("not found: nope");
  });

  it("gives the plain-changes reference with this model's census", async () => {
    expect(await text("get_reference", { topic: "changes" }, host().h)).toContain(PLAIN_FORMAT);
  });
});

describe("proposing", () => {
  const ADD = { add: "node", value: { id: "gen", label: "Generator", node_type: "Source" }, why: "The director said there is one" };

  it("turns a checked change into a pending Proposal and writes nothing", async () => {
    const b = bundle();
    const { h, proposals } = host(b);
    const out = await text("propose_change", { changes: [ADD], notes: "backup power" }, h);
    expect(out).toMatch(/^Proposal p1 is waiting for the person/);
    expect(proposals).toHaveLength(1);
    expect(b.project.nodes.gen).toBeUndefined();
    expect(await text("get_proposal", { id: "p1" }, h)).toContain("still waiting");
  });

  it("refuses a change the check refuses, with what to repair, and proposes nothing", async () => {
    const { h, proposals } = host();
    const out = await text("propose_change", { changes: [{ connect: { from: "gen", to: "clinic" } }] }, h);
    expect(out).toMatch(/^REFUSED/);
    expect(proposals).toHaveLength(0);
  });

  it("marks what an applied Proposal adds as the agent's, unconfirmed", () => {
    const t = JSON.stringify({ format: PLAIN_FORMAT, changes: [ADD] });
    const r = checkDesignText(bundle(), { bulk: true }, t, "agent");
    expect(r.checked.ok && r.checked.after.project.nodes.gen.provenance).toEqual({ origin: "agent", rationale: ADD.why, confirmed: false });
  });
});

describe("running on a copy", () => {
  it("plays a scenario and names each degraded Element's cause", async () => {
    const b = bundle();
    const out = await text("run_scenario", { events: ["cut"] }, host(b).h);
    expect(out).toContain("Clinic (clinic): 1 (critical); caused by Grid 100%");
    expect(out).toContain("(1 engine call)");
    expect(b.project.nodes.clinic.functionality).toBe(N);
    expect(await text("run_scenario", { events: ["flood"] }, host().h)).toMatch(/^Cannot run: Unknown Event ids: flood/);
  });

  it("runs the Expectations and reports them as the window does", async () => {
    expect(await text("run_expectations", {}, host().h)).toMatch(/^1 of 1 Expectations pass\./);
  });

  it("scores Elements with a topological metric", async () => {
    expect(await text("analyse", { metric: "out_degree" }, host().h)).toContain("1. Grid (grid)");
  });

  it("selects Elements on the canvas", async () => {
    const { h, shown } = host();
    await text("show", { ids: ["clinic"] }, h);
    expect(shown).toEqual(["clinic"]);
  });
});
