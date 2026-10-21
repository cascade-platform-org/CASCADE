"""Provenance — what LLM Design or an agent added, and whether a person has confirmed it (ADR-0022, ADR-0024)."""

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class Provenance(BaseModel):
    """The mark on a node, edge, Event or Expectation that LLM Design or an agent added.

    An LLM's frequency or vulnerability is a guess that looks like a measurement;
    this keeps the difference visible until a person confirms it. Client-side
    only: the engine never reads it.
    """
    model_config = ConfigDict(extra="forbid")

    origin: Literal["llm_design", "agent"] = Field(
        ..., description="`llm_design`: pasted into LLM Design; `agent`: a Proposal an agent made through the Agent Bridge.",
    )
    rationale: Optional[str] = Field(default=None, description="Why it was added: the change's `why`.")
    confirmed: bool = Field(default=False, description="True once a person has confirmed it.")
