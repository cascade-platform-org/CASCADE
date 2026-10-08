# ADR-0022 — The Model text: change what a project saves through a checked change set

**Status:** accepted (2026-10-08). Built: `lib/model-text.ts` (parse, check, preview; pure),
`lib/model-text-apply.ts` (apply, Undo this edit), the Action Bar's **Text** button and window
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
  equal to their record's id. A removal that leaves a reference dangling is refused, never
  repaired: the text says what to remove, and the check says what it forgot.
- **A preview lists every change** (Elements and Canvases through `diffGraph`, the rest leaf by
  leaf, lists of records with ids matched by id), as before → after, with totals. **Nothing is
  written until the person confirms it.** Apply checks again against the model as it is then.
- **Undo this edit.** The configuration has no undo stack, and the edit is one act across both
  files, so before writing, the whole current bundle is kept as a version ("Before Model text
  edit", File → Local → Recent saves) and the window offers Undo this edit, which puts it
  back. The write goes through the loaders a project file uses; the live `update_history` is
  kept.
- **A shown Temporal Simulation run refuses it**, like every model edit (ADR-0019 §1).
- **The change set is client-side only.** It is never saved or sent to the backend, so it has no
  Pydantic model; what it produces is validated by the mirrored Project and Configuration
  schemas.
- The Temporal Simulation's Text tab keeps its one document; Events and the rest of the model
  are edited through the Model text, so there is one text route per thing.

## Consequences

- Field paths refuse `__proto__`, `constructor` and `prototype` in every schema that holds one
  (ADR-0021), so a file loaded from disk meets the same rule as the text.
- "Copy with context for an LLM" sends the format and the model's ids and names (capped at 300
  per list), never the whole bundle; "Copy section" copies any part by pointer for the LLM to
  edit.
- Property tests (fast-check) throw random change sets at the check: each is refused with
  reasons or yields a bundle both schemas accept, and the starting bundle never changes.
