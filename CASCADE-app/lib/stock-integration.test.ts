import { describe, expect, it } from "vitest";
import { integrateStocks } from "./stock-integration";
import { periodState, runTimeline } from "./step-operator";
import { planTimeline } from "./timeline-plan";
import type { Edge, GraphSnapshot, Node, Stock } from "./schemas/network";

const N = 3;
const stock = (over: Partial<Stock>): Stock => ({ rate: 0, level: 0, retention: 1, efficiency: 1, ...over });
const node = (id: string, over: Partial<Node> = {}): Node => ({ id, functionality: N, node_categories: ["water"], ...over });
const consumer = (id: string, demand: number): Node =>
  node(id, { category_dependency_profiles: { water: { dependency_level: N, demand } } });
const edge = (id: string, source: string, target: string, over: Partial<Edge> = {}): Edge => ({ id, source, target, functionality: N, ...over });
const snap = (nodes: Node[], edges: Edge[] = []): GraphSnapshot => ({
  nodes: Object.fromEntries(nodes.map((x) => [x.id, x])),
  edges: Object.fromEntries(edges.map((x) => [x.id, x])),
  canvases: [],
});
const levelOf = (s: GraphSnapshot, id: string) => (s.nodes[id].supply_capacity?.water as Stock).level;

describe("integrateStocks", () => {
  it("moves storage by what the engine filled and drew", () => {
    const s = snap([node("tank", { supply_capacity: { water: stock({ level: 300, max: 500, max_fill: 100 }) } }), consumer("town", 50)]);
    const out = integrateStocks(s, { served_ratio: { town: { water: 1 } }, stored: { tank: { water: { filled: 20, drawn: 70 } } } }, N);
    expect(levelOf(out.snapshot, "tank")).toBe(250);
    expect(out.outcomes).toEqual([{ element: "tank", category: "water", level: 250, spilled: 0, unmet: 0 }]);
  });

  it("integrates the one source from every delivery, less what storage drew", () => {
    const s = snap([
      node("pump", { supply_capacity: { water: stock({ rate: 100, level: 40 }) } }),
      node("tank", { supply_capacity: { water: stock({ level: 10, max_fill: 5 }) } }),
      consumer("a", 80),
      consumer("b", 40),
    ]);
    const flow = { served_ratio: { a: { water: 1 }, b: { water: 0.5 } }, stored: { tank: { water: { filled: 0, drawn: 10 } } } };
    // Delivered 80 + 20 = 100, of which the tank drew 10: the pump sent 90. 40 + 100 − 90 = 50.
    expect(levelOf(integrateStocks(s, flow, N).snapshot, "pump")).toBe(50);
  });

  it("skips a node Stock that is not its Category's one source, with a warning", () => {
    const s = snap([node("pump", { supply_capacity: { water: stock({ rate: 10, level: 5 }) } }), node("well", { supply_capacity: { water: 4 } }), consumer("c", 9)]);
    const out = integrateStocks(s, { served_ratio: { c: { water: 1 } }, stored: {} }, N);
    expect(out.snapshot).toBe(s);
    expect(out.warnings).toEqual(["pump (water): not integrated, 1 other source supply water, so its own outflow is not determined."]);
  });

  it("credits a damaged Stock's inflow by its φ, and leaves the stored level unscaled", () => {
    // Functionality 2 of 3 → φ = 0.5: 100 + 0.5·10 − 0 = 105.
    const s = snap([node("pump", { functionality: 2, supply_capacity: { water: stock({ rate: 10, level: 100 }) } })]);
    expect(levelOf(integrateStocks(s, { served_ratio: {}, stored: {} }, N).snapshot, "pump")).toBe(105);
  });

  it("integrates an edge Stock from what its target received, and flags lent capacity", () => {
    const pool = node("pool", { supply_capacity: { water: 100 } });
    const s = snap([pool, consumer("act", 30)], [edge("e", "pool", "act", { capacity: stock({ rate: 40, inflow: 25, level: -5, min: -50 }) })]);
    const out = integrateStocks(s, { served_ratio: { act: { water: 1 } }, stored: {} }, N);
    // −5 + 25 − 30 = −10; rate 40 > inflow 25, so hours lent by others reached the target.
    expect(out.outcomes).toEqual([{ element: "e", level: -10, spilled: 0, unmet: 0, attributionInvalid: true }]);
    const twoIn = snap([pool, node("p2", { supply_capacity: { water: 5 } }), consumer("act", 30)], [s.edges.e, edge("f", "p2", "act")]);
    expect(integrateStocks(twoIn, { served_ratio: { act: { water: 1 } }, stored: {} }, N).warnings[0]).toMatch(/2 incoming water edges/);
  });
});

describe("a run with a Stock", () => {
  it("follows the banca ore recurrence L' = L + contract − worked, period after period", async () => {
    const start = snap([node("pool", { supply_capacity: { water: stock({ rate: 40, level: 0, min: -100 }) } }), consumer("work", 50)], [edge("e", "pool", "work")]);
    const plan = planTimeline({ name: "t", steps: [{ label: "2023-01", unit: "month", repeat: 3, phases: [{ events: [], propagate: true }] }] });
    // The engine stand-in delivers the whole demand: 50 worked against 40 contracted each month.
    const record = await runTimeline({
      start, plan, profile: {}, events: [], n: N,
      propagate: async (s) => ({ snapshot: s, flow: { served_ratio: { work: { water: 1 } }, stored: {} } }),
    });
    expect([1, 2, 3].map((t) => levelOf(periodState(record, t), "pool"))).toEqual([-10, -20, -30]);
    expect(record.periods[0].stocks).toEqual([{ element: "pool", category: "water", level: -10, spilled: 0, unmet: 0 }]);
  });
});
