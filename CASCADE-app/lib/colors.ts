/**
 * colors.ts — shared colour lookups for Functionality levels and Canvases.
 *
 * One place maps a Functionality integer to its configured colour, defines the
 * Canvas palette, and holds the Analysis Heatmap's own palette, so canvases,
 * panels, and search results can never drift apart on colour.
 *
 * Everything here is derived from `lib/brand.ts`, which mirrors the hues in
 * `app/globals.css`. Nothing in this file is a literal hex, so changing a hue
 * in the stylesheet repaints the canvas as well as the chrome.
 *
 * The Analysis Heatmap's colours live here rather than in
 * `topological-analysis.ts`, where they used to sit among the graph algorithms:
 * a metric computing scores and a renderer painting them are two jobs, and only
 * the second one is about colour.
 */
import { brandColor, brandRampColor, oklchToHex, BRAND_HUE } from "@/lib/brand";
import type { FunctionalityScaleLevel } from "@/lib/schemas/config";

/** Neutral for levels missing from the scale (and unset canvas colours). */
export const FALLBACK_LEVEL_COLOR = brandColor("neutral", 400);

/** Colour for a Functionality integer level, from the Model Configuration scale. */
export function levelColor(
  scale: readonly FunctionalityScaleLevel[],
  level: number,
): string {
  return scale.find((l) => l.level === level)?.color ?? FALLBACK_LEVEL_COLOR;
}

// ---------------------------------------------------------------------------
// Distinguishable palettes
// ---------------------------------------------------------------------------

/**
 * Colours whose job is to be told apart — Canvases, and metrics whose scores
 * are categories rather than magnitudes.
 *
 * These deliberately do NOT collapse onto the brand's few hues: a palette where
 * two categories look alike has failed at the only thing it does. What they
 * take from the brand instead is the ramp — one lightness and chroma for all of
 * them, starting at the accent hue and stepping evenly around the wheel — so
 * they sit at the same visual weight as everything else on screen.
 */
function evenHues(count: number, lightness: number, chroma: number): string[] {
  return Array.from({ length: count }, (_, i) =>
    oklchToHex(lightness, chroma, (BRAND_HUE.accent + (360 / count) * i) % 360),
  );
}

/** Default colour choices offered for a Canvas (inspector + topbar pickers). */
export const CANVAS_PALETTE = evenHues(8, 0.62, 0.19) as readonly string[];

/** Discrete palette for metrics whose scores are categories, not magnitudes. */
export const CATEGORY_COLORS = evenHues(10, 0.62, 0.19);

// ---------------------------------------------------------------------------
// Analysis Heatmap palette
// ---------------------------------------------------------------------------

/**
 * Maps a normalised value [0,1] onto the accent ramp, light → dark. Blue is the
 * app's accent for Analysis, so the heatmap on the canvas reads as the same
 * feature as the window that produced it.
 *
 * Interpolated in OKLCH rather than sRGB: a straight RGB blend between a pale
 * and a dark blue passes through a washed-out grey in the middle, which reads as
 * "no data" exactly where the mid-scoring Elements are.
 */
export function scoreToColor(normalised: number): string {
  return brandRampColor("accent", 100, 900, normalised);
}
