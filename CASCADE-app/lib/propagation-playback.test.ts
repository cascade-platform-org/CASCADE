import { describe, it, expect } from "vitest";
import { buildTimeline, fadesOn, hasDegradation, screenSeconds, stateAt, type PlaybackEdge } from "./propagation-playback";
import type { PropagationRound } from "@/lib/schemas/propagation";

// s → a → c → d : water flows s→a→c; d depends logically on c.
const edges: PlaybackEdge[] = [
  { id: "e1", source: "s", target: "a" },
  { id: "e2", source: "a", target: "c" },
  { id: "e3", source: "c", target: "d" },
];
const rounds: PropagationRound[] = [
  {
    flows: { water: { e1: 5, e2: 5 } },
    served_ratio: { c: { water: 0.5 } },
    changes: [
      { id: "d", functionality: 2, cause: "logical", responsibility_share: { c: 1 } },  // committed first…
      { id: "c", functionality: 2, cause: "flow", responsibility_share: { s: 1 } },     // …but flow plays first
    ],
  },
  { flows: { water: { e1: 5, e2: 5 } }, served_ratio: { c: { water: 0.5 } }, changes: [{ id: "e3", functionality: 2, cause: "edge", responsibility_share: { c: 1 } }] },
];
const start = { levels: { s: 3, a: 3, c: 3, d: 3, e1: 3, e2: 3, e3: 3 }, functionalityTime: {} };

describe("buildTimeline", () => {
  const t = buildTimeline(rounds, edges);

  it("plays one flow screen and the logical changes per round, the quiet last round as Converged", () => {
    expect(t.frames.map((f) => `${f.round}:${f.phase}`)).toEqual(["0:flow", "0:logical", "1:converged"]);
    expect(t.roundStarts).toEqual([0]);
    expect(t.changes.map((c) => c.id)).toEqual(["c", "d", "e3"]);
  });

  it("times the flow front within its one screen, by hops from the Sources", () => {
    const flow = t.frames[0];
    expect(flow.flowEdges).toEqual({ e1: "water", e2: "water" });
    expect(flow.arrival).toEqual({ s: 0, a: 1, c: 2 });
    expect(flow.hops).toBe(2);
    expect(flow.focus).toEqual(["c"]);
  });

  it("pulses a logical change along the edge from the element responsible", () => {
    expect(t.frames[1].pulse).toEqual(["e3"]);
    expect(t.maxFlow).toEqual({ water: 5 });
  });

  it("keeps the final flow standing on the Converged screen, without delays", () => {
    const end = t.frames[2];
    expect(end.flowEdges).toEqual({ e1: "water", e2: "water" });
    expect(end.arrival).toEqual({});
  });

  it("replays the changes up to a frame on top of the state sent", () => {
    expect(stateAt(t, start, 0).levels.c).toBe(2);
    expect(stateAt(t, start, 0).levels.d).toBe(3);
    const end = stateAt(t, start, t.frames.length - 1).levels;
    expect([end.c, end.d, end.e3]).toEqual([2, 2, 2]);
  });

  it("groups a long logical phase into at most 40 frames", () => {
    const many: PropagationRound[] = [{
      flows: {}, served_ratio: {},
      changes: Array.from({ length: 100 }, (_, i) => ({ id: `n${i}`, functionality: 1, cause: "logical" as const })),
    }];
    const long = buildTimeline(many, []);
    expect(long.frames.filter((f) => f.phase === "logical").length).toBeLessThanOrEqual(40);
    expect(long.changes).toHaveLength(100);
  });
});

describe("hasDegradation", () => {
  const round = (causes: ("edge" | "flow" | "logical" | "rule" | "backup")[]): PropagationRound =>
    ({ flows: {}, served_ratio: {}, changes: causes.map((cause, i) => ({ id: `x${i}`, functionality: 1, cause })) });

  it("is true once a node is lowered by flow, logical aggregation or a Rule", () => {
    expect(hasDegradation(rounds)).toBe(true);
    expect(hasDegradation([round(["edge"]), round(["rule"])])).toBe(true);
  });

  it("is false for edges catching up, a backup countdown, or nothing at all", () => {
    expect(hasDegradation([round(["edge", "backup"]), round([])])).toBe(false);
    expect(hasDegradation([])).toBe(false);
  });
});

describe("fadesOn", () => {
  const t = buildTimeline(rounds, edges);

  it("keeps a screen's targets and fades everything else", () => {
    const [flow, logical] = t.frames;
    expect(fadesOn(flow, "c")).toBe(false);   // degraded by this flow
    expect(fadesOn(flow, "s")).toBe(true);
    expect(fadesOn(flow, "e1")).toBe(true);
    expect(fadesOn(logical, "d")).toBe(false);
    expect(fadesOn(logical, "c")).toBe(true);
  });

  it("fades nothing on Converged", () => {
    expect(fadesOn(t.frames[2], "s")).toBe(false);
  });
});

describe("screenSeconds", () => {
  const t = buildTimeline(rounds, edges);

  it("ends a flow screen when the front reaches its farthest target, then pauses briefly", () => {
    expect(screenSeconds(t.frames[0], 2, 1)).toBeCloseTo(2 * 2 + 0.6);  // c arrives at hop 2
  });

  it("gives a flow screen with no target one hop, a logical step its pulse", () => {
    const quiet = { ...t.frames[0], focus: [] };
    expect(screenSeconds(quiet, 2, 1)).toBeCloseTo(2 + 0.6);
    expect(screenSeconds(t.frames[1], 2, 1)).toBeCloseTo(1 + 0.6);
  });

  it("holds Converged until Done", () => {
    expect(screenSeconds(t.frames[2], 2, 1)).toBe(0);
  });
});
