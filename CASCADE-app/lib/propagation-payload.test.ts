import { describe, expect, it } from "vitest";
import { buildPropagationPayload } from "./propagation-payload";
import type { ModelConfiguration } from "./schemas/config";
import type { Project } from "./schemas/network";

const config = {} as ModelConfiguration; // passed through untouched

const project: Project = {
  version: "2.0",
  meta: { name: "p" },
  nodes: {
    pump: { id: "pump", functionality: 3, supply_capacity: { water: 50, hours: { rate: 10, level: 4, retention: 1, efficiency: 1 } } },
    tank: { id: "tank", functionality: 3, supply_capacity: { water: { rate: 0, level: 300, min: 50, max: 500, max_draw: 200, max_fill: 120, retention: 1, efficiency: 1 } } },
    town: { id: "town", functionality: 3 },
  },
  edges: { e: { id: "e", source: "pump", target: "town", functionality: 3, capacity: { rate: 8, level: 2, max_draw: 1, retention: 1, efficiency: 1 } } },
  canvases: [{ id: "c", graph: { graph_type: "g", node_ids: ["pump", "tank", "town"], edge_ids: ["e"] } }],
  update_history: [],
  scorecard: [],
};

describe("buildPropagationPayload and Stocks (ADR-0020 §2)", () => {
  it("sends every Stock as its number and marks storage, in both scopes", () => {
    for (const scope of ["global", "local"] as const) {
      const payload = buildPropagationPayload({ project, config, scope, activeCanvasId: "c" });
      expect(payload.project.nodes.pump.supply_capacity).toEqual({ water: 50, hours: 14 });
      expect(payload.project.nodes.tank.supply_capacity).toEqual({ water: 200 });
      expect(payload.project.edges.e.capacity).toBe(9);
      expect(payload.storage).toEqual({ tank: { water: 120 } });
    }
  });

  it("leaves a project without Stocks as it is, with no storage marker", () => {
    const plain: Project = { ...project, nodes: { town: project.nodes.town }, edges: {} };
    const payload = buildPropagationPayload({ project: plain, config, scope: "global", activeCanvasId: null });
    expect(payload.project.nodes.town).toBe(plain.nodes.town);
    expect("storage" in payload).toBe(false);
  });
});
