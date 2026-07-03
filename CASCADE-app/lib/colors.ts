/**
 * colors.ts — shared colour lookups for Functionality levels and Canvases.
 *
 * One place maps a Functionality integer to its configured colour and defines
 * the Canvas palette, so canvases, panels, and search results can never drift
 * apart on colour.
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
