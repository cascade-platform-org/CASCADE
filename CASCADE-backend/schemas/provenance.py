"""Provenance — what LLM Design added, and whether a person has confirmed it (ADR-0022)."""

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class Provenance(BaseModel):
    """The mark on a node, edge or Event that LLM Design added.

    An LLM's frequency or vulnerability is a guess that looks like a measurement;
    this keeps the difference visible until a person confirms it. Client-side
    only: the engine never reads it.
    """
    model_config = ConfigDict(extra="forbid")

    origin: Literal["llm_design"]
    rationale: Optional[str] = Field(default=None, description="Why it was added: the change's `why`.")
    confirmed: bool = Field(default=False, description="True once a person has confirmed it.")
