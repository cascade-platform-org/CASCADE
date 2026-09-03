# IJDRR-CASCADE — preprint source

**Status:** preprint. This is the pre-refereeing version of a manuscript under
review at the *International Journal of Disaster Risk Reduction* (Elsevier).
It has not been peer-reviewed and may change before publication.

**Title:** Customizable Assessment of System Cascades And Dependency Effects for
Improving Resilience of Interdependent Essential Services

**Authors:** Cristian Curaba, Fabio Zorzini, Stefano Grimaz (University of Udine)

Posting a preprint is permitted under Elsevier's article-sharing policy and does
not affect the submission. Once the article is accepted, a citation and DOI link
to the published version will be added here.

## Build

```bash
pdflatex IJDRR-CASCADE.tex
bibtex   IJDRR-CASCADE
pdflatex IJDRR-CASCADE.tex
pdflatex IJDRR-CASCADE.tex
```

`elsarticle.cls` / `elsarticle-num.bst` (LaTeX Project Public License) are
tracked so the PDF builds offline; `*.pdf`, `*.bbl` and other LaTeX build
artifacts are git-ignored (see `.gitignore`).

## From paper to code

[`docs/papers.md`](../../papers.md) maps each section and figure of this paper
to the source file that implements or reproduces it.
