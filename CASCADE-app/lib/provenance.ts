/**
 * provenance.ts — mark what LLM Design or a Workbook import adds (ADR-0022,
 * ADR-0023). Pure.
 *
 * A node, edge or Event that an edit adds carries `provenance`: where it came
 * from (LLM Design with the change's `why`, or a spreadsheet with its file,
 * sheet and row), and whether a person has confirmed it. The mark is stamped
 * on the checked result, so it overrides whatever the text or the sheet said:
 * neither can mark its own additions confirmed.
 */

import { deepEqual } from "@/lib/graph-diff";
import type { Provenance } from "@/lib/schemas/provenance";
import type { ProjectBundle } from "@/lib/schemas/bundle";

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

/** Where a mark says its thing came from, in words: "LLM Design", "Coop.xlsx › Nodes, row 7". */
export function originText(p: Provenance): string {
  if (p.origin === "llm_design") return "LLM Design";
  return p.source ? `${p.source.file} › ${p.source.sheet}, row ${p.source.row}` : "a spreadsheet";
}

/** LLM Design's mark: unconfirmed, with the why of the change that added it (keyed `node:<id>`, `edge:<id>`, `event:<id>`). */
export const llmDesignMark = (rationale: ReadonlyMap<string, string> = new Map()) => (key: string): Provenance => {
  const why = rationale.get(key);
  return { origin: "llm_design", ...(why ? { rationale: why } : {}), confirmed: false };
};

/**
 * `after` with every node, edge and Event absent from `before` carrying
 * `mark(key)` (keyed `node:<id>`, `edge:<id>`, `event:<id>`), and every other
 * one keeping the mark it had in `before`: an edit neither confirms nor
 * removes a mark.
 */
export function markAdded(before: ProjectBundle, after: ProjectBundle, mark: (key: string) => Provenance = llmDesignMark()): ProjectBundle {
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
