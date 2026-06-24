/**
 * Helpers for discovering numeric node attributes that can serve as OI weights.
 */
import type { Node } from "@/lib/schemas/network";

/** Schema-defined attributes always offered, even when absent from live data. */
export const SCHEMA_NODE_ATTRS_FOR_OI = ["importance", "cost_of_disservice_per_day"] as const;

const NON_WEIGHT_KEYS = new Set([
  "id", "type", "label", "canvas_id", "node_categories", "icon",
  "direct_damage", "functionality_time", "time_restored",
  "x", "y", "positionAbsolute", "functionality",
]);

/**
 * Return all numeric node attribute names available as OI weight candidates.
 * Schema-known attrs appear first; custom attrs discovered in live data follow.
 */
export function detectOiWeightAttrs(nodes: Record<string, Node>): string[] {
  const seen = new Set<string>(SCHEMA_NODE_ATTRS_FOR_OI);
  for (const node of Object.values(nodes).slice(0, 20)) {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (typeof v === "number" && !NON_WEIGHT_KEYS.has(k)) seen.add(k);
    }
    const props = (node as Record<string, unknown>)["properties"];
    if (props && typeof props === "object") {
      for (const [k, v] of Object.entries(props as Record<string, unknown>)) {
        if (typeof v === "number") seen.add(k);
      }
    }
  }
  return [...seen];
}
