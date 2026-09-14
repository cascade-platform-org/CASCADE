#!/usr/bin/env python3
"""Regenerate every CASCADE brand asset from one geometry definition.

Requires: rsvg-convert (librsvg) and ImageMagick (`convert`).
Run from anywhere:  python3 docs/assets/build.py
"""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / "CASCADE-app"
ASSETS = ROOT / "docs" / "assets"
TMP = ASSETS / ".build-tmp"
TMP.mkdir(exist_ok=True)

# ── Palette ────────────────────────────────────────────────────────────────
# The mark is painted from the same five hue angles as the platform
# (CASCADE-app/app/globals.css → --hue-*), with the same OKLCH maths as
# CASCADE-app/lib/brand.ts. It used to carry its own hexes, which meant a hue
# change repainted the whole app and left the logo behind.
# `CASCADE-app/lib/brand.test.ts` fails the build if these hues drift.
HUE = {"neutral": 92, "danger": 28, "warning": 70, "success": 150, "accent": 210}

# Lightness/chroma ladders, mirroring lib/brand.ts.
RAMP = {
    # Achromatic: true greys, so the mark's only colour is its failing node.
    "neutral": {50: (.985, 0), 100: (.967, 0), 200: (.92, 0), 300: (.871, 0),
                400: (.705, 0), 500: (.552, 0), 600: (.442, 0), 700: (.37, 0),
                800: (.274, 0), 900: (.21, 0), 950: (.141, 0)},
    "danger": {50: (.971, .009), 100: (.936, .022), 200: (.885, .042), 300: (.808, .078),
               400: (.704, .149), 500: (.637, .185), 600: (.577, .191), 700: (.505, .166),
               800: (.444, .138), 900: (.396, .11), 950: (.258, .072)},
}


def oklch(l, c, h):
    """OKLCH -> #rrggbb, clipped per channel exactly as a browser does."""
    import math
    hr = math.radians(h)
    a, b = c * math.cos(hr), c * math.sin(hr)
    lp, mp, sp = (l + .3963377774 * a + .2158037573 * b,
                  l - .1055613458 * a - .0638541728 * b,
                  l - .0894841775 * a - 1.2914855480 * b)
    lc, mc, sc = lp ** 3, mp ** 3, sp ** 3
    rgb = (4.0767416621 * lc - 3.3077115913 * mc + .2309699292 * sc,
           -1.2684380046 * lc + 2.6097574011 * mc - .3413193965 * sc,
           -.0041960863 * lc - .7034186147 * mc + 1.7076147010 * sc)

    def srgb(v):
        s = 12.92 * v if v <= .0031308 else 1.055 * max(v, 0) ** (1 / 2.4) - .055
        return round(min(1, max(0, s)) * 255)

    return "#" + "".join(f"{srgb(v):02x}" for v in rgb)


def step(role, n):
    l, c = RAMP[role][n]
    return oklch(l, c, HUE[role])


RED = step("danger", 500)           # brand-critical: the failing Element
RED_SOFT = step("danger", 400)      # the jet, mid-fall
RED_PALE = step("danger", 300)
INK = oklch(.16, 0, HUE["neutral"])         # near-black, untinted
ABYSS = oklch(.10, 0, HUE["neutral"])       # one shade under ink
ABYSS_LIFT = oklch(.18, 0, HUE["neutral"])  # the OG card's gradient end
PAPER = step("neutral", 50)
MIST = step("neutral", 400)
STONE_100 = step("neutral", 100)
STONE_200 = step("neutral", 200)
WM_FONT = ('font-family="Inter, \'Segoe UI\', system-ui, -apple-system, Roboto, '
           'Helvetica, Arial, sans-serif" font-weight="700" letter-spacing="3.2"')


def mark(stroke, jet_lo, jet_hi, node_fill, shadow_op, cy_off=0):
    """Return (defs, body) for the mark, parameterised by colour."""
    y1, y2, y3 = 12 + cy_off, 30 + cy_off, 50 + cy_off
    e_top = [f'M32 {y1} Q24 {y1+10} 20 {y2}', f'M32 {y1} Q40 {y1+10} 44 {y2}']
    e_bot = [f'M20 {y2} Q15 {y2+10} 13 {y3}', f'M20 {y2} Q26 {y2+10} 32 {y3}',
             f'M44 {y2} Q38 {y2+10} 32 {y3}', f'M44 {y2} Q49 {y2+10} 51 {y3}']

    def g(ds, **kw):
        at = " ".join(f'{k.replace("_", "-")}="{v}"' for k, v in kw.items())
        return (f'<g fill="none" stroke-linecap="round" {at}>'
                + "".join(f'<path d="{p}"/>' for p in ds) + '</g>')

    defs = (
        f'<filter id="sh" x="-60%" y="-60%" width="220%" height="220%">'
        f'<feDropShadow dx="0" dy="1.1" stdDeviation="1.3" flood-color="{ABYSS}" flood-opacity="{shadow_op}"/></filter>'
        f'<mask id="cut" maskUnits="userSpaceOnUse"><rect width="64" height="64" fill="#fff"/>'
        f'<circle cx="32" cy="{y1}" r="5.7" fill="#000"/><circle cx="20" cy="{y2}" r="4.7" fill="#000"/>'
        f'<circle cx="44" cy="{y2}" r="4.7" fill="#000"/><circle cx="13" cy="{y3}" r="4.7" fill="#000"/>'
        f'<circle cx="51" cy="{y3}" r="4.7" fill="#000"/><circle cx="32" cy="{y3}" r="5.3" fill="#000"/></mask>'
        f'<linearGradient id="jet" x1="0" y1="0" x2="0" y2="1">'
        f'<stop offset="0" stop-color="{jet_lo}" stop-opacity="0.35"/>'
        f'<stop offset="1" stop-color="{jet_hi}" stop-opacity="1"/></linearGradient>'
    )
    body = (
        f'<g mask="url(#cut)">'
        + g(e_top + e_bot, stroke=stroke, stroke_width=6, opacity=0.09)
        + g(e_top, stroke=stroke, stroke_width=2.2, opacity=0.6)
        + g(e_bot, stroke=stroke, stroke_width=2, opacity=0.4)
        + f'<path d="M29.5 {y1+1} L34.5 {y1+1} L33 {y3-1} L31 {y3-1} Z" fill="url(#jet)"/>'
        + '</g>'
        + g([f'M17 {y3+7} Q32 {y3+11} 47 {y3+7}', f'M22 {y3+10} Q32 {y3+12.4} 42 {y3+10}'],
            stroke=stroke, stroke_width=1.4, opacity=0.26)
        + f'<g fill="{node_fill}" filter="url(#sh)">'
        + f'<circle cx="32" cy="{y1}" r="5"/>'
        + f'<circle cx="20" cy="{y2}" r="4" opacity="0.66"/><circle cx="44" cy="{y2}" r="4" opacity="0.66"/>'
        + f'<circle cx="13" cy="{y3}" r="4" opacity="0.44"/><circle cx="51" cy="{y3}" r="4" opacity="0.44"/>'
        + f'<circle cx="32" cy="{y3}" r="4.6" fill="{RED}"/></g>'
    )
    return defs, body


def write(path, svg):
    Path(path).write_text(svg)
    print("svg ", Path(path).relative_to(ROOT))


def png(src, w, h, out, bg=None):
    cmd = ["rsvg-convert", "-w", str(w), "-h", str(h), str(src), "-o", str(out)]
    if bg:
        cmd[1:1] = ["-b", bg]
    subprocess.run(cmd, check=True)
    print("png ", Path(out).relative_to(ROOT))


THEME_RULE = f"<style>@media (prefers-color-scheme:dark){{svg{{color:{STONE_100}}}}}</style>"

# 1 — canonical mark (theme-aware) --------------------------------------------
defs, body = mark("currentColor", RED, RED, "currentColor", "0.28")
canon = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" '
         f'height="64" role="img" aria-label="CASCADE" color="{INK}">{THEME_RULE}'
         f'<defs>{defs}</defs>{body}</svg>')
for p in (ASSETS / "cascade-logo-v8-taper-grad.svg",
          ASSETS / "cascade-logo.svg",
          APP / "public" / "logo.svg"):
    write(p, canon)

# 2 — lockups ----------------------------------------------------------------
def lockup(vb, mark_g, text, forced=None):
    col = f' color="{INK}"' if forced is None else ""
    rule = THEME_RULE if forced is None else ""
    defs, body = mark(*(forced or ("currentColor", RED, RED, "currentColor", "0.28")))
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" role="img" '
            f'aria-label="CASCADE"{col}>{rule}<defs>{defs}</defs>{mark_g(body)}{text}</svg>')

FORCE_DARK = (STONE_100, RED, RED_SOFT, PAPER, "0.5")
for suffix, forced in (("", None), ("-ondark", FORCE_DARK)):
    fill = "currentColor" if forced is None else PAPER
    write(ASSETS / f"cascade-lockup-horizontal{suffix}.svg", lockup(
        "0 0 268 64", lambda b: f"<g>{b}</g>",
        f'<text x="80" y="43" {WM_FONT} font-size="30" fill="{fill}">CASCADE</text>', forced))
    write(ASSETS / f"cascade-lockup-stacked{suffix}.svg", lockup(
        "0 0 168 100", lambda b: f'<g transform="translate(52,2)">{b}</g>',
        f'<text x="84" y="92" text-anchor="middle" {WM_FONT} font-size="19" fill="{fill}">CASCADE</text>', forced))
Path(APP / "public" / "logo-horizontal.svg").write_text(
    Path(ASSETS / "cascade-lockup-horizontal.svg").read_text())

# 3 — app icon + export sources --------------------------------------------
defs, body = mark(PAPER, RED_PALE, RED_SOFT, PAPER, "0.45", cy_off=1)
write(APP / "app" / "icon.svg",
      f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">'
      f'<defs>{defs}</defs><rect width="64" height="64" rx="14" fill="{INK}"/>{body}</svg>')
(TMP / "icon-tight.svg").write_text(
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">'
    f'<defs>{defs}</defs><rect width="64" height="64" fill="{INK}"/>{body}</svg>')
(TMP / "icon-maskable.svg").write_text(
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">'
    f'<defs>{defs}</defs><rect width="64" height="64" fill="{INK}"/>'
    f'<g transform="translate(32,33) scale(0.68) translate(-32,-33)">{body}</g></svg>')

# 4 — OG card --------------------------------------------------------------
defs, body = mark(STONE_200, RED_PALE, RED_SOFT, PAPER, "0.5", cy_off=1)
(TMP / "og.svg").write_text(
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">'
    f'<defs>{defs}<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">'
    f'<stop offset="0" stop-color="{ABYSS}"/><stop offset="1" stop-color="{ABYSS_LIFT}"/></linearGradient></defs>'
    f'<rect width="1200" height="630" fill="url(#bg)"/>'
    f'<g transform="translate(140,150) scale(4.6)">{body}</g>'
    f'<text x="470" y="300" {WM_FONT} font-size="104" fill="{PAPER}">CASCADE</text>'
    f'<text x="472" y="356" font-family="Inter, system-ui, Arial, sans-serif" font-size="30" fill="{MIST}">'
    f'Customizable assessment of system cascades</text>'
    f'<text x="472" y="396" font-family="Inter, system-ui, Arial, sans-serif" font-size="30" fill="{MIST}">'
    f'across interdependent essential services</text>'
    f'<rect x="472" y="440" width="52" height="4" rx="2" fill="{RED}"/></svg>')

# 5 — rasterise ----------------------------------------------------------------
png(APP / "app" / "icon.svg", 512, 512, APP / "public" / "icon-512.png")
png(APP / "app" / "icon.svg", 192, 192, APP / "public" / "icon-192.png")
png(TMP / "icon-maskable.svg", 512, 512, APP / "public" / "icon-maskable-512.png")
png(TMP / "icon-tight.svg", 180, 180, APP / "app" / "apple-icon.png")
png(TMP / "og.svg", 1200, 630, ASSETS / "cascade-og-card.png")
subprocess.run(["cp", str(ASSETS / "cascade-og-card.png"), str(APP / "public" / "og.png")], check=True)
png(ASSETS / "cascade-lockup-horizontal.svg", 1072, 256,
    ASSETS / "cascade-lockup-horizontal.png", bg=PAPER)

for s in (16, 32, 48):
    png(APP / "app" / "icon.svg", s, s, TMP / f"fav{s}.png")
subprocess.run(["convert", *[str(TMP / f"fav{s}.png") for s in (16, 32, 48)],
                str(APP / "app" / "favicon.ico")], check=True)
print("ico ", (APP / "app" / "favicon.ico").relative_to(ROOT))

# 6 — PNG export set (docs/assets/png/) -------------------------------------
# Solid backgrounds: white behind the ink mark, brand-abyss behind the white mark.
PNGDIR = ASSETS / "png"
PNGDIR.mkdir(exist_ok=True)
LIGHT_BG = PAPER
DARK_BG = ABYSS

# on-light mark = canonical (ink); on-dark mark = white/paper
defs_l, body_l = mark("currentColor", RED, RED, "currentColor", "0.28")
defs_d, body_d = mark(STONE_200, RED_PALE, RED_SOFT, PAPER, "0.5")
(TMP / "mark-dark.svg").write_text(
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">'
    f'<defs>{defs_d}</defs>{body_d}</svg>')

# SVG variants with a solid background rect (for slides / embeds that want no transparency)
write(ASSETS / "cascade-mark-onlight.svg",
      f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" '
      f'role="img" aria-label="CASCADE" color="{INK}"><defs>{defs_l}</defs>'
      f'<rect width="64" height="64" fill="{LIGHT_BG}"/>{body_l}</svg>')
write(ASSETS / "cascade-mark-ondark.svg",
      f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" '
      f'role="img" aria-label="CASCADE"><defs>{defs_d}</defs>'
      f'<rect width="64" height="64" fill="{DARK_BG}"/>{body_d}</svg>')

for size in (128, 256, 512, 1024):
    png(ASSETS / "cascade-logo.svg", size, size, PNGDIR / f"cascade-mark-{size}.png", bg=LIGHT_BG)
    png(TMP / "mark-dark.svg", size, size, PNGDIR / f"cascade-mark-ondark-{size}.png", bg=DARK_BG)

for w, h, src, stem, bg in (
    (600, 143, "cascade-lockup-horizontal.svg", "cascade-lockup-horizontal", LIGHT_BG),
    (1200, 287, "cascade-lockup-horizontal.svg", "cascade-lockup-horizontal", LIGHT_BG),
    (2400, 573, "cascade-lockup-horizontal.svg", "cascade-lockup-horizontal", LIGHT_BG),
    (600, 143, "cascade-lockup-horizontal-ondark.svg", "cascade-lockup-horizontal-ondark", DARK_BG),
    (1200, 287, "cascade-lockup-horizontal-ondark.svg", "cascade-lockup-horizontal-ondark", DARK_BG),
    (2400, 573, "cascade-lockup-horizontal-ondark.svg", "cascade-lockup-horizontal-ondark", DARK_BG),
    (500, 298, "cascade-lockup-stacked.svg", "cascade-lockup-stacked", LIGHT_BG),
    (1000, 595, "cascade-lockup-stacked.svg", "cascade-lockup-stacked", LIGHT_BG),
    (500, 298, "cascade-lockup-stacked-ondark.svg", "cascade-lockup-stacked-ondark", DARK_BG),
    (1000, 595, "cascade-lockup-stacked-ondark.svg", "cascade-lockup-stacked-ondark", DARK_BG),
):
    png(ASSETS / src, w, h, PNGDIR / f"{stem}-{w}.png", bg=bg)

for f in TMP.iterdir():
    f.unlink()
TMP.rmdir()
print("done")
