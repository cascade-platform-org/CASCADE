"""Provenance — what LLM Design or a Workbook import added, and whether a person has
confirmed it (ADR-0022, ADR-0023)."""

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

ProvenanceOrigin = Literal["llm_design", "spreadsheet"]


class SourceLocator(BaseModel):
    """The Workbook row a record came from."""
    model_config = ConfigDict(extra="forbid")

    file: str = Field(..., min_length=1, max_length=255)
    sheet: str = Field(..., min_length=1, max_length=255)
    row: int = Field(..., ge=1)


class Provenance(BaseModel):
    """The mark on a node, edge or Event that LLM Design or a Workbook import added.

    An LLM's frequency or vulnerability is a guess that looks like a measurement;
    this keeps the difference visible until a person confirms it. Client-side
    only: the engine never reads it.
    """
    model_config = ConfigDict(extra="forbid")

    origin: ProvenanceOrigin
    rationale: Optional[str] = Field(default=None, description="Why it was added: the change's `why`.")
    confirmed: bool = Field(default=False, description="True once a person has confirmed it.")
    source: Optional[SourceLocator] = Field(default=None, description="For a spreadsheet: the file, sheet and row.")

    @model_validator(mode="after")
    def _source_only_from_a_spreadsheet(self) -> "Provenance":
        if self.source is not None and self.origin != "spreadsheet":
            raise ValueError("`source` is only for origin \"spreadsheet\"")
        return self
