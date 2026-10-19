# ADR-0023 — The Workbook: a second, lossless form of the project file; edits come back as a checked change set

**Status:** accepted (2026-10-12); built (Open, Save and Import changes). Builds on ADR-0019 (Temporal Simulation), ADR-0021 (Attribute
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
  of machine keys, explained by a generated `README` sheet. Sheets: `Project` (key and
  value), `Canvases`, `Nodes`, `Edges`, `Categories`, `Functionality scale`,
  `Level scale`, `Events`, `Event operations`, `Graph types`, `Node templates`, `Simulations`,
  `Steps` (one row per Phase), `Parameters`, `Profile`, `Metrics`, `Series` (the index) and one
  `S·<name>` sheet per Series.
- **Identity is the id; every reference is an id.** A read-only `~label` column sits beside a
  reference (`source`, `~source_label`) and is ignored on read.
- **A column is the field path of what it holds**, dotted, as an Attribute Operation writes it:
  `label`, `supply_capacity.water.rate` (a Stock's field), `supply_capacity.water` (a plain rate),
  `category_dependency_profiles.water.demand`, `vulnerability_levels.<event>`,
  `properties.workers`, `capacity.level` on an edge. So a map keyed by Category, Event or property
  is a column per key, and a field added to the schema later becomes a column with no codec
  change. A segment holding `.`, `"` or `:` is written as a JSON string (`properties."a.b"`).
  A column ending in `[]` holds a list of texts (`canvases[]`, `node_categories[]`, `path[]`);
  a column starting with `~` is a label for reading. A field with more than 200 columns across
  the records (a properties map that large) is one JSON column. *Revised at build (2026-10-16):*
  the first draft named columns by short prefixes (`supply:`, `dep:`, `prop:`); the field path is
  one rule for every field and reads exactly as the operations that write it.
- **Time runs across**: the Profile has one row per operation and one column per period label,
  as the Timeline grid does; an `S·` sheet has one row per Element and one column per period.
- **An empty cell is an absent value**, never 0. Lists are `; `-joined, paths `.`-joined, Rules
  one per line; anything that would read back differently is written as `json:` followed by
  JSON. Small opaque parts (a Canvas's map anchor, heuristic parameters, responsibility shares)
  are JSON cells.
- **`_cascade`**, a hidden sheet (`key | part | text`), holds what has no table: the format (`cascade.workbook/v1`), `update_history`,
  the Scorecard, an imported Canvas's EPANET text, any cell over 32,000 characters (split into
  parts, under the 32,767-character limit), and the **residual**: every remaining difference between what the visible sheets read back as
  and the bundle (an empty list, the exact order of a Canvas's members), each with a hash of what
  the sheets gave when written. On read, a residual entry is applied only while that hash still
  matches, so an edit a person made on a visible sheet always wins.

### 3. What a spreadsheet does to a value is undone in one place

Cells describe themselves: a number cell is a number, a true/false cell a boolean, a text cell a
string, and what a plain cell cannot hold (null, an empty list, text that starts with `json:`,
holds control characters or `_xHHHH_`, which spreadsheet files decode) is `json:` and the JSON.
After reading, the schemas check the result and **repair what a spreadsheet typically does to a
value**, with a warning on its cell: a number where text belongs is read as its displayed text
(an id that lost its leading zeros is then named, with "type it as text"), a date in a text
column as its displayed text, `1,5` or `"12"` where a number belongs as the number, `TRUE` or
`false` typed as text where a yes/no belongs as the boolean. A formula's stored result is used;
a formula without one, and an error value (`#N/A`), are refused. **Every problem names its
cell** (`Nodes!F7 — …`).

Measured with LibreOffice 24.2 re-saving what CASCADE wrote (*2026-10-16*): LibreOffice saves
true/false as 1/0, so a 0 or 1 where the schema wants a boolean is read back with a note only;
in a field that may hold a number, true/false or text (an operation's or profile's `value`,
`properties`), true/false is therefore written in its `json:` form. LibreOffice also rounds a
number to 15 significant digits when it saves `.xlsx` (a canvas position's last digits), so
Import changes reads a number equal to the project's to 15 significant digits (a relative
difference below 1e-14) as no change. XLOOKUP needs LibreOffice 24.8 or
later; VLOOKUP and INDEX/MATCH work everywhere.

### 4. Two actions: Open, and Import changes

- **Open** replaces the project, exactly like opening a `.json`. Provenance is kept as written.
- **Import changes from a Workbook** compares the file with the open project and turns the
  difference into a change set, previewed and applied through LLM Design's gate (ADR-0022). One
  change per record (a node, an edge, a Canvas, an Event with its operations, a Category, a Graph
  type, a Node template, a Temporal Simulation with its Steps, Parameters, profile and Metrics, a
  Series, a custom sheet), plus the Functionality and Level scales, the project's and the
  configuration's other settings, and the Canvas order; a node's or edge's Canvas membership
  belongs to its own change. Each change can be left out; the result is built from each record's
  new or old version and checked as a whole (the schemas, `validateBundle`, unique ids), each
  problem at its cell. Apply reads the file again against the project as it is then.
- **A missing sheet changes nothing; a missing row is a deletion**, listed in the preview and
  open to leaving out. A reference to a deleted record is refused at its cell; nothing is
  repaired, because the sheet is what the person wrote. Deleting more than half the Elements
  needs an extra tick. A cell the person did not edit gives back what the project holds now,
  even when the file was written from an older version of it: the project's own residual is read
  before the file's.
- **A new row creates a record.** Where its cells are empty: an id from its label, the top
  Functionality level, a place on the grid below its Canvas's nodes, and the only Canvas when
  there is one.
- **Provenance** (ADR-0022, revised): a node, edge or Event added by an import carries
  `origin: "spreadsheet"` with `source {file, sheet, row}`, unconfirmed until a person confirms
  it; a changed record keeps its mark. A file neither confirms nor removes a mark.
- **Undo** is LLM Design's: the project is kept as a Local version before applying, and the
  window offers **Undo this import**. The import is also one undo step, so Ctrl+Z undoes it
  (ADR-0017 §1a).
- `update_history`, the Scorecard and the timestamps are never imported as changes.

### 4a. Custom sheets: a person's own analysis, kept and able to write the model

A person adds sheets of their own: an analysis of an organisation's data, a forecast, a
policy's numbers worked out with formulas. They are part of the project.

- **Kept in the project file**: `Project.sheets: [{name, writes?, computed_at?, rows}]`, `rows`
  holding each cell's value (number, text, true/false, or empty) and its formula when it has one,
  as the spreadsheet stored them; styles are left out. Saved as `.json` and opened again as a
  Workbook, a custom sheet has its formulas back.
- **The spreadsheet app computes; CASCADE never evaluates a formula.** It keeps each formula's
  last value, so every function of the person's spreadsheet works and no second engine holds
  logic. A formula is written without a stored value, so the app computes it on opening (a
  stored value is never recomputed by LibreOffice) and formulas that look values up in the
  model's sheets (by id, e.g. with XLOOKUP) see the model as CASCADE wrote it; the project keeps
  the last value until then. A viewer of custom sheets inside CASCADE is deferred.
- **What a custom sheet writes is declared**, in the `Sheets` index (`name | writes`): the name
  of a model sheet whose rows have a key (`Project` by `key`, `Canvases`, `Nodes`, `Edges`,
  `Events`, `Simulations` by `id`, `Categories`, `Graph types`, `Node templates` by `name`,
  `Functionality scale` by `level`, `Level scale` by `label`, `Parameters` and `Metrics` by
  `simulation` and `name`, a Series `S·<name>` by `element`), so the Model Configuration too.
  `Event operations`, `Steps` and `Profile` have no key a row is found by and are not written.
  It then uses that sheet's key and column keys, any subset of them. A sheet with no `writes` is
  analysis only, kept and never applied.
- **Its values reach the model through Import changes**, in the same preview as edits to the
  model's sheets, record by record and open to leaving out; Open keeps the file's model sheets as
  they are. A custom sheet writes the cells it has, over the model sheet's: a missing row or
  column changes nothing (only a model sheet's missing row is a deletion), and a key the model
  sheet lacks changes nothing, with a warning. A field two custom sheets set to different values
  is refused at both cells.
- **A formula without a stored value**, in any sheet, is refused at its cell: the file was not
  saved by a spreadsheet app, which computes it.

### 5. Library

SheetJS Community Edition (Apache-2.0) reads and writes both `.xlsx` and `.ods`, and is the only
module that touches the file format (`lib/workbook/sheetjs-adapter.ts`, loaded on demand). The
codec itself (`lib/workbook/`) works on a library-free model of sheets and cells, so its tests
need no file. The current release is installed from the vendor's server; the copy on the npm
registry is stale and carries known vulnerabilities. Dependabot does not watch that source, so
CI's `audit:sheetjs` fails when the vendor publishes a newer release.

**What SheetJS does, measured** (0.20.3, `lib/workbook/sheetjs-capabilities.test.ts`, and
LibreOffice 24 headless): text, true/false, doubles, comments, 32,000-character cells and
same-sheet formulas with their stored values survive both formats; `_xHHHH_` in text is
decoded, so the codec escapes it; xlsx refuses a cell over 32,767 characters. Three gaps, each
handled by the codec:
- **A hidden sheet stays hidden in xlsx and not in ods**: the ods `content.xml` is marked
  directly. Sheet protection is not written in either, so `_cascade` relies on its hash check.
- **A stored formula value is never recalculated on opening** (LibreOffice kept a stale value
  even with `fullCalcOnLoad`), while a formula written without a value is computed. Custom
  sheets are therefore written with formulas and no stored values; the app computes them on
  opening, and a file never opened by one is refused at those cells on import.
- **ods formulas that reference another sheet are converted wrongly** in both directions, so for
  `.ods` the codec reads and writes `table:formula` (OpenFormula) itself.

## Considered

- *An embedded spreadsheet component* (Univer, Fortune-sheet, jspreadsheet CE): rejected, see
  Context; Handsontable is not open source for commercial use (CLAUDE.md §1).
- *Formulas in the model's own sheets kept*: a model sheet is what CASCADE writes from the
  project, so a formula typed there is read as its value and the next export writes the value.
  Formulas belong in custom sheets (§4a), which keep them.
- *A formula engine inside CASCADE* (HyperFormula, GPLv3): live recomputation without leaving the
  app, at the cost of a second place logic runs, a subset of the spreadsheet's functions and about
  1 MB; a custom sheet recomputed every period of a run would be a second step operator.
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
- The check behind LLM Design (`checkBundle`, split from `checkChange`) returns structured issues
  (`message` and the path in the bundle, from the schema's path or the Element a `validateBundle`
  issue names) alongside its messages, so an import names the cell.
- Tests: generated bundles (fast-check) with hostile strings, keys and numbers; every public
  sample in both formats, and through LibreOffice re-saving them; Import changes on edited
  models (an edited cell, a missing row or sheet, a new row, every subset left out, custom-sheet
  writes and their conflicts, a file older than the project, LibreOffice's rounding).
- History, autosave and recovery stay JSON.
- `Project.sheets` is client data: the Propagation request leaves it out, and Pydantic declares it
  so Server Sync keeps it. Its size counts toward the project file, so a very large analysis
  belongs in its own spreadsheet with only its results in a custom sheet.
- Deferred (requirements §16): saved Parameter Sweeps, Series resampled across calendar units, a viewer of custom
  sheets inside CASCADE, the empty-Workbook template.
