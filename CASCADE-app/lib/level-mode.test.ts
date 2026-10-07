import { describe, expect, it } from "vitest";
import { bandFor, levelPaint, stockReference } from "./level-mode";
import { brandColor } from "./brand";
import { DEFAULT_LEVEL_SCALE, LevelBandSchema } from "./schemas/config";
import type { GraphSnapshot, Stock } from "./schemas/network";

const stock = (over: Partial<Stock>): Stock => ({ rate: 0, level: 0, retention: 1, efficiency: 1, ...over });
const snap = (pool: Stock, edgeStock?: Stock): GraphSnapshot => ({
  nodes: { pool: { id: "pool", functionality: 3, supply_capacity: { hours: pool } }, town: { id: "town", functionality: 3 } },
  edges: { e: { id: "e", source: "pool", target: "town", functionality: 3, ...(edgeStock ? { capacity: edgeStock } : {}) } },
  canvases: [],
});

describe("Level Mode", () => {
  it("takes the Stock's own reference, else its bound, else none", () => {
    expect(stockReference(stock({ min: -100, max: 40 }), "level")).toBe(100);
    expect(stockReference(stock({ min: -100, level_reference: 20 }), "level")).toBe(20);
    expect(stockReference(stock({ min: -100, change_reference: 5 }), "change")).toBe(5);
    expect(stockReference(stock({}), "level")).toBeNull();
  });

  it("puts a ratio in the first band whose bound it is below", () => {
    expect([-0.8, -0.3, 0, 0.3, 2].map((r) => bandFor(r, DEFAULT_LEVEL_SCALE).label)).toEqual([
      "large deficit", "deficit", "balanced", "surplus", "large surplus",
    ]);
  });

  it("colours each Stock by its level or its change, and says what the colours mean", () => {
    const before = snap(stock({ level: -10, min: -100 }), stock({ level: 0 }));
    const after = snap(stock({ level: -70, min: -100 }), stock({ level: 0 }));
    const level = levelPaint(after, before, DEFAULT_LEVEL_SCALE, "level");
    expect(level.colors.pool).toBe(brandColor("danger", 600));       // −70 / 100 = −0.7
    expect(level.colors.e).toBe(brandColor("neutral", 700));         // no bound, no reference
    expect(level.colors.town).toBe(brandColor("neutral", 300));      // no Stock
    expect(levelPaint(after, before, DEFAULT_LEVEL_SCALE, "change").colors.pool).toBe(brandColor("danger", 600)); // −60 / 100
    const labels = level.legend.nodes?.type === "swatches" ? level.legend.nodes.items.map((i) => i.label) : [];
    expect(labels).toEqual([
      "large surplus (≥ 0.50)", "surplus (0.10 to 0.50)", "balanced (-0.10 to 0.10)", "deficit (-0.50 to -0.10)",
      "large deficit (< -0.50)", "no reference: set min/max or a reference", "no Stock",
    ]);
  });
});

describe("LevelBandSchema", () => {
  it("takes only a step the brand ramps define, so a band always has a colour", () => {
    expect(LevelBandSchema.safeParse({ label: "a", role: "danger", step: 950 }).success).toBe(true);
    expect(LevelBandSchema.safeParse({ label: "a", role: "danger", step: 250 }).success).toBe(false);
  });
});
