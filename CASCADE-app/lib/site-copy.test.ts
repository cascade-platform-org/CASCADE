/**
 * The two locales of the website must stay in step.
 *
 * TypeScript already guarantees the SHAPE — both files satisfy `SiteCopy`, so a
 * missing key fails the build. What it cannot catch is a key that is present
 * and empty, a list that lost an item in translation, or an English string left
 * sitting in the Italian file after a copy-paste. Those are the failures a
 * reader notices and the compiler does not, so they are asserted here.
 */

import { describe, it, expect } from "vitest";
import { en } from "./site-copy/en";
import { it as itCopy } from "./site-copy/it";
import { CONTACT_EMAIL, LINKS, mailto } from "./site-copy/links";
import type { SiteCopy } from "./site-copy/types";

const LOCALES: [string, SiteCopy][] = [
  ["en", en],
  ["it", itCopy],
];

/** Every string reachable from a copy object, with a dotted path to it. */
function strings(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => strings(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => strings(v, path ? `${path}.${k}` : k));
  }
  return [];
}

/** The shape of a copy object, ignoring the strings themselves. */
function skeleton(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(skeleton);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, skeleton(v)]),
    );
  }
  return typeof value;
}

describe("site copy", () => {
  it.each(LOCALES)("%s has no empty strings", (_name, copy) => {
    const empty = strings(copy)
      .filter(([, text]) => text.trim() === "")
      .map(([path]) => path);
    expect(empty).toEqual([]);
  });

  it("both locales have the same structure, including list lengths", () => {
    // Catches a translation that dropped one of the nine capabilities, or one
    // of the three engine phases — a gap TypeScript's array type allows.
    expect(skeleton(itCopy)).toEqual(skeleton(en));
  });

  it("declares its own locale consistently", () => {
    for (const [, copy] of LOCALES) {
      expect(copy.htmlLang).toBe(copy.locale);
      expect(copy.alternate.locale).not.toBe(copy.locale);
    }
    // Each locale must point at the other, or the hreflang pair is broken.
    expect(en.alternate.href).toBe(itCopy.meta.path);
    expect(itCopy.alternate.href).toBe(en.meta.path);
  });

  it("was actually translated", () => {
    // Prose that is byte-identical across the two files is almost always an
    // untranslated paste. Proper nouns and paper titles are the real
    // exceptions, so only sentence-length strings are compared.
    const enText = new Map(strings(en));
    const shared = strings(itCopy).filter(([path, text]) => {
      const original = enText.get(path);
      return original !== undefined && original === text && text.includes(" ") && text.length > 60;
    });
    const allowed = /^research\.papers\[\d\]\.title$/;
    expect(shared.filter(([path]) => !allowed.test(path)).map(([path]) => path)).toEqual([]);
  });

  it("every in-page anchor has a section to land on", () => {
    // The nav is the only place these ids are written twice; a rename that
    // misses one produces a link that silently does nothing.
    const sections = ["#research", "#contact"];
    for (const [, copy] of LOCALES) {
      expect(copy.nav.links.map((l) => l.href).sort()).toEqual([...sections].sort());
    }
  });

  it("links off-site only over https, and marks those links external", () => {
    for (const [, copy] of LOCALES) {
      const links = [...copy.footer.groups.flatMap((g) => g.links), copy.research.link];
      for (const link of links) {
        if (link.external) expect(link.href).toMatch(/^https:\/\//);
        else expect(link.href).toMatch(/^\//);
      }
    }
  });

  it("builds a mailto with an encoded subject", () => {
    expect(mailto("CASCADE — research collaboration")).toBe(
      `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("CASCADE — research collaboration")}`,
    );
  });

  it("points every repository link at the same repository", () => {
    const repoLinks = Object.values(LINKS).filter((url) => url.startsWith("http"));
    for (const url of repoLinks) expect(url).toContain("github.com/cascade-platform-org/CASCADE");
  });
});
