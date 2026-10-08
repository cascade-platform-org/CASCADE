/**
 * model-text-sections — the Model text's tree (ADR-0022): every level opens
 * on its current JSON, an untouched section changes nothing, and an edited one
 * becomes patch operations that pass the same check as a hand-written change
 * set, taking along what a removal or an addition implies.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "@/store/config-store";
import { MODEL_TEXT_FORMAT, checkChange } from "./model-text";
import { BULK_KEY, findSection, sectionPatch, sectionTree, sectionValue, type Section } from "./model-text-sections";
import type { ProjectBundle } from "./file-io";

const N = DEFAULT_CONFIG.functionality_scale.length;

function bundle(): ProjectBundle {
  return {
    project: {
      version: "2.0",
      meta: { name: "p" },
      nodes: {
        s: { id: "s", label: "Source", functionality: N },
        c: { id: "c", label: "City", functionality: N },
        x: { id: "x", label: "Spare", functionality: N },
      },
      edges: { e: { id: "e", source: "s", target: "c", functionality: N } },
      canvases: [{ id: "c1", label: "Main", graph: { graph_type: "generic", node_ids: ["s", "c"], edge_ids: ["e"] } }],
      update_history: [],
      scorecard: [],
    },
    config: structuredClone({ ...DEFAULT_CONFIG, events: [{ id: "q", label: "Quake", type: "hazard" as const, frequency_per_10y: 1 }] }),
  };
}

const section = (b: ProjectBundle, key: string): Section => {
  const s = findSection(sectionTree(b), key);
  if (!s) throw new Error(`no section ${key}`);
  return s;
};

/** Edit a section's JSON and run the result through the check. */
function edit(b: ProjectBundle, key: string, fn: (v: never) => unknown) {
  const s = section(b, key);
  const result = sectionPatch(b, s, fn(structuredClone(sectionValue(b, s)) as never));
  if ("error" in result) return { error: result.error };
  return { patch: result.patch, checked: checkChange(b, { format: MODEL_TEXT_FORMAT, patch: result.patch, elements: [] }) };
}

const walk = (tree: readonly Section[]): Section[] => tree.flatMap((s) => [s, ...walk(s.children ?? [])]);

describe("the tree", () => {
  it("arranges the project and the configuration, with Nodes and Edges by Canvas", () => {
    const tree = sectionTree(bundle());
    expect(tree.map((s) => s.label)).toEqual(["Project", "Configuration", "Bulk operations"]);
    const nodes = section(bundle(), "/project/nodes");
    expect(nodes.count).toBe(3);
    expect(nodes.children?.map((g) => [g.label, g.count])).toEqual([["On Main", 2], ["Not on a Canvas", 1]]);
    expect(section(bundle(), "/project/edges").children?.[0].children?.[0].label).toBe("Source → City");
    expect(section(bundle(), "/config/events/0").label).toBe("Quake");
    expect(findSection(tree, BULK_KEY)).toBeDefined();
  });

  it("opens every section on its current value, keeps update_history out, and an untouched one changes nothing", () => {
    const b = bundle();
    expect(sectionValue(b, section(b, "/project"))).not.toHaveProperty("update_history");
    expect(sectionValue(b, section(b, "/project/nodes@c1"))).toEqual({ s: b.project.nodes.s, c: b.project.nodes.c });
    for (const s of walk(sectionTree(b)).filter((x) => x.key !== BULK_KEY)) {
      expect(sectionPatch(b, s, structuredClone(sectionValue(b, s))), s.key).toEqual({ patch: [] });
    }
  });
});

describe("editing a section", () => {
  it("a leaf: one replace, previewed", () => {
    const r = edit(bundle(), "/config/events/0", (e: { label: string }) => ({ ...e, label: "Earthquake" }));
    expect(r.patch).toEqual([{ op: "replace", path: "/config/events/0", value: expect.objectContaining({ label: "Earthquake" }) }]);
    expect(r.checked?.ok && r.checked.preview.lines.map((l) => l.where)).toEqual(['config › events "q" › label']);
  });

  it("a group in bulk: a new Event appended to the list", () => {
    const r = edit(bundle(), "/config/events", (list: object[]) => [...list, { id: "flood", label: "Flood", type: "hazard", frequency_per_10y: 0 }]);
    expect(r.checked?.ok && r.checked.preview.lines.map((l) => `${l.kind} ${l.where}`)).toEqual(['add config › events "flood"']);
  });

  it("a node removed from Nodes takes its edges and its places on Canvases along, and passes the check", () => {
    const r = edit(bundle(), "/project/nodes", (nodes: Record<string, unknown>) => { delete nodes.c; return nodes; });
    expect(r.checked?.ok).toBe(true);
    if (!r.checked?.ok) return;
    expect(r.checked.after.project.edges).toEqual({});
    expect(r.checked.after.project.canvases[0].graph).toMatchObject({ node_ids: ["s"], edge_ids: [] });
    expect(r.checked.preview.lines.map((l) => `${l.kind} ${l.where}`)).toEqual(expect.arrayContaining(['remove Node "City" (c)', "remove Edge e"]));
  });

  it("a node added in a Canvas's group is placed on that Canvas", () => {
    const r = edit(bundle(), "/project/nodes@c1", (nodes: Record<string, unknown>) => ({ ...nodes, w: { id: "w", label: "Well", functionality: N } }));
    expect(r.checked?.ok).toBe(true);
    if (r.checked?.ok) expect(r.checked.after.project.canvases[0].graph.node_ids).toEqual(["s", "c", "w"]);
  });

  it("the project in bulk: a key cannot be removed, and the history cannot be smuggled in", () => {
    expect(edit(bundle(), "/project", (p: Record<string, unknown>) => { delete p.scorecard; return p; })).toMatchObject({ error: expect.stringMatching(/cannot be removed/) });
    const r = edit(bundle(), "/project", (p: Record<string, unknown>) => ({ ...p, update_history: [] }));
    expect(r.checked && !r.checked.ok && r.checked.errors.join()).toMatch(/read-only/);
  });

  it("a list where an object belongs is refused with what belongs there", () => {
    expect(edit(bundle(), "/project/nodes", () => [])).toMatchObject({ error: expect.stringMatching(/is an object/) });
  });
});
