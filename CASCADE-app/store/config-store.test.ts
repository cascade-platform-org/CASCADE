/**
 * Functionality Scale ordering.
 *
 * The scale's level *numbers* are identity: every element stores one of them as
 * its `functionality`, `selectN` is the list's length, and vulnerability is read
 * as N − level. So a reorder must renumber by position and never renumber into
 * a gap or drop an entry — either would silently change what every stored
 * Functionality means.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useConfigStore, DEFAULT_CONFIG } from "@/store/config-store";

type Level = { level: number; label: string; color: string };

const SCALE: Level[] = [
  { level: 1, label: "critical", color: "#ef4444" },
  { level: 2, label: "operational_warning", color: "#f59e0b" },
  { level: 3, label: "operational", color: "#22c55e" },
];

beforeEach(() => {
  useConfigStore.setState({
    config: { ...DEFAULT_CONFIG, functionality_scale: SCALE.map((l) => ({ ...l })) },
    draft: { ...DEFAULT_CONFIG, functionality_scale: SCALE.map((l) => ({ ...l })) },
  } as never);
});

const scale = () => useConfigStore.getState().draft.functionality_scale;
const byNumber = () =>
  [...scale()].sort((a, b) => a.level - b.level).map((l) => `${l.level}:${l.label}`);

describe("reorderScaleLevels", () => {
  it("moves a label to the number it was moved to", () => {
    // Put "operational" at the bottom: 3 → 1, the others shift up.
    useConfigStore.getState().reorderScaleLevels([3, 1, 2]);
    expect(byNumber()).toEqual(["1:operational", "2:critical", "3:operational_warning"]);
  });

  it("keeps the numbers contiguous from 1", () => {
    useConfigStore.getState().reorderScaleLevels([2, 3, 1]);
    expect(scale().map((l) => l.level).sort()).toEqual([1, 2, 3]);
  });

  it("carries the colour with the label", () => {
    useConfigStore.getState().reorderScaleLevels([3, 2, 1]);
    const bottom = scale().find((l) => l.level === 1)!;
    expect(bottom.label).toBe("operational");
    expect(bottom.color).toBe("#22c55e");
  });

  it("is a no-op when the order is incomplete", () => {
    // Dropping a level would shift N, and with it the meaning of every stored
    // Functionality — so a partial order is refused rather than applied.
    useConfigStore.getState().reorderScaleLevels([3, 1]);
    expect(byNumber()).toEqual(["1:critical", "2:operational_warning", "3:operational"]);
  });

  it("ignores level numbers that do not exist", () => {
    useConfigStore.getState().reorderScaleLevels([1, 2, 99]);
    expect(byNumber()).toEqual(["1:critical", "2:operational_warning", "3:operational"]);
  });

  it("marks the draft dirty, so the modal offers to save it", () => {
    useConfigStore.setState({ isDirty: false } as never);
    useConfigStore.getState().reorderScaleLevels([2, 1, 3]);
    expect(useConfigStore.getState().isDirty).toBe(true);
  });

  it("round-trips: reordering back restores the original scale", () => {
    const before = byNumber();
    useConfigStore.getState().reorderScaleLevels([3, 1, 2]);
    useConfigStore.getState().reorderScaleLevels([2, 3, 1]);
    expect(byNumber()).toEqual(before);
  });
});
