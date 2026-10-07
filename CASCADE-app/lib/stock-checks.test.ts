import { describe, expect, it } from "vitest";
import { undeclaredCapacities } from "./stock-checks";
import type { Edge, Node } from "./schemas/network";

const node = (id: string, over: Partial<Node> = {}): Node => ({ id, functionality: 3, ...over });
const edge = (id: string, source: string, target: string, over: Partial<Edge> = {}): Edge => ({ id, source, target, functionality: 3, ...over });

describe("undeclaredCapacities", () => {
  it("counts the Category's edges and nodes with no declared capacity, and nothing outside it", () => {
    const nodes = {
      tank: node("tank", { supply_capacity: { water: { rate: 0, level: 5, max_fill: 2, retention: 1, efficiency: 1 } }, throughput_capacity: { water: 9 } }),
      town: node("town", { category_dependency_profiles: { water: { dependency_level: 3, demand: 4 } } }),
      relay: node("relay", { node_categories: ["water"] }),
      office: node("office", { node_categories: ["power"] }),
    };
    const edges = {
      a: edge("a", "tank", "relay"),
      b: edge("b", "relay", "town", { capacity: 5 }),
      c: edge("c", "relay", "office"),
    };
    expect(undeclaredCapacities("water", nodes, edges)).toEqual({ edges: 1, nodes: 2 });
  });
});
