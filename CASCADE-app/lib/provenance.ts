/**
 * provenance.ts — mark what LLM Design adds (ADR-0022). Pure.
 *
 * A node, edge or Event that an edit adds carries `provenance`: where it came
 * from, why (the change's `why`), and whether a person has confirmed it. The
 * mark is stamped on the checked result, so it applies to sections and Bulk
 * operations alike, and it overrides whatever the text said: a reply cannot
 * mark its own additions confirmed.
 */

import { deepEqual } from "@/lib/graph-diff";
import { PROVENANCE_ORIGIN, type Provenance } from "@/lib/schemas/provenance";
import type { ProjectBundle } from "@/lib/file-io";

/** True for an Element or Event LLM Design added that no person has confirmed yet. */
export const isUnconfirmed = (x: { provenance?: Provenance }): boolean => x.provenance !== undefined && !x.provenance.confirmed;

/** The same mark, confirmed by a person. */
export const confirmed = (p: Provenance): Provenance => ({ ...p, confirmed: true });

/** `x` carrying `provenance`, or none. */
function withMark<T extends { provenance?: Provenance }>(x: T, provenance: Provenance | undefined): T {
  if (provenance) return { ...x, provenance };
  const rest = { ...x };
  delete rest.provenance;
  return rest;
}

/**
 * `after` with every node, edge and Event absent from `before` marked as
 * added by LLM Design, unconfirmed, and every other one keeping the mark it
 * had in `before`: a text neither confirms nor removes a mark. `rationale`
 * gives the why of each addition, keyed `node:<id>`, `edge:<id>`, `event:<id>`.
 */
export function markAdded(before: ProjectBundle, after: ProjectBundle, rationale: ReadonlyMap<string, string> = new Map()): ProjectBundle {
  const mark = (key: string): Provenance => {
    const why = rationale.get(key);
    return { origin: PROVENANCE_ORIGIN, ...(why ? { rationale: why } : {}), confirmed: false };
  };
  const settle = <T extends { provenance?: Provenance }>(x: T, was: T | undefined, key: string): T => {
    const target = was ? was.provenance : mark(key);
    return deepEqual(x.provenance, target) ? x : withMark(x, target);
  };
  const registry = <T extends { provenance?: Provenance }>(was: Record<string, T>, now: Record<string, T>, kind: string) => {
    let out = now;
    for (const [id, x] of Object.entries(now)) {
      const next = settle(x, Object.hasOwn(was, id) ? was[id] : undefined, `${kind}:${id}`);
      if (next === x) continue;
      if (out === now) out = { ...now };
      out[id] = next;
    }
    return out;
  };
  const events = new Map(before.config.events.map((e) => [e.id, e]));
  return {
    ...after,
    project: {
      ...after.project,
      nodes: registry(before.project.nodes, after.project.nodes, "node"),
      edges: registry(before.project.edges, after.project.edges, "edge"),
    },
    config: { ...after.config, events: after.config.events.map((e) => settle(e, events.get(e.id), `event:${e.id}`)) },
  };
}
