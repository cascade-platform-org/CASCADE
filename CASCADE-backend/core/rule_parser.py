"""
core/rule_parser.py — Rule lexer, AST types, and structural validation (OPEN).

Ported from the v1 engine's `core/rules.py`, keeping ONLY the parsing and
validation half. Rule *evaluation* (deciding which Elements actually change
Functionality) is the engine's exclusive responsibility (CLAUDE.md §7) and is
NOT ported here.

Two deliberate departures from v1:

1. **No `networkx`.** v1 parsed against an `nx.MultiDiGraph`; v2 works from the
   `Project`/`Node`/`Edge` registry. This module — the lexer and AST scaffolding —
   is graph-agnostic, so it has no graph dependency at all. The graph-aware
   `RuleParser` class (categories, node/edge name resolution) lands in a later
   layer and will take the v2 registry, not a networkx graph.

2. **No four-state status domain.** v1 imported `config.status_order` (the retired
   operational/.../critical labels). v2 Functionality is an integer `1..N`;
   label-to-integer resolution happens via `functionality_scale` at parse time
   (ADR-0002) and lives in the grammar layer, not here.

This layer covers: the lexer (`tokenize_rule`), the token and error types, the
rule-type enum, structural AST validation, and reference extraction.

Rule kinds (see CONTEXT.md → *Rule*):
- **Specific**      — `if <condition> then <target> is <level>`
- **Intracategorical** / **Intercategorical** — `<function> propagates to <target>`
  distinguished by whether the function references a Category.
"""
from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from enum import Enum
from typing import Any, Optional

from core.rule_grammar import DISABLED_RULE_PREFIX, OPERATORS as _GRAMMAR_OPERATORS
from core.utils.normalization import (
    normalize_category_name,
    normalize_label,
)

# DISABLED_RULE_PREFIX is sourced from CASCADE-app/shared/rule-grammar.json
# via core.rule_grammar — the single source of truth shared with the frontend.


def is_rule_disabled(rule_text: str) -> bool:
    """True when a rule is disabled (commented out) and should be skipped."""
    return rule_text.startswith(DISABLED_RULE_PREFIX)


class RuleType(Enum):
    """The three supported rule kinds, plus UNKNOWN for undetermined input."""

    SPECIFIC = "specific"
    INTRACATEGORICAL = "intracategorical"
    INTERCATEGORICAL = "intercategorical"
    UNKNOWN = "unknown"


@dataclass
class Token:
    """A lexical token: its text `value` and its `position` (char offset) in the
    source rule string. Position is retained so syntax errors can point at the
    exact offset that confused the parser.
    """

    value: str
    position: int

    def __post_init__(self) -> None:
        if not isinstance(self.position, int) or self.position < 0:
            raise ValueError("Position must be a non-negative integer")


class RuleSyntaxError(Exception):
    """Raised when a rule string is lexically or grammatically malformed."""

    def __init__(self, message: str, position: Optional[int] = None):
        super().__init__(message)
        self.position = position


class SemanticValidationError(Exception):
    """Raised when a rule parses but is semantically invalid (e.g. references an
    unknown category, or mixes category levels in a way the kind forbids).
    """

    def __init__(self, message: str, rule_type: Optional[str] = None):
        super().__init__(message)
        self.rule_type = rule_type


def tokenize_rule(text: str) -> list[Token]:
    """Split a rule string into tokens, treating `( ) , .` as their own tokens.

    Whitespace separates tokens and is discarded. The punctuation characters
    `()`,`.` are emitted as standalone tokens so the grammar can see function
    calls (`best_of( ... )`), argument lists, and dotted attribute access
    (`node.functionality`). Parenthesis balance is checked as we go, so an
    unmatched `(` or `)` is reported with its position immediately.

    A stack records the offsets of open parentheses; an unmatched close raises at
    once, and any still-open paren at end-of-input is reported against its offset.
    """
    if not text or not text.strip():
        raise ValueError("Empty or whitespace-only rule text")

    tokens: list[Token] = []
    current_chars: list[str] = []
    parentheses_stack: list[int] = []

    def add_current_token(position: int) -> None:
        # Flush the characters accumulated since the last delimiter into a token.
        if current_chars:
            token_value = "".join(current_chars)
            start_pos = position - len(token_value)
            tokens.append(Token(value=token_value, position=start_pos))
            current_chars.clear()

    i = 0
    while i < len(text):
        char = text[i]
        if char.isspace():
            add_current_token(i)
            while i < len(text) and text[i].isspace():
                i += 1
            continue
        elif char in "().,":
            add_current_token(i)
            if char == "(":
                parentheses_stack.append(i)
            elif char == ")":
                if not parentheses_stack:
                    raise ValueError(f"Unmatched closing parenthesis at position {i}")
                parentheses_stack.pop()
            tokens.append(Token(value=char, position=i))
        else:
            current_chars.append(char)
        i += 1

    add_current_token(len(text))

    if parentheses_stack:
        raise ValueError(
            f"Unmatched opening parenthesis at position {parentheses_stack[-1]}"
        )
    return tokens


def validate_ast_structure(ast: dict[str, Any], rule_type: RuleType) -> None:
    """Check that a parsed AST has the shape required for its rule kind.

    A cheap structural guard run after parsing: it confirms the top-level `type`
    matches and the kind-specific required fields are present, so downstream
    consumers (and the engine's evaluator) can trust the shape.

    - Specific rules need `condition` and a `then` block of type `then_block`.
    - Propagation rules (intra/inter) need `function` and `target_node`.
    """
    if not isinstance(ast, dict):
        raise ValueError("AST must be a dictionary")
    if "type" not in ast:
        raise ValueError("AST must contain 'type' field")
    if ast["type"] != rule_type.value:
        raise ValueError(
            f"AST type '{ast['type']}' doesn't match expected type '{rule_type.value}'"
        )

    if rule_type == RuleType.SPECIFIC:
        if "condition" not in ast:
            raise ValueError("Specific rule AST missing required field: 'condition'")
        if "then" not in ast:
            raise ValueError("Specific rule AST missing required field: 'then'")
        if ast["then"].get("type") != "then_block":
            raise ValueError("Specific rule AST 'then' must be of type 'then_block'")
    elif rule_type in (RuleType.INTRACATEGORICAL, RuleType.INTERCATEGORICAL):
        for field_name in ("function", "target_node"):
            if field_name not in ast:
                raise ValueError(
                    f"Propagation rule AST missing required field: {field_name}"
                )


# Reference node types the AST uses for a resolved or unresolved identifier.
_REFERENCE_TYPES = frozenset(
    {"reference", "reference_node", "reference_edge", "reference_category", "reference_unknown"}
)


def extract_function_references(func_ast: dict[str, Any]) -> list[str]:
    """Collect every node/edge/category name referenced inside a function AST.

    Walks a `function` subtree recursively and returns the `name` of each
    reference leaf (in document order). Used to build the per-target rule lookup
    table and to drive semantic validation (e.g. "do all referenced categories
    exist?"). v1 only matched the bare `reference` type; v2 matches all resolved
    reference kinds too, so references survive type resolution.
    """
    refs: list[str] = []
    node_type = func_ast.get("type")
    if node_type == "function":
        for arg in func_ast.get("arguments", []):
            refs.extend(extract_function_references(arg))
    elif node_type in _REFERENCE_TYPES:
        refs.append(func_ast["name"])
    return refs


def extract_target_from_rule(rule_text: str) -> list[str]:
    """Best-effort extraction of a rule's target element without full parsing.

    Used to bucket rules by the element they affect (the per-target lookup table)
    cheaply, before committing to a full parse. Specific rules name their target
    after `then ... is`; propagation rules after `propagates to`. Returns an empty
    list when no target can be read (the caller then skips the malformed rule).
    """
    try:
        rule_lower = rule_text.lower()
        if rule_lower.startswith("if"):
            then_match = re.search(r"then\s+(\w+(?:\.\w+)*)\s+is", rule_text)
            if then_match:
                return [then_match.group(1)]
        if "propagates to" in rule_lower:
            propagates_match = re.search(r"propagates\s+to\s+(\w+(?:\.\w+)*)", rule_text)
            if propagates_match:
                return [propagates_match.group(1)]
        return []
    except Exception:
        return []


class RuleIgnored(Exception):
    """Raised when a rule is syntactically valid but must be skipped at parse time.

    The canonical case (ADR-0002) is an unknown Functionality label: the rule was
    valid when authored but references a label no longer in the Model
    Configuration. Rather than fail the whole Propagation, the engine catches this,
    records `.warning` in the PropagationResult, and continues with other rules.
    """

    def __init__(self, warning: str):
        super().__init__(warning)
        self.warning = warning


def build_label_map(scale_levels: Iterable[Any]) -> dict[str, int]:
    """Build a normalised-label -> integer-level map from `functionality_scale`.

    Accepts any objects exposing `.label` and `.level` (the
    `FunctionalityScaleLevel` Pydantic models, or duck-typed equivalents), so this
    layer needn't import the schema package. Labels are normalised for
    case-insensitive lookup.
    """
    return {normalize_label(lvl.label): int(lvl.level) for lvl in scale_levels}


class RuleParser:
    """Grammar-aware parser for the three rule kinds, resolving against the v2
    Project registry and the Model Configuration's Functionality scale.

    Produces a validated AST. It does NOT evaluate rules — evaluation (deciding
    which Elements change Functionality) is the engine's exclusive job
    (CLAUDE.md §7). Two v2 departures from v1 (see module docstring): no
    `networkx`, and Functionality labels are resolved to integers at parse time.

    Element identifiers (node/edge IDs) are matched **exactly** against the
    registry — they are canonical, unique, machine-generated keys (e.g.
    `edge-<nanoid>`), and nanoid is case-sensitive, so normalising them risks
    collapsing two distinct IDs (ADR-0002). Only **categories** and
    **Functionality labels** are normalised, because those are human vocabulary
    where case-insensitivity is a feature. Every AST node still carries the
    verbatim `raw_name` / `raw_value` it was authored with for frontend round-trip
    (here `raw_name` and `name` coincide for IDs, since no transform is applied).

    **Display-label fallback.** When `element_labels` (display label -> ID) is
    supplied, a name that is not an exact ID is resolved case-insensitively
    against the labels — so a rule may name an element by what the editor shows
    ("Mixed Hub") rather than its machine ID. Exact-ID matching always wins, so
    this never weakens ADR-0002. Multi-word names (labels or categories with
    spaces) are kept whole through the whitespace tokenizer by a pre-pass that
    swaps their internal spaces for a sentinel, restored the moment the reference
    is resolved; `name` holds the canonical ID, `raw_name` the verbatim spelling.
    """

    _ALLOWED_OPERATORS: frozenset[str] = frozenset(_GRAMMAR_OPERATORS)

    # `is not …` folds into the logical complement of the comparison operator.
    _NEGATED_OPERATORS: dict[str, str] = {
        "=": "≠", "≠": "=", "<": ">=", ">": "<=", "<=": ">", ">=": "<",
    }

    # Sentinel that temporarily replaces the internal spaces of a recognised
    # multi-word name, so the whitespace-splitting tokenizer keeps it as one
    # token. It is a private-use Unicode code point no human would type, and is
    # neither whitespace (so the tokenizer won't split on it — note the control
    # chars \x1c-\x1f *are* whitespace to Python, so they can't be used) nor one
    # of the punctuation tokens; it rides along inside a single token and is
    # stripped back out to a space the moment the reference is resolved.
    _SPACE_SENTINEL = "\uE000"

    def __init__(
        self,
        *,
        node_ids: Iterable[str] = (),
        edge_ids: Iterable[str] = (),
        categories: Iterable[str] = (),
        labels: Mapping[str, int] | None = None,
        element_labels: Mapping[str, str] | None = None,
        value_labels: Iterable[str] | None = None,
    ):
        # Element IDs are matched exactly (canonical keys); categories are matched
        # via their normalised form -> original-name map (human vocabulary).
        self.nodes: set[str] = set(node_ids)
        self.edges: set[str] = set(edge_ids)
        category_list = list(categories)
        self.categories: dict[str, str] = {
            normalize_category_name(c): c for c in category_list
        }
        self.labels: dict[str, int] = dict(labels or {})

        # Human display label -> canonical element ID. Used as a *fallback* after
        # exact-ID matching, so a rule may name an element by what the user sees
        # in the editor ("Datacenter", "Mixed Hub") rather than its machine ID.
        # Matched case-insensitively via the label normaliser.
        self._label_to_id: dict[str, str] = {
            normalize_label(label): eid
            for label, eid in (element_labels or {}).items()
            if label
        }

        # Pre-tokenizer protection: any recognised name/value that contains
        # whitespace — a display label, a category, or a Functionality-scale label
        # used as a value ("Operational Warning") — is matched in the raw text and
        # its internal spaces are swapped for the sentinel, so the tokenizer keeps
        # it whole. Longest-first so "Backup Datacenter" wins over a hypothetical
        # "Datacenter". Casing of the user's text is preserved (replacement only
        # rewrites the whitespace runs).
        spaced = sorted(
            {
                p
                for p in [
                    *(element_labels or {}).keys(),
                    *category_list,
                    *(value_labels or ()),
                ]
                if p and re.search(r"\s", p)
            },
            key=len,
            reverse=True,
        )
        pattern_parts = [
            r"(?<!\w)" + r"\s+".join(re.escape(w) for w in re.split(r"\s+", p.strip())) + r"(?!\w)"
            for p in spaced
        ]
        self._protect_re = (
            re.compile("|".join(pattern_parts), re.IGNORECASE) if pattern_parts else None
        )

        self.tokens: list[Token] = []
        self.position: int = 0

    # -- spaced-name handling -----------------------------------------------

    def _protect_spaced_names(self, text: str) -> str:
        """Swap the internal spaces of recognised multi-word names for the
        sentinel, so the whitespace tokenizer keeps each such name as one token.
        A no-op when no spaced names were configured."""
        if self._protect_re is None:
            return text
        return self._protect_re.sub(
            lambda m: re.sub(r"\s+", self._SPACE_SENTINEL, m.group(0)), text
        )

    def _denormalize(self, token_value: str) -> str:
        """Restore a protected token's spaces — the inverse of protection — so the
        user's verbatim spelling is recovered for matching and round-trip."""
        return token_value.replace(self._SPACE_SENTINEL, " ")

    def _resolve_identifier(self, token_value: str) -> tuple[str, str, str]:
        """Resolve an identifier token to `(canonical_name, display_name, node_type)`.

        Exact ID first (ADR-0002), then a case-insensitive display-label fallback.
        `canonical_name` is the registry key the engine resolves against (the ID);
        `display_name` is the user's verbatim spelling, kept for round-trip.
        """
        display = self._denormalize(token_value)
        if display in self.nodes:
            return display, display, "node"
        if display in self.edges:
            return display, display, "edge"
        eid = self._label_to_id.get(normalize_label(display))
        if eid is not None:
            return eid, display, "edge" if eid in self.edges else "node"
        return display, display, "node"

    # -- public API ----------------------------------------------------------

    def parse(self, rule_text: str) -> dict[str, Any]:
        """Parse one rule string into a validated AST.

        Raises `RuleSyntaxError` for malformed input, `RuleIgnored` for a valid
        rule that should be skipped (unknown label), and `ValueError` for a
        structurally invalid AST.
        """
        if not rule_text or not rule_text.strip():
            raise ValueError("Empty or whitespace-only rule text")
        try:
            self.tokens = tokenize_rule(self._protect_spaced_names(rule_text))
            self.position = 0
            rule_type = self._detect_rule_type()
            self.position = 0
            if rule_type == RuleType.SPECIFIC:
                ast = self._parse_specific_rule()
            elif rule_type in (RuleType.INTRACATEGORICAL, RuleType.INTERCATEGORICAL):
                ast = self._parse_propagation_rule(rule_type)
            else:
                rule_lower = rule_text.lower()
                if "then" in rule_lower and "is" in rule_lower and not rule_lower.startswith("if"):
                    raise RuleSyntaxError("Specific rule must start with 'if'")
                if "propagates to" in rule_lower:
                    raise RuleSyntaxError("Failed to parse propagation rule. Check function syntax.")
                raise RuleSyntaxError("Could not determine rule type.")
            validate_ast_structure(ast, rule_type)
            return ast
        except ValueError as exc:
            if "Unmatched opening parenthesis" in str(exc):
                raise RuleSyntaxError("Missing closing parenthesis") from exc
            raise

    # -- rule-type detection -------------------------------------------------

    def _detect_rule_type(self) -> RuleType:
        if not self.tokens:
            return RuleType.UNKNOWN
        token_values = [t.value.lower() for t in self.tokens]
        if token_values[0] == "if":
            return RuleType.SPECIFIC
        if "propagates" in token_values and "to" in token_values:
            saved = self.position
            try:
                self.position = 0
                func_ast = self._parse_function_expression()
                return (
                    RuleType.INTERCATEGORICAL
                    if self._has_category_reference(func_ast)
                    else RuleType.INTRACATEGORICAL
                )
            except RuleSyntaxError:
                return RuleType.UNKNOWN
            finally:
                self.position = saved
        return RuleType.UNKNOWN

    @staticmethod
    def _has_category_reference(ast_node: dict[str, Any]) -> bool:
        if ast_node.get("type") == "reference_category":
            return True
        if ast_node.get("type") == "function":
            return any(
                RuleParser._has_category_reference(arg)
                for arg in ast_node.get("arguments", [])
            )
        return False

    def _resolve_category(self, name: str) -> str | None:
        """Return the canonical category name for `name`, or None if it isn't a
        category. Accepts an optional `category_` prefix and matches
        case-insensitively (categories are human vocabulary).
        """
        if not name:
            return None
        candidate = name[len("category_"):] if name.startswith("category_") else name
        return self.categories.get(normalize_category_name(candidate))

    # -- specific rules ------------------------------------------------------

    def _parse_specific_rule(self) -> dict[str, Any]:
        if not self._consume_keyword("if"):
            raise RuleSyntaxError("Specific rule must start with 'if'")
        condition = self._parse_expression()
        if not self._consume_keyword("then"):
            raise RuleSyntaxError("Specific rule must contain 'then' keyword")
        then_block = self._parse_then_assignments()
        return {"type": RuleType.SPECIFIC.value, "condition": condition, "then": then_block}

    def _parse_expression(self) -> dict[str, Any]:
        return self._parse_or_expression()

    def _parse_or_expression(self) -> dict[str, Any]:
        left = self._parse_and_expression()
        while self._has_more_tokens() and self._get_current_token().value.lower() == "or":
            self.position += 1
            right = self._parse_and_expression()
            left = {"type": "or", "left": left, "right": right}
        return left

    def _parse_and_expression(self) -> dict[str, Any]:
        left = self._parse_not_expression()
        while self._has_more_tokens() and self._get_current_token().value.lower() == "and":
            self.position += 1
            right = self._parse_not_expression()
            left = {"type": "and", "left": left, "right": right}
        return left

    def _parse_not_expression(self) -> dict[str, Any]:
        if self._has_more_tokens() and self._get_current_token().value.lower() == "not":
            self.position += 1
            return {"type": "not", "operand": self._parse_primary_expression()}
        return self._parse_primary_expression()

    def _parse_primary_expression(self) -> dict[str, Any]:
        if self._has_more_tokens() and self._get_current_token().value == "(":
            self.position += 1
            expr = self._parse_expression()
            if not (self._has_more_tokens() and self._get_current_token().value == ")"):
                raise RuleSyntaxError("Missing closing parenthesis")
            self.position += 1
            return expr
        return self._parse_attribute_condition(is_result_part=False)

    def _parse_then_assignments(self) -> dict[str, Any]:
        assignment = self._parse_attribute_condition(is_result_part=True)
        return {"type": "then_block", "assignments": [assignment]}

    def _parse_attribute_condition(self, is_result_part: bool) -> dict[str, Any]:
        """Parse `<identifier>[.attribute] is [<op>] <value>`.

        The default attribute is `functionality`. When the attribute is
        `functionality`, a string value is treated as a label and resolved to its
        integer level via the Model Configuration; an unknown label raises
        `RuleIgnored`. Both the verbatim identifier (`raw_name`) and value
        (`raw_value`) are preserved for frontend round-tripping.
        """
        if not self._has_more_tokens():
            raise RuleSyntaxError("Expected identifier")

        raw_identifier = self._get_current_token().value
        self.position += 1

        attribute = "functionality"
        if self._has_more_tokens() and self._get_current_token().value == ".":
            self.position += 1
            if not self._has_more_tokens():
                raise RuleSyntaxError("Expected attribute name after '.'")
            attribute = self._get_current_token().value
            self.position += 1

        if not (self._has_more_tokens() and self._get_current_token().value.lower() == "is"):
            raise RuleSyntaxError("Expected 'is' keyword after identifier or attribute")
        self.position += 1

        # `is not <value>` — natural-language negation sugar. Only in the
        # condition (an assignment "then X is not Y" is meaningless); the
        # negation is folded into the comparison operator below.
        negated = False
        if (
            not is_result_part
            and self._has_more_tokens()
            and self._get_current_token().value.lower() == "not"
        ):
            negated = True
            self.position += 1

        operator = "="
        if self._has_more_tokens() and self._get_current_token().value in self._ALLOWED_OPERATORS:
            operator = self._get_current_token().value
            self.position += 1

        if not self._has_more_tokens():
            raise RuleSyntaxError("Expected value after 'is'")
        value_raw = self._get_current_token().value
        self.position += 1

        # An operator glued to the value, e.g. "is <2", when not given separately.
        if not is_result_part and operator == "=":
            for candidate in sorted(self._ALLOWED_OPERATORS, key=len, reverse=True):
                if candidate != "=" and value_raw.startswith(candidate):
                    operator = candidate
                    value_raw = value_raw[len(candidate):].strip()
                    break

        if negated:
            operator = self._NEGATED_OPERATORS[operator]

        value_raw = self._denormalize(value_raw)  # restore any protected spaces
        value = self._resolve_value(value_raw, attribute)
        name, raw_name, node_type = self._resolve_identifier(raw_identifier)
        if is_result_part:
            operator = "="

        return {
            "type": "attribute_condition",
            "node_type": node_type,
            "name": name,              # canonical ID — what the engine resolves against
            "raw_name": raw_name,        # verbatim spelling, for frontend round-trip
            "attribute": attribute,
            "operator": operator,
            "value": value,            # resolved (int for functionality)
            "raw_value": value_raw,    # verbatim token text
        }

    def _resolve_value(self, value_raw: str, attribute: str) -> Any:
        """Coerce a value token: int, then float, else string. For the
        `functionality` attribute, a string is a label and is resolved to its
        integer level (unknown label -> RuleIgnored).
        """
        try:
            return int(value_raw)
        except ValueError:
            pass
        if attribute == "functionality":
            level = self.labels.get(normalize_label(value_raw))
            if level is None:
                raise RuleIgnored(
                    f"Unknown Functionality label '{value_raw}' — rule ignored "
                    f"(not defined in functionality_scale)."
                )
            return level
        try:
            return float(value_raw)
        except ValueError:
            return value_raw

    # -- propagation (intra/inter) rules -------------------------------------

    def _parse_propagation_rule(self, rule_type: RuleType) -> dict[str, Any]:
        function_ast = self._parse_function_expression()
        if not (self._consume_keyword("propagates") and self._consume_keyword("to")):
            raise RuleSyntaxError(f"{rule_type.value} rule must contain 'propagates to'")
        if not self._has_more_tokens():
            raise RuleSyntaxError(
                f"{rule_type.value} rule must specify target node after 'propagates to'"
            )
        target_token = self._get_current_token()
        if target_token.value in (")", ","):
            raise RuleSyntaxError("Invalid target node specified for propagation rule")
        target_name, raw_target, _ = self._resolve_identifier(target_token.value)
        self.position += 1
        if self._has_more_tokens():
            raise RuleSyntaxError(
                f"Unexpected token '{self._get_current_token().value}' after target node"
            )
        return {
            "type": rule_type.value,
            "function": function_ast,
            "target_node": target_name,      # canonical ID (label resolved if used)
            "raw_target_node": raw_target,   # verbatim spelling, for round-trip
        }

    def _parse_function_expression(self) -> dict[str, Any]:
        if not self._has_more_tokens():
            raise RuleSyntaxError("Expected function name")
        function_name = self._get_current_token().value
        self.position += 1

        if not (self._has_more_tokens() and self._get_current_token().value == "("):
            raise RuleSyntaxError("Expected '(' after function name")
        self.position += 1

        arguments: list[dict[str, Any]] = []
        while self._has_more_tokens() and self._get_current_token().value != ")":
            if (
                self.position + 1 < len(self.tokens)
                and self.tokens[self.position + 1].value == "("
            ):
                arguments.append(self._parse_function_expression())
            else:
                raw_name = self._get_current_token().value
                arguments.append(self._classify_reference(raw_name))
                self.position += 1

            if self._has_more_tokens() and self._get_current_token().value == ",":
                self.position += 1
                if not (self._has_more_tokens() and self._get_current_token().value != ")"):
                    raise RuleSyntaxError("Trailing comma found in function arguments")

        if not (self._has_more_tokens() and self._get_current_token().value == ")"):
            raise RuleSyntaxError("Missing closing parenthesis for function")
        self.position += 1

        return {"type": "function", "name": function_name, "arguments": arguments}

    def _classify_reference(self, raw_name: str) -> dict[str, Any]:
        """Tag an argument token as a node / category / edge / unknown reference.

        Element IDs are matched exactly; categories via their normalised form.
        `name` holds the exact ID for elements and the original category name for
        categories, so the engine can resolve it directly.
        """
        display = self._denormalize(raw_name)
        if display in self.nodes:
            return {"type": "reference_node", "name": display, "raw_name": display}
        category = self._resolve_category(display)
        if category is not None:
            return {"type": "reference_category", "name": category, "raw_name": display}
        if display in self.edges:
            return {"type": "reference_edge", "name": display, "raw_name": display}
        # Display-label fallback: resolve a human label to its canonical element ID.
        eid = self._label_to_id.get(normalize_label(display))
        if eid is not None:
            kind = "reference_edge" if eid in self.edges else "reference_node"
            return {"type": kind, "name": eid, "raw_name": display}
        return {"type": "reference_unknown", "name": display, "raw_name": display}

    # -- token helpers -------------------------------------------------------

    def _consume_keyword(self, keyword: str) -> bool:
        if self._has_more_tokens() and self._get_current_token().value.lower() == keyword.lower():
            self.position += 1
            return True
        return False

    def _has_more_tokens(self) -> bool:
        return self.position < len(self.tokens)

    def _get_current_token(self) -> Token:
        if not self._has_more_tokens():
            raise RuleSyntaxError("Unexpected end of input")
        return self.tokens[self.position]
