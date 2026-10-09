"""ADR-0021: an Event's Attribute Operations, as the backend validates them.

The engine never reads them, but the Model Configuration travels with every
Propagation request, so a malformed operation must be rejected here with a
clear message rather than reach anyone as a silent no-op.
"""
import pytest
from pydantic import ValidationError

from schemas.config import AttributeOperation, EventDefinition


def test_accepts_one_element_or_one_filter():
    AttributeOperation(element="pool", path=["supply_capacity", "water"], op="mul", value=0.5)
    AttributeOperation(where={"kind": "node", "node_type": "Service"}, path=["functionality"], op="set", value=1)


@pytest.mark.parametrize(
    "bad, message",
    [
        ({"path": ["x"], "op": "set", "value": 1}, "exactly one of"),
        ({"element": "a", "where": {"kind": "node"}, "path": ["x"], "op": "set", "value": 1}, "exactly one of"),
        ({"element": "a", "path": ["x"], "op": "add", "value": "5"}, "need a number"),
        ({"element": "a", "path": ["x"], "op": "mul", "value": True}, "need a number"),
        ({"element": "a", "path": [], "op": "set", "value": 1}, "at least 1"),
        ({"element": "a", "path": ["x", ""], "op": "set", "value": 1}, "at least 1 character"),
        ({"element": "a", "path": ["x"], "op": "set", "value": 1, "extra": 1}, "Extra inputs"),
        ({"where": {"kind": "node", "typo": 1}, "path": ["x"], "op": "set", "value": 1}, "Extra inputs"),
    ],
)
def test_rejects_malformed_operations(bad, message):
    with pytest.raises(ValidationError, match=message):
        AttributeOperation(**bad)


def test_event_carries_operations_in_order_and_defaults_to_none():
    event = EventDefinition(
        id="e",
        label="Policy",
        type="disservice",
        attribute_operations=[
            {"element": "pool", "path": ["supply_capacity", "water"], "op": "add", "value": 2},
            {"element": "pool", "path": ["supply_capacity", "water"], "op": "at_most", "value": 50},
        ],
    )
    assert [op.op for op in event.attribute_operations or []] == ["add", "at_most"]
    assert EventDefinition(id="f", label="F", type="hazard").attribute_operations is None


def test_attribute_mutations_load_as_set_operations_ahead_of_the_events_own():
    """Retired 2026-10-08 (ADR-0021): a file's mutations become `set` operations,
    one per scalar leaf, before the operations the Event already had."""
    from schemas.config import EventDefinition

    event = EventDefinition.model_validate({
        "id": "e", "label": "e", "type": "disservice",
        "attribute_mutations": {
            "a.b.functionality_time": 6,
            "J2.category_dependency_profiles": {"water": {"demand": 40, "priority": 3}},
        },
        "attribute_operations": [{"element": "x", "path": ["functionality"], "op": "set", "value": 1}],
    })
    assert [op.model_dump(exclude_none=True) for op in event.attribute_operations or []] == [
        {"element": "a.b", "path": ["functionality_time"], "op": "set", "value": 6},
        {"element": "J2", "path": ["category_dependency_profiles", "water", "demand"], "op": "set", "value": 40},
        {"element": "J2", "path": ["category_dependency_profiles", "water", "priority"], "op": "set", "value": 3},
        {"element": "x", "path": ["functionality"], "op": "set", "value": 1},
    ]
    assert "attribute_mutations" not in event.model_dump()
    with pytest.raises(ValidationError, match="no Attribute Operation form"):
        EventDefinition.model_validate({"id": "e", "label": "e", "type": "disservice", "attribute_mutations": {"a.node_categories": ["water"]}})


def test_a_restorative_event_is_an_event_type():
    from schemas.config import EventDefinition

    assert EventDefinition(id="r", label="Repair", type="restorative").type == "restorative"


def test_of_reads_the_operand_from_another_field_and_needs_a_number_factor():
    op = AttributeOperation.model_validate(
        {"element": "a", "path": ["properties", "balance"], "op": "add", "value": -0.5, "of": ["properties", "opening"]}
    )
    assert op.model_dump(exclude_none=True)["of"] == ["properties", "opening"]
    with pytest.raises(ValidationError, match="with `of`, `value` is the factor"):
        AttributeOperation.model_validate({"element": "a", "path": ["p"], "op": "set", "value": "text", "of": ["q"]})
    with pytest.raises(ValidationError):
        AttributeOperation.model_validate({"element": "a", "path": ["p"], "op": "add", "value": 1, "of": ["__proto__"]})
