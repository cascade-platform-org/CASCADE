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
import type { LevelBand } from "@/lib/schemas/config";
import type { GraphSnapshot, Stock } from "@/lib/schemas/network";

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

/** Every Stock of a snapshot, keyed by the Element that carries it. */
function stocksOf(snapshot: GraphSnapshot): { element: string; key: string; stock: Stock }[] {
  const out: { element: string; key: string; stock: Stock }[] = [];
  for (const node of Object.values(snapshot.nodes)) {
    for (const [category, value] of Object.entries(node.supply_capacity ?? {})) {
      if (typeof value !== "number") out.push({ element: node.id, key: `${node.id}/${category}`, stock: value });
    }
  }
  for (const edge of Object.values(snapshot.edges)) {
    if (edge.capacity !== undefined && typeof edge.capacity !== "number") out.push({ element: edge.id, key: edge.id, stock: edge.capacity });
  }
  return out;
}

const fmt = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(2));

/**
 * The colour of every Element at the end of a period, and the legend that says
 * what the colours mean. `before` is the state the period started from (for a
 * change). A node with several Stocks shows the most extreme of them.
 */
export function levelPaint(
  state: GraphSnapshot,
  before: GraphSnapshot,
  scale: readonly LevelBand[],
  reading: LevelReading,
): { colors: Record<string, string>; legend: HeatmapLegend } {
  const colors: Record<string, string> = {};
  for (const id of [...Object.keys(state.nodes), ...Object.keys(state.edges)]) colors[id] = NO_STOCK;

  const previous = new Map(stocksOf(before).map((s) => [s.key, s.stock.level]));
  const extremity = new Map<string, number>();
  let unreferenced = false;
  for (const { element, key, stock } of stocksOf(state)) {
    const reference = stockReference(stock, reading);
    if (reference === null) {
      unreferenced = true;
      if (!extremity.has(element)) colors[element] = NO_REFERENCE;
      continue;
    }
    const value = reading === "level" ? stock.level : stock.level - (previous.get(key) ?? stock.level);
    const ratio = value / reference;
    if (Math.abs(ratio) >= (extremity.get(element) ?? -1)) {
      extremity.set(element, Math.abs(ratio));
      colors[element] = bandColor(bandFor(ratio, scale));
    }
  }

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
