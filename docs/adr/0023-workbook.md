# ADR-0023 — The Workbook: a second, lossless form of the project file; edits come back as a checked change set

**Status:** proposed (2026-10-12). Builds on ADR-0019 (Temporal Simulation), ADR-0021 (Attribute
Operations) and ADR-0022 (LLM Design), each revised the same day for Parameters, Series and
spreadsheet provenance.

## Context

People who will feed CASCADE with an organisation's data work in spreadsheets: HR exports,
asset lists, monthly ledgers. The Coop Noncello engagement showed the cost of the gap: every
monthly input reached the model through a script that wrote operations, and every result left
it as a CSV. Two answers were weighed. Embedding a spreadsheet component in the app would give
familiar editing, but its formulas would become a second place where the model's logic runs,
which CLAUDE.md §7 forbids for propagation and ADR-0019 §4 declined for Metrics. The answer
taken here makes the spreadsheet a **form of the project file**, as the Text tab and LLM Design
are forms of a definition: the same schema, read and written by the same checks.

## Decision

### 1. A Workbook is a complete project file

File → Open accepts `.json`, `.xlsx` and `.ods`; Save writes any of them. The Workbook holds the
whole bundle `{project, config}`, and the conversion is lossless both ways:
`parse(decode(encode(B)))` deep-equals `B` for every bundle `B` the schemas accept (arrays in
order; record keys in any order). **A Workbook is written only after that check passes**;
otherwise the save is refused and names the JSON pointer that would be lost.

### 2. Layout (`cascade.workbook/v1`)

- **One sheet per kind of record, one row per record, row order = list order.** One header row
  of machine keys, explained by a generated `README` sheet. Sheets: `Project` (key and value,
  with the format), `Canvases`, `Nodes`, `Edges`, `Categories`, `Functionality scale`,
  `Level scale`, `Events`, `Event operations`, `Graph types`, `Node templates`, `Simulations`,
  `Steps` (one row per Phase), `Parameters`, `Profile`, `Metrics`, `Series` (the index) and one
  `S·<name>` sheet per Series.
- **Identity is the id; every reference is an id.** A read-only `~label` column sits beside a
  reference (`source`, `~source_label`) and is ignored on read.
- **Maps keyed by Category, Event or property become columns**: `supply:<category>` (a rate) or
  `supply:<category>.<field>` (a Stock), `throughput:<category>`, `dep:<category>.<field>`,
  `vuln:<event>`, `prop:<key>`; on an edge, `capacity` or `capacity.<field>`. A key holding `.`,
  `:` or a quote is written as a JSON string.
- **Time runs across**: the Profile has one row per operation and one column per period label,
  as the Timeline grid does; an `S·` sheet has one row per Element and one column per period.
- **An empty cell is an absent value**, never 0. Lists are `; `-joined, paths `.`-joined, Rules
  one per line; anything that would read back differently is written as `json:` followed by
  JSON. Small opaque parts (a Canvas's map anchor, heuristic parameters, responsibility shares)
  are JSON cells.
- **`_cascade`**, a hidden sheet (`key | part | text`), holds what has no table: `update_history`,
  the Scorecard, an imported Canvas's EPANET text, any cell over 32,000 characters (split into
  parts, under the 32,767-character limit), a fingerprint of the project it was written from,
  and the **residual**: every remaining difference between what the visible sheets read back as
  and the bundle (an empty list, the exact order of a Canvas's members), each with a hash of what
  the sheets gave when written. On read, a residual entry is applied only while that hash still
  matches, so an edit a person made on a visible sheet always wins.

### 3. What a spreadsheet does to a value is undone in one place

`lib/workbook/cells.ts` reads every cell. Period labels and ids are written as text; a label a
spreadsheet turned into a date is matched back to the known labels through its displayed text;
an id that lost its leading zeros is an error naming the cell; `1,5` reads as 1.5 with a
warning and `1.234,5` is an error; a formula's stored result is used and a formula without one
is an error; `TRUE`, `false`, 1 and 0 typed in a yes/no column are accepted with a warning;
`#N/A` is an error; an unknown column is ignored with a near-match suggestion. **Every problem
names its cell** (`Nodes!F7`).

### 4. Two actions: Open, and Import changes

- **Open** replaces the project, exactly like opening a `.json`. Provenance is kept as written.
- **Import changes from a Workbook** compares the file with the open project and turns the
  difference into a change set, previewed and applied through LLM Design's gate (ADR-0022). One
  change per record (a node, an edge, an Event with its operations, a Category, a Temporal
  Simulation with its Steps, Parameters, profile and Metrics, a Series), plus one per setting and
  per list order; a node's or edge's Canvas membership belongs to its own change. Each change
  can be left out; the result is built from each record's new or old version and checked as a
  whole (the schemas, `validateBundle`, unique ids, a Temporal Simulation's warnings).
- **A missing sheet changes nothing; a missing row is a deletion**, listed in the preview and
  open to leaving out. A reference to a deleted record is refused at its cell; nothing is
  repaired, because the sheet is what the person wrote. Deleting more than half the Elements
  needs an extra tick, and a file written from another project says so before the preview.
- **A new row creates a record.** Where its cells are empty: an id from its label, the top
  Functionality level, a place on the grid below its Canvas's nodes, and the only Canvas when
  there is one.
- **Provenance** (ADR-0022, revised): a node, edge or Event added by an import carries
  `origin: "spreadsheet"` with `source {file, sheet, row}`, unconfirmed until a person confirms
  it; a changed record keeps its mark. A file neither confirms nor removes a mark.
- **Undo** is LLM Design's: the project is kept as a Local version before applying, and the
  window offers **Undo this import**. The undo history is not written, so Ctrl+Z does not undo
  an import; the window says so.
- `update_history`, the Scorecard and the timestamps are never imported as changes.

### 5. Library

SheetJS Community Edition (Apache-2.0) reads and writes both `.xlsx` and `.ods`, and is the only
module that touches the file format (`lib/workbook/sheetjs-adapter.ts`, loaded on demand). The
codec itself (`lib/workbook/`) works on a library-free model of sheets and cells, so its tests
need no file. The current release is installed from the vendor's server; the copy on the npm
registry is stale and carries known vulnerabilities. Dependabot does not watch that source, so
its updates are checked by hand (deployment.md).

## Considered

- *An embedded spreadsheet component* (Univer, Fortune-sheet, jspreadsheet CE): rejected, see
  Context; Handsontable is not open source for commercial use (CLAUDE.md §1).
- *Formulas kept per cell and written back*: the platform would hold logic it does not run.
  Formulas stay in the person's spreadsheet; the Workbook carries their results, and the README
  sheet says so.
- *The whole bundle as JSON in cells*: lossless and unreadable.
- *A zip of CSV files*: no types, so every number and date would be guessed.
- *Importing through LLM Design's plain changes (v2)*: a Workbook is a state, and turning a state
  into instructions loses meaning (a merge cannot set a property to null; a v2 deletion cascades
  where the sheet still lists the edge). Per-record composition keeps the one check and the one
  preview.
- *ExcelJS*: MIT and on npm, but no `.ods`.
- *Two header rows* (a readable name over the key): breaks sorting and filtering in a spreadsheet.

## Consequences

- `toProject` keeps `meta.created_at` (it used to stamp it on every save), so a project's creation
  time survives any round trip.
- The check behind LLM Design returns structured issues (`message`, a JSON pointer, the Element,
  a code) alongside its messages, and `validateBundle` issues carry a pointer, so an import can
  name the cell.
- Tests: generated bundles (fast-check) with hostile strings, keys and numbers; every public
  sample in both formats; encoding twice gives identical cells; the residual holds only empty
  containers, empty labels and orders; a Workbook edited in Excel and one edited in LibreOffice
  are committed as fixtures.
- History, autosave and recovery stay JSON.
- Deferred (requirements §16): an undo history entry for a whole-project edit (shared with LLM
  Design), saved Parameter Sweeps, Series resampled across calendar units.
