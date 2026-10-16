"""Names and numbers an Attribute Operation's operand reads (ADR-0021, revised
2026-10-12): Parameter and Series names, and the finite numbers they hold.

A name is an identifier, so it works unchanged as a sheet header
(`param:<name>`), a sheet title (`S·<name>`) and in LLM text. Mirrors
`CASCADE-app/lib/schemas/operand.ts`.
"""

from typing import Annotated

from pydantic import Field, StringConstraints

from schemas.field_path import SafeKey

OPERAND_NAME_PATTERN = r"^[A-Za-z_][A-Za-z0-9_]{0,63}$"

OperandName = Annotated[SafeKey, StringConstraints(pattern=OPERAND_NAME_PATTERN)]
FiniteFloat = Annotated[float, Field(allow_inf_nan=False)]


def duplicate_names(names: list[str]) -> list[str]:
    """Names that occur more than once, in first-repeat order."""
    seen: set[str] = set()
    repeated: list[str] = []
    for name in names:
        if name in seen and name not in repeated:
            repeated.append(name)
        seen.add(name)
    return repeated
