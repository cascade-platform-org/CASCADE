#!/usr/bin/env python3
"""Build an arXiv-ready copy of the manuscript (authors kept, unlike make_submission.py).

Flat folder, no spaces in names, .bbl inlined, PNG metadata stripped, test-compiled, zipped.
    python3 make_arxiv.py [OUT_DIR]      (default: ./arxiv)
"""
import re, shutil, subprocess, sys, zipfile
from pathlib import Path
from PIL import Image

SRC = Path(__file__).parent
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else SRC / "arxiv"
MAIN = "IJDRR-CASCADE"
tex = (SRC / f"{MAIN}.tex").read_text()
live = "\n".join(l for l in tex.splitlines() if not l.lstrip().startswith("%"))
paths = re.findall(r"\\includegraphics(?:\[[^\]]*\])?\s*%?\s*\{([^}]+)\}", live)
names, n = {}, 0
for p in paths:
    if p not in names:
        n += 1
        names[p] = f"Figure_{n:02d}{Path(p).suffix.lower()}"
shutil.rmtree(OUT, ignore_errors=True); OUT.mkdir(parents=True)
for old, new in names.items():
    shutil.copy(SRC / old, OUT / new); tex = tex.replace(old, new)
for new in names.values():
    if new.endswith(".png"):
        im = Image.open(OUT / new); im.load(); im.save(OUT / new, optimize=True)
for f in ("elsarticle.cls", "elsarticle-num.bst", "cas-refs.bib"):
    shutil.copy(SRC / f, OUT / f)
# arXiv-only additions: status note on the title, and the two companion preprints
tex = tex.replace(r"Essential Services}", r"Essential Services\tnoteref{tstatus}}", 1)
tex = tex.replace(r"\author[uniud]{Cristian Curaba", r"\tnotetext[tstatus]{Preprint. Under review at the International Journal of Disaster Risk Reduction.}" + "\n" + r"\author[uniud]{Cristian Curaba", 1)
tex = tex.replace(r"\section*{Declaration of generative AI", r"\section*{Companion preprints}" + "\nTwo companion preprints build on CASCADE: the vitality measure for interdependent networks of networks \\cite{curaba2026seriesparalleldependencylinks} and the flow-allocation module validated against hydraulic simulation \\cite{curaba2026composableknowledgedrivendisservicepropagation}.\n\n" + r"\section*{Declaration of generative AI", 1)
(OUT / f"{MAIN}.tex").write_text(tex)
run = lambda *c: subprocess.run(c, cwd=OUT, capture_output=True, text=True)
run("pdflatex", "-interaction=nonstopmode", f"{MAIN}.tex"); run("bibtex", MAIN)
run("pdflatex", "-interaction=nonstopmode", f"{MAIN}.tex")
bbl = (OUT / f"{MAIN}.bbl").read_text()
tex = re.sub(r"\\bibliographystyle\{[^}]*\}\s*\\bibliography\{[^}]*\}", lambda m: bbl, tex)
(OUT / f"{MAIN}.tex").write_text(tex)
for f in ("cas-refs.bib", "elsarticle-num.bst"): (OUT / f).unlink()
for _ in range(2): run("pdflatex", "-interaction=nonstopmode", f"{MAIN}.tex")
log = (OUT / f"{MAIN}.log").read_text().splitlines()
print("errors:", [l for l in log if l.startswith("!")] or "none")
print("undefined:", [l for l in log if "undefined" in l.lower() and "Warning" in l] or "none")
keep = {f"{MAIN}.tex", "elsarticle.cls", *names.values()}
for f in OUT.iterdir():
    if f.name == f"{MAIN}.pdf": f.rename(OUT.parent / f"{OUT.name}-check.pdf")
    elif f.name not in keep: f.unlink()
with zipfile.ZipFile(OUT.parent / f"{OUT.name}.zip", "w", zipfile.ZIP_DEFLATED) as z:
    for f in sorted(OUT.iterdir()): z.write(f, f.name)
print(sorted(f.name for f in OUT.iterdir()))
