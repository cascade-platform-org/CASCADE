"""A Series: project-wide numbers by Element and period label (ADR-0019, revised
2026-10-12). An Attribute Operation reads one as a factor of its operand
(`series`), at the label of the period being run; the `*` row serves Elements
without a row of their own. A missing value refuses the write. Client data: the
Propagation request leaves it out and the engine never reads it. Mirrors
`CASCADE-app/lib/schemas/series.ts`.
"""

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from schemas.field_path import SafeKey
from schemas.operand import FiniteFloat, OperandName

ALL_ELEMENTS = "*"


class Series(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: OperandName
    unit: Optional[str] = None
    description: Optional[str] = None
    rows: dict[SafeKey, dict[SafeKey, FiniteFloat]] = Field(
        default_factory=dict,
        description="Row key (an Element id, or '*' for every Element without a row of its own) → period label → number.",
    )
