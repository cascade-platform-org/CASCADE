/**
 * temporal-jump-run — reading a Scenario's remaining time.
 *
 * The imperative half of the module (extendRun / revertRun / endRun) is covered
 * against the real stores in `store/canvas-store.test.ts`; this file covers the
 * pure half, which used to be three hand-rolled loops inside `action-bar.tsx`.
 */

import { describe, it, expect } from "vitest";

import { remainingJumpHours, nextJumpHours } from "@/lib/temporal-jump-run";

const scenario = (nodeFts: (number | undefined)[], edgeFts: (number | undefined)[] = []) => ({
  nodes: Object.fromEntries(nodeFts.map((ft, i) => [`n${i}`, { functionality_time: ft }])),
  edges: Object.fromEntries(edgeFts.map((ft, i) => [`e${i}`, { functionality_time: ft }])),
});

describe("remainingJumpHours", () => {
  it("returns the distinct pending times, ascending", () => {
    expect(remainingJumpHours(scenario([6, 2, 6, 12]))).toEqual([2, 6, 12]);
  });

  it("covers edges as well as nodes — an edge's backup is a tick too", () => {
    expect(remainingJumpHours(scenario([4], [9]))).toEqual([4, 9]);
  });

  it("ignores Elements with no countdown", () => {
    // 0 means "not counting down", and an absent field means the same.
    expect(remainingJumpHours(scenario([0, undefined, 3]))).toEqual([3]);
  });

  it("is empty when nothing is pending, so the slider has no range to draw", () => {
    expect(remainingJumpHours(scenario([0, undefined]))).toEqual([]);
  });
});

describe("nextJumpHours", () => {
  it("is the nearest expiry — the step auto-advance takes", () => {
    expect(nextJumpHours(scenario([12, 3, 7]))).toBe(3);
  });

  it("is null when nothing is counting down, which is what stops auto-advance", () => {
    expect(nextJumpHours(scenario([0]))).toBeNull();
  });
});
