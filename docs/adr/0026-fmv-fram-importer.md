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
- a function → a node; each distinct (function, output text) → an output node
  whose Category is named after the text, so producers of the same text are
  alternatives (`best_of`); a consumer needs all its distinct inputs;
- the semantics is a request choice, default **v2**: one level of damping per
  coupling and second-worst resonance, written as one rule per function with
  level offsets (ADR-0025), on a 4-level scale. `reachability` (every deviation
  reaches everything downstream) and `fmi` (the FMI's binary reading, with the
  file's All/Any/None profiles) are the paper's baseline and verification
  semantics;
- labels are the function names and output texts (made distinct: the app
  flags shared labels); Category names are slugs of the texts, so rules stay
  readable; node ids stay machine keys;
- functions sit where the modeller drew them in FMV; a model without
  positions is laid out in columns by upstream depth.

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
  importer ships what was evaluated. A file with profiles gets a warning naming
  the `fmi` semantics.

## Consequences

- `defusedxml` (PSF-2.0) becomes an explicit backend dependency.
- Large models produce long resonance rules (a function with m inputs carries
  m(m − 1)/2 pairwise terms); they parse and evaluate, and the FMV library,
  Grabbe 2022 (285 functions, 798 couplings) and two 50–85-function industrial
  models import and open without schema or reference problems.
