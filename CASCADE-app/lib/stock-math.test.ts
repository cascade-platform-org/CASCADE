import { describe, expect, it } from "vitest";
import { capacityNumber, capacityShare, integrateStock, integrateStorage, stockSupply, storageSink, storageSource, type StockFields } from "./stock-math";

describe("stockSupply", () => {
  it("is rate plus the level above the floor in the ordinary case", () => {
    expect(stockSupply({ rate: 100, level: 40, min: 10 })).toEqual({ supply: 130, draw: 30 });
  });
  it("is capped by max_draw", () => {
    expect(stockSupply({ rate: 100, level: 40, min: 10, max_draw: 5 }).supply).toBe(105);
  });
  it("draws nothing when the level sits at its floor", () => {
    // Banca ore stored sign: workers owed 50 h with the cap at 50 h → L = −50, min = −50.
    expect(stockSupply({ rate: 160, level: -50, min: -50 }).supply).toBe(160);
  });
  it("draws against the retained level, so decay cannot overdraw", () => {
    const s: StockFields = { rate: 10, level: 100, min: 0, retention: 0.9 };
    const { supply } = stockSupply(s);
    // Deliver everything offered: the level must end exactly at the floor.
    expect(integrateStock(s, supply)).toEqual({ level: 0, spilled: 0, unmet: 0 });
  });
});

describe("integrateStock", () => {
  it("reproduces the banca ore recurrence L' = L + contract − worked", () => {
    expect(integrateStock({ rate: 160, level: -20, min: -50 }, 150).level).toBe(-10);
  });
  it("reports what the ceiling spilled", () => {
    expect(integrateStock({ rate: 50, level: 90, max: 100 }, 10)).toEqual({ level: 100, spilled: 30, unmet: 0 });
  });
  it("reports unmet when capacity lent by others exceeds the inflow", () => {
    // rate 120 > inflow 100: delivering the full rate at the floor leaves 20 unmet.
    expect(integrateStock({ rate: 120, inflow: 100, level: 0, min: 0 }, 120)).toEqual({ level: 0, spilled: 0, unmet: 20 });
  });
  it("scales the credited inflow by φ and leaves the stored level unscaled", () => {
    expect(integrateStock({ rate: 100, level: 50 }, 0, 0.5).level).toBe(100);
  });
});

describe("storage", () => {
  const tank = { rate: 0, level: 300, min: 50, max: 500, max_draw: 200, max_fill: 120 };
  it("offers its level above the floor, capped by max_draw, and fills up to its ceiling, capped by max_fill", () => {
    expect(storageSource(tank)).toBe(200);
    expect(storageSource({ ...tank, level: 120 })).toBe(70);
    expect(storageSink(tank)).toBe(120);
    expect(storageSink({ ...tank, level: 450 })).toBe(50);
    expect(storageSink({ ...tank, level: 500 })).toBe(0);
  });
  it("integrates what the engine filled and drew, clamped and reported", () => {
    expect(integrateStorage(tank, 40, 100)).toEqual({ level: 240, spilled: 0, unmet: 0 });
    expect(integrateStorage({ ...tank, level: 480 }, 60, 0)).toEqual({ level: 500, spilled: 40, unmet: 0 });
  });
  it("is what capacityNumber sends for storage, and a plain number passes through", () => {
    expect(capacityNumber(5)).toBe(5);
    expect(capacityNumber({ ...tank, retention: 1, efficiency: 1 })).toBe(200);
    expect(capacityNumber({ rate: 10, level: 4, retention: 1, efficiency: 1 })).toBe(14);
  });
});

describe("capacityShare", () => {
  // The engine's φ table (`test_func_ratio_endpoints_pinned_middle_midpoints` in
  // CASCADE-backend/test/test_engine_flow.py); change both together.
  it.each([
    [3, 3, 1], [1, 3, 0], [2, 3, 0.5],
    [4, 4, 1], [1, 4, 0], [2, 4, 0.375], [3, 4, 0.625],
    [5, 5, 1], [1, 5, 0], [3, 5, 0.5],
    [1, 1, 1],
  ])("functionality %i of %i carries %f", (f, n, share) => {
    expect(capacityShare(f, n)).toBeCloseTo(share);
  });
});
