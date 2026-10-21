/**
 * state-text.ts — an Element's state in words, for an LLM or a person. Pure.
 *
 * A level by its scale label and what caused it, by name. The LLM Recipes'
 * state, the agent's runs and the Expectation results all write it through
 * these, so an LLM reads the same words whichever one it was given.
 */

import { filterLabel } from "@/lib/element-filter";
import type { ModelConfiguration } from "@/lib/schemas/config";
import type { Edge, Node } from "@/lib/schemas/network";

/** A Functionality level in words: `2 (operational_warning)`. */
export function levelText(level: number, config: ModelConfiguration): string {
  const label = config.functionality_scale[level - 1]?.label;
  return label ? `${level} (${label})` : String(level);
}

/** A name for an id a Responsibility Share holds: an Event's label, else the Element's. */
export function stateNamer(
  model: { nodes: Readonly<Record<string, Node>>; edges: Readonly<Record<string, Edge>> },
  config: ModelConfiguration,
): (id: string) => string {
  const events = new Map(config.events.map((e) => [e.id, e.label]));
  return (id) => events.get(id) ?? filterLabel(id, model);
}

/** Who caused an Element's state, most first: `Substation 50%, Grid 25%`; empty when nothing did. */
export function causesText(share: Readonly<Record<string, number>> | undefined, name: (id: string) => string): string {
  return Object.entries(share ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([id, s]) => `${name(id)} ${Math.round(s * 100)}%`)
    .join(", ");
}
