# CNA 2026 talk: render, export, run sheet

`presentation.qmd` is the 11-slide, 12-minute talk for the flow-module paper
(`../FlowAllocationModuleForHydraulic.tex`). Every number on the slides comes from
the paper's Table 1 or from Supp. S2, S4, S8 and S9. The talk to memorize is
`script.md`. The speaker notes in the `.qmd` are cue cards generated from it (time,
memory hook, opening line, anchor lines): open the HTML and press `S` to see them.
When you change the script, update the matching cue card by hand.

`qr-platform.svg` encodes `https://app.cascade-platform.org/`. It was generated with
`segno` (`segno.make(url, error='m')`, scale 10, border 2), and a decode of the
rendered PDF page returned that URL. The title slide uses
`logo_cna2026_textblue.png`.

## Render to PDF

Quarto 1.10.19 was used to render the deck, and Google Chrome to print the PDF.

```bash
cd docs/paper/FlowAllocationModuleForHydraulic/talk
quarto render presentation.qmd            # writes presentation.html, self-contained

google-chrome --headless=new --no-pdf-header-footer \
  --run-all-compositor-stages-before-draw --virtual-time-budget=20000 \
  --print-to-pdf=presentation.pdf "file://$PWD/presentation.html?print-pdf"
pdfinfo presentation.pdf | grep Pages     # must say 11
```

Without `--run-all-compositor-stages-before-draw`, headless Chrome sometimes prints a
single page. If the page count is not 11, run the print command again.

To export by hand instead: open `presentation.html`, press `E` (print view), then
Ctrl+P, choose Destination "Save as PDF", Layout landscape, Margins none, and tick
"Background graphics".

To print a speaker copy with the notes, use `?print-pdf&showNotes=separate-page`.

## Before final export: verify

1. **Slide 8 framing departs from the plan.** The plan headlined "mean FMS 0.92".
   Table 1 shows reachability also at 0.92 and the null model at 0.82, so the deck
   leaves the Functionality Match Score out and makes recall the evidence. Keep those
   three numbers ready for questions: an expert reading Table 1 may ask.
2. **Slide 9 script, "lowest for source and tank failures, the families that
   force the most rerouting onto backup paths."** This follows main paper §6 and the
   Table 1 precision values (0.51, 0.20). The supplement disagrees on two points:
   S4 calls *targeted* "the capacity-loaded family that forces the most rerouting",
   and S7 attributes the tank family's 0.20 to C-Town orientation (57 of 72
   situations). Settle the wording in the paper, then match the slide to it.
3. **Status names.** The slides name the three functionality statuses Operational,
   Warning and Critical. The paper calls the middle level "degraded". Slide 9 shows the
   three panels of the paper's Net3 figure (`fig_net3_panel_{a,b,c}.png`, cropped from
   `../fig_net3_snapshot_targeted41.png`) under a slide legend that uses "Warning".
4. **Timing.** The per-slide targets in the original plan add up to 12:45. They
   are rebalanced below to exactly 12:00.

## PDF-first submission checklist

- [ ] Title, authors (Cristian Curaba and Stefano Grimaz) and affiliation
      (University of Udine, Udine, Italy) match the camera-ready paper.
- [ ] Every slide reads correctly as a static page: the deck uses no fragments,
      transitions, video or web fonts.
- [ ] The formula (slide 5), diagrams (slides 3–6) and the chart (slide 8)
      render in the PDF. They are HTML and inline SVG, so no math engine is involved.
- [ ] The PDF has 11 pages at 16:9.
- [ ] Filename follows `[SUBMISSION_ID][PRESENTER_SURNAME][PRESENTER_NAME].pdf`.
- [ ] Tested in full-screen presentation mode on the laptop you will present from.
- [ ] `.qmd` source, exported PDF and a USB/cloud backup kept together.
- [ ] Repository and platform URLs on slide 11 still resolve. Both returned
      HTTP 200 on 2026-10-18.
- [ ] The QR code on slide 11 scans from the projected PDF.

## Speaker run sheet

`script.md` is about 1,330 words, roughly 115 words a minute over 12:00, which leaves
room for the marked pauses. Dropping every *(skip if late)* sentence saves about 45 words.

| # | Slide | Time | Cumulative | The one message to land |
|---|---|---|---|---|
| 1 | Title | 0:30 | 0:30 | Generality without quantities, or fidelity without composability: this talk keeps both where it matters. |
| 2 | The dilemma | 1:05 | 1:35 | A district can be connected to a reservoir and still receive no water. |
| 3 | Whether / how much | 1:05 | 2:40 | Reachability asks only *whether*; water asks *how much*. |
| 4 | Architecture | 1:25 | 4:05 | Attributes choose the algorithm: logic or quantities, in one mechanism on the functionality status. |
| 5 | Convergence | 1:00 | 5:05 | A status can only stay or get worse, so the iteration terminates. |
| 6 | Flow module | 1:10 | 6:15 | Max-min fair allocation; the served ratio becomes the functionality status. |
| 7 | Validation design | 1:05 | 7:20 | Same network and situation, WNTR as ground truth, reachability as baseline, 939 situations. |
| 8 | Main results | 1:30 | 8:50 | Targeted: 46% missed vs 10%. Source: 46% vs 8%. |
| 9 | Over-warning | 1:10 | 10:00 | Recall 0.90–0.98, precision 0.73: fit for screening. |
| 10 | Scope | 1:10 | 11:10 | Three things established, three limitations, stated before anyone asks. |
| 11 | Takeaway | 0:50 | 12:00 | Generality of topological abstractions, plus quantity exactly where delivery needs it. Code and data are open. |

Checkpoints: be on slide 5 by 4:05 and on slide 9 by 8:50. If you are behind at
either point, take the cut sentences on the slides that follow.
