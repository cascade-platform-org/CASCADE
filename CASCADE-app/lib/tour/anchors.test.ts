/**
 * The anchor list, checked against the components that must render it.
 *
 * `TourStep.anchor` is typed as `TourAnchor`, so tsc already stops a tour from
 * naming an anchor that is not on the list. The other direction is what this
 * covers: a name on the list that no component renders any more. Such a step
 * still renders — centred, with no ring — behind a dev-only `console.warn`
 * nobody is watching, so the drift is silent.
 *
 * This replaces the hand-maintained `rendered` Set each tour spec used to
 * carry. Three copies of one list, kept in sync by comment.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { TOUR_ANCHORS } from "./types";

const COMPONENTS = fileURLToPath(new URL("../../components", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(path);
    return e.name.endsWith(".tsx") || e.name.endsWith(".ts") ? [path] : [];
  });
}

/** Every string literal a component passes as a `data-tour` value. */
const rendered = new Set<string>();
for (const file of sourceFiles(COMPONENTS)) {
  const src = readFileSync(file, "utf8");
  // Both spellings: the attribute written inline, and the value handed to a
  // component that spreads it onto the element (`dataTour="…"`).
  for (const m of src.matchAll(/data-?[Tt]our=\{?"([a-z-]+)"/g)) rendered.add(m[1]);
  // The toolbox builds its two anchors inside a ternary, so the names appear as
  // plain string literals rather than directly after the attribute.
  for (const m of src.matchAll(/"(tool-[a-z-]+)"/g)) rendered.add(m[1]);
}

describe("TOUR_ANCHORS", () => {
  it("finds the anchors the components render at all", () => {
    // Guards the regexes above: if they stop matching, every assertion below
    // would pass vacuously in the other direction.
    expect(rendered.size).toBeGreaterThan(8);
  });

  it.each(TOUR_ANCHORS)("%s is rendered by some component", (anchor) => {
    expect(rendered).toContain(anchor);
  });

  it("has no duplicates", () => {
    expect(new Set(TOUR_ANCHORS).size).toBe(TOUR_ANCHORS.length);
  });
});
