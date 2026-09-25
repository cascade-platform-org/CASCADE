/**
 * Helpers for discovering numeric node attributes that can serve as OI weights.
 */
import type { Node } from "@/lib/schemas/network";
import { NON_WEIGHT_KEYS_BASE } from "@/lib/weight-attrs";

/** Schema-defined attributes always offered, even when absent from live data. */
const SCHEMA_NODE_ATTRS_FOR_OI = ["importance", "cost_of_disservice_per_day"] as const;

/** The shared base, plus `functionality`: the Operativity Score is a weighted
 *  mean OF functionality, so offering it as its own weight would be circular.
 *  Weight expressions compute something else and do offer it — the difference
 *  is intended, and `lib/weight-attrs.ts` says why. */
const NON_WEIGHT_KEYS = new Set([...NON_WEIGHT_KEYS_BASE, "functionality"]);

/**
 * Return all numeric node attribute names available as OI weight candidates.
 * Schema-known attrs appear first; custom attrs discovered in live data follow.
 */
function detectOiWeightAttrs(nodes: Record<string, Node>): string[] {
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

/** A selectable Operativity-weighting option for the UI dropdowns. */
export interface OiWeightOption {
  value: string;
  label: string;
}

/**
 * Build the list of Operativity-weighting options shared by every selector
 * (model-based analysis and the Scorecard), so the choices stay identical
 * wherever the Operativity Score is computed.
 *
 * The first option, "constant", maps to uniform (equal) weighting in
 * `computeOperativityScore`; the remaining options are the numeric node
 * attributes discovered above (e.g. `importance`, `cost_of_disservice_per_day`).
 */
export function buildOiWeightOptions(nodes: Record<string, Node>): OiWeightOption[] {
  return [
    { value: "constant", label: "Equal weight (uniform)" },
    ...detectOiWeightAttrs(nodes).map((a) => ({ value: a, label: a.replace(/_/g, " ") })),
  ];
}
