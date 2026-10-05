# ADR-0021 — Events carry Attribute Operations on the current value

**Status:** proposed (2026-10-02, revised 2026-10-05). Nothing is built. Reasoning:
`docs/project/temporal-simulation-design.md` §2.3.

## Context

An Event's `attribute_mutations` is `{"<elementId>.<field>": literal}`: it can only
**overwrite**. Policy in a Temporal Simulation (ADR-0019) depends on the current value:
settle half a balance, settle the excess above a threshold, raise a ceiling by 10%. Neither
the stock integration rule (one fixed shape, ADR-0020) nor a literal overwrite can say "write
half of the current level", so without a primitive that policy would live in client script
code outside the Event, which is the only edit handle.

Two further constraints: dotted keys split on the last dot, and EPANET ids contain dots
(ADR-0016 and ADR-0017 keyed structurally for that reason); and a Stock field sits at
`supply_capacity.<category>.level`, deeper than any key a dotted string can address.

## Decision

`EventDefinition` gains an optional, additive **`attribute_operations`**: an ordered list of

```python
class AttributeOperation(BaseModel):
    element: str                                         # Element id
    path: list[str]                                      # ["supply_capacity", "hours", "level"]
    op: Literal["set", "add", "mul", "at_most", "at_least"]
    value: float | int | bool | str                      # a number for add/mul/at_most/at_least
```

- **`new = op(current, value)`**, applied to the value the field holds when the operation
  runs. `set` writes `value`. `at_most` caps the value at `value`; `at_least` raises it to
  `value`. The names differ from the Stock bounds `min`/`max` on purpose: those name a
  floor and a ceiling, and an operation named `max` would *raise to* a floor.
- **Operations on the same `(element, path)` compose in list order**, each reading the
  previous result. This is a deliberate exception to `applyEventToSnapshot`'s rule that every
  application pass reads the original Element: an operation is relative by definition.
- **Order inside Event application:** operations run after `attribute_mutations`, as a new
  last pass, so they win. (`lib/event-application.ts` calls these passes "phases" in its
  comments; this ADR says *pass* because **Phase** is a Timeline term, ADR-0019.) An
  operation that targets `functionality` re-attributes the cause to the Event, as a mutation
  does, and updates the step operator's imposed layer (ADR-0019 §2a).
- **Rejected with a warning, never clamped silently:** a result outside the field's valid
  range; a non-`set` operation on an absent field; a non-number `value` for an arithmetic
  operation; a path that runs into a number (`["supply_capacity", "hours", "level"]` on a
  bare-float supply).
- **A Stock is written field by field.** An `attribute_mutations` entry that would replace a
  whole `supply_capacity` or `capacity` holding a Stock is rejected with a warning, so an
  Attribute Operation is the only way an Event writes a Stock.
- The written change is a **Graph Diff** entry addressed by its full path (ADR-0020 §4).
  Fired by hand, it is tagged `event:<id>` for the Scenario Baseline; inside a run, the run's
  single history entry is tagged `simulation` (ADR-0019 §5). No Mutation Reversal is written.
- A Timeline's **profile** is a list of Attribute Operations per period label
  (ADR-0019 §1), the same mechanism without an Event around it.
- Recovering Functionality between Phases and periods is the step operator's job
  (ADR-0019 §2a). An earlier draft gave Events a `restore_functionality` flag; it was dropped
  because forcing the Scenario Fields operational also wiped damage, repair times and backup
  countdowns.
- `attribute_mutations` stays as the literal-overwrite form, equivalent to `set` at a
  one-element path. Nothing existing changes.

Examples, in the stock's stored sign (ADR-0020): liquidate half — `mul 0.5` on `level`;
settle the excess above X — `at_least −X` on `level`; settle everything owed — `at_least 0`
on `level`; open a draw limit — `set` on `max_draw`.

### Why this is no Rule

An operation is static, declared arithmetic on one value, applied client-side when the user
or a Timeline fires the Event. It has no condition and no engine evaluation, so CLAUDE.md §7
(rule *evaluation* belongs to the engine) is untouched. ADR-0015's set-once latch governs
engine-driven fixed points and does not apply: a user-fired Event may write the same path
again next period, which is exactly what periodic policy needs.

### Considered

- *Operator objects as `attribute_mutations` values* (`{"$op": "mul", "value": 0.5}`).
  Rejected: it keeps the dotted-key addressing that cannot reach a Stock field and breaks on
  dotted ids.
- *Free-text expressions.* Rejected for the same reason as a Metric formula language
  (ADR-0019 §4): an unbounded surface for evaluation, errors and performance. The rule
  grammar is the single place to extend if it is ever wanted.

## Consequences

- Pydantic `AttributeOperation` and `EventDefinition.attribute_operations` →
  `export_json_schema.py` → Zod → `pydantic-mirror.test.ts` (CLAUDE.md §6).
- `lib/event-application.ts` gains the pass; **`lib/merge-import.ts` remaps element ids
  inside Event mutation keys and must remap `AttributeOperation.element` too**, or an
  imported Event silently targets the wrong Element. The same holds for a Timeline profile.
- The Events tab of the config modal edits operations; `requirements.md` §6.4 gains the field.
- What an operation changed is read with a `read: change` Metric over its Phase
  (ADR-0019 §4); no separate result is stored.
- **Open (design doc §7):** an Element selector so a policy over many Elements is not one
  entry each; conditionals, which operations do not express.
