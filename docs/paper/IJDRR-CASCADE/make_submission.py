#!/usr/bin/env python3
"""Build a flat, Editorial-Manager-ready copy of the manuscript.

Editorial Manager takes no subfolders, no spaces in file names and no duplicate
base names, and compiles from a .bbl. This copies the figures flat under logical
names (Figure_01.png ... in order of appearance), rewrites the paths, inlines the
bibliography into the .tex (no separate .bbl to find), test-compiles, and zips the result.

    python3 make_submission.py [OUT_DIR]      (default: ./submission)
"""
import re, shutil, subprocess, sys, zipfile
from pathlib import Path

SRC = Path(__file__).parent
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else SRC / "submission"
MAIN = "IJDRR-CASCADE"

tex = (SRC / f"{MAIN}.tex").read_text()
live = "\n".join(l for l in tex.splitlines() if not l.lstrip().startswith("%"))
paths = re.findall(r"\\includegraphics(?:\[[^\]]*\])?\s*%?\s*\{([^}]+)\}", live)

names, n = {}, 0
for p in paths:
    if p in names:
        continue
    ext = Path(p).suffix.lower()
    if "graphical_abstract" in p:
        names[p] = f"graphical_abstract{ext}"
    else:
        n += 1
        names[p] = f"Figure_{n:02d}{ext}"

shutil.rmtree(OUT, ignore_errors=True)
OUT.mkdir(parents=True)
for old, new in names.items():
    shutil.copy(SRC / old, OUT / new)
    tex = tex.replace(old, new)
# double-anonymized review: the authors' own paper is cited as Anonymous and omitted from the list
tex = tex.replace(r"\cite{Grimaz2021}", "[Anonymous, 2021]")
ANON_REF = "\\medskip\\noindent[Anonymous 2021] Details omitted for double-anonymized reviewing.\n"
# PNG text chunks and EXIF can carry tool or author metadata; rewrite them without
from PIL import Image
for new in names.values():
    if new.endswith(".png"):
        im = Image.open(OUT / new); im.load()
        im.save(OUT / new, optimize=True)
shutil.copy(SRC / "elsarticle.cls", OUT / "elsarticle.cls")
shutil.copy(SRC / "cas-refs.bib", OUT / "cas-refs.bib")
shutil.copy(SRC / "elsarticle-num.bst", OUT / "elsarticle-num.bst")
(OUT / f"{MAIN}.tex").write_text(tex)

def run(*cmd):
    return subprocess.run(cmd, cwd=OUT, capture_output=True, text=True)

run("pdflatex", "-interaction=nonstopmode", f"{MAIN}.tex")
run("bibtex", MAIN)
run("pdflatex", "-interaction=nonstopmode", f"{MAIN}.tex")
log_run = run("pdflatex", "-interaction=nonstopmode", f"{MAIN}.tex")

# paste the compiled bibliography into the .tex so the upload needs no .bib,
# .bst or .bbl for Editorial Manager to locate
bbl = (OUT / f"{MAIN}.bbl").read_text()
tex = re.sub(r"\\bibliographystyle\{[^}]*\}\s*\\bibliography\{[^}]*\}", lambda m: bbl + "\n" + ANON_REF, tex)
(OUT / f"{MAIN}.bbl").unlink()

# blind review: authors, affiliation, funding, CRediT and repository links go to the title page
tex = re.sub(r"\\author\[[^\]]*\]\{[^\n]*\n", "", tex)
tex = re.sub(r"\\cortext\[[^\n]*\n|\\ead\{[^\n]*\n", "", tex)
tex = re.sub(r"\\affiliation\[[^\]]*\]\{.*?\n\}\n", "", tex, flags=re.S)
tex = re.sub(r"\\section\*\{Funding\}.*?(?=\\section\*)", "", tex, flags=re.S)
tex = re.sub(r"\\section\*\{CRediT authorship contribution statement\}.*?(?=\\section\*)", "", tex, flags=re.S)
tex = re.sub(r"(\\section\*\{Data availability\}).*?(?=\\section\*)",
             lambda m: m.group(1) + "\nThe software and the synthetic case-study data are openly available; the link is withheld for review and given on the title page.\n\n", tex, flags=re.S)
(OUT / f"{MAIN}.tex").write_text(tex)
for f in ("cas-refs.bib", "elsarticle-num.bst"):
    (OUT / f).unlink()

for _ in range(2):
    res = run("pdflatex", "-interaction=nonstopmode", f"{MAIN}.tex")
log = (OUT / f"{MAIN}.log").read_text()
errors = [l for l in log.splitlines() if l.startswith("!")]
undefined = [l for l in log.splitlines() if "undefined" in l.lower() and "Warning" in l]
print("errors:", errors or "none"); print("undefined refs/citations:", undefined or "none")

# keep only what is uploaded
keep = {f"{MAIN}.tex", "elsarticle.cls", *names.values()}
for f in OUT.iterdir():
    if f.name == f"{MAIN}.pdf":
        f.rename(OUT.parent / f"{OUT.name}-check.pdf")
    elif f.name not in keep:
        f.unlink()
with zipfile.ZipFile(OUT.parent / f"{OUT.name}.zip", "w", zipfile.ZIP_DEFLATED) as z:
    for f in sorted(OUT.iterdir()):
        z.write(f, f.name)
print("files:", sorted(f.name for f in OUT.iterdir()))
