"""A path into an Element's fields, as Attribute Operations, Metrics and Graph
Diffs address it (ADR-0021).

The frontend follows a path with `record[key]`, where `__proto__`,
`constructor` and `prototype` reach the object's prototype instead of a field,
so a path holding one is refused here too. Mirrors
`CASCADE-app/lib/schemas/field-path.ts`.
"""

from typing import Annotated

from pydantic import AfterValidator, Field

UNSAFE_KEYS = frozenset({"__proto__", "constructor", "prototype"})


def _safe_key(key: str) -> str:
    if key in UNSAFE_KEYS:
        raise ValueError("__proto__, constructor and prototype cannot be field names")
    return key


SafeKey = Annotated[str, AfterValidator(_safe_key)]
FieldKey = Annotated[str, Field(min_length=1), AfterValidator(_safe_key)]
FieldPath = Annotated[list[FieldKey], Field(min_length=1)]
