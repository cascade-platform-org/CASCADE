# ADR-0015 — Generic attribute-set rule consequents

**Status:** accepted (2026-07-27)

## Context

A **specific rule** (ADR-0003) has the form `if <cond> then <target>[.<attr>] is
<value>`. Until now the evaluator (`engine/rules_eval.py`) accepted only
`functionality` consequents; any other attribute was dropped with the warning
*"only functionality assignments are supported."*

Modellers reasonably want to drive other element attributes from conditions —
the motivating example being *"if El Source is critical then Substation.direct_damage
is True"*: assert that a cascade physically damages an element, which then feeds
the (future) recovery module's repair-crew candidate list. `direct_damage`,
`expected_repair_time`, and arbitrary custom `properties` already exist on
`Node`/`Edge` and on `ElementUpdate`; the engine simply never wrote them from a
rule.

The owner's directive was explicit: this must be **uniform** — `direct_damage`
is not a special case; *any* attribute assignment (first-class field or custom
property) is handled by one mechanism.

## Decision

Specific-rule consequents may assign **any** attribute. Two paths:

- `functionality` (or a bare `then <target> is <level>`) keeps its existing
  behaviour: a highest-priority override guard on the target's proposal, clamped
  to worsening by the monotone commit. It is the propagation variable.
- **Every other attribute** — first-class `direct_damage` / `expected_repair_time`,
  or a custom key — is a **generic attribute-set consequent**. When the condition
  holds, the value is written onto the target element and emitted in its
  `ElementUpdate` (a recognised first-class field fills its typed slot; anything
  else lands in `properties`). It does **not** change `functionality` by itself.

### Set-once latch (the load-bearing choice)

`functionality` is safe to iterate to a fixed point because it is a bounded-below
integer that only ever decreases — the loop provably terminates. Arbitrary
attributes have no such ordering, so a rule that sets attribute *x* combined with
another whose condition reads *x* could oscillate forever.

We therefore apply each attribute-set as a **set-once latch**: the first firing
of a given `(element, attribute)` pair wins and is never overwritten. Because
each pair changes at most once and `functionality` remains monotone, the fixed
point still terminates. A rule-set attribute is written into a per-run overlay
that the condition resolver reads first, so one rule's assignment is visible to
another rule's condition **within the same run** (e.g. `then b.tripped is True`
feeding `if b.tripped is True then c is critical`). Un-setting when a condition
later becomes false is deliberately **not** supported — it would reintroduce
non-monotonicity, and it does not match the intended semantics ("the fault
occurred").

### Labels may not contain `.`

`.` is the rule grammar's attribute-access operator, so a label like `El. Source`
tokenises as element `El` + attribute `Source`. Rather than teach the parser to
parse periods inside labels, the node-label input strips `.` on entry. Existing
data with periods is not rejected on import (that would break older files); such
a label simply cannot be referenced by a rule until renamed.

## Consequences

- The `"only functionality assignments are supported"` warning is gone; the
  parser already parsed these consequents — only the evaluator gated them.
- `direct_damage` is no longer *solely* set by hazards (per the prior wording in
  `requirements.md §16`): a rule can set it too. `requirements.md` is updated to
  reflect this. The recovery module still consumes `direct_damage` unchanged; it
  simply now has a second, rule-driven origin.
- Stays inside the engine boundary (CLAUDE.md §7): only *evaluation* changed;
  parsing (`core/rule_parser.py`) was untouched. `ElementUpdate` already carried
  every field, so no schema change was needed.
- Conflict handling is first-writer-wins per `(element, attribute)`. A second rule
  assigning the same pair is flagged with a parse warning ("another rule already
  assigns … when both conditions hold the first to fire wins"), rather than
  resolved silently — the latch semantics are unchanged.
