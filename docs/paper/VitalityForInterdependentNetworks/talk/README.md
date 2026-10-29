# CNA 2026 talk: render, export, run sheet

`presentation.qmd` is the 10-slide, 12-minute talk for the vitality paper
(`../VitalityForInterdependentNetworks.tex`). Every number on the slides is copied
from the paper: the Fig. 2 table, and the text of Sec. 5. The deck shares its visual
system with the flow-module talk in `../../FlowAllocationModuleForHydraulic/talk/`.

The talk to memorize is `script.md`. The speaker notes in the `.qmd` are cue cards
generated from it: open the HTML and press `S` to see them. When you change the script,
update the matching cue card by hand.

## Assets

- `fig2-tau-vs-L.svg` is the paper's Fig. 2, compiled from the paper's own pgfplots code
  in `fig2-tau-vs-L.tex`. The data, line styles, markers and legend are unchanged; only
  the size, the font (Helvetica) and the line weight are scaled for a slide. To rebuild it:
  `pdflatex fig2-tau-vs-L.tex && pdftocairo -svg fig2-tau-vs-L.pdf fig2-tau-vs-L.svg`.
- `qr-platform.svg` encodes `https://app.cascade-platform.org/`. It was generated with
  `segno` (`segno.make(url, error='m')`, scale 10, border 2), and a decode of the
  rendered PDF page returned that URL.

## Render to PDF

```bash
cd docs/paper/VitalityForInterdependentNetworks/talk
quarto render presentation.qmd            # writes presentation.html, self-contained

google-chrome --headless=new --no-pdf-header-footer \
  --run-all-compositor-stages-before-draw --virtual-time-budget=20000 \
  --print-to-pdf=presentation.pdf "file://$PWD/presentation.html?print-pdf"
pdfinfo presentation.pdf | grep Pages     # must say 10
```

If the page count is not 10, run the print command again. Headless Chrome
occasionally prints before the layout settles. For a speaker copy with the cue cards,
use `?print-pdf&showNotes=separate-page`.

## Before final export: verify

1. **Format.** The deck assumes this paper also has a 12-minute slot at CNA 2026.
2. **Slide 8, "3 / 5 of the top-10% nodes replaced"** is the paper's own reading of
   the 0.402 overlap ("moves three fifths of the six nodes selected for protection").
3. **Slide 9 ring** illustrates the paper's own example: "A loop of interconnected
   junctions behind a failed reservoir stays operational here, which is wrong."

## PDF-first submission checklist

- [ ] Title, authors and affiliation match the camera-ready paper.
- [ ] Every slide reads as a static page: no fragments, transitions, video or web fonts.
- [ ] Formulas (slides 4 and 5), the Ω chart (slide 7) and Fig. 2 (slide 8) render in the PDF.
- [ ] The QR code on slide 10 scans from the projected PDF.
- [ ] The PDF has 10 pages at 16:9.
- [ ] Filename follows `[SUBMISSION_ID][PRESENTER_SURNAME][PRESENTER_NAME].pdf`.
- [ ] Tested in full-screen presentation mode on the laptop you will present from.
- [ ] `.qmd` source, exported PDF and a USB/cloud backup kept together.

## Speaker run sheet

`script.md` is about 1,160 words, roughly 97 words a minute over 12:00: slow
delivery with the marked pauses. If rehearsal runs short, slow down before adding text.
Dropping every *(skip if late)* sentence saves about 40 words.

| # | Slide | Time | Cumulative | The one message to land |
|---|---|---|---|---|
| 1 | Title | 0:40 | 0:40 | Two pictures of one hospital: same shape, different fate. |
| 2 | The two pictures | 1:05 | 1:45 | Links with the same service are alternatives; links with different services are jointly required. |
| 3 | Two readings | 1:05 | 2:50 | The literature applies one reading to every link; the service decides which one fits. |
| 4 | The model | 1:20 | 4:10 | OR within a service, AND across services. |
| 5 | Vitality | 1:15 | 5:25 | Requirements stay when a node goes; removing a node equals switching it off. |
| 6 | The experiment | 1:05 | 6:30 | One fixed graph; only the labels change. |
| 7 | Fivefold | 1:10 | 7:40 | The labels alone move the Mean Operativity Loss fivefold. |
| 8 | Nodes worth protecting | 1:35 | 9:15 | Relabelling replaces three in five of the top-10% nodes. |
| 9 | Applies, and the limitation | 1:45 | 11:00 | Applies wherever services and failure are defined; a ring can hold itself up. |
| 10 | Close | 1:00 | 12:00 | Describe what each node provides. |

Checkpoints: be on slide 4 by 2:50 and on slide 8 by 7:40.
