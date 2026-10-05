import { describe, expect, it } from "vitest";
import { advanceLabel, planTimeline, type Timeline } from "./timeline-plan";

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
      advance_hours: 730,
      repeat: 6,
      phases: [
        { events: ["contract"], propagate: true },
        { events: ["supplement"], propagate: true },
        { events: ["settle"], propagate: false },
      ],
    },
  ],
  every: [{ every: 3, phase: 2, events: ["quarter-close"] }],
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

  it("joins Periodic Events to every N-th period, 1-based", () => {
    const plan = planTimeline(base);
    const fired = plan.periods.filter((p) => p.phases[2].periodicEvents.length > 0).map((p) => p.number);
    expect(fired).toEqual([3, 6]);
    expect(plan.periods[2].phases[2].events).toEqual(["settle", "quarter-close"]);
  });

  it("marks integration after the last propagating Phase", () => {
    const flags = planTimeline(base).periods[0].phases.map((p) => p.integratesAfter);
    expect(flags).toEqual([false, true, false]);
  });

  it("warns on an invalid label, a duplicate label and an unreachable Periodic rule", () => {
    const plan = planTimeline({
      name: "t",
      steps: [
        { label: "Jan", unit: "month", advance_hours: 730, repeat: 1, phases: [{ events: [], propagate: true }] },
        { label: "x", unit: "none", advance_hours: 0, repeat: 1, phases: [{ events: [], propagate: true }] },
        { label: "x", unit: "none", advance_hours: 0, repeat: 1, phases: [{ events: [], propagate: true }] },
      ],
      every: [{ every: 2, phase: 4, events: ["e"] }],
    });
    expect(plan.periods).toHaveLength(2);
    expect(plan.warnings.join("\n")).toMatch(/not a valid month label/);
    expect(plan.warnings.join("\n")).toMatch(/appears twice/);
    expect(plan.warnings.join("\n")).toMatch(/never fires/);
  });
});
