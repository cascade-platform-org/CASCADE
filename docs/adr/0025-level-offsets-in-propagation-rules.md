# ADR-0025 — Level offsets in propagation rules

**Status:** accepted (2026-10-27)

## Context

Propagation rules (`op(args) propagates to target`, ADR-0003) choose how a
target combines its inputs. Every operator returns a value between its lowest
and highest argument (`worst_of`, `best_of`, `median_of`, `majority_of` return
one of them; `average_of` rounds down a mean), and the only other lever, the
`dependency_level` guard, shifts a whole category up. Two relations therefore
could not be written:

- **Damping one term while another sees it raw.** "A function absorbs one
  degraded input by a level, and two degraded inputs pass in full" is
  `min(worst + 1, second worst)`. The damping is per category on the node, so
  the same input cannot be damped in one term and raw in the other. The FRAM
  conversion (paper harness, `experiments/fram/`) worked around it with one
  damped **copy node** per input.
- **Going below every input.** "Three coinciding deviations cost one level more"
  needs a level lower than any input. No operator or guard produces one, and a
  Specific Rule caps the target by design (user manual §2.3), so the harness
  needed a **helper node** carrying Specific Rules, whose level then entered the
  target's `worst_of`.

Both workarounds put plumbing nodes on the user's canvas.

## Decision

Any term of a propagation rule — a reference to a category or element, or a
function call — may carry **one integer offset**:

```
worst_of(worst_of(a, b, c) + 1, worst_of(best_of(a, b), best_of(a, c), best_of(b, c)))
  propagates to f
```

**Semantics** (`engine/logical.apply_offset`), on the scale 1..N, applied to the
term's level after it is resolved:

- `x + k` = `min(N, x + k)`. A term lifted back to N carries no blame.
- `x − k` = `max(1, x − k)` when x < N; **x = N stays N**.

The second clause is the load-bearing choice. An offset amplifies a deviation;
it never creates one. Without it, a term such as "third worst − 1" would degrade
a function whose inputs are all nominal. It also makes offsets non-composable
(`(N − 1) + 1` and `N` differ), so the grammar allows one offset per term.

`x + k` with k = N − dependency_level is exactly the dependency-level
attenuation (`engine/guards.attenuate`), so `+1` on a term is one level of
damping on that term alone. Offsets apply **after** the dependency level.

**Evaluation path.** A rule with an offset anywhere is evaluated as a whole
expression over the target's category candidates, the path nested rules
already use (`RuleContext.nested_inter`, `eval_nested_func_ast`). The flat
`(operator, categories)` override cannot carry offsets. Consequences, the same
as for nested rules: categories the rule does not name are left out of the
target's result, and an element named in the rule stands for its category.

**Grammar.** The signs live in the shared spec
(`CASCADE-app/shared/rule-grammar.json` → `offset_signs`). The tokenizer does
not split on them, because element ids are nanoids whose alphabet contains `-`.
The parser reads an offset after a term in three spellings: `+ 1`, `+1`, and
glued to a name (`pump+1`). A glued token is split only when the whole token is
not a known name and the part before the sign is one, so an element called
`pump-1` stays itself and a typo is reported as written. A second offset on one
term, a decimal, zero, or a sign without a number is a syntax error.

## Alternatives considered

- **A `kth_worst_of(k, …)` operator.** It would shorten the second-worst term but
  leaves the damping and the below-every-input cases unsolved. The pairwise
  `worst_of(best_of(…), …)` already expresses any order statistic.
- **Making a Specific Rule combine with the proposal by `worst_of`.** Rejected
  by the owner: a Specific Rule caps its target by design.
- **Arithmetic on Specific-rule consequents** (`then f is worst_of(a, b) − 1`).
  Not needed for the cases above; it remains possible later and would still cap.

## Consequences

- The FRAM conversion needs no copy or helper nodes; its results must be
  identical with and without them (`test_rule_offsets.py` checks the
  resonance rule against the copy encoding on every input combination).
- Offsets give the rule language a way to originate a level below every input
  (`− k`), but only from an input that already deviates, so the monotone commit
  and termination (ADR-0003) are unchanged.
- The autocomplete offers `+` / `-` after a function and 1..N−1 after a sign.
