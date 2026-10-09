/**
 * LLM Design for people who do not know the platform (ADR-0022, requirements
 * §13.3b): partial apply, placement of added nodes, provenance, and what each
 * Recipe copies. Each case states the outcome.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "@/store/config-store";
import { ModelConfigurationSchema } from "./schemas/config";
import { ProjectSchema } from "./schemas/network";
import { PLAIN_FORMAT } from "./model-text-v2";
import { checkDesignText } from "./llm-design-check";
import { markAdded } from "./provenance";
import { RECIPES, focusContext, recipeContext, stateContext } from "./llm-recipes";
import type { ProjectBundle } from "./file-io";

const N = DEFAULT_CONFIG.functionality_scale.length;

function bundle(): ProjectBundle {
  return {
    project: {
      version: "2.0",
      meta: { name: "p" },
      nodes: {
        s: { id: "s", label: "Coastal Substation", functionality: N, node_type: "Source", supply_capacity: { electric: 10 }, position: { x: 0, y: 0 } },
        h: { id: "h", label: "Harbour Hospital", functionality: 2, node_type: "Service", position: { x: 300, y: 100 }, responsibility_share: { s: 0.75, q: 0.25 } },
        w: { id: "w", label: "Water Works", functionality: N, node_type: "Infrastructure" },
      },
      edges: { e: { id: "e", source: "s", target: "h", functionality: N } },
      canvases: [{ id: "main", label: "Main", graph: { graph_type: "generic", node_ids: ["s", "h", "w"], edge_ids: ["e"] } }],
      update_history: [],
      scorecard: [],
    },
    config: structuredClone({ ...DEFAULT_CONFIG, events: [{ id: "q", label: "Quake", type: "hazard" as const, frequency_per_10y: 1 }] }),
  };
}

const plain = (changes: unknown[], notes?: string) => JSON.stringify({ format: PLAIN_FORMAT, ...(notes ? { notes } : {}), changes });

const FLOOD = [
  { add: "event", value: { id: "flood", label: "Storm surge", type: "hazard", frequency_per_10y: 2 }, why: "Coastal site: surges hit the harbour" },
  { set: "vulnerability", event: "flood", to: 2, id: "s", why: "Low-lying substation" },
  { set: "importance", to: 3, id: "h", why: "Only hospital" },
];

describe("partial apply", () => {
  it("applies only the ticked changes; a left-out change is listed, crossed out, where it stood", () => {
    const b = bundle();
    const r = checkDesignText(b, { bulk: true, leaveOut: new Set([2]) }, plain(FLOOD));
    expect(r.checked.ok).toBe(true);
    if (!r.checked.ok) return;
    expect(r.checked.after.project.nodes.h.importance).toBeUndefined();
    expect(r.checked.after.project.nodes.s.vulnerability_levels?.flood).toBe(2);
    expect(r.groups?.map((g) => [g.index, !!g.left_out])).toEqual([[0, false], [1, false], [2, true]]);
    expect(r.groups?.[2].title).toBe("set importance → 3");
  });

  it("refuses a change whose prerequisite was left out, naming it by its place in the reply", () => {
    const r = checkDesignText(bundle(), { bulk: true, leaveOut: new Set([0]) }, plain(FLOOD));
    expect(r.checked.ok).toBe(false);
    if (r.checked.ok) return;
    expect(r.checked.errors.join("\n")).toMatch(/flood/);
  });

  it("leaving everything out is valid and changes nothing", () => {
    const r = checkDesignText(bundle(), { bulk: true, leaveOut: new Set([0, 1, 2]) }, plain(FLOOD));
    expect(r.checked.ok && r.checked.preview.lines.length).toBe(0);
  });
});

describe("references to Events", () => {
  it("refuses an edit that gives an Element a vulnerability to an Event that does not exist, by any path", () => {
    for (const change of [
      { set: "vulnerability", event: "typo", to: 1, id: "s" },
      { set: ["vulnerability_levels", "typo"], to: 1, id: "s" },
      { add: "node", value: { id: "x", label: "X", vulnerability_levels: { typo: 1 } } },
    ]) {
      const r = checkDesignText(bundle(), { bulk: true }, plain([change]));
      expect(r.checked.ok).toBe(false);
      if (!r.checked.ok) expect(r.checked.errors.join("\n")).toMatch(/"typo"/);
    }
  });

  it("deleting an Event in the Events section takes its vulnerability levels along", () => {
    const b = bundle();
    b.project.nodes.s.vulnerability_levels = { q: 1 };
    const r = checkDesignText(b, { bulk: false, sectionKey: "/config/events", label: "Events" }, "[]");
    expect(r.checked.ok).toBe(true);
    if (!r.checked.ok) return;
    expect(r.checked.after.config.events).toEqual([]);
    expect(r.checked.after.project.nodes.s.vulnerability_levels).toEqual({});
  });
});

describe("placing added nodes", () => {
  it("puts nodes added without a position on a grid below the Canvas's nodes, and keeps a given one", () => {
    const r = checkDesignText(bundle(), { bulk: true }, plain([
      { add: "node", value: { id: "g1", label: "Generator 1", node_type: "Source" } },
      { add: "node", value: { id: "g2", label: "Generator 2", node_type: "Source" } },
      { add: "node", value: { id: "g3", label: "Pump", node_type: "Infrastructure", position: { x: 50, y: 60 } } },
    ]));
    expect(r.checked.ok).toBe(true);
    if (!r.checked.ok) return;
    const at = (id: string) => r.checked.ok && r.checked.after.project.nodes[id].position;
    // Below the lowest node (y 100) by the gap, from the leftmost x (0), one column apart.
    expect(at("g1")).toEqual({ x: 0, y: 260 });
    expect(at("g2")).toEqual({ x: 200, y: 260 });
    expect(at("g3")).toEqual({ x: 50, y: 60 });
  });
});

describe("provenance", () => {
  it("marks what a reply adds, unconfirmed, with the why of the change that added it", () => {
    const r = checkDesignText(bundle(), { bulk: true }, plain([...FLOOD, { connect: { from: "w", to: "h" }, why: "Hospital needs water" }], "Flood red-team"));
    expect(r.checked.ok).toBe(true);
    if (!r.checked.ok) return;
    const { after } = r.checked;
    expect(after.config.events.find((e) => e.id === "flood")?.provenance).toEqual({ origin: "llm_design", rationale: "Coastal site: surges hit the harbour", confirmed: false });
    const edge = Object.values(after.project.edges).find((e) => e.source === "w");
    expect(edge?.provenance).toEqual({ origin: "llm_design", rationale: "Hospital needs water", confirmed: false });
    // Changed, not added: no mark.
    expect(after.project.nodes.h.provenance).toBeUndefined();
    expect(ProjectSchema.safeParse(after.project).success).toBe(true);
    expect(ModelConfigurationSchema.safeParse(after.config).success).toBe(true);
  });

  it("marks what an edited section adds too, without a why", () => {
    const b = bundle();
    const events = [...b.config.events, { id: "heat", label: "Heatwave", type: "hazard", frequency_per_10y: 3 }];
    const r = checkDesignText(b, { bulk: false, sectionKey: "/config/events", label: "Events" }, JSON.stringify(events));
    expect(r.checked.ok).toBe(true);
    if (!r.checked.ok) return;
    expect(r.checked.after.config.events.find((e) => e.id === "heat")?.provenance).toEqual({ origin: "llm_design", confirmed: false });
  });

  it("a reply cannot confirm what it adds, nor confirm or remove an existing mark", () => {
    const b = bundle();
    b.project.nodes.w.provenance = { origin: "llm_design", rationale: "earlier", confirmed: false };
    const r = checkDesignText(b, { bulk: true }, plain([
      { add: "node", value: { id: "x", label: "X", provenance: { origin: "llm_design", confirmed: true } } },
      { update: "node", id: "w", value: { provenance: { origin: "llm_design", confirmed: true } } },
      { update: "node", id: "h", value: { provenance: { origin: "llm_design", confirmed: true } } },
    ]));
    expect(r.checked.ok).toBe(true);
    if (!r.checked.ok) return;
    const { nodes } = r.checked.after.project;
    expect(nodes.x.provenance?.confirmed).toBe(false);
    expect(nodes.w.provenance).toEqual({ origin: "llm_design", rationale: "earlier", confirmed: false });
    expect(nodes.h.provenance).toBeUndefined();
  });

  it("leaves a bundle with nothing added as it was", () => {
    const b = bundle();
    expect(markAdded(b, b)).toEqual(b);
  });
});

describe("Recipes", () => {
  it("each copies its task, what the person wrote and the model's names", () => {
    for (const r of RECIPES) {
      const text = recipeContext(r.id, bundle(), { input: "We are a harbour hospital." });
      expect(text).toContain("# Task:");
      expect(text).toContain("We are a harbour hospital.");
      expect(text).toContain("Harbour Hospital");
      expect(text).toContain("Coastal Substation");
    }
  });

  it("the Recipes that change the model carry the plain-changes format; Explain asks for words", () => {
    for (const r of RECIPES) {
      const text = recipeContext(r.id, bundle());
      if (r.reply === "changes") expect(text).toContain(PLAIN_FORMAT);
      else expect(text).not.toContain(PLAIN_FORMAT);
    }
  });

  it("without input, the LLM is told to ask", () => {
    expect(recipeContext("describe", bundle())).toContain("nothing yet: ask them what you need");
  });

  it("red-teaming lists the existing Events so they are skipped, and the vulnerability range", () => {
    const text = recipeContext("red-team", bundle());
    expect(text).toContain("- q — Quake — hazard");
    expect(text).toContain(`levels lost (1..${N - 1})`);
  });

  it("the state names what is degraded and its causes by name, largest first", () => {
    const text = stateContext(bundle(), { metric: "betweenness", scores: { h: 1 }, ranked: [{ id: "h", kind: "node", score: 1, rank: 1 }], min: 0, max: 1, avg: 0.5 });
    expect(text).toContain(`Harbour Hospital (h): Functionality 2/${N}; caused by Coastal Substation 75%, Quake 25%`);
    expect(text).toContain("1. Harbour Hospital (node): 1.000");
    expect(text).not.toContain("Water Works (w)");
  });

  it("a focus carries the selected Elements as stored, the edges between them, and their neighbours", () => {
    const text = focusContext(bundle(), { nodeIds: ["s", "h"], edgeIds: [] });
    expect(text).toContain("2 nodes, 1 edges");
    expect(text).toContain('"Coastal Substation"');
    expect(focusContext(bundle(), { nodeIds: ["s"], edgeIds: [] })).toContain("- h — Harbour Hospital — Service");
  });
});
