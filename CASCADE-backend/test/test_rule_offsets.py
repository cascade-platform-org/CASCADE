"""Level offsets on rule terms (ADR-0025): `worst_of(a, b) + 1`, `best_of(a, b) - 1`.

Parsing (core/rule_parser.py) and evaluation (engine/logical.apply_offset via
the nested-rule path) are tested together because the feature is one contract:
what the author writes is what the engine computes.
"""
import itertools

import pytest

from core.rule_parser import RuleParser, RuleSyntaxError, extract_function_references
from engine.logical import apply_offset
from engine.propagation import run
from schemas.config import (
    CategoryDefinition,
    ConfigMeta,
    FunctionalityScaleLevel,
    ModelConfiguration,
)
from schemas.network import (
    Canvas,
    CategoryDependencyProfile,
    Edge,
    Graph,
    Node,
    Project,
    ProjectMeta,
)
from schemas.results import PropagationRequest

N = 4


# --- parsing ------------------------------------------------------------------


def _parser() -> RuleParser:
    return RuleParser(
        node_ids=["a", "b", "c", "hub", "pump-1"],
        categories=["water", "power"],
        element_labels={"Mixed Hub": "hub"},
    )


def _function(rule: str):
    ast = _parser().parse(rule)
    assert ast["type"] in ("intracategorical", "intercategorical")
    return ast["function"]


@pytest.mark.parametrize("written, offset", [
    ("+ 1", 1), ("+1", 1), ("- 2", -2), ("-2", -2), ("+ 3", 3),
    ("+ 12", 12), ("-250", -250),       # any whole number: the scale clamps, not the grammar
])
def test_offset_after_the_outer_function(written, offset):
    fn = _function(f"worst_of(water, power) {written} propagates to hub")
    assert fn["offset"] == offset
    assert all("offset" not in arg for arg in fn["arguments"])


def test_offset_after_a_nested_function():
    fn = _function("worst_of(best_of(water, power) - 1, a) propagates to hub")
    assert fn["arguments"][0]["offset"] == -1
    assert "offset" not in fn["arguments"][1]
    assert "offset" not in fn


@pytest.mark.parametrize("written", ["a+1", "a +1", "a + 1", "a+ 1"])
def test_offset_on_a_reference_in_every_spelling(written):
    fn = _function(f"worst_of({written}, b) propagates to hub")
    assert fn["arguments"][0] == {"type": "reference_node", "name": "a", "raw_name": "a", "offset": 1}


@pytest.mark.parametrize("written, offset", [("a+17", 17), ("a -40", -40), ("a+ 305", 305)])
def test_multi_digit_offsets_on_a_reference(written, offset):
    fn = _function(f"worst_of({written}, b) propagates to hub")
    assert fn["arguments"][0]["offset"] == offset


def test_glued_offset_on_a_spaced_display_label():
    fn = _function("worst_of(Mixed Hub-1, a) propagates to hub")
    assert fn["arguments"][0]["name"] == "hub"
    assert fn["arguments"][0]["offset"] == -1


def test_a_name_that_exists_as_written_is_never_split():
    # An element may be called "pump-1": exact names win over offsets.
    fn = _function("worst_of(pump-1, a) propagates to hub")
    assert fn["arguments"][0] == {"type": "reference_node", "name": "pump-1", "raw_name": "pump-1"}


def test_an_unknown_glued_name_stays_one_unknown_reference():
    # "zz" is not a name, so "zz+1" is a typo and is reported as written.
    fn = _function("worst_of(zz+1, water) propagates to hub")
    assert fn["arguments"][0] == {"type": "reference_unknown", "name": "zz+1", "raw_name": "zz+1"}


def test_rule_kind_and_references_are_unchanged_by_offsets():
    ast = _parser().parse("worst_of(water + 1, best_of(a, b) - 1) - 1 propagates to hub")
    assert ast["type"] == "intercategorical"
    assert extract_function_references(ast["function"]) == ["water", "a", "b"]
    assert _parser().parse("worst_of(a, b) + 1 propagates to hub")["type"] == "intracategorical"


@pytest.mark.parametrize("rule, message", [
    ("worst_of(a + 1 - 1, b) propagates to hub", "Only one offset per term"),
    ("worst_of(a, b) + 1 + 1 propagates to hub", "Only one offset per term"),
    ("worst_of(a + 1.5, b) propagates to hub", "whole number"),
    ("worst_of(a + 0, b) propagates to hub", "at least one level"),
    ("worst_of(a +, b) propagates to hub", "whole number after"),
    ("worst_of(a + x, b) propagates to hub", "whole number after"),
    ("worst_of(a+, b) propagates to hub", "whole number after"),
])
def test_malformed_offsets_are_syntax_errors(rule, message):
    with pytest.raises(RuleSyntaxError, match=message):
        _parser().parse(rule)


# --- the offset arithmetic ------------------------------------------------------


def test_plus_absorbs_and_clamps_at_nominal_dropping_blame():
    assert apply_offset(2, {"x": 1.0}, 1, N) == (3, {"x": 1.0})
    assert apply_offset(3, {"x": 1.0}, 1, N) == (4, {})
    assert apply_offset(1, {"x": 1.0}, 5, N) == (4, {})


def test_minus_amplifies_a_deviation_and_clamps_at_one():
    assert apply_offset(3, {"x": 1.0}, -1, N) == (2, {"x": 1.0})
    assert apply_offset(2, {"x": 1.0}, -3, N) == (1, {"x": 1.0})


def test_minus_leaves_a_nominal_term_nominal():
    assert apply_offset(N, {}, -1, N) == (N, {})


@pytest.mark.parametrize("level, offset, n, expected", [
    (6, 3, 10, 9), (6, 4, 10, 10), (6, -4, 10, 2), (6, -40, 10, 1), (10, -7, 10, 10), (2, 250, 7, 7),
])
def test_offsets_work_for_any_size_on_any_scale(level, offset, n, expected):
    assert apply_offset(level, {}, offset, n)[0] == expected


# --- evaluation through the engine ----------------------------------------------


def _config(categories) -> ModelConfiguration:
    return ModelConfiguration(
        version="1", meta=ConfigMeta(name="t"),
        functionality_scale=[
            FunctionalityScaleLevel(level=lv, label=label, color="#000")
            for lv, label in enumerate(("not performed", "severe", "variable", "nominal"), start=1)
        ],
        categories=[CategoryDefinition(name=c, category_type="Requisite") for c in categories],
    )


def _hub(levels: dict[str, int], rules: list[str], profiles=None):
    """Sources s_<cat> at the given levels, each feeding `hub` in its own category.
    Returns (hub level or N when untouched, hub responsibility, warnings)."""
    nodes = [Node(id=f"s_{c}", functionality=lv, node_categories=[c]) for c, lv in levels.items()]
    nodes.append(Node(id="hub", functionality=N, rules=rules, category_dependency_profiles=profiles))
    edges = [Edge(id=f"e_{c}", source=f"s_{c}", target="hub", functionality=N) for c in levels]
    project = Project(
        version="2.0", meta=ProjectMeta(name="p"),
        nodes={x.id: x for x in nodes}, edges={e.id: e for e in edges},
        canvases=[Canvas(id="c", graph=Graph(graph_type="g", node_ids=[x.id for x in nodes],
                                              edge_ids=[e.id for e in edges]))],
    )
    result = run(PropagationRequest(project=project, config=_config(levels), scope="global"))
    hub = next((u for u in result.updates if u.id == "hub"), None)
    return (hub.functionality, hub.responsibility_share) if hub else (N, {}), result.warnings


def test_a_flat_rule_with_an_offset_takes_the_expression_path():
    (level, blame), warnings = _hub({"water": 3, "power": 4}, ["worst_of(water, power) - 1 propagates to hub"])
    assert warnings == []
    assert level == 2
    assert blame == {"s_water": 1.0}


def test_plus_one_equals_one_level_of_dependency_damping():
    for lv in range(1, N + 1):
        by_rule, _ = _hub({"water": lv}, ["worst_of(water) + 1 propagates to hub"])
        by_profile, _ = _hub({"water": lv}, [], {"water": CategoryDependencyProfile(dependency_level=N - 1)})
        assert by_rule == by_profile, lv


def test_offsets_apply_after_the_dependency_level():
    (level, _), _ = _hub({"water": 1}, ["worst_of(water) + 1 propagates to hub"],
                         {"water": CategoryDependencyProfile(dependency_level=N - 1)})
    assert level == 3


RESONANCE = ("worst_of(worst_of(a, b, c) + 1, "
             "worst_of(best_of(a, b), best_of(a, c), best_of(b, c))) propagates to hub")


def test_resonance_rule_is_min_of_worst_plus_one_and_second_worst():
    """The rule that replaces damped copy nodes in the FRAM translation: one
    deviating input is absorbed by a level, two coinciding ones pass."""
    for lv in itertools.product(range(1, N + 1), repeat=3):
        (level, _), warnings = _hub(dict(zip("abc", lv)), [RESONANCE])
        ordered = sorted(lv)
        assert warnings == []
        assert level == min(N, ordered[0] + 1, ordered[1]), lv


def test_resonance_rule_matches_the_damped_copy_encoding():
    """Same function, written the way it had to be before offsets: each input
    re-enters through a copy node damped by a dependency level."""
    for lv in itertools.product(range(1, N + 1), repeat=3):
        nodes = [Node(id=f"s_{c}", functionality=v, node_categories=[c]) for c, v in zip("abc", lv)]
        edges = [Edge(id=f"e_{c}", source=f"s_{c}", target="hub", functionality=N) for c in "abc"]
        for c in "abc":
            nodes.append(Node(id=f"d_{c}", functionality=N, node_categories=[f"dmp_{c}"],
                              category_dependency_profiles={c: CategoryDependencyProfile(dependency_level=N - 1)}))
            edges += [Edge(id=f"ed_{c}", source=f"s_{c}", target=f"d_{c}", functionality=N),
                      Edge(id=f"eh_{c}", source=f"d_{c}", target="hub", functionality=N)]
        nodes.append(Node(id="hub", functionality=N, rules=[
            "worst_of(dmp_a, dmp_b, dmp_c, best_of(a, b), best_of(a, c), best_of(b, c)) propagates to hub"]))
        project = Project(
            version="2.0", meta=ProjectMeta(name="p"),
            nodes={x.id: x for x in nodes}, edges={e.id: e for e in edges},
            canvases=[Canvas(id="c", graph=Graph(graph_type="g", node_ids=[x.id for x in nodes],
                                                  edge_ids=[e.id for e in edges]))],
        )
        config = _config(["a", "b", "c", "dmp_a", "dmp_b", "dmp_c"])
        copies = run(PropagationRequest(project=project, config=config, scope="global"))
        hub = next((u.functionality for u in copies.updates if u.id == "hub"), N)
        (level, _), _ = _hub(dict(zip("abc", lv)), [RESONANCE])
        assert level == hub, lv


def test_cumulative_term_needs_a_third_deviation():
    """Third worst minus one: three coinciding deviations cost a level more,
    and a nominal third input leaves the function where resonance put it."""
    rule = ("worst_of(worst_of(a, b, c) + 1, worst_of(best_of(a, b), best_of(a, c), best_of(b, c)), "
            "best_of(a, b, c) - 1) propagates to hub")
    assert _hub({"a": 4, "b": 4, "c": 4}, [rule])[0][0] == 4
    assert _hub({"a": 3, "b": 3, "c": 4}, [rule])[0][0] == 3
    assert _hub({"a": 3, "b": 3, "c": 3}, [rule])[0][0] == 2
    assert _hub({"a": 1, "b": 1, "c": 3}, [rule])[0][0] == 1


def test_a_term_lifted_to_nominal_blames_nobody():
    (level, blame), _ = _hub({"water": 3, "power": 3},
                             ["worst_of(water + 1, power) propagates to hub"])
    assert level == 3
    assert blame == {"s_power": 1.0}
