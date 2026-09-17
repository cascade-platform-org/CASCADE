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
--hue-neutral:  92;   /* surfaces, text, borders — at chroma 0: true greys */
--hue-danger:   28;   /* clay red — errors, destructive actions, level 1 */
--hue-warning:  70;   /* amber — warnings */
--hue-success: 150;   /* leaf — confirmations */
--hue-accent:  210;   /* petrol — interactive, selection, Analysis */
```

### Why these five

The theme is resilience of the bamboo kind: a system that bends, degrades and
recovers, rather than one that is either fine or on fire. The pale steps — the
ones that fill panels and banners — are held at about **0.68× the chroma** of a
stock Tailwind palette, so surfaces stay calm; the mid and dark steps sit at
**0.78×**, because a status colour that is too polite stops reading as a status.
Muting a colour is not the same as bending its hue towards its neighbour: that
is what turns green into sage and amber into mustard, and a whole UI tinted that
way looks soiled rather than soft.

| Role | Colour | Reading |
|---|---|---|
| `success` | **Leaf** (150°) | Green with only a trace of yellow — the bamboo idea without the olive. |
| `warning` | **Amber** (70°) | Deliberately not pulled towards green: a yellow with green in it turns mustard, and mustard reads as dirt rather than as caution. |
| `danger` | **Clay red** (28°) | Warm and definite rather than emergency scarlet — damaged and still structural, which is what Functionality 1 means. |
| `accent` | **Petrol** (210°) | The one cool hue, and the platform's interactive colour. |
| `neutral` | **Grey** (achromatic) | Deliberately colourless. A tinted surface reads as dirty rather than as warm, and every panel in the app is a surface — so white is white, black is black, and the four coloured roles do all the talking. |

Three decisions came from colour theory rather than taste:

- **Accent is the exact complement of danger** (32 + 180 = 212 ≈ 210). "You can
  click this" and "something is wrong" are the two meanings a user must never
  confuse, so they sit at opposite ends of the wheel.
- **Danger → warning → success are analogous** (28°, 70°, 150°), which is what
  makes a degradation gradient read as one scale rather than three unrelated
  stickers — and the Functionality scale is exactly that gradient.
- **The neutrals carry no hue at all.** Colour in this app means something —
  a Functionality level, a warning, a selection — so a surface that is quietly
  tinted is noise competing with signal.

Separations run 42°, 80°, 60° — far enough apart to name under an off-hue
display, close enough to read as one system.

### Legibility

Chroma is damped, lightness is not: the ramps keep Tailwind's lightness ladder,
and contrast is almost entirely a function of lightness. `lib/brand.test.ts`
asserts it rather than trusting it — every `700` step and the `600` steps that
carry links and labels clear **WCAG AA (4.5:1) on white**, and no step is
clipped by sRGB, which would silently collapse two rungs of a ramp onto the same
colour. The petrol ramp is flatter than the others for that reason: a dark cyan
is the most gamut-limited colour in the set, so its chroma is capped at what
sRGB can hold at each lightness.

Change a number there and the platform repaints: buttons, toasts, warning
banners, panel borders, the Analysis heatmap, the canvas. Nothing else to edit.

### How it propagates

Tailwind's colour ramps are **redefined** rather than sat next to. `red-500`,
`zinc-400` and `amber-600` are not Tailwind's red, grey and amber in this app —
they are brand-critical, brand-neutral and brand-warning at those steps. So
there is no off-brand colour left to reach for, and the ~2900 colour classes
already in the codebase were correct the moment the ramps changed.

Each ramp keeps Tailwind's lightness ladder and replaces both the hue and the
chroma, so legibility behaves as it does in stock Tailwind while the colour is
muted to the brand's.

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

`lib/brand.test.ts` reads `globals.css` and **fails the build** if any of the 55
ramp steps disagrees with `lib/brand.ts` on hue, lightness *or* chroma, or if a
step hard-codes a hue instead of referencing the variable.
`lib/no-hex-literals.test.ts` fails it if any `.ts`/`.tsx` file writes a hex
colour at all — the one exception being Google's own logo in the auth gate,
which is not ours to restyle. "Change the hue in globals.css" therefore stays a
complete instruction.

### The mark

`docs/assets/build.py` derives the logo's colours from the same five hues with
the same OKLCH maths and regenerates every SVG, PNG and the favicon. The mark
used to carry its own hexes, so a hue change repainted the platform and left the
logo behind. Run `python3 docs/assets/build.py` after changing a hue — it needs
`rsvg-convert` and ImageMagick.

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

**The public website is set in Inter too**, so the page and the mark share a
face. The variable `woff2` is committed at
[`CASCADE-app/app/fonts/`](../CASCADE-app/app/fonts/) with its licence beside
it, and loaded through `next/font/local` (`app/fonts.ts`) rather than fetched
from a font CDN: the build stays reproducible offline and a visitor's browser
contacts nobody. The editor keeps its own face (`--font-app` in `globals.css`,
applied by `app/(product)/layout.tsx`).

The website's small-caps section labels are tracked `+0.11em` — the wordmark's
own tracking — which is what makes a section label read as part of the mark.

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
[`lib/site-metadata.ts`](../CASCADE-app/lib/site-metadata.ts) `openGraph` /
`twitter` metadata, which every root layout reads. Shown when a page of the site
or the repo is shared.

---

## The public website

[`cascade-platform.org`](https://cascade-platform.org) is built from the same
palette and the same components discipline as the platform, in the same Next.js
build (`app/(site)` and `app/(site-it)`; see
[architecture.md](project/architecture.md#routing--the-public-website-and-the-editor)).

Three things about it are brand decisions rather than layout ones:

- **The hero figure is drawn, not filmed.**
  [`components/site/cascade-animation.tsx`](../CASCADE-app/components/site/cascade-animation.tsx)
  is an inline SVG of a three-tier network in the mark's own fan, and a failure
  falls through it exactly as the mark's stream does. It costs no media file and
  stays sharp at any size. Its keyframes live in `globals.css` beside the tour
  ring, read their colours from the ramps, and are frozen under
  `prefers-reduced-motion` on the settled end state.
- **Green → amber → red is the Functionality scale**, not decoration. It is the
  only place red appears on the site, which is what keeps red meaning "something
  has failed" there as it does on the canvas.
- **The navigation bar is dark in both colour schemes.** The hero band is dark,
  so a bar that matched the page would have to change on scroll. A bar that is
  always dark reads as the platform's chrome and needs no scroll listener.

### Website assets in `CASCADE-app/public/`

| File | Source | Why the copy exists |
|---|---|---|
| `logo-horizontal.svg` | `cascade-lockup-horizontal.svg` | Footer — theme-aware, follows the visitor's scheme |
| `logo-horizontal-ondark.svg` | `cascade-lockup-horizontal-ondark.svg` | Header — the bar is always dark, which the theme-aware file cannot see |
| `platform.gif` | `CASCADE-platform.gif` | The "see it work" band |
| `og.png` | `cascade-og-card.png` | Link previews |

Re-copy these after `build.py` regenerates `docs/assets/`.

---

## Regenerating

All SVGs and PNGs are produced by one script,
[`docs/assets/build.py`](assets/build.py) (needs `rsvg-convert` and
ImageMagick). Edit the geometry there, run it, commit the diff.
