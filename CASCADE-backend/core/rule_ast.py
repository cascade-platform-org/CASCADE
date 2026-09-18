# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Cristian Curaba
"""
core/rule_ast.py — the AST shape `core/rule_parser.py` produces and
`engine/rules_eval.py` consumes across the ADR-0009 engine boundary (CLAUDE.md
§7: import direction there is enforced by import-linter; this module is what
makes the SHAPE crossing that seam checked too, by pyright rather than by
reading rule_parser.py's construction code to find out what keys exist for a
given `type` discriminant).

Every node is a `TypedDict` keyed by a literal `type` field, so `ast["type"]`
narrows the rest of a `Union` member the same way pattern matching would.
Values stay `Any` for the resolved literal a condition or assignment compares
against (`AttributeCondition.value`) — int, float or str, exactly what
`RuleParser._resolve_value` returns — typing it further would just move the
`Any` one level down without adding a check anything relies on.
"""
from __future__ import annotations

from typing import Any, Literal, TypedDict, Union

# ---------------------------------------------------------------------------
# Specific-rule condition tree: and / or / not / attribute_condition
# ---------------------------------------------------------------------------


class AttributeCondition(TypedDict):
    """`<identifier>[.attribute] is [<op>] <value>` — a condition leaf, or (with
    `operator` forced to "=") a `then` assignment."""

    type: Literal["attribute_condition"]
    node_type: Literal["node", "edge"]
    name: str          # canonical ID — what the engine resolves against
    raw_name: str       # verbatim spelling, for frontend round-trip
    attribute: str
    operator: str       # one of the comparators, or "=" for a then-assignment
    value: Any          # resolved: int for functionality, else int | float | str
    raw_value: str      # verbatim token text


class AndCondition(TypedDict):
    type: Literal["and"]
    left: "ConditionAST"
    right: "ConditionAST"


class OrCondition(TypedDict):
    type: Literal["or"]
    left: "ConditionAST"
    right: "ConditionAST"


class NotCondition(TypedDict):
    type: Literal["not"]
    operand: "ConditionAST"


ConditionAST = Union[AndCondition, OrCondition, NotCondition, AttributeCondition]


class ThenBlock(TypedDict):
    """A Specific rule's consequent. Always exactly one assignment (the grammar
    has no syntax for more than one `then` clause per rule)."""

    type: Literal["then_block"]
    assignments: list[AttributeCondition]


class SpecificRuleAST(TypedDict):
    type: Literal["specific"]
    condition: ConditionAST
    then: ThenBlock


# ---------------------------------------------------------------------------
# Propagation-rule (intra/intercategorical) function tree
# ---------------------------------------------------------------------------


class ReferenceNode(TypedDict):
    type: Literal["reference_node"]
    name: str
    raw_name: str


class ReferenceEdge(TypedDict):
    type: Literal["reference_edge"]
    name: str
    raw_name: str


class ReferenceCategory(TypedDict):
    type: Literal["reference_category"]
    name: str
    raw_name: str


class ReferenceUnknown(TypedDict):
    """A function argument that resolved to neither an element nor a category —
    kept (not rejected at parse time) so the engine can surface it as a
    typo-shaped warning with the rest of the rule still evaluated."""

    type: Literal["reference_unknown"]
    name: str
    raw_name: str


ReferenceAST = Union[ReferenceNode, ReferenceEdge, ReferenceCategory, ReferenceUnknown]


class FunctionAST(TypedDict):
    type: Literal["function"]
    name: str
    arguments: list["FunctionArgumentAST"]


FunctionArgumentAST = Union[FunctionAST, ReferenceAST]


class PropagationRuleAST(TypedDict):
    type: Literal["intracategorical", "intercategorical"]
    function: FunctionAST
    target_node: str       # canonical ID (label resolved if used)
    raw_target_node: str   # verbatim spelling, for round-trip


RuleAST = Union[SpecificRuleAST, PropagationRuleAST]
