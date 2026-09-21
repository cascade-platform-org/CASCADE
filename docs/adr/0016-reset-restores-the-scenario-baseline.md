# ADR-0016 — Reset, Clear Event and Undo: three reverters over one Scenario Baseline

**Status:** accepted (2026-09-10)

## Context

`resetFunctionality` (`CASCADE-app/lib/network-utils.ts`) writes a fixed patch
onto every in-scope Element:

```ts
{ functionality: n, direct_damage: false, functionality_time: 0, responsibility_share: undefined }
```

That is only correct on a network where every Element was already at the
Functionality scale's maximum. Three defects follow, all reachable today:

1. **`expected_repair_time` survives.** An Event sets it (`default_repair_time`,
   `direct_damage_effects`); Reset clears `direct_damage` but leaves the repair
   time behind, so the Element reads as undamaged and still-under-repair.
2. **Rule-written attributes survive.** Since ADR-0015 a Specific Rule may assign
   *any* attribute — a first-class field or an arbitrary custom `properties`
   key — and `lib/element-update.ts` **merges** `ElementUpdate.properties` onto
   the Element. Reset knows nothing about those writes, so a cascade's
   `properties.damaged_by` outlives the cascade that caused it. ADR-0015's
   set-once latch means a re-Propagation will not clear it either.
3. **Nothing else can revert a Propagation.** CTRL+Z steps back one Update at a
   time and Clear Event reaches only an Event's own fields, so a user who wants
   "put the cascade back" has no operation that does it.

A fourth — *an authored degraded baseline is destroyed*, since Reset promotes to
`N` an Element a modeller authored below max as its normal state — was the
original motivation for reconstructing Functionality rather than asserting it.
The owner **subsequently overrode it**; Reset now promotes such an Element
deliberately. See *Reset guarantees a working network* (§4).

Three reverters already exist and none agrees with the others about what "put it
back" means, which is the underlying problem:

| operation | reverts | mechanism |
|---|---|---|
| **Undo** (CTRL+Z) | the newest Update, whatever it was | positional, over the update history |
| **Clear Event** (Ctrl+R) | the newest Event's own fields | `mutation_reversal` on that entry |
| **Reset** | nothing, in truth — it *asserts* Functionality `N` | a fixed patch |

The owner's directive: Reset must undo **the changes Events and Propagations
caused**, and restore **Functionality — including Functionality a hand edit
changed** — while leaving the *model* alone. A label fixed, a node moved, or a
capacity corrected mid-scenario is authoring work and must survive.

## Decision

### 1. Scenario Fields and model fields

Five fields describe an Element's **condition**:

```
functionality   functionality_time   direct_damage   expected_repair_time   responsibility_share
```

They are the **Scenario Fields** (`CONTEXT.md`). Everything else an Element
carries — label, position, Node Type, Categories, capacity, `vulnerability_levels`,
`properties` — is **model**. Reset forces the five to an operational state
outright; the Baseline is what reverts machine writes to everything else.

`functionality_time` is in the set deliberately. It is the countdown a backup has
left *in this scenario*, the history entry for editing it is literally
`manual_functionality_update` ("Functionality **or Functionality Time**"), and a
6-hour reserve typed in as a what-if is not a property of the asset.

This list is a **Reset-time classification and nothing else**. No other code
branches on it, and it does not constrain ADR-0015: a Rule may still assign any
attribute. That is exactly why the second capture path below is the only one that
names fields, and why it names only these.

### 2. The Scenario Baseline

Reset, and Clear Event, operate over the **Scenario Baseline**: a field-level map
holding each touched field's value from before the scenario touched it.

Entries are keyed **structurally** — element id, field name, and a `properties`
sub-key — not by the `"<elementId>.<field>"` string a Mutation Reversal uses.
That convention has to split on the last dot, which EPANET ids break (`J.12.A`),
and a `properties` key needs a third component anyway. The parts are carried on
the entry, so nothing parses the key back; it exists only to hold one field once
(`baselineKey`, `lib/scenario-baseline.ts`).

It is the same shape as an Event's **Mutation Reversal** (ADR-0003,
`lib/event-application.ts`) — including the `ABSENT` sentinel for a field that did
not exist, which is **deleted** on reversal rather than written back as `null`.
A Mutation Reversal is one Event's inverse; the Scenario Baseline is the whole
scenario's, over the same representation.

Each entry additionally carries a **source tag** — `event:<id>`, `propagation`,
or `manual` — recording *who wrote the field*. It is a tag, not a causal graph:
it says which operation performed the write, never which Event ultimately caused
it. **First write wins**, so the value held is always the pre-scenario one.

#### Two capture paths, and why there are two

**Machine writes are captured by provenance, never by name.** Every Event
application contributes its Mutation Reversal, tagged `event:<id>`. Every
Propagation contributes, per `ElementUpdate`, the prior value of each field it
wrote — including one entry per `properties` key it merged — tagged
`propagation`.

This is the load-bearing choice. A rule that matched on field *names* would have
to be extended every time ADR-0015 lets a Rule write a new attribute, and the
failure would be silent: Reset would leave the new attribute behind with nothing
failing. Because `ElementUpdate` already carries every field the engine writes,
provenance capture covers attributes that do not exist yet.

**Hand edits are captured by the Scenario Field list**, tagged `manual`. A human
editing in the Inspector is not a machine write, so provenance cannot see it —
this is the one place a name list is unavoidable, and it is bounded by the five
fields above rather than by what a Rule might invent.

#### `properties`: one field, two treatments

`properties` is both authored (the EPANET importer's `inp_id` and `kind`, a
modeller's own metadata) and machine-written (an ADR-0015 rule consequent). A
name-based rule cannot separate them; provenance can. A property key enters the
Baseline **only** if it arrived through an `ElementUpdate` or an Event's
`attribute_mutations`. Typed by hand, it is model and survives Reset.

#### Where the map comes from

The Baseline is **grown by capture and derived from the update history**, and the
two agree because a history entry's Graph Diff (ADR-0017) already records exactly
what that Update changed:

1. **Grow** — each write captures as above, first-write-wins.
2. **Seed on load** — fold `update_history` back to the last `scenario_reset`,
   taking each entry's *before* side and tagging it from that entry's
   `update_type`. The walk runs **oldest-first under first-write-wins**, so what
   survives for each field is the value from before the scenario's earliest
   write — not from before its most recent one.
3. **Re-derive after a rewind** — Undo, Redo and Clear Event change what the
   history says happened, so the fold is simply re-run; there is no cached copy
   to invalidate.

   Updates that *undo* work — `event_cleared`, `temporal_jump_revert` — are
   skipped entirely. Their diff's `before` side is a mid-scenario state, so
   folding one would record a degraded value as the pre-scenario one and Reset
   would restore the graph back **into** the cascade it was asked to remove.
   Nothing is lost: if the Update they reverted is still in history it already
   contributes the right value, and if it was removed its writes are gone.
4. **Retain past eviction** — an entry whose producing Update has been evicted
   from the capped history (`HISTORY_LIMIT`, or ADR-0017's byte budget) is kept.
   A scenario easily outlives twenty Updates, and losing Reset because the user
   nudged twenty node positions is the bug this clause prevents.
5. **Clear** — Reset empties the map.

Seeding is a correctness requirement, not an optimisation: any saved file may
ship **mid-scenario**. `samples/public/IJDRR_example.json` carries an
`event_applied` (Earthquake), its `propagation` and a
`manual_functionality_update`, and the guided tour (requirements §8.5) opens on
that file and asks for a Reset at its fourth step. Without seeding that Reset is
a silent no-op on a still-cascaded graph.

### 3. What each reverter does

| written by | tagged | Undo (CTRL+Z) | Clear Event | Reset |
|---|---|---|---|---|
| an Event, any field | `event:<id>` | if it is the newest Update | the newest Event's entries | **yes** |
| a Propagation, any field | `propagation` | if it is the newest Update | **yes — all of them** | **yes** |
| a hand edit, Scenario Field | `manual` | if it is the newest Update | no | **yes** — forced operational, not restored |
| a hand edit, model field | `manual` | if it is the newest Update | no | no |
| a hand edit to a MODEL field a machine already wrote | (already held, first-write-wins) | if it is the newest Update | with that machine write | with that machine write |
| nothing — an Element damaged with no Baseline entry at all | — | no | no | **yes** — half 1 needs no record |

The last row is the one surprise, and it is deliberate: the Baseline records a
*field's* pre-scenario value, not a log of writes. If a Rule set `capacity` to 40
and the user corrected it to 45, Reset restores 40 — 45 corrected a number the
cascade invented, and only means anything relative to a cascade that no longer
exists. Once that machine write has been reverted its entry is gone, so a later
hand edit to the field is untracked and survives.

**Undo is untouched by this ADR.** It remains positional over the update history
and consults no Baseline. Reset and Clear Event are *semantic* reverters — "put
the scenario back" — and Undo is a *temporal* one — "put the last thing back".
Keeping them separate is why Reset can leave a mid-scenario model edit standing
while Undo would not.

### 4. Reset

Two halves, and the first does not depend on the second:

1. **Every Element is forced operational** — `functionality` to `N`,
   `functionality_time` to `0`, and `direct_damage`, `expected_repair_time` and
   `responsibility_share` deleted. Unconditional, across the whole project,
   consulting nothing.
2. **Machine-written model attributes are reverted from the Baseline** — every
   entry tagged `event:<id>` or `propagation`, whatever the field. This is the
   half that reaches a `capacity` a Rule assigned or a custom `properties` key a
   cascade merged (ADR-0015), which half 1 knows nothing about.

A hand edit to a model field survives both — that is the authoring work the
directive protects.

#### Reset guarantees a working network, rather than reconstructing a past one

Half 1 reverses this ADR's original first Context defect, at the owner's
direction after a real failure: a Temporal Jump reverted *after* a Reset put the
graph back into a cascade the Baseline could no longer explain, and Reset
answered "nothing to reset" on a visibly broken network.

That hole is closed at its cause (below), but the directive was broader, and
correct: **the Baseline is derived state, and derived state can be wrong.** It is
folded from a history that is capped, evicted, rewound by Undo and skipped for
entries that undo work — each a place a future change can leave the fold
incomplete, with one failure mode: Reset silently declines to repair a damaged
network. Reset is what a user reaches for when the model is unintelligible, so it
cannot be the operation whose correctness depends on the most derived state in
the app. The price — an Element authored below `N` is promoted — is accepted as
visible and correctable, where damage left behind is neither.

Reset **ignores the local/global scope toggle** and always covers the whole
project. A Situation is a project-level concept — Events reach across Canvases,
and inter-canvas edges participate under global Propagation — so a half-rewound
cascade is a state the model was never in, and the Situation window would go on
describing something no longer on the canvas.

#### Reset ends the Temporal Jump run

A Temporal Jump run keeps state outside the graph: the pre-jump snapshot the
`−Xh` control restores, and the hours elapsed since. Both belong to the scenario
being ended, so Reset clears them.

Leaving them alive is what produced the failure above. The `−Xh` control went on
offering a snapshot taken *inside* the ended scenario; taking it dropped the
graph back into the cascade, and because that restore lands **above** the
`scenario_reset` entry — where `deriveBaseline` stops folding — the Baseline
behind it was empty. The network was damaged with nothing able to undo it.

An Element created during the scenario has no Baseline entries and keeps its
model attributes, though half 1 does make it operational. An Element deleted
during the scenario is not resurrected: its entries name an id that is gone, and
reversal skips unknown ids (`reverseMutations` already does).

Reset remains one undoable Any Graph Update: it pushes its own `scenario_reset`
entry, so CTRL+Z brings the scenario back — and, because the Baseline is
re-derived after a rewind (§2 step 3), a second Reset then works rather than
finding an emptied map. Undo does not restore the Temporal Jump run, which is
ephemeral UI state rather than graph state; the jumps themselves are ordinary
history entries and step back individually.

### 5. Clearing one Event clears the cascade with it

A Rule may write an attribute *because of* an Event (ADR-0015), but it writes it
during the **Propagation**, not during the Event application. So the write is
tagged `propagation`, and no reversal of the Event's own Mutation Reversal can
reach it. Until now such an attribute outlived the Event that caused it, latched
set-once so a re-Propagation would not clear it either.

Clear Event therefore reverts the newest Event's entries **and every entry tagged
`propagation`**. `manual` entries, and older Events' entries, stand.

**A cascade computed from an input that no longer exists is stale, and showing it
is worse than showing nothing.** Clearing an Event lands the graph at "the
remaining Events, un-propagated"; the user re-runs Propagation when they want the
new cascade.

Three obligations come with that, because it is a much larger operation than the
field-surgery Clear Event performs today:

- **It becomes undoable.** Today `clearEvent` reverts, removes the `event_applied`
  entry from history, clears the redo stack, and pushes nothing — CTRL+Z cannot
  bring the Event back. That is tolerable while it reverts a handful of fields
  and unacceptable once one keystroke also discards a whole cascade. It pushes an
  `event_cleared` entry, an `AnyUpdateType` that already exists in both schemas
  and is already documented in `architecture.md`, and has simply never been
  written.
- **It stays the newest Event only.** `clearEvent()` takes no argument and finds
  `updateHistory.find(update_type === "event_applied")`. This ADR does not
  introduce a per-Event picker; "Clear Event `X`" throughout means "the Event
  Ctrl+R would pick".
- **A Temporal Jump is an Event.** `temporalJumpEvent` goes through `applyEvent`
  and lands as `event_applied`, so Ctrl+R after a jump clears the jump and, now,
  the cascade with it — consistent, and a bigger blast radius than the user
  expects from a `−Xh` control sitting next to it. Clearing a Temporal Jump must
  also decrement `temporalJumpElapsedHours` and clear
  `temporalJumpRevertSnapshot` when it reaches zero, or the `−Xh` button goes on
  offering to rewind to a snapshot that predates a scenario that no longer
  exists.

**No Propagation is re-run automatically.** Firing one on the user's behalf would
spend an engine evaluation against their Entitlement (ADR-0008) silently, push a
history entry they did not cause, shift the Situation, and give Ctrl+R two
different behaviours depending on whether the server happens to be reachable.
Clearing an Event stays a purely local, offline, deterministic operation.

The product does auto-propagate in one place — the Temporal Jump popover's
`ui-store.temporalAutoPropagate`, shipped **on** — because a jump advances
simulated time, which means nothing until the cascade is recomputed. Clearing an
Event instead *removes* an input, and the graph without it is already the useful
result. If this is ever wanted, copy that checkbox, defaulting off.

## Considered options

- *Keep "set everything to `N`" and nothing else.* Rejected: on its own it
  reaches neither `expected_repair_time` nor anything an ADR-0015 Rule wrote, and
  it was scope-dependent. Forcing Functionality is now half of Reset — the half
  that guarantees a working network — but it is not the whole of it.
- *Reconstruct Functionality from the Baseline instead of forcing it.* This was
  the original decision here, and it was reversed (§4): it makes the one
  operation a user reaches for when the model is unintelligible depend on the
  most derived state in the app. Rejected on robustness, at the known cost of
  promoting an authored-degraded Element.
- *Restore Functionality but leave hand-edited Functionality alone.* Rejected by
  the owner: Functionality is the scenario variable no matter who moved it, and a
  Reset that leaves a manual `3 → 1` standing has not ended the scenario.
- *Snapshot the whole graph when a scenario starts, and restore it wholesale.*
  Rejected: it reverts model edits made mid-scenario, which the directive
  excludes. It is also the design that made `update_history` 97.5% of a project
  file (ADR-0017).
- *Classify fields as "scenario" or "model" by name.* Rejected as the sole
  mechanism: correct today, silently wrong after the next ADR-0015 attribute.
  Kept only for the one case provenance cannot see — a hand edit — where the list
  is bounded by the five Scenario Fields.
- *Accumulate the Baseline only, without deriving it from history.* Rejected: it
  is a second copy of what the update history already records, and every rewind
  (Undo, Redo, Clear Event) is a chance for the two to disagree with nothing
  failing. `deriveSituation` already took the same decision for the same reason —
  "there is no separate mutable copy to keep in sync".
- *Derive the Baseline from history only, with no retained map.* Rejected: it
  would age out with `HISTORY_LIMIT`, so twenty node nudges would quietly cost the
  user the ability to Reset their scenario.
- *Per-Event causal attribution of Propagation writes,* so that clearing one Event
  could revert exactly its own consequences and leave the rest of the cascade
  standing. Rejected: with several Events stacked before a single Propagation,
  only the engine can say which one caused a given write, and re-propagating
  without that Event **is** that answer rather than an approximation of it.
  Re-propagating is the user's call, not the app's.
- *Rewind to a point in time (the entry before the scenario's first Event).*
  Rejected: it makes Reset a time operation, so unrelated authoring done during
  the scenario is lost. The distinction the owner drew is model versus scenario,
  not before versus after.

## Consequences

- New domain terms **Scenario Field**, **Scenario Baseline** and **Clear Event**
  in `CONTEXT.md`. **Reset** is rewritten there.
- **`mutation_reversal` stops being written.** The Baseline generalises it, and
  an entry's Graph Diff already records the same thing in the same shape for
  every kind of Update, so writing both would be one fact stored twice — and
  ADR-0017 exists because history entries were too big. The field stays in the
  schema, and `reverseMutations` stays in `lib/event-application.ts`, because
  entries written by older builds carry it: for those, Clear Event reverts the
  Event's own fields precisely rather than rewinding the whole graph.
- Reset stops being scope-dependent, and `resetFunctionality` loses `scope` and
  `globalViewActive` (it reads `N` from the Model Configuration itself). Both
  call sites change: `components/canvas/action-bar.tsx`, and
  `components/scorecard/scorecard-panel.tsx`.
- Reset returns the number of Elements it actually changed, so "nothing to
  reset" is reported from the graph rather than from the Baseline being empty.
- **An Element authored below `N` is promoted by Reset.** One shipped sample is
  affected: `samples/public/backup-defer.json`, an engine fixture whose
  `e_da_hosp` edge is authored at Functionality 1 with no history behind it.
- **The Scorecard's gap-fill changes meaning.** `scorecard-panel.tsx`'s
  `onRunEvent` uses Reset as "give me a clean graph for this uncovered Event".
  Seeding (§2) keeps that working, but it now depends on the Baseline reaching
  back far enough, so it must be tested rather than assumed.
- **Clear Event becomes undoable** and starts writing the `event_cleared` entries
  the schema has always allowed. `store/canvas-store.test.ts`'s *"reverses only
  the Event's own fields"* simulates a cascade as a direct state write, so it is
  tagged `manual` and would keep passing while asserting the opposite of the new
  rule; it is corrected to tag that write `propagation`.
- **The Baseline is derived, so it is not a schema field.** No Pydantic → JSON
  Schema → Zod change, and no project-file format change beyond ADR-0017's.
- The Analysis Heatmap is **cleared by Reset** — `resetFunctionality` calls
  `clearHeatmap` (`lib/network-utils.ts`). The Analysis window's close button
  does not clear it, because the window floats over the canvas and closing it
  says nothing about the overlay; clearing is the explicit **Clear heatmap**
  control, or Reset. Resolved 2026-09-11, see ADR-0018.
- The Baseline gives the update history an anchor that survives eviction. It is
  the same object `deriveSituation` needs to stop returning `null` when a
  `reverts_to_entry_id` boundary ages out; that follow-up is not part of this ADR.
