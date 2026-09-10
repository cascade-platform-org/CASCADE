# ADR-0017 — Update history stores Graph Diffs; auto-save writes a Working Copy

**Status:** accepted (2026-09-10)

## Context

Every entry in `Project.update_history` holds two whole `GraphSnapshot`s, a
`before` and an `after`, whatever changed. Measured on the git-tracked sample
`CASCADE-app/samples/public/Palmanova_Complete.json` (39 nodes, 93 edges, 20
history entries). Sizes are the **compact** JSON serialisation unless the row
says otherwise; the tracked file is pretty-printed, which is why the number the
user sees in the sample picker is larger again:

| | |
|---|---|
| the file on disk, as tracked (`manifest.json` calls it "3.7 MB") | **3647 KB** |
| project, compact | **2190 KB** |
| the model itself (nodes + edges + canvases) | **53 KB** |
| `update_history` — 20 entries | **2137 KB — 97.6%** |

The history is **40× the model it describes**, and one of those twenty entries
stores its ~100 KB for a change of *nothing*.

That size has already forced four different persistence policies for one field:

| path | `update_history` |
|---|---|
| `useAutosave` → localStorage (2 s debounce) | **stripped** — "the undo stack holds full graph snapshots that easily exhaust the localStorage quota" |
| `pushAutoSnapshot` → 5-minute version ring | **stripped** |
| `saveBeforeUnload` → recovery file + localStorage | **kept** (~2 MB written on every unload; the write failure is caught and ignored) |
| explicit Save, and Server Sync | **kept** (2 MB × up to 10 synced versions ≈ 20 MB of JSONB per project name) |

The user-visible consequence is that undo is empty after a crash. That is a
workaround for a size problem, not a design decision.

Diff formats measured against that same real history — both directions,
invertible, `properties` one level deep. Re-runnable against the sample, so these
are checkable rather than remembered:

| representation | size | vs today |
|---|---|---|
| the snapshot pairs as stored today | 2131 KB | 1× |
| element-level (changed Elements stored whole) | 286 KB | 7.5× |
| **field-level (changed fields only)** | **66 KB** | **32×** |

## Decision

### 1. History entries store a Graph Diff, not two snapshots

A **Graph Diff** is a field-level, invertible description of what changed
between two Scenarios. It is the same idea as a Mutation Reversal (ADR-0003) and
a Scenario Baseline (ADR-0016) — including the `ABSENT` sentinel — generalised
from "what one Event wrote" to "what any Any Graph Update changed", and carrying
both directions so it can be applied forwards or backwards.

It is **schema-agnostic by construction**: it enumerates the keys actually
present on each Element rather than a known field list. This is not tidiness.
Since ADR-0015 a Rule may write any attribute, including a custom `properties`
key; the moment the differ knows field names, the next new attribute stops being
undoable and *nothing fails* — undo just silently leaves a value behind. Full
snapshots had this property for free, and it is the one virtue of theirs that
must not be lost.

Two structural consequences follow:

- Keys are **structured, not dot-joined strings**. Mutation Reversal's
  `"<elementId>.<field>"` convention has to split on the last dot because EPANET
  ids contain dots (`J.12.A`); a diff addressing nested `properties` keys cannot
  rely on that.
- The differ **recurses one level into `properties`** and stores every other
  compound field (`responsibility_share`, `vulnerability_levels`,
  `node_categories`) whole. `ElementUpdate.properties` is *merged* onto an
  Element (`lib/element-update.ts`), so a Rule adding one key to a 20-key
  properties object would otherwise store that whole object twice per entry.
  The other compound fields are replaced wholesale by the engine, so storing
  them whole is exact and cheaper.

**Undo needs no snapshot materialisation.** The live graph is the anchor: the
newest entry's `after` *is* the current state, so undo applies the diff backwards
and redo applies it forwards. This is why no periodic checkpoint is required —
there is no chain to replay from a base.

Four consumers read `before`/`after` today and each needs a different answer:

| consumer | reads | under diffs |
|---|---|---|
| `canvas-store.undo` / `redo` | the whole snapshot | applies the diff against the live graph |
| `situation.ts` → Save-to-Scorecard | `propEntry.before` / `.after` as whole Scenarios | materialises by walking back from the live state, at most `HISTORY_LIMIT` steps |
| `scorecard-utils.findUnsavedRuns` | same, plus a dedup hash over `entry.before` | same materialisation |
| `inspector/cause-banner.tsx` | one Element's `functionality` on each side | reads the diff directly — this consumer gets *simpler*, since the diff is already "what changed" |

`cause-banner` also declares its own structural `HistoryEntry` type with `before`
and `after` required, rather than importing `AnyUpdateEntry`. Making those fields
optional will fail at its call site rather than at its reads, which is the
failure mode to want; it is listed here so the fix is not discovered by tsc.

The **Scenario Baseline** (ADR-0016) is a fifth consumer, and the reason the diff
must be tagged with its entry's `update_type`: the Baseline is seeded on load and
re-derived after a rewind by folding these diffs.

**Both formats are read; only diffs are written.** `before`/`after` become
optional and legacy. There is no migration and no version bump: existing project
files, including every git-tracked sample, keep undoing correctly.

### 2. One history policy, and eviction by bytes as well as count

`update_history` is persisted everywhere it is saved — localStorage autosave,
recovery file, explicit Save, Sync. At 66 KB for 20 entries it no longer
threatens any quota, so undo survives a crash. The history-free write is kept as
a *fallback* behind a size guard, with a toast, rather than as the default.

The engine payload remains the one deliberate exception:
`lib/propagation-payload.ts` sends `update_history: []`, because the engine has
no use for it and the body has a size ceiling. Three paths keep it, one strips
it, for a stated reason — cheaper and consistent, not literally uniform.

`HISTORY_LIMIT = 20` gains a companion byte budget. A count alone is the wrong
bound when one bulk deletion can produce a diff far larger than twenty ordinary
ones; entries are evicted past **either** limit.

### 3. Auto-save fires on 10 seconds idle, and only when content changed

`useAutosave` subscribes to the whole of canvas-store and config-store, so it
fires on writes that change nothing serialisable — switching Canvas tab
(`setActiveCanvas`), or an `updateNode` patch equal to what is already there. A
timer alone would therefore write forever on an untouched tab. The save is
skipped when the serialised content is unchanged since the last one, which is
also what makes the interval safe to lengthen from 2 s to 10 s.

### 4. Server Sync gains a Working Copy, distinct from a version

§13.4 requires that every save be a **new version, never an overwrite**, with 10
kept per project name. Auto-saving into that model at any useful interval would
churn the version list into "the last few minutes" and evict the user's own
explicit saves.

A **Working Copy** is therefore not a version: one row per `(owner, name)`,
UPSERTed. Explicit Save still creates versions, and §13.4's never-overwrite rule
is untouched because an auto-save is not a version. On load, the Working Copy is
offered when it is newer than the newest version.

**It is opt-in per project and off by default.** ADR-0007's guarantee is that the
network is never stored server-side unless the user opts into Sync; an auto-save
that uploaded silently would break that sentence, not merely stretch it.

## Considered options

- *Element-level diffs (store changed Elements whole).* Rejected: 7.5× against
  field-level's 32×, and the extra machinery is small because the `ABSENT`
  sentinel and the field-level shape already exist and are tested in
  `lib/event-application.ts`.
- *Commands instead of states — record "Rule R fired", replay to undo.* Rejected.
  Replay needs the engine, which needs the server, so offline undo dies; and
  ADR-0015's set-once latch makes replay order-dependent. Snapshots and diffs are
  self-describing, which is what lets them reverse attributes that do not exist
  yet.
- *A base snapshot plus an accumulating diff chain, with periodic checkpoints.*
  Rejected as unnecessary: anchoring each diff to the live state removes the
  chain, and with it the question of when a chain has grown too long.
- *Split the project into a model file and a session file.* Rejected: it would
  make "which paths carry history" disappear, but it costs the single
  downloadable file that local-first depends on — every sample ships as one.
- *Auto-save creating throttled real versions.* Rejected: machine saves still mix
  into the user's version list and still evict explicit ones.

## Consequences

- New domain terms **Graph Diff** and **Working Copy** in `CONTEXT.md`.
- `AnyUpdateEntry` gains `diff`; `before`/`after` become optional. Pydantic first
  per CLAUDE.md §6, then the exported JSON Schema, then Zod.
- `local-first-guide.md` documents the canonical project JSON, and this changes
  its shape — the guide is updated in the same change.
- Migration **007** adds the working-copy table; `PUT`/`GET /api/projects/autosave`
  are added to `api-reference.md`. §13.4 is amended to name the Working Copy and
  restate that it is not a version.
- **The working-copy table is personal data and inherits the whole GDPR
  contract.** `privacy-and-data-protection.md` states the rule plainly — a new
  table lands in its §2 inventory and in `db/export.py` in the same session, or
  both go stale. It also needs `owner_id … ON DELETE CASCADE`, like `projects`
  already has, or the Art. 17 erasure claim ("`projects` … are `ON DELETE
  CASCADE` and go with it") stops being true of the copy that is most current.
- **The history seam is fixed in the same change.** There are eight
  `pushUpdateEntry` call sites against one declared seam (`lib/run-with-history.ts`)
  and two id schemes — `crypto.randomUUID()` in canvas-store, `nanoid()`
  everywhere else. Diffs make this urgent rather than untidy: each site would
  otherwise have to build its own diff, and a site that got it wrong would produce
  an entry that undoes incorrectly with nothing failing. `runWithHistory` becomes
  the only path, on `nanoid` throughout, with the store-internal pushes passing
  their extra fields (`mutation_reversal`, `propagation_meta`) through it.
- The case-study project drops from 2190 KB compact to ~120 KB (3647 KB to
  ~200 KB as tracked on disk). **Four** git-tracked Palmanova variants carry a
  fat history — `Palmanova_Complete`, `_electric_priority`, `_water_improvement`
  and `Updated_Palmanova_New`, ~13 MB between them — and can be re-saved to
  shrink the repository. That is a separate, reviewable commit and not a
  prerequisite; `samples/public/manifest.json` carries a `sizeLabel` per sample
  ("3.7 MB") that has to be corrected in the same commit.
- **Not addressed here:** Scorecard entries embed whole Scenarios plus base64
  PNGs (30 KB in `Office_with_Heat.json`). The same treatment would apply, but a
  Scorecard entry is an intentional archive rather than a mechanical log, so it
  is left alone.
