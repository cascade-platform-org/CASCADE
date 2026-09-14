import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BRAND_HUE, brandColor, brandRampColor, oklchToHex, type BrandRole } from "./brand";

const GLOBALS_CSS = fileURLToPath(new URL("../app/globals.css", import.meta.url));

describe("oklchToHex", () => {
  it("round-trips the brand mark colours the stylesheet hard-codes", () => {
    // Measured from the committed logo assets; if the maths drifts, the canvas
    // stops matching the mark.
    expect(oklchToHex(0.637, 0.2078, 25.3)).toBe("#ef4444"); // brand-critical
    expect(oklchToHex(0.711, 0.0351, 256.8)).toBe("#94a3b8"); // brand-mist
    expect(oklchToHex(0.506, 0.0275, 256.2)).toBe("#5b6675"); // brand-slate
  });

  it("clamps out-of-gamut colours instead of emitting garbage", () => {
    const hex = oklchToHex(0.5, 0.4, 140);
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("produces black and white at the ends of the lightness axis", () => {
    expect(oklchToHex(0, 0, 0)).toBe("#000000");
    expect(oklchToHex(1, 0, 0)).toBe("#ffffff");
  });
});

describe("brandColor", () => {
  it("gets darker as the step rises", () => {
    const lum = (hex: string) =>
      parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
    for (const role of Object.keys(BRAND_HUE) as BrandRole[]) {
      expect(lum(brandColor(role, 50))).toBeGreaterThan(lum(brandColor(role, 500)));
      expect(lum(brandColor(role, 500))).toBeGreaterThan(lum(brandColor(role, 950)));
    }
  });

  it("rejects a step that is not on the ramp", () => {
    expect(() => brandColor("accent", 450)).toThrow(/No step 450/);
  });
});

describe("brandRampColor", () => {
  it("returns the endpoints at t=0 and t=1", () => {
    expect(brandRampColor("accent", 100, 900, 0)).toBe(brandColor("accent", 100));
    expect(brandRampColor("accent", 100, 900, 1)).toBe(brandColor("accent", 900));
  });

  it("clamps t outside [0,1] rather than extrapolating off the ramp", () => {
    expect(brandRampColor("accent", 100, 900, -5)).toBe(brandColor("accent", 100));
    expect(brandRampColor("accent", 100, 900, 5)).toBe(brandColor("accent", 900));
  });
});

// ---------------------------------------------------------------------------
// The drift guard
// ---------------------------------------------------------------------------

describe("brand hues match app/globals.css", () => {
  const css = readFileSync(GLOBALS_CSS, "utf8");

  it.each(Object.entries(BRAND_HUE))(
    "--hue-%s is %s in the stylesheet too",
    (role, hue) => {
      const match = css.match(new RegExp(`--hue-${role}:\\s*([0-9.]+)\\s*;`));
      expect(match, `--hue-${role} is missing from app/globals.css`).not.toBeNull();
      expect(Number(match![1])).toBe(hue);
    },
  );

  it("every hue declared in the stylesheet is also declared here", () => {
    const declared = [...css.matchAll(/--hue-([a-z-]+):/g)].map((m) => m[1]).sort();
    expect(declared).toEqual(Object.keys(BRAND_HUE).sort());
  });

  it("the ramps reference the hue variables rather than hard-coding a hue", () => {
    // A literal hue on a ramp step is how the palette silently splits in two.
    const rampLines = css.match(/--color-(zinc|red|amber|green|blue)-\d+:\s*oklch\([^;]+;/g) ?? [];
    expect(rampLines.length).toBeGreaterThan(50);
    for (const line of rampLines) {
      expect(line, `${line} should end in var(--hue-…)`).toMatch(/var\(--hue-[a-z]+\)\s*\)/);
    }
  });
});
