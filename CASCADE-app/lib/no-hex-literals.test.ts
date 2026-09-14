/**
 * CLAUDE.md §5 — "never write a hex literal or pick a colour by eye" — made
 * mechanical.
 *
 * The palette propagates through redefined Tailwind ramps, so a stray
 * `#3b82f6` does not look wrong the day it is written: it looks like the
 * accent, because it *was* the accent. It only becomes wrong when a hue moves,
 * and then it is one unexplained blue among thousands of repainted surfaces.
 * That is a bad thing to discover by eye, so it is a test.
 *
 * Canvas and inline styles take their colours from `lib/brand.ts`
 * (`brandColor`, `brandRampColor`) and `lib/colors.ts`; classes take theirs
 * from the ramps in `app/globals.css`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SEARCHED = ["lib", "store", "components", "app", "hooks"];

/**
 * Third-party marks are not ours to restyle: Google's "G" has to be Google's
 * four colours or it is not their logo. Anything else added here needs a reason
 * of that kind.
 */
const ALLOWED = ["components/auth/auth-gate.tsx"];

const HEX = /#[0-9a-fA-F]{6}\b/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(path);
    if (!/\.tsx?$/.test(e.name) || e.name.includes(".test.")) return [];
    return [path];
  });
}

const offenders: string[] = [];
for (const top of SEARCHED) {
  for (const file of sourceFiles(join(ROOT, top))) {
    const rel = relative(ROOT, file);
    if (ALLOWED.includes(rel)) continue;
    const src = readFileSync(file, "utf8");
    for (const line of src.split("\n")) {
      // A hex inside a comment is documentation ("e.g. #ef4444"), not paint.
      const code = line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
      if (/^\s*\*/.test(line)) continue;
      const found = code.match(HEX);
      if (found) offenders.push(`${rel}: ${found.join(", ")} — ${line.trim()}`);
    }
  }
}

describe("colour literals", () => {
  it("finds source to scan", () => {
    // Guards the walk itself: an empty search would pass vacuously forever.
    expect(sourceFiles(join(ROOT, "components")).length).toBeGreaterThan(20);
  });

  it("no hex colour is written outside the palette", () => {
    expect(offenders, `use brandColor()/brandRampColor() or a Tailwind class instead:\n${offenders.join("\n")}`)
      .toEqual([]);
  });
});
