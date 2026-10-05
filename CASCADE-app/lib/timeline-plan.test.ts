import { describe, expect, it } from "vitest";
import { advanceLabel, planTimeline } from "./timeline-plan";
import type { Timeline } from "./temporal-simulation-schema";

describe("advanceLabel", () => {
  it("advances months across a year boundary", () => {
    expect(advanceLabel("2023-11", "month", 3)).toBe("2024-02");
  });
  it("advances ISO weeks across a 53-week year", () => {
    // 2020 has 53 ISO weeks.
    expect(advanceLabel("2020-W52", "week", 1)).toBe("2020-W53");
    expect(advanceLabel("2020-W52", "week", 2)).toBe("2021-W01");
  });
  it("advances days across a leap day", () => {
    expect(advanceLabel("2024-02-28", "day", 2)).toBe("2024-03-01");
  });
  it("advances quarters and years", () => {
    expect(advanceLabel("2023-Q4", "quarter", 1)).toBe("2024-Q1");
    expect(advanceLabel("2023", "year", 2)).toBe("2025");
  });
  it("numbers repeats when the unit is none", () => {
    expect(advanceLabel("baseline", "none", 0)).toBe("baseline");
    expect(advanceLabel("baseline", "none", 2)).toBe("baseline#3");
  });
  it("rejects a label that does not match its unit", () => {
    expect(advanceLabel("March", "month", 1)).toBeNull();
    expect(advanceLabel("2023-13", "month", 1)).toBeNull();
    expect(advanceLabel("2023-02-30", "day", 1)).toBeNull();
  });
});

const base: Timeline = {
  name: "t",
  steps: [
    {
      label: "2023-01",
      unit: "month",
      repeat: 6,
      phases: [
        { events: [{ event: "contract", every: 1 }], propagate: true },
        { events: [{ event: "supplement", every: 1 }], propagate: true },
        { events: [{ event: "settle", every: 1 }, { event: "quarter-close", every: 3 }], propagate: false },
      ],
    },
  ],
};

describe("planTimeline", () => {
  it("unrolls repeats into labelled periods and counts engine calls", () => {
    const plan = planTimeline(base);
    expect(plan.periods.map((p) => p.label)).toEqual([
      "2023-01", "2023-02", "2023-03", "2023-04", "2023-05", "2023-06",
    ]);
    // 6 periods × 2 propagating Phases.
    expect(plan.engineCalls).toBe(12);
    expect(plan.warnings).toEqual([]);
  });

  it("fires an every-N Event on the Step's periods N, 2N…", () => {
    const plan = planTimeline(base);
    const fired = plan.periods.filter((p) => p.phases[2].events.includes("quarter-close")).map((p) => p.number);
    expect(fired).toEqual([3, 6]);
    expect(plan.periods[2].phases[2].events).toEqual(["settle", "quarter-close"]);
  });

  it("marks integration after the last propagating Phase", () => {
    const flags = planTimeline(base).periods[0].phases.map((p) => p.integratesAfter);
    expect(flags).toEqual([false, true, false]);
  });

  it("warns on an invalid label, a duplicate label and an Event that never fires", () => {
    const plan = planTimeline({
      name: "t",
      steps: [
        { label: "Jan", unit: "month", repeat: 1, phases: [{ events: [], propagate: true }] },
        { label: "x", unit: "none", repeat: 1, phases: [{ events: [{ event: "e", every: 2 }], propagate: true }] },
        { label: "x", unit: "none", repeat: 1, phases: [{ events: [], propagate: true }] },
      ],
    });
    expect(plan.periods).toHaveLength(2);
    expect(plan.warnings.join("\n")).toMatch(/not a valid month label/);
    expect(plan.warnings.join("\n")).toMatch(/appears twice/);
    expect(plan.warnings.join("\n")).toMatch(/never fires/);
  });
});
