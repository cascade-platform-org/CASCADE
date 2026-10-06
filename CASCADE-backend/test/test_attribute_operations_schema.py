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
        ({"element": "a", "path": ["x", ""], "op": "set", "value": 1}, "cannot be empty"),
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
