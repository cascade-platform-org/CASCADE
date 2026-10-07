/**
 * level-mode.ts — the Run View's Level Mode colours (ADR-0019 §6).
 *
 * Functionality only worsens, so it cannot show an accumulation whose two
 * extremes are both problems. Level Mode recolours each Stock by the Level
 * Scale over the signed ratio `value / reference`, where the value is the
 * Stock's level at the period's end, or its change over the period. It paints
 * through the same per-Element colour map and legend shape as the Analysis
 * Heatmap (`lib/analysis-legend.ts`). Display only: it feeds no Rule, score or
 * Recovery Value. Pure.
 */

import { brandColor } from "@/lib/brand";
import type { HeatmapLegend } from "@/lib/analysis-legend";
import { stocksIn, type PlacedStock } from "@/lib/stock-math";
import type { LevelBand } from "@/lib/schemas/config";
import type { GraphSnapshot, Stock, StockValue } from "@/lib/schemas/network";

export type LevelReading = "level" | "change";

/**
 * What Level Mode paints an Element with no Stock (light enough to recede, dark
 * enough to keep the network legible) and a Stock with no reference. Both stay
 * clear of the default "balanced" grey (neutral 500).
 */
const NO_STOCK = brandColor("neutral", 300);
const NO_REFERENCE = brandColor("neutral", 700);

/**
 * The reference a Stock's value is divided by: its own override for the
 * reading, else its bound max(|min|, |max|); null when it has neither.
 */
export function stockReference(stock: Stock, reading: LevelReading): number | null {
  const own = reading === "level" ? stock.level_reference : stock.change_reference;
  if (own !== undefined) return own;
  const bound = Math.max(Math.abs(stock.min ?? 0), Math.abs(stock.max ?? 0));
  return bound > 0 ? bound : null;
}

/** The band a ratio falls in: the first whose bound it is below, else the last. */
export function bandFor(ratio: number, scale: readonly LevelBand[]): LevelBand {
  return scale.find((band) => band.below !== undefined && ratio < band.below) ?? scale[scale.length - 1];
}

const bandColor = (band: LevelBand) => brandColor(band.role, band.step);

const keyOf = (s: PlacedStock) => `${s.element}/${s.category ?? ""}`;

const fmt = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(2));

/**
 * Each Stock's value at the end of a period, with its reference (absent when
 * it has none): what Level Mode paints, and what a Scorecard entry stores so it
 * can repaint later. `before` is the state the period started from.
 */
export function stockValues(state: GraphSnapshot, before: GraphSnapshot, reading: LevelReading): StockValue[] {
  const previous = new Map(stocksIn(before).map((s) => [keyOf(s), s.stock.level]));
  return stocksIn(state).map((placed) => {
    const { element, category, stock } = placed;
    const reference = stockReference(stock, reading);
    const value = reading === "level" ? stock.level : stock.level - (previous.get(keyOf(placed)) ?? stock.level);
    return { element, ...(category !== undefined ? { category } : {}), value, ...(reference !== null ? { reference } : {}) };
  });
}

/** Every Element's colour from its Stocks' values; a node with several shows the most extreme ratio. */
export function colorsFor(values: readonly StockValue[], elementIds: Iterable<string>, scale: readonly LevelBand[]): Record<string, string> {
  const colors: Record<string, string> = {};
  for (const id of elementIds) colors[id] = NO_STOCK;
  const extremity = new Map<string, number>();
  for (const { element, value, reference } of values) {
    if (reference === undefined) {
      if (!extremity.has(element)) colors[element] = NO_REFERENCE;
      continue;
    }
    const ratio = value / reference;
    if (Math.abs(ratio) >= (extremity.get(element) ?? -1)) {
      extremity.set(element, Math.abs(ratio));
      colors[element] = bandColor(bandFor(ratio, scale));
    }
  }
  return colors;
}

/**
 * The colour of every Element at the end of a period, and the legend that says
 * what the colours mean. `before` is the state the period started from (for a
 * change).
 */
export function levelPaint(
  state: GraphSnapshot,
  before: GraphSnapshot,
  scale: readonly LevelBand[],
  reading: LevelReading,
): { colors: Record<string, string>; legend: HeatmapLegend } {
  const values = stockValues(state, before, reading);
  const colors = colorsFor(values, [...Object.keys(state.nodes), ...Object.keys(state.edges)], scale);
  const unreferenced = values.some((v) => v.reference === undefined);

  const items = [...scale].reverse().map((band, i, bands) => {
    const lower = bands[i + 1]?.below;
    const range = band.below === undefined ? `≥ ${fmt(lower ?? 0)}` : lower === undefined ? `< ${fmt(band.below)}` : `${fmt(lower)} to ${fmt(band.below)}`;
    return { color: bandColor(band), label: `${band.label} (${range})` };
  });
  if (unreferenced) items.push({ color: NO_REFERENCE, label: "no reference: set min/max or a reference" });
  items.push({ color: NO_STOCK, label: "no Stock" });
  return {
    colors,
    legend: {
      title: reading === "level" ? "Stock level ÷ reference" : "Stock change this period ÷ reference",
      nodes: { type: "swatches", items },
    },
  };
}
