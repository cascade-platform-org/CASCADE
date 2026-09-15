/**
 * The in-app manual is generated from the markdown, and this is what makes
 * "generated" true rather than aspirational.
 *
 * `lib/generated/user-manual.ts` is committed, because the Docker image copies
 * only `CASCADE-app/` and cannot read `docs/` at build time. A committed
 * artefact is a copy, and a copy goes stale — so the test reparses the markdown
 * and compares. Edit the manual without regenerating and this fails, naming the
 * command to run.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error — plain ESM, shared with scripts/build-user-manual.mjs.
import { parseManual } from "../../scripts/manual-parse.mjs";
import { USER_MANUAL } from "@/lib/generated/user-manual";
import type { ManualDoc, ManualSection } from "@/lib/manual/types";

const SOURCE = resolve(__dirname, "../../../docs/project/user-manual.md");

function parseSource(): ManualDoc {
  return parseManual(readFileSync(SOURCE, "utf8")) as ManualDoc;
}

describe("user manual", () => {
  it("the committed generated file matches the markdown", () => {
    expect(
      USER_MANUAL,
      "docs/project/user-manual.md has changed — run `npm run docs:manual`",
    ).toEqual(parseSource());
  });

  it("every section is numbered in order, with an anchor id", () => {
    USER_MANUAL.sections.forEach((section, i) => {
      expect(section.n).toBe(i + 1);
      expect(section.id).toMatch(/^[a-z0-9-]+$/);
      expect(section.title.length).toBeGreaterThan(0);
    });
  });

  it("carries real content in every section", () => {
    for (const section of USER_MANUAL.sections) {
      expect(section.blocks.length, `${section.title} is empty`).toBeGreaterThan(0);
    }
  });

  it("names only actions the renderer knows", () => {
    // A `cascade:` link renders as a button; an unknown one would render as a
    // button that does nothing.
    const KNOWN = new Set(["rules-manual"]);
    const walk = (blocks: ManualSection["blocks"]): void => {
      for (const block of blocks) {
        if (block.type === "sub") walk(block.blocks);
        const spans =
          block.type === "paragraph" || block.type === "callout"
            ? block.spans
            : block.type === "list"
              ? block.items.flat()
              : block.type === "table"
                ? block.rows.flat(2)
                : [];
        for (const span of spans) {
          if (span.kind === "link" && span.href.startsWith("cascade:")) {
            expect(KNOWN).toContain(span.href.slice("cascade:".length));
          }
        }
      }
    };
    USER_MANUAL.sections.forEach((s) => walk(s.blocks));
  });
});
