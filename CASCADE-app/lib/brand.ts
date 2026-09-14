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
  neutral: 258,
  danger: 25,
  warning: 70,
  success: 149,
  accent: 263,
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
 * stylesheet generates. The lightness/chroma ladders are Tailwind's own; only
 * the hue is ours, which is why contrast behaves exactly as stock Tailwind.
 */
const RAMPS: Record<BrandRole, Record<number, [number, number]>> = {
  neutral: {
    50: [0.985, 0.003], 100: [0.967, 0.006], 200: [0.92, 0.012], 300: [0.871, 0.019],
    400: [0.705, 0.035], 500: [0.552, 0.033], 600: [0.442, 0.03], 700: [0.37, 0.03],
    800: [0.274, 0.032], 900: [0.21, 0.036], 950: [0.141, 0.03],
  },
  danger: {
    50: [0.971, 0.013], 100: [0.936, 0.032], 200: [0.885, 0.062], 300: [0.808, 0.114],
    400: [0.704, 0.191], 500: [0.637, 0.237], 600: [0.577, 0.245], 700: [0.505, 0.213],
    800: [0.444, 0.177], 900: [0.396, 0.141], 950: [0.258, 0.092],
  },
  warning: {
    50: [0.987, 0.022], 100: [0.962, 0.059], 200: [0.924, 0.12], 300: [0.879, 0.169],
    400: [0.828, 0.189], 500: [0.769, 0.188], 600: [0.666, 0.179], 700: [0.555, 0.163],
    800: [0.473, 0.137], 900: [0.414, 0.112], 950: [0.279, 0.077],
  },
  success: {
    50: [0.982, 0.018], 100: [0.962, 0.044], 200: [0.925, 0.084], 300: [0.871, 0.15],
    400: [0.792, 0.209], 500: [0.723, 0.219], 600: [0.627, 0.194], 700: [0.527, 0.154],
    800: [0.448, 0.119], 900: [0.393, 0.095], 950: [0.266, 0.065],
  },
  accent: {
    50: [0.97, 0.014], 100: [0.932, 0.032], 200: [0.882, 0.059], 300: [0.809, 0.105],
    400: [0.707, 0.165], 500: [0.623, 0.214], 600: [0.546, 0.245], 700: [0.488, 0.243],
    800: [0.424, 0.199], 900: [0.379, 0.146], 950: [0.282, 0.091],
  },
};

/**
 * The hex for one step of one brand ramp — the TypeScript equivalent of a
 * `text-blue-600` class. `brandColor("accent", 600)` and `bg-blue-600` are the
 * same colour, and both move when `--hue-accent` moves.
 */
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
