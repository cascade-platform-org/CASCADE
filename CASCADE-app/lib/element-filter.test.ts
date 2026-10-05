import { describe, expect, it } from "vitest";
import { elementLabel, filterMisuse, matchElements, type FilterableModel } from "./element-filter";
import type { Canvas, Edge, Node } from "./schemas/network";

const node = (id: string, extra: Partial<Node> = {}): Node => ({ id, functionality: 4, ...extra }) as Node;
const edge = (id: string, source: string, target: string, extra: Partial<Edge> = {}): Edge =>
  ({ id, source, target, functionality: 4, ...extra }) as Edge;

const model: FilterableModel = {
  nodes: {
    pool: node("pool", { label: "Worker pool", node_type: "Personnel", supply_capacity: { hours: 1000 } }),
    a1: node("a1", { label: "Kitchen", node_type: "Service", category_dependency_profiles: { hours: { demand: 100 } } as unknown as Node["category_dependency_profiles"], properties: { area: "food" } }),
    a2: node("a2", { label: "Laundry", node_type: "Service", category_dependency_profiles: { hours: { demand: 50 } } as unknown as Node["category_dependency_profiles"], properties: { area: "care" } }),
    t: node("t", { label: "Tank", node_type: "Infrastructure", node_categories: ["water"] }),
  },
  edges: {
    e1: edge("e1", "pool", "a1", { properties: { area: "food" } }),
    e2: edge("e2", "pool", "a2"),
    e3: edge("e3", "t", "a1"),
  },
  canvases: {
    c1: { id: "c1", label: "Workforce", graph: { graph_type: "default", node_ids: ["pool", "a1", "a2"], edge_ids: ["e1", "e2"] } } as unknown as Canvas,
  },
};

describe("matchElements", () => {
  it("selects nodes by Node Type, case-insensitively", () => {
    expect(matchElements({ kind: "node", node_type: "service" }, model)).toEqual(["a1", "a2"]);
  });
  it("selects nodes by a supplied, demanded or tagged Category", () => {
    expect(matchElements({ kind: "node", category: "hours" }, model)).toEqual(["a1", "a2", "pool"]);
    expect(matchElements({ kind: "node", category: "water" }, model)).toEqual(["t"]);
  });
  it("selects edges by the source's supply Category, and reads an edge's label as its endpoints", () => {
    expect(matchElements({ kind: "edge", category: "hours" }, model)).toEqual(["e1", "e2"]);
    expect(elementLabel("e1", model)).toBe("Worker pool → Kitchen");
    expect(matchElements({ kind: "edge", label_contains: "laundry" }, model)).toEqual(["e2"]);
  });
  it("ANDs canvas, label and Node Type", () => {
    expect(matchElements({ kind: "node", canvas: "Workforce", node_type: "Service", label_contains: "kit" }, model)).toEqual(["a1"]);
    expect(matchElements({ kind: "node", label_contains: "TANK" }, model)).toEqual(["t"]);
  });
  it("drops hand-unticked matches, and still includes an Element that starts matching later", () => {
    const f = { kind: "node" as const, node_type: "Service", exclude: ["a2"] };
    expect(matchElements(f, model)).toEqual(["a1"]);
    const later: FilterableModel = { ...model, nodes: { ...model.nodes, a3: node("a3", { node_type: "Service" }) } };
    expect(matchElements(f, later)).toEqual(["a1", "a3"]);
  });
  it("selects nothing for an unknown canvas", () => {
    expect(matchElements({ kind: "node", canvas: "nope" }, model)).toEqual([]);
  });
  it("reports conditions that do not apply to the kind", () => {
    expect(filterMisuse({ kind: "edge", node_type: "Service" })).toEqual(["node_type applies to nodes only"]);
  });
});
