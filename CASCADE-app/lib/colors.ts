/**
 * colors.ts — shared colour lookups for Functionality levels and Canvases.
 *
 * One place maps a Functionality integer to its configured colour, defines the
 * Canvas palette, and holds the Analysis Heatmap's own palette, so canvases,
 * panels, and search results can never drift apart on colour.
 *
 * The Analysis Heatmap's colours live here rather than in
 * `topological-analysis.ts`, where they used to sit among the graph algorithms:
 * a metric computing scores and a renderer painting them are two jobs, and only
 * the second one is about colour.
 */
import type { FunctionalityScaleLevel } from "@/lib/schemas/config";

/** Neutral gray for levels missing from the scale (and unset canvas colours). */
export const FALLBACK_LEVEL_COLOR = "#94a3b8";

/** Colour for a Functionality integer level, from the Model Configuration scale. */
export function levelColor(
  scale: readonly FunctionalityScaleLevel[],
  level: number,
): string {
  return scale.find((l) => l.level === level)?.color ?? FALLBACK_LEVEL_COLOR;
}

/** Default colour choices offered for a Canvas (inspector + topbar pickers). */
export const CANVAS_PALETTE = [
  "#3b82f6", "#22c55e", "#eab308", "#f97316",
  "#ef4444", "#a855f7", "#06b6d4", "#ec4899",
] as const;

// ---------------------------------------------------------------------------
// Analysis Heatmap palette
// ---------------------------------------------------------------------------

/**
 * Maps a normalised value [0,1] to a light→dark blue gradient (blue-100 →
 * blue-900). Blue is the app's accent for Analysis, so the heatmap on the canvas
 * reads as the same feature as the window that produced it.
 */
export function scoreToColor(normalised: number): string {
  const r = Math.round(219 + normalised * (30 - 219));
  const g = Math.round(234 + normalised * (58 - 234));
  const b = Math.round(254 + normalised * (138 - 254));
  return `rgb(${r},${g},${b})`;
}

/** Discrete palette for metrics whose scores are categories, not magnitudes. */
export const CATEGORY_COLORS = [
  "#6366f1", "#ec4899", "#f59e0b", "#10b981",
  "#3b82f6", "#ef4444", "#8b5cf6", "#14b8a6",
  "#f97316", "#84cc16",
];
