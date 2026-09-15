/**
 * types.ts — the shape of the parsed User Manual.
 *
 * `docs/project/user-manual.md` is the source; `scripts/manual-parse.mjs`
 * produces this shape and `components/help/user-manual.tsx` renders it. The
 * parser is plain ESM (it runs from a node script and from vitest), so these
 * types are the contract between the two rather than something either side
 * infers.
 */

export type ManualSpan =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "em"; text: string }
  | { kind: "link"; text: string; href: string }
  | { kind: "break" };

export type ManualBlock =
  | { type: "paragraph"; spans: ManualSpan[] }
  | { type: "callout"; spans: ManualSpan[] }
  | { type: "code"; text: string }
  | { type: "list"; ordered: boolean; items: ManualSpan[][] }
  | { type: "table"; head: string[]; rows: ManualSpan[][][] }
  | { type: "sub"; title: string; blocks: ManualBlock[] };

export interface ManualSection {
  /** Anchor id — the markdown heading's own slug. */
  id: string;
  /** The number the heading carries, so the panel and the file agree. */
  n: number;
  title: string;
  blocks: ManualBlock[];
}

export interface ManualDoc {
  sections: ManualSection[];
}
