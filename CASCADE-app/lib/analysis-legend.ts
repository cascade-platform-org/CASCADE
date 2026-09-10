/**
 * analysis-legend.ts — what an Analysis Heatmap's colours mean.
 *
 * The Analysis Heatmap (CONTEXT.md) repaints Elements by Analysis Metric score,
 * which overrides the Functionality colours the canvas normally shows. Two
 * places have to explain that repaint: the Analysis page, next to the button
 * that applies it, and the canvas legend, where the user actually looks at the
 * colours after minimizing.
 *
 * Deriving the explanation twice is how the two drift. It lives here once, as a
 * plain description of colour → meaning, and both renderers consume it. The
 * description is built at APPLY time and stored beside the colours it describes
 * (`analysis-store.ts`), so the canvas cannot show a legend for one Analysis
 * Metric while displaying another's colours — the two are written together or
 * not at all.
 */

import { CATEGORY_COLORS, scoreToColor } from "@/lib/topological-analysis";
import type { AnalysisResult } from "@/lib/topological-analysis";

/** Not exported: consumers reach it through `Legend`, the shape they render. */
type LegendItem = { color: string; label: string };

/**
 * A gradient reads "low → high"; swatches read as a fixed key. Which one an
 * Analysis Metric needs is a property of the metric, not of the renderer.
 */
export type Legend =
  | {
      type: "gradient";
      low: string;
      high: string;
      /** The scores the two ends stand for, formatted for display. */
      minLabel: string;
      maxLabel: string;
    }
  | { type: "swatches"; items: LegendItem[] };

/** The full explanation of one applied Analysis Heatmap. */
export interface HeatmapLegend {
  /** The Analysis Metric's own name, as the Analysis page spells it. */
  title: string;
  nodes?: Legend;
  edges?: Legend;
}

/**
 * Beyond this many communities the legend stops listing and starts counting.
 * `buildCategoricalColorMap` wraps the palette with `idx % CATEGORY_COLORS.length`,
 * so this is also the point where colours start repeating on the canvas.
 */
const MAX_LISTED_COMMUNITIES = CATEGORY_COLORS.length;

/**
 * The ends of the indigo ramp, taken from the function that paints it rather
 * than written out again — `scoreToColor` is what `buildColorMap` calls.
 */
export const GRADIENT_LOW = scoreToColor(0);
export const GRADIENT_HIGH = scoreToColor(1);

/**
 * Render a score the way a legend end should read it.
 *
 * Analysis Metric scores span several orders of magnitude — a reach count is an
 * integer in the tens, a Shapley Value is a few hundredths, a betweenness score
 * sits between. A single fixed precision is unreadable for at least one of them,
 * so the format follows the magnitude.
 */
export function formatScore(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Number.isInteger(value)) return value.toLocaleString();
  const abs = Math.abs(value);
  if (abs >= 1000) return Math.round(value).toLocaleString();
  if (abs >= 1) return value.toFixed(2).replace(/\.?0+$/, "");
  // Two significant digits keeps 0.017 and 0.069 distinguishable where a fixed
  // two decimal places would render both as 0.02 and 0.07 — or worse, as 0.00.
  if (abs >= 0.001) return Number(value.toPrecision(2)).toString();
  return value.toExponential(1);
}

/**
 * The colour key for one Analysis Result.
 *
 * Metrics whose scores are categorical (a community id, a shell index) or
 * boolean (is it an articulation point) get named swatches; everything whose
 * score is a magnitude gets the low→high gradient. Keep this in step with
 * `buildColorMap` in topological-analysis.ts — that decides the colours, this
 * decides how they are explained, and a metric added to one needs the other.
 */
export function buildLegend(result: AnalysisResult): Legend {
  const { metric, scores } = result;
  switch (metric) {
    case "articulation_points":
      return {
        type: "swatches",
        items: [
          { color: "#ef4444", label: "Articulation point" },
          { color: "#94a3b8", label: "Non-critical" },
        ],
      };
    case "bridge_edges":
      return {
        type: "swatches",
        items: [
          { color: "#ef4444", label: "Bridge" },
          { color: "#94a3b8", label: "Non-bridge" },
        ],
      };
    case "downstream_reachability":
      return {
        type: "swatches",
        items: [
          { color: "#4338ca", label: "Source" },
          { color: "#818cf8", label: "In downstream cone" },
          { color: "#e2e8f0", label: "Outside cone" },
        ],
      };
    case "upstream_reachability":
      return {
        type: "swatches",
        items: [
          { color: "#4338ca", label: "Target" },
          { color: "#818cf8", label: "In upstream cone" },
          { color: "#e2e8f0", label: "Outside cone" },
        ],
      };
    case "community": {
      const uniqueVals = [...new Set(Object.values(scores))].sort((a, b) => a - b);
      const items: LegendItem[] = uniqueVals
        .slice(0, MAX_LISTED_COMMUNITIES)
        .map((_, i) => ({ color: CATEGORY_COLORS[i], label: `Community ${i + 1}` }));
      if (uniqueVals.length > MAX_LISTED_COMMUNITIES) {
        // The overflow does NOT get a colour of its own: the colour map wraps,
        // so community 11 is painted exactly like community 1. The legend used
        // to show a grey swatch here, which claimed a colour the canvas never
        // draws. Say what actually happens instead.
        items.push({
          color: CATEGORY_COLORS[0],
          label: `+${uniqueVals.length - MAX_LISTED_COMMUNITIES} more (colours repeat)`,
        });
      }
      return { type: "swatches", items };
    }
    case "k_core": {
      // Only the ends of the shell range are worth naming; the values between
      // them read off the same two colours.
      const maxK = Math.max(...Object.values(scores), 1);
      return {
        type: "swatches",
        items: [
          { color: GRADIENT_LOW, label: "k=0 (peripheral)" },
          { color: GRADIENT_HIGH, label: `k=${maxK} (core)` },
        ],
      };
    }
    default: {
      // buildColorMap normalises with (score - min) / (max - min), so the ramp's
      // two ends are exactly this Analysis Result's min and max — naming them
      // beats "Low"/"High", which said nothing the colours had not already said.
      const { min, max } = result;
      if (min === max) {
        // A flat result would otherwise print a range that does not exist. Every
        // Element is painted the ramp's low end here, because the guarded
        // divisor makes the normalised score 0 for all of them.
        return {
          type: "swatches",
          items: [{ color: GRADIENT_LOW, label: `All ${formatScore(min)}` }],
        };
      }
      return {
        type: "gradient",
        low: GRADIENT_LOW,
        high: GRADIENT_HIGH,
        minLabel: formatScore(min),
        maxLabel: formatScore(max),
      };
    }
  }
}

/**
 * Assemble the legend for a heatmap about to be applied.
 *
 * `title` comes from the Analysis page's own metric list, so the canvas names
 * the Analysis Metric exactly as the page that produced it does.
 */
export function buildHeatmapLegend({
  title,
  result,
  edgeResult,
}: {
  title: string;
  result?: AnalysisResult;
  edgeResult?: AnalysisResult;
}): HeatmapLegend {
  return {
    title,
    ...(result ? { nodes: buildLegend(result) } : {}),
    ...(edgeResult ? { edges: buildLegend(edgeResult) } : {}),
  };
}
