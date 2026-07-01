"""Tests for rule evaluation: specific overrides, intra/inter re-parameterisation,
and arithmetic conditions over any field.
"""
from engine.propagation import run
from engine.rules_eval import RuleContext, eval_condition
from schemas.config import (
    CategoryDefinition,
    ConfigMeta,
    FunctionalityScaleLevel,
    ModelConfiguration,
)
from schemas.network import (
    Canvas,
    Edge,
    Graph,
    Node,
    Project,
    ProjectMeta,
)
from schemas.results import PropagationRequest

N = 3


def _cfg(categories):
    return ModelConfiguration(
        version="1", meta=ConfigMeta(name="t"),
        functionality_scale=[
            FunctionalityScaleLevel(level=1, label="critical", color="#000"),
            FunctionalityScaleLevel(level=2, label="warning", color="#111"),
            FunctionalityScaleLevel(level=3, label="operational", color="#222"),
        ],
        categories=[CategoryDefinition(name=k, category_type=v) for k, v in categories.items()],
    )


def _run(nodes, edges, categories):
    proj = Project(
        version="2.0", meta=ProjectMeta(name="p"),
        nodes={x.id: x for x in nodes}, edges={e.id: e for e in edges},
        canvases=[Canvas(id="c", graph=Graph(graph_type="g",
                  node_ids=[x.id for x in nodes], edge_ids=[e.id for e in edges]))],
    )
    res = run(PropagationRequest(project=proj, config=_cfg(categories), scope="global"))
    return {u.id: u for u in res.updates}, res


# --- condition evaluation ---------------------------------------------------


def test_arithmetic_condition_greater_than():
    ast = {"type": "attribute_condition", "node_type": "node", "name": "a",
           "attribute": "functionality", "operator": ">", "value": 2}
    assert eval_condition(ast, lambda nt, name, attr: 3) is True
    assert eval_condition(ast, lambda nt, name, attr: 2) is False


def test_and_or_not_conditions():
    def resolve(_nt, name, _attr):
        return {"a": 1, "b": 3}[name]
    a_lt2 = {"type": "attribute_condition", "node_type": "node", "name": "a", "attribute": "functionality", "operator": "<", "value": 2}
    b_eq3 = {"type": "attribute_condition", "node_type": "node", "name": "b", "attribute": "functionality", "operator": "=", "value": 3}
    assert eval_condition({"type": "and", "left": a_lt2, "right": b_eq3}, resolve) is True
    assert eval_condition({"type": "not", "operand": a_lt2}, resolve) is False


# --- specific rule override -------------------------------------------------


def test_specific_rule_forces_target_critical():
    # B is healthy with no failing input, but a specific rule on B forces it
    # critical when A is critical.
    a = Node(id="a", functionality=1, node_categories=["x"])
    b = Node(id="b", functionality=3, rules=["if a is critical then b is critical"])
    by_id, _ = _run([a, b], [], {"x": "Requisite"})
    assert by_id["b"].functionality == 1
    assert by_id["b"].responsibility_share == {"a": 1.0}


def test_specific_rule_cannot_improve_monotone():
    # A rule that "sets" a healthy node to operational is a no-op (can't improve).
    a = Node(id="a", functionality=2, node_categories=["x"],
             rules=["if a is warning then a is operational"])
    by_id, _ = _run([a], [], {"x": "Requisite"})
    assert "a" not in by_id  # monotone commit blocks the improvement


def test_specific_rule_arithmetic_condition():
    a = Node(id="a", functionality=2, node_categories=["x"])
    b = Node(id="b", functionality=3, rules=["if a.functionality is <3 then b is critical"])
    by_id, _ = _run([a, b], [], {"x": "Requisite"})
    assert by_id["b"].functionality == 1


# --- intercategorical re-parameterisation -----------------------------------


def _consumer_two_cats(rules=None):
    return Node(id="hub", functionality=3, node_categories=["water", "power"], rules=rules)


def test_intercategorical_default_worst_of():
    # Without a rule: water=1, power healthy -> worst_of -> 1.
    w = Node(id="w", functionality=1, node_categories=["water"])
    p = Node(id="p", functionality=3, node_categories=["power"])
    hub = _consumer_two_cats()
    edges = [Edge(id="ew", source="w", target="hub", functionality=3),
             Edge(id="ep", source="p", target="hub", functionality=3)]
    by_id, _ = _run([w, p, hub], edges, {"water": "Requisite", "power": "Requisite"})
    assert by_id["hub"].functionality == 1


def test_intercategorical_rule_loosens_to_average():
    # Same graph, but a rule lets the hub run on the average of its categories:
    # average_of(water=1, power=3) = floor(2.0) = 2 instead of worst_of = 1.
    w = Node(id="w", functionality=1, node_categories=["water"])
    p = Node(id="p", functionality=3, node_categories=["power"])
    hub = _consumer_two_cats(rules=["average_of(water, power) propagates to hub"])
    edges = [Edge(id="ew", source="w", target="hub", functionality=3),
             Edge(id="ep", source="p", target="hub", functionality=3)]
    by_id, _ = _run([w, p, hub], edges, {"water": "Requisite", "power": "Requisite"})
    assert by_id["hub"].functionality == 2


def test_intercategorical_missing_category_counts_as_full():
    # Only water degraded; power has no candidate. average_of(water=1, power=N=3)
    # = floor(2.0) = 2.
    w = Node(id="w", functionality=1, node_categories=["water"])
    hub = Node(id="hub", functionality=3, node_categories=["water", "power"],
               rules=["average_of(water, power) propagates to hub"])
    edges = [Edge(id="ew", source="w", target="hub", functionality=3)]
    by_id, _ = _run([w, hub], edges, {"water": "Requisite", "power": "Requisite"})
    assert by_id["hub"].functionality == 2


# --- intracategorical re-parameterisation -----------------------------------


def test_intracategorical_rule_overrides_best_of_with_worst_of():
    # Two water suppliers A=3 (healthy), B=1 (critical). Default best_of keeps the
    # consumer at 3; a worst_of rule makes it follow the worst supplier -> 1.
    a = Node(id="a", functionality=3, node_categories=["water"])
    b = Node(id="b", functionality=1, node_categories=["water"])
    c = Node(id="c", functionality=3, node_categories=["water"],
             rules=["worst_of(a, b) propagates to c"])
    edges = [Edge(id="ea", source="a", target="c", functionality=3),
             Edge(id="eb", source="b", target="c", functionality=3)]
    by_id, _ = _run([a, b, c], edges, {"water": "Requisite"})
    assert by_id["c"].functionality == 1


# --- warnings ---------------------------------------------------------------


def test_unknown_label_rule_produces_warning():
    a = Node(id="a", functionality=2, node_categories=["x"],
             rules=["if a is meltdown then a is critical"])
    _, res = _run([a], [], {"x": "Requisite"})
    assert any("meltdown" in w for w in res.warnings)


def test_rulecontext_buckets_kinds():
    a = Node(id="a", functionality=3, node_categories=["water"],
             rules=["if a is critical then a is critical"])
    c = Node(id="c", functionality=3, node_categories=["water"],
             rules=["worst_of(a) propagates to c"])
    ctx = RuleContext({"a": a, "c": c}, [], _cfg({"water": "Requisite"}))
    assert len(ctx.specific) == 1
    assert ctx.intra_operator("c", "water") == "worst_of"


# --- parser + evaluation together: label / spaced-name resolution -----------


def test_specific_rule_resolves_node_by_display_label():
    # The rule names elements by their editor label ("A", "B"), not their ID.
    a = Node(id="a", label="A", functionality=1, node_categories=["x"])
    b = Node(id="b", label="B", functionality=3,
             rules=["if A is critical then B is critical"])
    by_id, _ = _run([a, b], [], {"x": "Requisite"})
    assert by_id["b"].functionality == 1
    assert by_id["b"].responsibility_share == {"a": 1.0}  # blame resolves to the ID


def test_specific_rule_resolves_spaced_display_label():
    # Labels with spaces survive the tokenizer via the protection pre-pass.
    a = Node(id="dc", label="Main Datacenter", functionality=1, node_categories=["x"])
    b = Node(id="ctrl", label="Control Room", functionality=3,
             rules=["if Main Datacenter is critical then Control Room is critical"])
    by_id, _ = _run([a, b], [], {"x": "Requisite"})
    assert by_id["ctrl"].functionality == 1
    assert by_id["ctrl"].responsibility_share == {"dc": 1.0}


def test_intercategorical_rule_with_spaced_category_name():
    # A multi-word category name is kept whole and resolved.
    w = Node(id="w", functionality=1, node_categories=["spare power"])
    p = Node(id="p", functionality=3, node_categories=["water"])
    hub = Node(id="hub", functionality=3, node_categories=["spare power", "water"],
               rules=["average_of(spare power, water) propagates to hub"])
    edges = [Edge(id="ew", source="w", target="hub", functionality=3),
             Edge(id="ep", source="p", target="hub", functionality=3)]
    by_id, _ = _run([w, p, hub], edges, {"spare power": "Requisite", "water": "Requisite"})
    # average_of(1, 3) = floor(2.0) = 2, instead of the default worst_of = 1.
    assert by_id["hub"].functionality == 2


def test_specific_rule_with_spaced_functionality_label_value():
    # "low warning" is a scale label with a space, used as the assigned level.
    cfg = ModelConfiguration(
        version="1", meta=ConfigMeta(name="t"),
        functionality_scale=[
            FunctionalityScaleLevel(level=1, label="critical", color="#000"),
            FunctionalityScaleLevel(level=2, label="low warning", color="#111"),
            FunctionalityScaleLevel(level=3, label="operational", color="#222"),
        ],
        categories=[CategoryDefinition(name="x", category_type="Requisite")],
    )
    a = Node(id="a", functionality=1, node_categories=["x"])
    b = Node(id="b", functionality=3, rules=["if a is critical then b is low warning"])
    proj = Project(
        version="2.0", meta=ProjectMeta(name="p"),
        nodes={"a": a, "b": b}, edges={},
        canvases=[Canvas(id="c", graph=Graph(graph_type="g",
                  node_ids=["a", "b"], edge_ids=[]))],
    )
    res = run(PropagationRequest(project=proj, config=cfg, scope="global"))
    by_id = {u.id: u for u in res.updates}
    assert by_id["b"].functionality == 2  # "low warning" -> level 2
    assert res.warnings == []


# --- parser + evaluation together: boolean conditions through the engine ----


def test_specific_rule_and_condition_through_engine():
    # Both clauses must hold for the rule to fire.
    a = Node(id="a", functionality=1, node_categories=["x"])
    b = Node(id="b", functionality=1, node_categories=["x"])
    c = Node(id="c", functionality=3,
             rules=["if a is critical and b is critical then c is critical"])
    by_id, _ = _run([a, b, c], [], {"x": "Requisite"})
    assert by_id["c"].functionality == 1
    assert by_id["c"].responsibility_share == {"a": 0.5, "b": 0.5}  # blame split


def test_specific_rule_and_condition_does_not_fire_when_one_false():
    a = Node(id="a", functionality=1, node_categories=["x"])
    b = Node(id="b", functionality=3, node_categories=["x"])  # healthy -> not critical
    c = Node(id="c", functionality=3,
             rules=["if a is critical and b is critical then c is critical"])
    by_id, _ = _run([a, b, c], [], {"x": "Requisite"})
    assert "c" not in by_id  # condition false -> no change


def test_specific_rule_or_and_not_through_engine():
    a = Node(id="a", functionality=3, node_categories=["x"])  # healthy
    b = Node(id="b", functionality=1, node_categories=["x"])  # failed
    c = Node(id="c", functionality=3,
             rules=["if not a is critical or b is critical then c is critical"])
    by_id, _ = _run([a, b, c], [], {"x": "Requisite"})
    assert by_id["c"].functionality == 1  # 'not a is critical' is true


# --- parser + evaluation together: precedence and operators -----------------


def test_multiple_specific_rules_worst_level_wins():
    a = Node(id="a", functionality=1, node_categories=["x"])
    b = Node(id="b", functionality=3, rules=[
        "if a is critical then b is warning",
        "if a is critical then b is critical",
    ])
    by_id, _ = _run([a, b], [], {"x": "Requisite"})
    assert by_id["b"].functionality == 1  # worst of {warning=2, critical=1}


def test_intracategorical_average_of_operator():
    # Three suppliers 1/2/3 in one category; average_of -> floor(2.0) = 2,
    # instead of the default best_of = 3.
    a = Node(id="a", functionality=1, node_categories=["water"])
    b = Node(id="b", functionality=2, node_categories=["water"])
    c = Node(id="c", functionality=3, node_categories=["water"])
    d = Node(id="d", functionality=3, node_categories=["water"],
             rules=["average_of(a, b, c) propagates to d"])
    edges = [Edge(id="ea", source="a", target="d", functionality=3),
             Edge(id="eb", source="b", target="d", functionality=3),
             Edge(id="ec", source="c", target="d", functionality=3)]
    by_id, _ = _run([a, b, c, d], edges, {"water": "Requisite"})
    assert by_id["d"].functionality == 2


# --- disabled-rule convention (consistency with the frontend "// " prefix) ---


def test_disabled_rule_is_skipped_without_warning():
    # A "// "-prefixed rule is inactive: the engine neither applies nor warns.
    a = Node(id="a", functionality=1, node_categories=["x"])
    b = Node(id="b", functionality=3,
             rules=["// if a is critical then b is critical"])
    by_id, res = _run([a, b], [], {"x": "Requisite"})
    assert "b" not in by_id      # rule did not fire
    assert res.warnings == []    # and produced no parse warning


def test_enabling_a_disabled_rule_makes_it_fire():
    # The same rule without the prefix is active again — proving the prefix is
    # the only thing toggling it.
    a = Node(id="a", functionality=1, node_categories=["x"])
    b = Node(id="b", functionality=3,
             rules=["if a is critical then b is critical"])
    by_id, _ = _run([a, b], [], {"x": "Requisite"})
    assert by_id["b"].functionality == 1


# --- code-review fixes: robustness of rule resolution -----------------------


def test_noncontiguous_scale_does_not_spuriously_degrade():
    # Scale levels [1, 2, 4] (len 3, max 4): N must be 4, else the dependency
    # guard would clamp a healthy level-4 category down to 3. A healthy supplier
    # feeding a healthy consumer must produce no change.
    cfg = ModelConfiguration(
        version="1", meta=ConfigMeta(name="t"),
        functionality_scale=[
            FunctionalityScaleLevel(level=1, label="critical", color="#000"),
            FunctionalityScaleLevel(level=2, label="warning", color="#111"),
            FunctionalityScaleLevel(level=4, label="operational", color="#222"),
        ],
        categories=[CategoryDefinition(name="water", category_type="Requisite")],
    )
    s = Node(id="s", functionality=4, node_categories=["water"])
    c = Node(id="c", functionality=4, node_categories=["water"])
    edges = [Edge(id="e", source="s", target="c", functionality=4)]
    proj = Project(
        version="2.0", meta=ProjectMeta(name="p"),
        nodes={"s": s, "c": c}, edges={e.id: e for e in edges},
        canvases=[Canvas(id="cv", graph=Graph(graph_type="g",
                  node_ids=["s", "c"], edge_ids=["e"]))],
    )
    res = run(PropagationRequest(project=proj, config=cfg, scope="global"))
    assert res.updates == []  # no spurious degradation from a wrong N


def test_intercategorical_rule_category_spelling_is_case_insensitive():
    # Rule names categories "Water"/"Power"; nodes use "water"/"power". The rule
    # must still apply (categories are case-insensitive vocabulary, ADR-0002).
    w = Node(id="w", functionality=1, node_categories=["water"])
    p = Node(id="p", functionality=3, node_categories=["power"])
    hub = Node(id="hub", functionality=3, node_categories=["water", "power"],
               rules=["average_of(Water, Power) propagates to hub"])
    edges = [Edge(id="ew", source="w", target="hub", functionality=3),
             Edge(id="ep", source="p", target="hub", functionality=3)]
    by_id, _ = _run([w, p, hub], edges, {"water": "Requisite", "power": "Requisite"})
    assert by_id["hub"].functionality == 2  # average_of(1, 3), not worst_of/missing-as-N


def test_unknown_element_in_condition_is_ignored_with_warning():
    # A negated condition over a non-existent element must NOT fire (it would
    # otherwise evaluate True and blame a phantom id).
    b = Node(id="b", functionality=3, node_categories=["x"],
             rules=["if not ghost is critical then b is critical"])
    by_id, res = _run([b], [], {"x": "Requisite"})
    assert "b" not in by_id
    assert any("ghost" in w and "unknown" in w for w in res.warnings)


def test_ambiguous_display_label_is_reported_not_resolved():
    # Two nodes share the label "Pump": a rule naming it resolves to neither.
    p1 = Node(id="p1", label="Pump", functionality=1, node_categories=["x"])
    p2 = Node(id="p2", label="Pump", functionality=3, node_categories=["x"])
    t = Node(id="t", functionality=3, rules=["if Pump is critical then t is critical"])
    by_id, res = _run([p1, p2, t], [], {"x": "Requisite"})
    assert "t" not in by_id
    assert any("ambiguous" in w.lower() for w in res.warnings)


def test_conflicting_intercategorical_rules_warn():
    w = Node(id="w", functionality=1, node_categories=["water"])
    p = Node(id="p", functionality=3, node_categories=["power"])
    hub = Node(id="hub", functionality=3, node_categories=["water", "power"], rules=[
        "average_of(water, power) propagates to hub",
        "worst_of(water, power) propagates to hub",
    ])
    edges = [Edge(id="ew", source="w", target="hub", functionality=3),
             Edge(id="ep", source="p", target="hub", functionality=3)]
    _, res = _run([w, p, hub], edges, {"water": "Requisite", "power": "Requisite"})
    assert any("replaces an earlier intercategorical" in w for w in res.warnings)


# --- node.properties attribute access in specific rule conditions ------------


def test_specific_rule_reads_node_properties_attribute():
    # A node stores a custom boolean in `properties`. A specific rule reads it
    # via dot-notation and fires normally when the value matches.
    flag_node = Node(id="flag", functionality=3, node_categories=["x"],
                     properties={"is_monitored": True})
    target = Node(id="target", functionality=3,
                  rules=["if flag.is_monitored is True then target is critical"])
    by_id, _ = _run([flag_node, target], [], {"x": "Requisite"})
    assert by_id["target"].functionality == 1


def test_specific_rule_properties_guard_prevents_degradation():
    # A failing supplier degrades the target logically to 1. But a specific rule
    # on the target intercepts the proposal: when `is_backup_active` is True, the
    # rule fires and replaces the proposal with "operational" (3). The monotone
    # commit sees 3 >= current (3) and skips — no degradation is committed.
    # This is the guard pattern: the rule prevents the drop, not causes it.
    supplier = Node(id="sup", functionality=1, node_categories=["x"])
    target = Node(id="target", functionality=3, node_categories=["x"],
                  properties={"is_backup_active": True},
                  rules=["if target.is_backup_active is True then target is operational"])
    edge = Edge(id="e", source="sup", target="target", functionality=3)
    by_id, _ = _run([supplier, target], [edge], {"x": "Requisite"})
    assert "target" not in by_id  # guarded: no degradation committed


def test_specific_rule_properties_guard_inactive_when_false():
    # Same topology, but the property is False. The specific rule's condition is
    # False → rule does not fire → the logical proposal (1) stands → degradation commits.
    supplier = Node(id="sup", functionality=1, node_categories=["x"])
    target = Node(id="target", functionality=3, node_categories=["x"],
                  properties={"is_backup_active": False},
                  rules=["if target.is_backup_active is True then target is operational"])
    edge = Edge(id="e", source="sup", target="target", functionality=3)
    by_id, _ = _run([supplier, target], [edge], {"x": "Requisite"})
    assert by_id["target"].functionality == 1  # guard inactive, degradation commits


def test_specific_rule_properties_on_other_node_guards_target():
    # The condition checks a property on a *different* node (water Operator) to
    # guard a third node (Fauglis water Source). This mirrors the rule:
    # "if water Operator.is_communicating_with_electric_operator is True
    #  then Fauglis water Source is operational"
    supplier = Node(id="sup", functionality=1, node_categories=["power"])
    water_op = Node(id="water_op", label="water Operator",
                    functionality=3, node_categories=["water"],
                    properties={"is_communicating_with_electric_operator": True})
    fauglis = Node(id="fauglis", label="Fauglis water Source",
                   functionality=3, node_categories=["water"],
                   rules=["if water Operator.is_communicating_with_electric_operator is True "
                          "then Fauglis water Source is operational"])
    edge = Edge(id="e", source="sup", target="fauglis", functionality=3)
    by_id, _ = _run([supplier, water_op, fauglis], [edge],
                    {"power": "Requisite", "water": "Requisite"})
    assert "fauglis" not in by_id  # guarded by the water Operator property


def test_unknown_label_in_function_arg_warns_but_keeps_rule():
    # 'ghost' is a typo'd element; 'a' validly selects the water category, so the
    # rule still applies (worst_of) but the unknown arg is surfaced.
    a = Node(id="a", functionality=3, node_categories=["water"])
    bn = Node(id="bn", functionality=1, node_categories=["water"])
    c = Node(id="c", functionality=3, node_categories=["water"],
             rules=["worst_of(a, ghost) propagates to c"])
    edges = [Edge(id="ea", source="a", target="c", functionality=3),
             Edge(id="eb", source="bn", target="c", functionality=3)]
    by_id, res = _run([a, bn, c], edges, {"water": "Requisite"})
    assert by_id["c"].functionality == 1  # worst_of applied across the water category
    assert any("ghost" in w for w in res.warnings)
