/**
 * brand.ts — the palette for consumers that cannot read CSS.
 *
 * `app/globals.css` is the source of truth: it drives every Tailwind class in
 * the app from five hue numbers. But the canvas paints with inline styles and
 * `html-to-image` exports, and `lib/` is unit-tested in a Node environment with
 * no DOM — so those colours have to be computable in TypeScript.
 *
 * Rather than copy hexes (which drift silently), this file copies the same five
 * hues and derives the rest with the same OKLCH maths the stylesheet uses.
 * `brand.test.ts` reads `globals.css` and fails if a hue here disagrees with the
 * one there, so "change the hue in globals.css" stays a complete instruction.
 */

/**
 * OKLCH hue angles, in degrees. Must equal the `--hue-*` values in
 * `app/globals.css` — enforced by `brand.test.ts`.
 */
export const BRAND_HUE = {
  neutral: 92,
  danger: 28,
  warning: 70,
  success: 150,
  accent: 210,
} as const;

export type BrandRole = keyof typeof BRAND_HUE;

/**
 * Convert an OKLCH colour to a `#rrggbb` string.
 *
 * Out-of-gamut results are clipped per channel. That is the same thing a
 * browser does for `oklch()` values it cannot display, and the ramps here stay
 * well inside sRGB anyway.
 *
 * @param l Lightness, 0–1.
 * @param c Chroma, 0–~0.4.
 * @param h Hue in degrees.
 */
export function oklchToHex(l: number, c: number, h: number): string {
  const hRad = (h * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);

  const lp = l + 0.3963377774 * a + 0.2158037573 * b;
  const mp = l - 0.1055613458 * a - 0.0638541728 * b;
  const sp = l - 0.0894841775 * a - 1.291485548 * b;

  const lc = lp * lp * lp;
  const mc = mp * mp * mp;
  const sc = sp * sp * sp;

  const rLin = 4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc;
  const gLin = -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc;
  const bLin = -0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc;

  const toSrgb = (v: number) => {
    const s = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, s)) * 255);
  };

  return `#${[rLin, gLin, bLin].map((v) => toSrgb(v).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * One step of a brand ramp, matching the `--color-<family>-<step>` value the
 * stylesheet generates.
 *
 * The lightness ladder is Tailwind's, so contrast behaves as it does there; the
 * chroma is damped to roughly 0.6× and capped at what sRGB can actually hold at
 * that lightness and hue — which is the whole "muted, not alarm-coloured" look,
 * and is also why the petrol ramp is flatter than the others (a dark cyan is
 * the most gamut-limited colour here). Contrast on white at step 600 stays at
 * or above WCAG AA for every role; `brand.test.ts` asserts it.
 */
const RAMPS: Record<BrandRole, Record<number, [number, number]>> = {
  // Achromatic: true greys, so surfaces never read as tinted.
neutral: { 50: [0.985, 0.0], 100: [0.967, 0.0], 200: [0.92, 0.0], 300: [0.871, 0.0], 400: [0.705, 0.0], 500: [0.552, 0.0], 600: [0.442, 0.0], 700: [0.37, 0.0], 800: [0.274, 0.0], 900: [0.21, 0.0], 950: [0.141, 0.0] },
  danger: { 50: [0.971, 0.009], 100: [0.936, 0.022], 200: [0.885, 0.042], 300: [0.808, 0.078], 400: [0.704, 0.149], 500: [0.637, 0.185], 600: [0.577, 0.191], 700: [0.505, 0.166], 800: [0.444, 0.138], 900: [0.396, 0.11], 950: [0.258, 0.072] },
  warning: { 50: [0.987, 0.008], 100: [0.962, 0.024], 200: [0.924, 0.053], 300: [0.879, 0.086], 400: [0.828, 0.128], 500: [0.769, 0.147], 600: [0.666, 0.135], 700: [0.555, 0.113], 800: [0.473, 0.096], 900: [0.414, 0.085], 950: [0.279, 0.06] },
  success: { 50: [0.982, 0.012], 100: [0.962, 0.03], 200: [0.925, 0.057], 300: [0.871, 0.102], 400: [0.792, 0.163], 500: [0.723, 0.171], 600: [0.627, 0.151], 700: [0.527, 0.12], 800: [0.448, 0.093], 900: [0.393, 0.074], 950: [0.266, 0.051] },
  accent: { 50: [0.97, 0.01], 100: [0.932, 0.022], 200: [0.882, 0.04], 300: [0.809, 0.071], 400: [0.707, 0.115], 500: [0.623, 0.102], 600: [0.546, 0.088], 700: [0.488, 0.079], 800: [0.424, 0.07], 900: [0.379, 0.062], 950: [0.282, 0.047] },
};

/** The raw `[lightness, chroma]` of one ramp step — what the stylesheet emits. */
export function rampStep(role: BrandRole, step: number): [number, number] {
  const entry = RAMPS[role][step];
  if (!entry) throw new Error(`No step ${step} in the "${role}" ramp`);
  return entry;
}

export function brandColor(role: BrandRole, step: number): string {
  const ramp = RAMPS[role];
  const entry = ramp[step];
  if (!entry) throw new Error(`No step ${step} in the "${role}" ramp`);
  return oklchToHex(entry[0], entry[1], BRAND_HUE[role]);
}

/** Interpolate within a ramp in OKLCH, which keeps mid-tones from going muddy. */
export function brandRampColor(role: BrandRole, from: number, to: number, t: number): string {
  const ramp = RAMPS[role];
  const a = ramp[from];
  const b = ramp[to];
  if (!a || !b) throw new Error(`No step ${from}/${to} in the "${role}" ramp`);
  const k = Math.min(1, Math.max(0, t));
  return oklchToHex(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, BRAND_HUE[role]);
}
