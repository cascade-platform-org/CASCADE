import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BRAND_HUE, brandColor, brandRampColor, oklchToHex, rampStep, type BrandRole } from "./brand";

/** Relative luminance, for the WCAG contrast checks below. */
function luminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const GLOBALS_CSS = fileURLToPath(new URL("../app/globals.css", import.meta.url));

describe("oklchToHex", () => {
  it("converts known OKLCH values to the sRGB hexes a browser produces", () => {
    // Fixed reference points, independent of the palette: if the maths drifts,
    // the canvas stops matching what CSS paints for the same oklch() value.
    expect(oklchToHex(0.637, 0.2078, 25.3)).toBe("#ef4444");
    expect(oklchToHex(0.711, 0.0351, 256.8)).toBe("#94a3b8");
    expect(oklchToHex(0.506, 0.0275, 256.2)).toBe("#5b6675");
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

  it("every ramp step in the stylesheet has the same lightness and chroma here", () => {
    // The hue check above is not enough on its own: the palette is muted by
    // damping chroma, so a chroma edited in one file and not the other would
    // leave the canvas more (or less) saturated than every CSS surface, with
    // both files still passing a hue-only check.
    const FAMILY: Record<string, BrandRole> = {
      zinc: "neutral", red: "danger", amber: "warning", green: "success", blue: "accent",
    };
    let checked = 0;
    for (const [family, role] of Object.entries(FAMILY)) {
      for (const step of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]) {
        const m = css.match(
          new RegExp(`--color-${family}-${step}:\\s*oklch\\(([0-9.]+)%\\s+([0-9.]+)\\s+var`),
        );
        expect(m, `--color-${family}-${step} is missing from app/globals.css`).not.toBeNull();
        const [l, c] = rampStep(role, step);
        expect(Number(m![1]) / 100, `${family}-${step} lightness`).toBeCloseTo(l, 4);
        expect(Number(m![2]), `${family}-${step} chroma`).toBeCloseTo(c, 4);
        checked++;
      }
    }
    expect(checked).toBe(55);
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

// ---------------------------------------------------------------------------
// Legibility
// ---------------------------------------------------------------------------

describe("contrast", () => {
  const WHITE = "#ffffff";

  it.each(["danger", "success", "warning", "accent", "neutral"] as BrandRole[])(
    "%s-700 is readable as text on white (WCAG AA)",
    (role) => {
      expect(contrast(brandColor(role, 700), WHITE)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(["danger", "accent", "neutral"] as BrandRole[])(
    "%s-600 is readable as text on white too — these carry labels and links",
    (role) => {
      expect(contrast(brandColor(role, 600), WHITE)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("every 500 step is at least a legible large-text colour", () => {
    // Damping chroma must not quietly turn a mid step into decoration.
    for (const role of Object.keys(BRAND_HUE) as BrandRole[]) {
      expect(contrast(brandColor(role, 500), WHITE), role).toBeGreaterThanOrEqual(2.0);
    }
  });

  it("stays inside sRGB — no step is clipped", () => {
    // A clipped step is a colour the ramp does not actually contain: two
    // neighbouring steps can collapse onto the same hex and the ladder loses a
    // rung. The muted chroma exists partly to keep every step reachable.
    for (const role of Object.keys(BRAND_HUE) as BrandRole[]) {
      const seen = new Set<string>();
      for (const step of [300, 400, 500, 600, 700, 800, 900]) {
        seen.add(brandColor(role, step));
      }
      expect(seen.size, `${role} has duplicate steps — something is clipping`).toBe(7);
    }
  });
});
