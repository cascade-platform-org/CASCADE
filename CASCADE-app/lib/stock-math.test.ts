import { describe, expect, it } from "vitest";
import { integrateStock, stockSupply, type StockDraft } from "./stock-math";

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
    const s: StockDraft = { rate: 10, level: 100, min: 0, retention: 0.9 };
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
