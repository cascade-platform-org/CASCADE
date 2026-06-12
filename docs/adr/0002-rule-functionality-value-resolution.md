# Rule functionality value resolution: dual-form with label→integer resolution at parse time

Rules are authored client-side and may express Functionality values in two equivalent forms:

- **Integer form**: `node1.functionality is <2` — a direct numeric comparison against the 1..N scale.
- **Label form**: `node1 is critical` — a human-readable label defined in `FunctionalityScaleLevel` within the Model Configuration.

The rule parser accepts both. Label resolution happens at parse time: the parser receives the `FunctionalityScaleLevel` list from the Model Configuration alongside the graph, looks up the label, and substitutes its integer value. The AST produced is identical in both cases — the evaluator works exclusively on integers and never sees string labels.

If a label appears in a rule but is not defined in the current `FunctionalityScaleLevel` config, the rule is **ignored** and a warning is returned. It is not a hard error — the propagation continues with the remaining rules.

The `status_order` mapping used by the engine is derived from the Model Configuration (`FunctionalityScaleLevel` integers), not hardcoded. No fixed 4-level enum (`operational`, `critical`, etc.) exists in the engine.

## Element IDs match exactly; only categories and labels are normalised

Rules reference elements by their **canonical unique ID** (e.g. `node-hospital`, `edge-<nanoid(8)>`), and the parser matches those IDs **exactly** — no normalisation. Element IDs are machine-generated and case-sensitive (nanoid's alphabet is `A-Za-z0-9_-`), so lowercasing them would risk collapsing two distinct IDs into one — a silent correctness bug. The frontend rule editor is therefore responsible for inserting the exact ID token (not a typed display name); this is the chosen frontend contract.

Normalisation (strip, whitespace/dots → `_`, lowercase) applies **only to categories and Functionality labels**, which are human vocabulary where case-insensitivity is a feature. `worst_of(Water)` resolves to the canonical category `water`; `is Critical` resolves to the `critical` level.

Because categories are case-insensitive vocabulary, the **rule-evaluation layer** (`engine/rules_eval.py`) compares categories by their normalised form on *both* sides: the category a rule names, the `node_categories` the engine aggregates over, and the config's `CategoryDefinition.name` may each be spelled differently and still match. Intra/inter operator overrides are stored and looked up under the normalised category, and `compose_categories` maps a rule's normalised category back to the actual node-spelled candidate key (so blame keeps the real spelling).

## Display-label fallback, spaced names, and unknown references

Exact-ID matching is still the primary contract, but the parser now accepts a **display-label fallback** so a rule may name an element by what the editor shows (`Datacenter`, `Mixed Hub`) rather than its machine ID. Resolution order for an element reference is: **exact ID → exact category (for function args) → exact edge ID → case-insensitive display label → unresolved**. Exact ID always wins, so the fallback never weakens the guarantee above. Multi-word names (labels or categories containing spaces) survive the whitespace tokenizer via a pre-pass that swaps their internal spaces for a private-use sentinel, restored the moment the reference resolves; `name` holds the canonical ID, `raw_name` the verbatim spelling. The frontend should still insert the canonical ID when the user picks an element, but a hand-typed label now resolves correctly instead of silently failing.

Two safety rails make a mis-named reference visible instead of silently mis-firing:

- **Unknown element.** A specific rule whose condition or target names an element that is neither a known ID nor a resolvable label is **ignored with a warning** (it would otherwise let a negated condition — `if not ghost is critical …` — evaluate `True` against a missing value and attach blame to a phantom id). An intra/inter rule with an unknown **target** is likewise ignored; an unknown **function argument** is reported but does not void a rule whose other arguments still resolve a category.
- **Ambiguous display label.** A label shared by two or more nodes is **not** registered for the fallback (resolving it would pick an arbitrary node); a rule that names it is reported as *ambiguous* — rename the nodes or use the element id.
- **Conflicting overrides.** A second intercategorical rule on the same target, or an intracategorical rule that re-sets the operator for a category already overridden at that target, applies *last-wins* and emits a warning so the shadowed rule is visible.

## Raw authored forms are preserved alongside resolved values

Label resolution (label → integer) and category resolution (typed name → canonical name) are lossy, so the AST stores the **verbatim authored form next to the resolved one**: `raw_name` beside `name`, `raw_value` beside `value`, `raw_target_node` beside `target_node`. A rule can always be rendered back to the frontend exactly as written (`critical`, not `1`). For element IDs, `name` and `raw_name` coincide (exact match, no transform). Implemented in `core/rule_parser.py` (`RuleParser`).

## Considered options

**Keep string labels in the engine**: retain v1's `status_order` string enum. Simple port, but contradicts the N-scale design and hardcodes the label vocabulary.

**Integer-only in rules**: force authors to write `node1.functionality is <2`. Consistent, but rules become unreadable without knowing the scale labels.

**Dual-form with parse-time resolution (chosen)**: rules stay human-readable, the engine stays label-free. The config is the single source of truth for label↔integer mapping.

## Why ignore rather than error on unknown labels

Rules are authored in the client and travel to the engine in the propagation payload. A label that was valid when the rule was written may become unknown if the Model Configuration is edited. Silently ignoring the rule (with a warning) keeps the engine fault-tolerant and avoids blocking a propagation over a stale rule definition. The user sees the warning in the PropagationResult and can fix the rule.
