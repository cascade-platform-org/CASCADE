# ADR-0026 — FMV (.xfmv) importer for FRAM models

**Status:** accepted (2026-10-29)

## Context

FRAM (Functional Resonance Analysis Method) models are drawn in the FRAM
Model Visualiser (FMV) and saved as `.xfmv` XML. The FRAM paper
(`experiments/fram/`, its TRANSLATION.md) defines and evaluates a conversion of
FRAM models into CASCADE models ("v2"), with a harness that had its own reader
and translator. Two copies of that conversion — one evaluated, one shipped —
would drift; the owner wants the FRAM community to be able to open their own
models in CASCADE, which needs the shipped one.

## Decision

**One implementation, in the product:** `CASCADE-backend/core/importers/xfmv/`
(`model.py`, `parse.py`, `map.py`), served at `POST /api/import/xfmv`. The
paper's harness imports `translate` and its configurations from there, so the
numbers the paper reports are computed by the code the importer ships. Moving
the code changed no result (every harness CSV byte-identical).

**Parsing.** Both FMV layouts: drawn couplings (an `<Aspects>` list), and
aspects stored as texts, coupled — as FMV itself does — wherever an Output's
text equals another function's aspect text. Files written in cp1252 under an
XML declaration with no encoding are decoded as cp1252 (the client does the
same before sending). The XML is parsed with `defusedxml`: the file is user input.

**Mapping** (`map.py` docstring holds the details):
- a function → a node. A function with one distinct output text carries a
  Category named after that text, so producers of the same text are
  alternatives (`best_of`) and consumers wire to it directly. Only a function
  with several output texts (or an output fed back to itself) gets an output
  node per text, because a parent passes all its categories to every child
  (amended 2026-11-02; before, every output had a node, and every paper result
  is byte-identical without them). A consumer needs all its distinct inputs;
- one conversion, **v2**: one level of damping per coupling and second-worst
  resonance, written as one rule per function with level offsets (ADR-0025),
  on a 4-level scale. (Amended 2026-11-02: the request used to choose between
  v2, `reachability` and `fmi`. The latter two are the paper's baseline and
  verification readings; they stay as configurations in `map.py` for the
  harness and are no longer offered to users.)
- labels are the function names and output texts (made distinct: the app
  flags shared labels); Category names are slugs of the texts, so rules stay
  readable; node ids stay machine keys;
- functions sit where the modeller drew them in FMV; a model without
  positions is laid out in columns by upstream depth.
- **Canvases from the modeller's groups** (2026-10-29). An FMV Group is a
  parent function whose children FMV collapses into it; groups nest. Each
  function goes on the Canvas of its outermost group, with one Canvas for
  ungrouped functions and one for background functions; a model with neither
  keeps one Canvas. Output nodes sit with their producer; an edge between two
  Canvases is listed on both, as the Inter-Canvas Edge tool does. Layout is per
  Canvas, columns ordered by the predecessors' rows. Display only: global
  propagation is unchanged (every FRAM paper result byte-identical). With the
  Global view's collapsible Canvases this carries FMV's own collapsing into
  CASCADE.

**What the file cannot carry**, and the user adds as ordinary Events and Rules
after importing: the scenario (which functions deviate, and how much), and any
rule a FRAM analysis states only in prose.

**Replace only.** Each semantics brings its own Functionality scale, so merging
into an existing project would mix scales.

## Alternatives considered

- **A client-side converter.** Rejected: the conversion is the evaluated
  artefact, and the paper's harness is Python; one implementation means
  server-side.
- **Reading FMI profiles under v2.** Not done: the paper's v2 does not, and the
  importer ships what was evaluated. A file with profiles gets a warning that
  they are ignored.

## Consequences

- `defusedxml` (PSF-2.0) becomes an explicit backend dependency.
- Large models produce long resonance rules (a function with m inputs carries
  m(m − 1)/2 pairwise terms); they parse and evaluate, and the FMV library,
  Grabbe 2022 (285 functions, 798 couplings) and two 50–85-function industrial
  models import and open without schema or reference problems.
