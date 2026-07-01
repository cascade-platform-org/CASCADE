"""
engine/rules_eval.py — Rule evaluation (PRIVATE IP).

Rule *parsing* is open (core/rule_parser.py); rule *evaluation* — deciding which
Elements change Functionality — is the engine's exclusive responsibility
(CLAUDE.md §7) and lives here.

Three rule kinds (ADR-0003 → Heuristic pipeline), all authored on the target
element's `rules` list:

- **Specific** `if <cond> then <target> is <level>` — highest-priority override
  guard: when the condition holds, the target's proposal is replaced by the
  rule's level (still clamped to worsening by the monotone commit).
- **Intracategorical** `op(args) propagates to <target>` — re-parameterises the
  intracategorical aggregation operator for the referenced category at the
  target (default `best_of`).
- **Intercategorical** `op(cats) propagates to <target>` — re-parameterises the
  compose (intercategorical) operator across the referenced categories at the
  target (default `worst_of`); categories with no candidate count as full N.

Conditions are boolean formulas (`and`/`or`/`not`) over attribute comparisons on
any element field, with arithmetic operators `< > = ≠ <= >=`.
"""
from __future__ import annotations

from typing import Any, Callable, Optional

from core.aggregation import OPERATORS
from core.rule_parser import (
    RuleIgnored,
    RuleParser,
    RuleSyntaxError,
    build_label_map,
    is_rule_disabled,
)
from core.utils.normalization import normalize_category_name, normalize_label
from schemas.network import Edge, Node

# A resolver maps (node_type, element_name, attribute) → the current value.
Resolver = Callable[[str, str, str], Any]

_COMPARATORS: dict[str, Callable[[Any, Any], bool]] = {
    "<": lambda a, b: a < b,
    ">": lambda a, b: a > b,
    "=": lambda a, b: a == b,
    "≠": lambda a, b: a != b,
    "<=": lambda a, b: a <= b,
    ">=": lambda a, b: a >= b,
}


def _compare(actual: Any, expected: Any, operator: str) -> bool:
    """Apply a comparison operator, returning False for missing or incomparable
    values rather than raising (a rule that can't be evaluated simply doesn't
    fire)."""
    if actual is None:
        return False
    # Booleans authored as `true`/`false` arrive as strings from the parser.
    if isinstance(actual, bool) and isinstance(expected, str):
        expected = expected.strip().lower() == "true"
    comparator = _COMPARATORS.get(operator)
    if comparator is None:
        return False
    try:
        return comparator(actual, expected)
    except TypeError:
        return False


def eval_condition(ast: dict[str, Any], resolve: Resolver) -> bool:
    """Evaluate a specific-rule condition AST against current state."""
    kind = ast.get("type")
    if kind == "and":
        return eval_condition(ast["left"], resolve) and eval_condition(ast["right"], resolve)
    if kind == "or":
        return eval_condition(ast["left"], resolve) or eval_condition(ast["right"], resolve)
    if kind == "not":
        return not eval_condition(ast["operand"], resolve)
    if kind == "attribute_condition":
        actual = resolve(ast["node_type"], ast["name"], ast["attribute"])
        return _compare(actual, ast["value"], ast["operator"])
    return False


class RuleContext:
    """Parsed, classified rules for one Propagation, built once up front.

    Exposes the per-target operator overrides (intra/inter) and the list of
    specific rules. Parse warnings (syntax errors, unknown labels, unknown
    operators) are collected for the PropagationResult.
    """

    def __init__(self, nodes: dict[str, Node], edges: list[Edge], config: Any):
        labels = build_label_map(config.functionality_scale)

        # Display label -> element id, for the parser's label fallback. Edges have
        # no label, so only nodes contribute. A label shared by two nodes is
        # **ambiguous**: registering it would resolve a rule to an arbitrary one,
        # so we drop it and remember it — a rule that names it is then reported as
        # ambiguous rather than silently resolved (see `_describe_unknown`).
        by_norm: dict[str, list[tuple[str, str]]] = {}
        for nid, node in nodes.items():
            if node.label:
                by_norm.setdefault(normalize_label(node.label), []).append((node.label, nid))
        element_labels: dict[str, str] = {}
        self._ambiguous_labels: set[str] = set()
        for norm, entries in by_norm.items():
            if len({eid for _, eid in entries}) == 1:
                raw_label, eid = entries[0]
                element_labels[raw_label] = eid
            else:
                self._ambiguous_labels.add(norm)

        parser = RuleParser(
            node_ids=list(nodes),
            edge_ids=[e.id for e in edges],
            categories=[c.name for c in config.categories],
            labels=labels,
            element_labels=element_labels,
            # Original Functionality-scale spellings, so spaced labels used as a
            # rule value ("Operational Warning") survive the whitespace tokenizer.
            value_labels=[lvl.label for lvl in config.functionality_scale if lvl.label],
        )
        # category membership per element, to resolve a rule's referenced category
        # from element references (intracategorical rules name same-category peers).
        self._element_categories: dict[str, set[str]] = {}
        for nid, node in nodes.items():
            cats: set[str] = set(node.node_categories or [])
            cats.update((node.supply_capacity or {}).keys())
            cats.update((node.category_dependency_profiles or {}).keys())
            self._element_categories[nid] = cats

        # Canonical element ids, to detect references to elements that don't exist
        # (typos): such a rule is ignored with a warning rather than silently
        # mis-firing — a negated condition over an absent element would otherwise
        # evaluate True and blame a phantom id.
        self._known: set[str] = set(nodes) | {e.id for e in edges}

        self.specific: list[tuple[str, dict[str, Any], int]] = []
        self.intra: dict[str, dict[str, str]] = {}          # target -> {category: operator}
        self.inter: dict[str, tuple[str, list[str]]] = {}   # target -> (operator, categories)
        self.nested_inter: dict[str, dict[str, Any]] = {}   # target -> full nested function AST
        self.warnings: list[str] = []

        for element in [*nodes.values(), *edges]:
            for rule_text in element.rules or []:
                # A disabled rule ("// " prefix) is intentionally inactive — skip
                # it silently (no parse, no warning). Same convention as the UI.
                if is_rule_disabled(rule_text):
                    continue
                try:
                    ast = parser.parse(rule_text)
                except RuleIgnored as exc:
                    self.warnings.append(exc.warning)
                    continue
                except (RuleSyntaxError, ValueError) as exc:
                    self.warnings.append(f"Rule ignored ('{rule_text}'): {exc}")
                    continue
                self._classify(ast, rule_text)

    def _classify(self, ast: dict[str, Any], rule_text: str) -> None:
        kind = ast["type"]
        if kind == "specific":
            assignment = ast["then"]["assignments"][0]
            if assignment["attribute"] != "functionality":
                self.warnings.append(
                    f"Rule ignored ('{rule_text}'): only functionality assignments are supported."
                )
                return
            level = assignment["value"]
            if not isinstance(level, int):
                self.warnings.append(
                    f"Rule ignored ('{rule_text}'): assigned value is not a Functionality level."
                )
                return
            # Every element named in the condition or as the target must exist.
            refs = {*_condition_elements(ast["condition"]), assignment["name"]}
            unknown = [self._describe_unknown(r) for r in sorted(refs) if r not in self._known]
            if unknown:
                self.warnings.append(
                    f"Rule ignored ('{rule_text}'): {', '.join(unknown)}."
                )
                return
            self.specific.append((assignment["name"], ast["condition"], level))
            return

        # intra / intercategorical re-parameterisation
        operator = ast["function"]["name"]
        if operator not in OPERATORS:
            self.warnings.append(f"Rule ignored ('{rule_text}'): unknown operator '{operator}'.")
            return
        target = ast["target_node"]
        if target not in self._known:
            self.warnings.append(
                f"Rule ignored ('{rule_text}'): {self._describe_unknown(target)} as target."
            )
            return
        # A function argument that resolves to nothing (not an element nor a
        # category) is a typo — surface it, but keep the rule if other arguments
        # still resolve a category.
        unknown_args = sorted(self._unknown_function_refs(ast["function"]))
        if unknown_args:
            self.warnings.append(
                f"Rule ('{rule_text}'): unknown element(s) {unknown_args} ignored."
            )
        categories = self._referenced_categories(ast["function"])
        if not categories:
            self.warnings.append(
                f"Rule ignored ('{rule_text}'): no category could be resolved from its arguments."
            )
            return

        # Nested function: one or more direct arguments are themselves functions
        # (e.g. worst_of(best_of(A, B), best_of(C, B))). The flat (operator,
        # categories) representation loses the nested grouping, so we store the
        # full AST for dedicated evaluation in the propagation loop.
        has_nested = any(
            arg.get("type") == "function"
            for arg in ast["function"].get("arguments", [])
        )
        if has_nested:
            if target in self.nested_inter:
                self.warnings.append(
                    f"Rule ('{rule_text}'): replaces an earlier nested intercategorical rule on "
                    f"'{target}' (only the last one applies)."
                )
            self.nested_inter[target] = ast["function"]
            return

        # Category identity is case-insensitive human vocabulary (ADR-0002): a
        # rule may spell a category differently from the node's `node_categories`
        # or the config's CategoryDefinition.name. Store and look up by the
        # normalised form so the three always agree.
        if kind == "intracategorical":
            for category in categories:
                nc = normalize_category_name(category)
                existing = self.intra.get(target, {}).get(nc)
                if existing is not None and existing != operator:
                    self.warnings.append(
                        f"Rule ('{rule_text}'): intracategorical operator for a category at "
                        f"'{target}' was already set to '{existing}'; overriding with '{operator}'."
                    )
                self.intra.setdefault(target, {})[nc] = operator
        elif kind == "intercategorical":
            if target in self.inter:
                self.warnings.append(
                    f"Rule ('{rule_text}'): replaces an earlier intercategorical rule on "
                    f"'{target}' (only the last one applies)."
                )
            self.inter[target] = (
                operator,
                sorted({normalize_category_name(c) for c in categories}),
            )

    def _describe_unknown(self, name: str) -> str:
        """Phrase an unresolved element reference for a warning: distinguish a
        genuine typo from a display label that is ambiguous (shared by ≥2 nodes)."""
        if normalize_label(name) in self._ambiguous_labels:
            return f"ambiguous display label '{name}' (rename the nodes or use the element id)"
        return f"unknown element '{name}'"

    def _unknown_function_refs(self, function_ast: dict[str, Any]) -> set[str]:
        """Names in a function that resolved to neither an element nor a category
        (`reference_unknown`) — i.e. typos worth surfacing."""
        unknown: set[str] = set()
        for arg in function_ast.get("arguments", []):
            if arg.get("type") == "function":
                unknown |= self._unknown_function_refs(arg)
            elif arg.get("type") == "reference_unknown":
                unknown.add(arg["name"])
        return unknown

    def _referenced_categories(self, function_ast: dict[str, Any]) -> set[str]:
        """Collect the categories a function references — directly (category refs)
        or via the categories of referenced elements."""
        categories: set[str] = set()
        for arg in function_ast.get("arguments", []):
            atype = arg.get("type")
            if atype == "function":
                categories |= self._referenced_categories(arg)
            elif atype == "reference_category":
                categories.add(arg["name"])
            elif atype in ("reference_node", "reference_edge", "reference_unknown"):
                categories |= self._element_categories.get(arg["name"], set())
        return categories

    # --- per-target lookups used by the engine ------------------------------

    def nested_inter_ast(self, target_id: str) -> Optional[dict[str, Any]]:
        """Full nested function AST for targets whose intercategorical rule contains
        sub-functions (e.g. worst_of(best_of(A, B), best_of(C, B))). Returns None
        when no such rule exists for this target."""
        return self.nested_inter.get(target_id)

    def intra_operator(self, target_id: str, category: str) -> Optional[str]:
        # `category` arrives in node spelling; match on the normalised form.
        return self.intra.get(target_id, {}).get(normalize_category_name(category))

    def inter_override(self, target_id: str) -> Optional[tuple[str, list[str]]]:
        return self.inter.get(target_id)

    def specific_override(
        self, target_id: str, resolve: Resolver
    ) -> Optional[tuple[int, dict[str, float]]]:
        """The worst level prescribed by any firing specific rule for this target,
        with blame split evenly across that rule's referenced elements, or None.
        Worst-of when several rules fire — pessimistic."""
        firing = [
            (level, condition)
            for (tid, condition, level) in self.specific
            if tid == target_id and eval_condition(condition, resolve)
        ]
        if not firing:
            return None
        level, condition = min(firing, key=lambda pair: pair[0])
        elements = _condition_elements(condition)
        blame = {e: 1.0 / len(elements) for e in elements} if elements else {}
        return level, blame


def _condition_elements(ast: dict[str, Any]) -> list[str]:
    """Element names referenced anywhere in a condition (for responsibility)."""
    kind = ast.get("type")
    if kind in ("and", "or"):
        return _condition_elements(ast["left"]) + _condition_elements(ast["right"])
    if kind == "not":
        return _condition_elements(ast["operand"])
    if kind == "attribute_condition":
        return [ast["name"]]
    return []
