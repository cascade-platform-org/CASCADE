"""An Expectation: what a person knows their system does, stated so it can be checked (ADR-0023).

A project keeps any number at `Project.expectations`. Each one is the person's
own sentence (`statement`) and a `check` the app runs on a copy of the model:

- `scenario`: apply these Events to the Reset model, Propagate, optionally let
  hours pass and Propagate again, then assert on Elements' fields;
- `simulation`: run one of the project's Temporal Simulations and compare one
  column of its Run table, at a period or as a statistic, with a value.

A result is computed when the check runs and never stored. An Expectation an
LLM or agent wrote carries `provenance`, unconfirmed until the person says the
statement is true of their system. Client data: the Propagation request leaves
it out and the engine never reads it. Mirrors `CASCADE-app/lib/schemas/expectation.ts`.
"""

from __future__ import annotations

from typing import Annotated, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator

from schemas.config import ElementFilter
from schemas.field_path import FieldPath
from schemas.operand import FiniteFloat
from schemas.provenance import Provenance
from schemas.temporal_simulation import Comparison, SimulationScope

ExpectationStatistic = Literal["end", "mean", "min", "max", "total"]


class ElementAssertion(BaseModel):
    """A comparison every (or any) selected Element's field must pass after the scenario."""
    model_config = ConfigDict(extra="forbid")

    element: Optional[str] = Field(default=None, min_length=1, description="One Element, by id.")
    where: Optional[ElementFilter] = Field(default=None, description="Or every Element the filter selects.")
    quantifier: Literal["all", "any"] = Field(
        default="all", description="With `where`: every match must pass, or at least one.",
    )
    path: FieldPath = Field(default_factory=lambda: ["functionality"])
    cmp: Comparison
    value: Union[bool, FiniteFloat, str] = Field(
        ..., description="A number, a boolean, or a Functionality scale label (read as its level).",
    )

    @model_validator(mode="after")
    def _one_target(self) -> "ElementAssertion":
        if (self.element is None) == (self.where is None):
            raise ValueError("an assertion names exactly one of `element` and `where`")
        return self


class ScenarioCheck(BaseModel):
    """Events on the Reset model, a Propagation, optionally hours passing and a second Propagation."""
    model_config = ConfigDict(extra="forbid")

    kind: Literal["scenario"]
    events: list[str] = Field(default_factory=list, description="EventDefinition ids, applied in order.")
    advance_hours: int = Field(
        default=0, ge=0,
        description="Hours that pass after the first Propagation (a Temporal Jump), followed by a second one.",
    )
    scope: SimulationScope = "global"
    canvas: Optional[str] = Field(default=None, min_length=1, description="For `local`: the Canvas id.")
    assertions: list[ElementAssertion] = Field(..., min_length=1)

    @model_validator(mode="after")
    def _canvas_with_local_scope(self) -> "ScenarioCheck":
        if (self.scope == "local") != (self.canvas is not None):
            raise ValueError("a local scope needs `canvas`, and only a local scope takes one")
        return self


class SimulationCheck(BaseModel):
    """One column of a Temporal Simulation's Run table, at a period or as a statistic of the run."""
    model_config = ConfigDict(extra="forbid")

    kind: Literal["simulation"]
    simulation: str = Field(..., min_length=1, description="The Temporal Simulation's id.")
    column: str = Field(..., min_length=1, description="The Run table column, as the table names it.")
    period: Optional[str] = Field(default=None, min_length=1, description="A period label.")
    statistic: Optional[ExpectationStatistic] = Field(default=None, description="Or a statistic over the run.")
    cmp: Comparison
    value: FiniteFloat
    tolerance: FiniteFloat = Field(
        default=0, ge=0, description="`==` passes within it, `!=` outside it; the other comparisons ignore it.",
    )

    @model_validator(mode="after")
    def _one_reading(self) -> "SimulationCheck":
        if (self.period is None) == (self.statistic is None):
            raise ValueError("a simulation check reads exactly one of `period` and `statistic`")
        return self


ExpectationCheck = Annotated[Union[ScenarioCheck, SimulationCheck], Field(discriminator="kind")]


class Expectation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(..., min_length=1)
    statement: str = Field(..., min_length=1, description="The person's own words.")
    check: ExpectationCheck
    provenance: Optional[Provenance] = None
