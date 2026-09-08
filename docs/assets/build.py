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

RED = "#ef4444"
INK = "#0f172a"
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
        f'<feDropShadow dx="0" dy="1.1" stdDeviation="1.3" flood-color="#0b1220" flood-opacity="{shadow_op}"/></filter>'
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


THEME_RULE = "<style>@media (prefers-color-scheme:dark){svg{color:#f1f5f9}}</style>"

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

FORCE_DARK = ("#f1f5f9", RED, "#f87171", "#f8fafc", "0.5")
for suffix, forced in (("", None), ("-ondark", FORCE_DARK)):
    fill = "currentColor" if forced is None else "#f8fafc"
    write(ASSETS / f"cascade-lockup-horizontal{suffix}.svg", lockup(
        "0 0 268 64", lambda b: f"<g>{b}</g>",
        f'<text x="80" y="43" {WM_FONT} font-size="30" fill="{fill}">CASCADE</text>', forced))
    write(ASSETS / f"cascade-lockup-stacked{suffix}.svg", lockup(
        "0 0 168 100", lambda b: f'<g transform="translate(52,2)">{b}</g>',
        f'<text x="84" y="92" text-anchor="middle" {WM_FONT} font-size="19" fill="{fill}">CASCADE</text>', forced))
Path(APP / "public" / "logo-horizontal.svg").write_text(
    Path(ASSETS / "cascade-lockup-horizontal.svg").read_text())

# 3 — app icon + export sources --------------------------------------------
defs, body = mark("#ffffff", "#fca5a5", "#f87171", "#ffffff", "0.45", cy_off=1)
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
defs, body = mark("#e2e8f0", "#fca5a5", "#f87171", "#f8fafc", "0.5", cy_off=1)
(TMP / "og.svg").write_text(
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">'
    f'<defs>{defs}<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">'
    f'<stop offset="0" stop-color="#0b1220"/><stop offset="1" stop-color="#111f36"/></linearGradient></defs>'
    f'<rect width="1200" height="630" fill="url(#bg)"/>'
    f'<g transform="translate(140,150) scale(4.6)">{body}</g>'
    f'<text x="470" y="300" {WM_FONT} font-size="104" fill="#f8fafc">CASCADE</text>'
    f'<text x="472" y="356" font-family="Inter, system-ui, Arial, sans-serif" font-size="30" fill="#94a3b8">'
    f'Customizable assessment of system cascades</text>'
    f'<text x="472" y="396" font-family="Inter, system-ui, Arial, sans-serif" font-size="30" fill="#94a3b8">'
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
    ASSETS / "cascade-lockup-horizontal.png", bg="#ffffff")

for s in (16, 32, 48):
    png(APP / "app" / "icon.svg", s, s, TMP / f"fav{s}.png")
subprocess.run(["convert", *[str(TMP / f"fav{s}.png") for s in (16, 32, 48)],
                str(APP / "app" / "favicon.ico")], check=True)
print("ico ", (APP / "app" / "favicon.ico").relative_to(ROOT))

# 6 — PNG export set (docs/assets/png/) -------------------------------------
# Solid backgrounds: white behind the ink mark, brand-abyss behind the white mark.
PNGDIR = ASSETS / "png"
PNGDIR.mkdir(exist_ok=True)
LIGHT_BG = "#ffffff"
DARK_BG = "#0b1220"

# on-light mark = canonical (ink); on-dark mark = white/paper
defs_l, body_l = mark("currentColor", RED, RED, "currentColor", "0.28")
defs_d, body_d = mark("#e2e8f0", "#fca5a5", "#f87171", "#f8fafc", "0.5")
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
