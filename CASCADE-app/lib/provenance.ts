/**
 * provenance.ts — mark what LLM Design or an agent adds (ADR-0022, ADR-0024). Pure.
 *
 * A node, edge, Event or Expectation that an edit adds carries `provenance`: where it came
 * from, why (the change's `why`), and whether a person has confirmed it. The
 * mark is stamped on the checked result, so it applies to sections and Bulk
 * operations alike, and it overrides whatever the text said: a reply cannot
 * mark its own additions confirmed.
 */

import { deepEqual } from "@/lib/graph-diff";
import { PROVENANCE_ORIGIN, type Provenance, type ProvenanceOrigin } from "@/lib/schemas/provenance";
import type { ProjectBundle } from "@/lib/schemas/bundle";
import { RECORD_LISTS } from "@/lib/record-lists";

/** True for an Element, Event or Expectation LLM Design or an agent added that no person has confirmed yet. */
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
 * `after` with every node, edge, and item of a list that carries Provenance
 * (lib/record-lists.ts: Events, Expectations) absent from `before`
 * marked as added by `origin` (LLM Design unless an agent's Proposal), unconfirmed,
 * and every other one keeping the mark it had in `before`: a text neither
 * confirms nor removes a mark. `rationale` gives the why of each addition, keyed
 * `node:<id>`, `edge:<id>`, `event:<id>`, `expectation:<id>`.
 */
export function markAdded(
  before: ProjectBundle,
  after: ProjectBundle,
  rationale: ReadonlyMap<string, string> = new Map(),
  origin: ProvenanceOrigin = PROVENANCE_ORIGIN,
): ProjectBundle {
  const mark = (key: string): Provenance => {
    const why = rationale.get(key);
    return { origin, ...(why ? { rationale: why } : {}), confirmed: false };
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
  type Marked = Record<string, unknown> & { provenance?: Provenance };
  const out = {
    project: { ...after.project, nodes: registry(before.project.nodes, after.project.nodes, "node"), edges: registry(before.project.edges, after.project.edges, "edge") },
    config: { ...after.config },
  };
  // Every list whose items carry Provenance (lib/record-lists.ts): Events and Expectations.
  for (const l of RECORD_LISTS) {
    if (!("provenance" in l)) continue;
    const now = (after[l.at] as unknown as Record<string, Marked[] | undefined>)[l.key];
    if (!now) continue;
    const was = new Map(((before[l.at] as unknown as Record<string, Marked[] | undefined>)[l.key] ?? []).map((x) => [x[l.idField], x]));
    (out[l.at] as unknown as Record<string, Marked[]>)[l.key] = now.map((x) => settle(x, was.get(x[l.idField]), `${l.kind}:${String(x[l.idField])}`));
  }
  return { ...after, ...out };
}
