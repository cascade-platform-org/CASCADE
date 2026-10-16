"""A custom sheet: a person's own sheet in the Workbook, kept in the project with
its values and formulas (ADR-0023 §4a). The spreadsheet app computes it;
CASCADE never evaluates a formula. One that declares the model sheet it
`writes` sends its values to the model through Import changes. Mirrors
`CASCADE-app/lib/schemas/custom-sheet.ts`.
"""

from typing import Annotated, Optional

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

# A spreadsheet's own limits on a sheet name: 1–31 characters, none of []:*?/\,
# and no apostrophe at either end.
SheetName = Annotated[str, StringConstraints(min_length=1, max_length=31, pattern=r"^[^\[\]:*?/\\']([^\[\]:*?/\\]*[^\[\]:*?/\\'])?$")]


class SheetCell(BaseModel):
    """One cell: its value as the spreadsheet stored it, and its formula if any."""
    model_config = ConfigDict(extra="forbid")

    v: float | bool | str | None = Field(default=None, description="The value (the formula's last result); None = empty.")
    f: Optional[str] = Field(default=None, min_length=1, description="The formula, in A1 syntax without the leading '='.")


class CustomSheet(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: SheetName
    writes: Optional[str] = Field(
        default=None,
        min_length=1,
        description="The model sheet whose columns this sheet uses and whose records it writes (e.g. 'Nodes', 'S·demand'); None = analysis only.",
    )
    computed_at: Optional[str] = Field(default=None, description="When the spreadsheet app last computed it (ISO 8601), if known.")
    rows: list[list[Optional[SheetCell]]] = Field(default_factory=list, description="Row by row from A1; None = an empty cell.")
