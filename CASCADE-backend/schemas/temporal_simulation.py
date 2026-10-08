"""
schemas/temporal_simulation.py — a project's Temporal Simulation (ADR-0019).

One document per project, at `Project.temporal_simulation`: the Timeline, the
profile and the Metrics. It is input only; a run is computed client-side on its
own copy and is not saved. The same document is the plain-text form the window
copies and pastes (ADR-0019 §7), so every object forbids unknown keys: a
misspelt key is an error.

References this project may not satisfy (an unknown Event id, a missing
Element, a filter matching nothing) are warnings in the window, never schema
errors, so a document survives an Element being deleted.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from schemas.config import AttributeOperation, ElementFilter

CalendarUnit = Literal["hour", "day", "week", "month", "quarter", "year", "none"]


class PhaseEvent(BaseModel):
    """An Event a Phase fires: every period of its Step, or the Step's periods N, 2N, 3N…"""
    model_config = ConfigDict(extra="forbid")

    event: str = Field(..., min_length=1, description="EventDefinition id.")
    every: int = Field(default=1, ge=1)


class Phase(BaseModel):
    """Lets time pass, applies its Events, then optionally runs one Propagation."""
    model_config = ConfigDict(extra="forbid")

    events: list[PhaseEvent] = Field(
        default_factory=list,
        description="A bare Event id is accepted and read as {event: id, every: 1}.",
    )
    propagate: bool = True
    advance_hours: int = Field(
        default=0, ge=0,
        description=(
            "Hours that pass at the start of the Phase, before its Events: every "
            "positive Functionality Time counts down and an expired one drops to "
            "Functionality 1, as the Time control does. 0: no time passes."
        ),
    )

    @field_validator("events", mode="before")
    @classmethod
    def _bare_ids(cls, value: object) -> object:
        if isinstance(value, list):
            return [{"event": v, "every": 1} if isinstance(v, str) else v for v in value]
        return value


class Step(BaseModel):
    """One period, or the same period pattern repeated; with a unit, repeats advance the label."""
    model_config = ConfigDict(extra="forbid")

    label: str = Field(..., min_length=1)
    unit: CalendarUnit
    repeat: int = Field(default=1, ge=1)
    phases: list[Phase]


class Timeline(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    steps: list[Step]


MetricAggregate = Literal["sum", "mean", "min", "max", "count", "share_where", "percentile"]
Comparison = Literal["<", "<=", ">", ">=", "==", "!="]


class ValueFilter(BaseModel):
    """Keeps only values passing the comparison; also the predicate of `share_where`."""
    model_config = ConfigDict(extra="forbid")

    cmp: Comparison
    value: float


class Metric(BaseModel):
    """A view definition evaluated per period over the run record (ADR-0019 §4)."""
    model_config = ConfigDict(extra="forbid")

    name: str
    target: ElementFilter
    path: list[str] = Field(..., min_length=1)
    read: Literal["state", "change"]
    phase: Optional[int] = Field(
        default=None, ge=1,
        description="For `change`: the 1-based Phase whose diff is read; absent = the whole period.",
    )
    aggregate: MetricAggregate
    percentile: Optional[float] = Field(default=None, ge=0, le=100, description="For `percentile`.")
    value_filter: Optional[ValueFilter] = None


StandardMetric = Literal["operativity", "coverage", "stock_level"]
STANDARD_METRICS: tuple[StandardMetric, ...] = ("operativity", "coverage", "stock_level")


class TemporalSimulation(BaseModel):
    """The whole definition: Timeline, profile and Metrics."""
    model_config = ConfigDict(extra="forbid")

    format: Literal["cascade.temporal-simulation/v1"]
    timeline: Timeline
    profile: dict[str, list[AttributeOperation]] = Field(
        default_factory=dict,
        description="Period label → operations applied at the start of that period, in order.",
    )
    metrics: list[Metric] = Field(default_factory=list)
    standard_metrics: list[StandardMetric] = Field(
        default_factory=lambda: list(STANDARD_METRICS),
        description=(
            "The standard Metrics the run's table shows before the project's own "
            "(ADR-0019 §4): the Operativity Score, coverage per Category, stock "
            "level per Category. All three when absent."
        ),
    )
