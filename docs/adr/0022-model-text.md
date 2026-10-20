# ADR-0022 — LLM Design: change what a project saves through a checked change set

**Status:** accepted (2026-10-08). Built: `lib/model-text.ts` (parse, check, preview; pure),
`lib/model-text-apply.ts` (apply, Undo this edit), the Topbar's **LLM Design** button (beside Help) and window
(`components/model-text/model-text-window.tsx`).

## Context

The Temporal Simulation's Text tab (ADR-0019 §7) showed that a JSON round-trip with an LLM is
a fast way to author: bulk edits, a whole Timeline at once. People asked for the same reach
over everything a project saves: Elements, Canvases, Events, Categories, the scale, the
Scorecard, the Temporal Simulations. Two things make the obvious answer, the whole bundle in
a text box, wrong: a real model is megabytes (the georeferenced Udine sample is 2.2 MB), which
neither a text box nor an LLM context holds; and replacing the bundle hides what changed,
which is exactly what a person must see before accepting an LLM's edit. Text from an LLM or a
paste is also untrusted input.

## Decision

**The text is a change set**, never the bundle:

```json
{ "format": "cascade.model-change/v1",
  "patch":    [ { "op": "add" | "replace" | "remove", "path": "/config/events/-", "value": … } ],
  "elements": [ AttributeOperation … ] }
```

- `patch` is JSON Patch (RFC 6902, its three editing operations) at a JSON Pointer into
  `{ project, config }`: any part the project file or the Model Configuration holds. **One
  exception: `project.update_history` is read-only** — it is the app's record of what
  happened, and undo and the Scenario Baseline read it (ADR-0016, ADR-0017). The whole
  `/project` cannot be replaced either, since that would include it.
- `elements` are Attribute Operations (ADR-0021), applied after the patch: the bulk form, by
  id or Element Filter.
- **The check runs on a copy and stops at the first failing stage:** size (2 M characters) and
  nesting (48 levels) limits; `JSON.parse` only, nothing is executed; no `__proto__`,
  `constructor` or `prototype` key anywhere; the change set's strict schema; the dry run
  (a path must exist, an operation must apply, nothing is clamped); the full Project and
  Model Configuration schemas on the result; and the reference checks a loaded file gets
  (`validateBundle`), plus unique Event, Canvas and Temporal Simulation ids and registry keys
  equal to their record's id; a vulnerability to an Event that does not exist, which a loaded
  file only warns about, is refused when the edit introduces it. A removal that leaves a reference dangling is refused, never
  repaired: the text says what to remove, and the check says what it forgot.
- **A preview lists every change** (Elements and Canvases through `diffGraph`, the rest leaf by
  leaf, lists of records with ids matched by id), as before → after, with totals. **Nothing is
  written until the person confirms it.** Apply checks again against the model as it is then.
- **Undo this edit.** The configuration has no undo stack, and the edit is one act across both
  files, so before writing, the whole current bundle is kept as a version ("Before LLM Design
  edit", File → Local → Recent saves) and the window offers Undo this edit, which puts it
  back. The write goes through the loaders a project file uses; the live `update_history` is
  kept.
- **A shown Temporal Simulation run refuses it**, like every model edit (ADR-0019 §1).
- **The change set is client-side only.** It is never saved or sent to the backend, so it has no
  Pydantic model; what it produces is validated by the mirrored Project and Configuration
  schemas.
- The Temporal Simulation's Text tab keeps its one document; Events and the rest of the model
  are edited through LLM Design, so there is one text route per thing.

**The window is a tree of sections** (`lib/model-text-sections.ts`), each opening on its current
JSON: Project (info, Canvases, Nodes and Edges grouped by Canvas, Scorecard, Temporal
Simulations), Configuration (Events, Categories, Functionality scale, the rest), and Bulk
operations, the change set above. Any level is editable: a group is a bulk edit of everything
under it, a leaf one item. An edited section becomes patch operations (a registry key by key, the
rest replaced whole) and goes through the same check and preview. In the Nodes and Edges
sections a deletion takes its references along (a node's edges, its place on every Canvas) and an
Element added under a Canvas is placed on it, all listed in the preview; the project section
shows everything but `update_history` and refuses a removed key.

**Bulk operations are plain changes** (*revised 2026-10-08*, `lib/model-text-v2.ts`, format
`cascade.model-change/v2`). Agents writing the first format kept tripping on the storage layout:
a supply that is a number on one Element and a Stock on another, list positions, a filter
whose matches differ. A plain change says what to do to which thing, and the app works out where it
is stored:

- a verb on a field name (`set`, `scale`, `increase`, `cap`, `floor` on `supply`, `demand`,
  `importance`, `vulnerability`, …; or a raw path), with `id` or a `where` filter; a supply or
  capacity that is a Stock is changed through its `rate`, per Element;
- `add`, `update` (JSON Merge Patch, RFC 7386: `null` removes a field) and `delete` of a node,
  edge, Event, Category, Canvas or Temporal Simulation by id; `connect` / `disconnect` for edges;
  a deletion takes what refers to it (a node's edges and Canvas places, an Event's
  vulnerability levels);
- a change that does not fit a match refuses the set, naming the Element; `skip_unfit` leaves such
  Elements out, and the preview lists them as skipped.

Plain changes compile, in order on a copy, into the patch the check already reads: one gate.
The preview groups its lines under the change that made them, with the LLM's `notes` and each
change's `why`; the box opens on a worked example on the model's own ids. The LLM context adds
a **field census** (per Node Type: each field's shapes and ranges; the values a filter can use),
and a refused check offers **Copy the problems for the LLM**: the errors, the text and the
stored JSON of every Element they name. The first format stays accepted.
`lib/llm-eval.test.ts` (run on demand) states each evaluation task's expected outcome and
compares the two formats with fresh agents. On six bulk tasks (halve mixed-shape supplies, raise
demand, delete by type, add an Event with vulnerabilities, add and connect a generator, rewire
and rename), the first format did what was asked on 3 first try, plain changes on 6; every
refusal came from list positions (a Canvas addressed by id). Given the repair text, a fresh
agent fixed all 3.

**For people who do not know the platform** (*revised 2026-10-08*, requirements §13.3b). The aim
moved from "an LLM can edit the model" to "a person describes, an LLM models, the person
reviews". What that needed:

- **Recipes** (`lib/llm-recipes.ts`, pure): the job's instructions in front of the model's
  context: model from a description, import an organisation's data, red-team Events, explain the
  current state. The person's text goes in the copy, and an LLM is told to ask before guessing.
  Red-teaming uses an LLM because it has no stake in the organisation and knows hazards across
  sectors; it needs the names, since the context of an organisation (a coastal hospital, a data
  centre) is in them, so the copy keeps them.
- **Privacy is the person's choice of LLM**, said once before the first copy: a chat that keeps no
  history, or a local LLM. Hiding names would remove what red-teaming reasons from.
- **Partial apply**: a reply proposing fifteen Events is accepted in part. Changes left out are
  skipped where they stand when the set is compiled, so the indices in errors stay the reply's,
  and a change that depended on one left out is refused like any other.
- **Provenance** (`schemas/provenance.py`): what LLM Design adds is marked
  `origin: "llm_design"` with the change's `why`, unconfirmed until a person confirms it.
  An LLM's frequency is a guess that looks like a measurement; the mark keeps the difference
  visible. It is stamped on the checked result, after the preview, so it applies to sections and
  Bulk operations alike.
- **Entry points** where the person already is (Canvas menu, Inspector, Events tab, Analysis,
  pasting a reply on the Canvas) open LLM Design through one request in the UI store.
- Evaluated like Bulk operations (`lib/llm-eval.test.ts`, recipe tasks): fresh agents given only a
  Recipe's copy modelled a hill town from a paragraph, imported a five-row asset table (one node per
  row, every dependency edge the right way, no invented quantity) and red-teamed the IJDRR sample
  (10 Events of both types, each striking an Element, none repeating the existing one); all three
  did what was asked on the first try. What they asked about went into the guide: carrying a
  Category needs no dependency on it, `demand` and `backup_duration` are for flows, an edge takes a
  vulnerability too. The run also found that a vulnerability to an Event that does not exist
  passed the check (a file load only warns); the check now refuses an edit that introduces one, by
  any path, and deleting an Event in the Events section takes its vulnerability levels along.

## Consequences

- Field paths refuse `__proto__`, `constructor` and `prototype` in every schema that holds one
  (ADR-0021), so a file loaded from disk meets the same rule as the text.
- "Copy with context for an LLM" sends the format and the model's ids and names (capped at 300
  per list), never the whole bundle; "Copy section" copies any part by pointer for the LLM to
  edit.
- The LLM context was tested with agents that saw only the copied context (six tasks: Events,
  one node, a removal, a bulk change on Net1, a Timeline and a Metric, a node added to a
  Canvas). What they had to guess shaped it: the primer and field references the Simulation
  text uses, Event fields and id rules, what the app does around a section (a removal's edges
  and Canvas places, an addition's Canvas), and for Bulk operations one stored Element per Node
  Type and supply shape, so a Stock is addressed by its field. After four rounds every task's
  reply passed the check on the first try.
- Property tests (fast-check) throw random change sets at the check: each is refused with
  reasons or yields a bundle both schemas accept, and the starting bundle never changes.
