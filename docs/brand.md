# CASCADE Brand

The mark is a network graph that falls like a waterfall: a source node at the
crest, edges fanning down through two tiers, and a red stream plunging into the
node at the basin — a failure cascading from source to a critical Element, which
is what the platform computes.

Assets live in [`docs/assets/`](assets/); the app copies are under
`CASCADE-app/public/` and `CASCADE-app/app/`.

---

## Palette

The whole palette is **five hue angles**. Everything else — every shade of
every colour in the platform — is generated from them.

```css
/* CASCADE-app/app/globals.css */
--hue-neutral: 258;   /* surfaces, text, borders */
--hue-danger:   25;   /* errors, destructive actions, Functionality level 1 */
--hue-warning:  70;   /* warnings */
--hue-success: 149;   /* confirmations */
--hue-accent:  263;   /* interactive, selection, Analysis */
```

Change a number there and the platform repaints: buttons, toasts, warning
banners, panel borders, the Analysis heatmap, the canvas. Nothing else to edit.

### How it propagates

Tailwind's colour ramps are **redefined** rather than sat next to. `red-500`,
`zinc-400` and `amber-600` are not Tailwind's red, grey and amber in this app —
they are brand-critical, brand-neutral and brand-warning at those steps. So
there is no off-brand colour left to reach for, and the ~2900 colour classes
already in the codebase were correct the moment the ramps changed.

Each ramp keeps Tailwind's own lightness and chroma ladder and swaps only the
hue, so contrast — and therefore legibility and accessibility — behaves exactly
as stock Tailwind.

| Write this | You get |
|---|---|
| `bg-danger`, `text-warning`, `border-accent` | The semantic name. **Preferred in new code** — it says what the colour means. |
| `bg-red-600`, `text-zinc-400`, … | The same brand ramps, by step. Fine, and what most of the app still uses. |
| `bg-slate-*`, `gray-*`, `sky-*`, `indigo-*`, `rose-*`, `emerald-*`, `orange-*` | Aliased onto the ramp above, so a stray class can't smuggle in a different colour. |
| `violet-*`, `purple-*` | Left alone on purpose — they only ever mark *categories*, where being distinguishable is the entire job. |

### Canvas and chart colour

The canvas paints with inline styles, and `lib/` is unit-tested with no DOM, so
those colours can't read CSS. [`lib/brand.ts`](../CASCADE-app/lib/brand.ts)
mirrors the same five hues and derives hexes with the same OKLCH maths;
[`lib/colors.ts`](../CASCADE-app/lib/colors.ts) builds the heatmap ramp, the
Canvas palette and the category palette from it. No hex literals.

`lib/brand.test.ts` reads `globals.css` and **fails the build** if a hue there
disagrees with `lib/brand.ts`, or if any ramp step hard-codes a hue instead of
referencing the variable. "Change the hue in globals.css" therefore stays a
complete instruction.

### Brand marks

These are fixed hexes, not ramp steps: they must match the committed logo
assets in [`docs/assets/`](assets/) byte for byte.

| Token | Hex | Use |
|---|---|---|
| `brand-ink` | `#0f172a` | Mark and wordmark on light |
| `brand-paper` | `#f8fafc` | Mark and wordmark on dark |
| `brand-slate` | `#5b6675` | Middle tonal step of the mark |
| `brand-mist` | `#94a3b8` | Lightest tonal step |
| `brand-abyss` | `#0b1220` | OG card background |
| `brand-critical` | `#ef4444` | The cascade stream and basin node |
| `brand-critical-soft` | `#f87171` | The same accent on dark backgrounds |

`brand-critical` is intentionally the same red as `functionality_scale` level 1
(`critical`) in [`local-first-guide.md`](project/local-first-guide.md) — the
logo speaks the same colour language as the canvas. The neutral ramp is hued to
match `brand-slate` / `brand-mist`, so the greys carry the mark's slate cast
instead of reading as flat grey.

Functionality-scale colours themselves are **user data**, stored per project in
the Model Configuration. The defaults follow the brand; a user is free to
change them for their own model.

---

## Typography

Wordmark: **CASCADE**, all caps, weight 700, tracked `+0.11em`, set in Inter with
a system fallback (`"Segoe UI", system-ui, -apple-system, Roboto, Helvetica,
Arial, sans-serif`). Inter is SIL OFL — safe under the project's open-source rule
(CLAUDE.md §1). For assets used outside this repo, convert the wordmark to
outlines so it renders identically without the font installed.

---

## Logo files

| File | When to use |
|---|---|
| [`cascade-logo.svg`](assets/cascade-logo.svg) | The mark alone. Theme-aware (`currentColor` + a `prefers-color-scheme` rule). Primary in-app and README use. |
| [`cascade-lockup-horizontal.svg`](assets/cascade-lockup-horizontal.svg) | Mark + wordmark in a row. Doc headers, site header. |
| [`cascade-lockup-stacked.svg`](assets/cascade-lockup-stacked.svg) | Mark above wordmark. Square-ish spaces, splash. |
| `*-ondark.svg` variants | The two lockups with colours **forced** light — use on a coloured or dark surface where the automatic theme rule can't see the local background. |
| [`cascade-logo-v8-taper-grad.svg`](assets/cascade-logo-v8-taper-grad.svg) | The design source. Start edits here, then re-sync the copies. |

The `cascade-logo-v1..v7` files are earlier explorations, kept for reference.

### Backgrounded variants

[`cascade-mark-onlight.svg`](assets/cascade-mark-onlight.svg) and
[`cascade-mark-ondark.svg`](assets/cascade-mark-ondark.svg) are the mark on a
solid `#ffffff` / `#0b1220` panel — for surfaces that can't do transparency.

### Raster (PNG) exports

[`docs/assets/png/`](assets/png/) holds PNGs on a solid background (white behind
the ink mark, `#0b1220` behind the white mark) for tools that can't take SVG
(slides, Word, posters):

- `cascade-mark-{128,256,512,1024}.png` — mark, ink (for light backgrounds)
- `cascade-mark-ondark-{128,256,512,1024}.png` — mark, white (for dark backgrounds)
- `cascade-lockup-horizontal[-ondark]-{600,1200,2400}.png`
- `cascade-lockup-stacked[-ondark]-{500,1000}.png`

Regenerated by `build.py` alongside everything else.

### Clear space and minimum size

- Keep clear space of at least the crest-node diameter on every side.
- The mask that trims the edges to the node rims starts to break up below
  **~20 px**. Below that, use the app icon (`app/icon.svg`), which is drawn for
  small sizes.

### Do / don't

- **Do** recolour the mark by setting `color` (it is all `currentColor` except
  the fixed red).
- **Don't** change the red to another hue, restyle the wordmark, add effects, or
  box the mark on its own — the app icon is the only boxed form.

---

## App icon, favicon, PWA

Next.js serves these from convention — no `<link>` tags needed:

| File | Output |
|---|---|
| `CASCADE-app/app/icon.svg` | Rounded ink square, white graph. Scalable favicon. |
| `CASCADE-app/app/favicon.ico` | 16 / 32 / 48 px fallback. |
| `CASCADE-app/app/apple-icon.png` | 180 px, full-bleed (iOS rounds it). |
| `CASCADE-app/public/icon-192.png`, `icon-512.png` | PWA icons (`purpose: any`). |
| `CASCADE-app/public/icon-maskable-512.png` | PWA icon with safe-zone padding (`purpose: maskable`). |
| `CASCADE-app/app/manifest.webmanifest` | Ties the PWA icons + theme colours together. |

Regenerate them with `docs/assets/build.py` (below) if the mark changes.

---

## Social / OG card

[`cascade-og-card.png`](assets/cascade-og-card.png) (1200×630) — mirrored to
`CASCADE-app/public/og.png` and referenced from
[`app/layout.tsx`](../CASCADE-app/app/layout.tsx) `openGraph` / `twitter`
metadata. Shown when the app or repo is shared.

---

## Regenerating

All SVGs and PNGs are produced by one script,
[`docs/assets/build.py`](assets/build.py) (needs `rsvg-convert` and
ImageMagick). Edit the geometry there, run it, commit the diff.
