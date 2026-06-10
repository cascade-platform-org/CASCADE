"""Tests for core/rule_parser.py — lexer + AST scaffolding (Layer 1).

These pin the lexical grammar and structural validation that the rest of the
rule layer builds on. Evaluation is engine-only and not tested here.
"""
import pytest

from core.rule_parser import (
    RuleSyntaxError,
    RuleType,
    Token,
    extract_function_references,
    extract_target_from_rule,
    tokenize_rule,
    validate_ast_structure,
)


# --- Token ------------------------------------------------------------------


def test_token_rejects_negative_position():
    with pytest.raises(ValueError):
        Token(value="x", position=-1)


# --- tokenizer --------------------------------------------------------------


def test_tokenize_splits_on_whitespace():
    tokens = tokenize_rule("a is critical")
    assert [t.value for t in tokens] == ["a", "is", "critical"]


def test_tokenize_emits_punctuation_as_tokens():
    tokens = tokenize_rule("best_of(a, b)")
    assert [t.value for t in tokens] == ["best_of", "(", "a", ",", "b", ")"]


def test_tokenize_handles_dotted_attribute():
    tokens = tokenize_rule("node1.functionality")
    assert [t.value for t in tokens] == ["node1", ".", "functionality"]


def test_tokenize_records_positions():
    tokens = tokenize_rule("ab cd")
    assert tokens[0] == Token("ab", 0)
    assert tokens[1] == Token("cd", 3)


def test_tokenize_empty_raises():
    with pytest.raises(ValueError):
        tokenize_rule("   ")


def test_tokenize_unmatched_close_paren():
    with pytest.raises(ValueError, match="Unmatched closing parenthesis"):
        tokenize_rule("a )")


def test_tokenize_unmatched_open_paren():
    with pytest.raises(ValueError, match="Unmatched opening parenthesis"):
        tokenize_rule("best_of(a")


# --- validate_ast_structure -------------------------------------------------


def test_validate_specific_ast_ok():
    ast = {
        "type": "specific",
        "condition": {"type": "reference_node", "name": "a"},
        "then": {"type": "then_block"},
    }
    validate_ast_structure(ast, RuleType.SPECIFIC)  # no raise


def test_validate_specific_missing_then():
    ast = {"type": "specific", "condition": {}}
    with pytest.raises(ValueError, match="missing required field: 'then'"):
        validate_ast_structure(ast, RuleType.SPECIFIC)


def test_validate_specific_then_wrong_type():
    ast = {"type": "specific", "condition": {}, "then": {"type": "nope"}}
    with pytest.raises(ValueError, match="must be of type 'then_block'"):
        validate_ast_structure(ast, RuleType.SPECIFIC)


def test_validate_propagation_ast_ok():
    ast = {"type": "intracategorical", "function": {}, "target_node": "x"}
    validate_ast_structure(ast, RuleType.INTRACATEGORICAL)  # no raise


def test_validate_propagation_missing_field():
    ast = {"type": "intercategorical", "function": {}}
    with pytest.raises(ValueError, match="missing required field: target_node"):
        validate_ast_structure(ast, RuleType.INTERCATEGORICAL)


def test_validate_type_mismatch():
    with pytest.raises(ValueError, match="doesn't match expected type"):
        validate_ast_structure({"type": "specific"}, RuleType.INTRACATEGORICAL)


# --- extract_function_references --------------------------------------------


def test_extract_references_nested_function():
    ast = {
        "type": "function",
        "name": "worst_of",
        "arguments": [
            {"type": "reference_node", "name": "a"},
            {
                "type": "function",
                "name": "best_of",
                "arguments": [
                    {"type": "reference_category", "name": "water"},
                    {"type": "reference_edge", "name": "e1"},
                ],
            },
        ],
    }
    assert extract_function_references(ast) == ["a", "water", "e1"]


def test_extract_references_empty_for_non_function():
    assert extract_function_references({"type": "literal", "value": 3}) == []


# --- extract_target_from_rule -----------------------------------------------


def test_extract_target_specific_rule():
    assert extract_target_from_rule("if a is critical then b is critical") == ["b"]


def test_extract_target_propagation_rule():
    assert extract_target_from_rule("worst_of(water) propagates to hospital") == [
        "hospital"
    ]


def test_extract_target_dotted():
    assert extract_target_from_rule("if x is critical then n.functionality is 1") == [
        "n.functionality"
    ]


def test_extract_target_none_found():
    assert extract_target_from_rule("garbage input") == []


def test_rule_syntax_error_carries_position():
    err = RuleSyntaxError("bad", position=5)
    assert err.position == 5


# --- Layer 2: RuleParser (grammar + v2 resolution) --------------------------

from core.rule_parser import RuleIgnored, RuleParser, build_label_map  # noqa: E402


class _Level:
    """Duck-typed FunctionalityScaleLevel for build_label_map tests."""

    def __init__(self, level, label):
        self.level = level
        self.label = label


def _parser():
    # N=4 scale; labels resolve to integers per ADR-0002.
    labels = build_label_map(
        [
            _Level(1, "critical"),
            _Level(2, "time warning"),
            _Level(3, "operational warning"),
            _Level(4, "operational"),
        ]
    )
    # IDs are single tokens (the lexer splits on whitespace); 'PumpA' has mixed
    # case so raw_name vs normalised 'pumpa' is exercised.
    return RuleParser(
        node_ids=["PumpA", "hospital", "tank"],
        edge_ids=["e1"],
        categories=["water", "electricity"],
        labels=labels,
    )


def test_build_label_map_normalises_labels():
    labels = build_label_map([_Level(1, "Critical"), _Level(3, "Operational Warning")])
    assert labels == {"critical": 1, "operational_warning": 3}


def test_specific_rule_resolves_label_to_integer():
    ast = _parser().parse("if hospital is critical then tank is critical")
    assert ast["type"] == "specific"
    then_assign = ast["then"]["assignments"][0]
    assert then_assign["value"] == 1            # 'critical' -> 1
    assert then_assign["raw_value"] == "critical"  # verbatim preserved
    assert then_assign["name"] == "tank"


def test_element_ids_matched_exactly_not_normalised():
    # 'PumpA' is a canonical ID; it is kept verbatim, NOT lowercased.
    ast = _parser().parse("if PumpA is operational then hospital is critical")
    cond = ast["condition"]
    assert cond["name"] == "PumpA"       # exact ID, no case-folding
    assert cond["raw_name"] == "PumpA"
    assert cond["node_type"] == "node"


def test_wrong_case_id_does_not_resolve_as_node():
    # 'pumpa' is NOT the registry ID 'PumpA'; exact matching must not collapse them.
    ast = _parser().parse("best_of(pumpa) propagates to hospital")
    assert ast["function"]["arguments"][0]["type"] == "reference_unknown"


def test_integer_functionality_comparison():
    ast = _parser().parse("if hospital.functionality is <2 then tank is critical")
    cond = ast["condition"]
    assert cond["attribute"] == "functionality"
    assert cond["operator"] == "<"
    assert cond["value"] == 2


def test_unknown_label_raises_rule_ignored():
    with pytest.raises(RuleIgnored, match="Unknown Functionality label"):
        _parser().parse("if hospital is meltdown then tank is critical")


def test_boolean_and_or_not_condition():
    ast = _parser().parse(
        "if hospital is critical and not tank is operational then PumpA is critical"
    )
    assert ast["condition"]["type"] == "and"
    assert ast["condition"]["right"]["type"] == "not"


def test_intracategorical_rule_detected():
    ast = _parser().parse("best_of(hospital, tank) propagates to PumpA")
    assert ast["type"] == "intracategorical"
    assert ast["function"]["name"] == "best_of"
    assert ast["target_node"] == "PumpA"       # exact ID
    assert ast["raw_target_node"] == "PumpA"


def test_intercategorical_rule_detected_via_category_ref():
    ast = _parser().parse("worst_of(water, electricity) propagates to hospital")
    assert ast["type"] == "intercategorical"
    args = ast["function"]["arguments"]
    assert {a["type"] for a in args} == {"reference_category"}


def test_categories_are_case_insensitive():
    # Categories are human vocabulary -> matched case-insensitively, resolved to
    # their canonical name.
    ast = _parser().parse("worst_of(Water, ELECTRICITY) propagates to hospital")
    args = ast["function"]["arguments"]
    assert all(a["type"] == "reference_category" for a in args)
    assert {a["name"] for a in args} == {"water", "electricity"}  # canonical
    assert ast["type"] == "intercategorical"


def test_reference_classification_node_edge_category_unknown():
    ast = _parser().parse("worst_of(tank, e1, water, ghost) propagates to hospital")
    by_name = {a["name"]: a["type"] for a in ast["function"]["arguments"]}
    assert by_name["tank"] == "reference_node"
    assert by_name["e1"] == "reference_edge"
    assert by_name["water"] == "reference_category"
    assert by_name["ghost"] == "reference_unknown"


def test_missing_then_is_syntax_error():
    with pytest.raises(RuleSyntaxError, match="must contain 'then'"):
        _parser().parse("if hospital is critical")


def test_non_if_specific_shape_is_syntax_error():
    with pytest.raises(RuleSyntaxError, match="must start with 'if'"):
        _parser().parse("hospital is critical then tank is critical")
