import { describe, expect, it } from "vitest";
import { RunStopped, periodState, runTimeline, type RunInput } from "./step-operator";
import { planTimeline } from "./timeline-plan";
import { isEmptyDiff } from "./graph-diff";
import type { EventDefinition } from "./schemas/config";
import type { GraphSnapshot, Node } from "./schemas/network";
import type { Timeline } from "./schemas/temporal-simulation";

const N = 4;

const node = (id: string, over: Partial<Node> = {}): Node => ({ id, label: id, functionality: N, ...over });

/** A source `a` feeding a consumer `b`, Reset. */
const start: GraphSnapshot = {
  nodes: { a: node("a", { vulnerability_levels: { cut: 3 } }), b: node("b", { vulnerability_levels: { quake: 2 } }) },
  edges: {},
  canvases: [],
};

/** A fake engine: `b` falls to `a`'s Functionality when `a` is worse, caused by `a`. */
async function engine(s: GraphSnapshot): Promise<GraphSnapshot> {
  const a = s.nodes.a, b = s.nodes.b;
  if (a.functionality >= b.functionality) return s;
  return { ...s, nodes: { ...s.nodes, b: { ...b, functionality: a.functionality, responsibility_share: { a: 1 } } } };
}

const event = (id: string, over: Partial<EventDefinition> = {}): EventDefinition => ({ id, label: id, type: "disservice", frequency_per_10y: 0, ...over });
const events: EventDefinition[] = [
  event("cut"),
  event("quake", { type: "hazard" }),
  event("repair", { attribute_operations: [{ element: "a", path: ["functionality"], op: "set", value: N }] }),
];

/** Three days; Phase Events per day given as lists. */
function input(days: string[][], over: Partial<RunInput> = {}): RunInput {
  const timeline: Timeline = {
    name: "t",
    steps: days.map((ids, i) => ({ label: `2023-01-0${i + 1}`, unit: "day", repeat: 1, phases: [{ events: ids.map((event) => ({ event, every: 1 })), propagate: true }] })),
  };
  return { start, plan: planTimeline(timeline), profile: {}, events, n: N, propagate: engine, ...over };
}

const f = (s: GraphSnapshot, id: string) => s.nodes[id].functionality;

describe("runTimeline", () => {
  it("recomputes shortage every Propagation: supply back, the consumer recovers", async () => {
    const record = await runTimeline(input([["cut"], [], ["repair"]]));
    expect([1, 2, 3].map((t) => [f(periodState(record, t), "a"), f(periodState(record, t), "b")])).toEqual([[1, 1], [1, 1], [N, N]]);
  });

  it("keeps an Event's damage on an Element a shortage had already pushed lower", async () => {
    // Day 2: b sits at 1 from the cut; the quake imposes N − 2 = 2 on it. Day 3: supply returns.
    const record = await runTimeline(input([["cut"], ["quake"], ["repair"]]));
    expect(f(periodState(record, 2), "b")).toBe(1);
    expect(f(periodState(record, 3), "b")).toBe(2);
    expect(periodState(record, 3).nodes.b.responsibility_share).toEqual({ quake: 1 });
  });

  it("gives the same diffs twice, and every period reconstructs to the state it ran in", async () => {
    const seen: GraphSnapshot[] = [];
    const days = [["cut"], ["quake"], ["repair"]];
    const record = await runTimeline(input(days, { propagate: async (s) => { const out = await engine(s); seen.push(out); return out; } }));
    expect((await runTimeline(input(days))).periods).toEqual(record.periods);
    seen.forEach((state, i) => expect(periodState(record, i + 1)).toEqual(state));
  });

  it("applies the profile in the first Phase, also for a Step with no Phase", async () => {
    const timeline: Timeline = {
      name: "t",
      steps: [
        { label: "P1", unit: "none", repeat: 1, phases: [{ events: [], propagate: true }, { events: [], propagate: false }] },
        { label: "Q1", unit: "none", repeat: 1, phases: [] },
      ],
    };
    const op = (value: number) => [{ element: "a", path: ["properties", "load"], op: "set" as const, value }];
    const record = await runTimeline({ ...input([]), plan: planTimeline(timeline), profile: { P1: op(5), Q1: op(7) } });
    expect(record.periods.map((p) => p.diffs.length)).toEqual([2, 1]);
    expect(isEmptyDiff(record.periods[0].diffs[1])).toBe(true);
    expect(periodState(record, 1).nodes.a.properties).toEqual({ load: 5 });
    expect(periodState(record, 2).nodes.a.properties).toEqual({ load: 7 });
  });

  it("reports a refused operation and an Event the configuration lacks, and runs on", async () => {
    const record = await runTimeline(input([["ghost"]], { profile: { "2023-01-01": [{ element: "a", path: ["functionality"], op: "add", value: 9 }] } }));
    expect(record.warnings).toHaveLength(2);
    expect(record.warnings.join("\n")).toMatch(/2023-01-01: Profile 2023-01-01 → a: functionality/);
    expect(record.warnings.join("\n")).toMatch(/"ghost" is not in the configuration/);
  });

  it("stops on a cancel or an engine error, naming the period, and leaves the start untouched", async () => {
    const before = structuredClone(start);
    const controller = new AbortController();
    const cancelled = runTimeline(input([["cut"], [], []], { signal: controller.signal, onProgress: () => controller.abort() }));
    await expect(cancelled).rejects.toMatchObject({ period: "2023-01-02", message: "Cancelled" });

    const failing = runTimeline(input([[], ["cut"]], { propagate: async (s) => { if (f(s, "a") < N) throw new Error("429 budget"); return s; } }));
    await expect(failing).rejects.toBeInstanceOf(RunStopped);
    await expect(failing).rejects.toMatchObject({ period: "2023-01-02", message: "429 budget" });
    expect(start).toEqual(before);
  });
});
