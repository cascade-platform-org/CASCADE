"""Field paths refuse the keys that reach a JavaScript prototype (schemas/field_path.py)."""

import pytest
from pydantic import ValidationError

from schemas.config import AttributeOperation
from schemas.field_path import UNSAFE_KEYS
from schemas.network import FieldChange


@pytest.mark.parametrize("key", sorted(UNSAFE_KEYS))
def test_unsafe_key_refused_at_any_depth(key: str) -> None:
    for path in ([key], ["properties", key], ["properties", key, "x"]):
        with pytest.raises(ValidationError, match="cannot be field names"):
            AttributeOperation(element="a", path=path, op="set", value=1)
        with pytest.raises(ValidationError, match="cannot be field names"):
            FieldChange(field="properties", path=path, before=0, after=1)


def test_ordinary_path_kept_and_empty_segment_refused() -> None:
    assert AttributeOperation(element="a", path=["supply_capacity", "water"], op="set", value=1).path == ["supply_capacity", "water"]
    with pytest.raises(ValidationError):
        AttributeOperation(element="a", path=["properties", ""], op="set", value=1)
