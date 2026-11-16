from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, model_validator

from .network import Project, ResponsibilityShare, PropagationScorecardEntry, Stock
from .config import ModelConfiguration


# ---------------------------------------------------------------------------
# Propagation request / result
# ---------------------------------------------------------------------------

def _reject_stocks(project: Project) -> None:
    """A Stock never reaches the engine (ADR-0020 §2): the payload builder sends
    its supply number. Refused here as a 422 rather than failing inside a run."""
    for node in project.nodes.values():
        for category, value in (node.supply_capacity or {}).items():
            if isinstance(value, Stock):
                raise ValueError(f"node {node.id}: supply_capacity[{category}] is a Stock; send its supply number")
    for edge in project.edges.values():
        if isinstance(edge.capacity, Stock):
            raise ValueError(f"edge {edge.id}: capacity is a Stock; send its capacity number")


class PropagationRequest(BaseModel):
    """
    Body for POST /api/propagate.
    Hazard effects are applied client-side before this call; the engine
    receives the resulting graph state and propagates cascading failures.
    """
    project: Project
    config: ModelConfiguration
    scope: Literal["local", "global"]
    active_canvas_id: Optional[str] = Field(
        default=None, description="Canvas to restrict propagation when scope = local."
    )
    storage: Optional[dict[str, dict[str, float]]] = Field(
        default=None,
        description=(
            "Storage (ADR-0020 §1c), written by the client's payload builder: node → "
            "Category → the most it may fill this Propagation. That node's "
            "supply_capacity[Category] is then its draw, used only for demand the "
            "other sources cannot cover; filling comes after every consumer."
        ),
    )
    trace: bool = Field(
        default=False,
        description=(
            "Also return `rounds`: what each engine round did, for the Propagation "
            "animation (ADR-0027). Off by default; the rest of the result is the same "
            "either way."
        ),
    )

    @model_validator(mode="after")
    def _numbers_only(self):
        _reject_stocks(self.project)
        return self


MAX_COALITIONS_PER_BATCH = 50


class BatchPropagationRequest(PropagationRequest):
    """
    Body for POST /api/propagate/batch.

    One Project, many Scenarios. Each coalition names the Elements to drive to
    the worst Functionality before propagating; everything else about the run is
    shared. This exists because the model-based Analysis Metrics evaluate
    hundreds of coalitions over an unchanged Project, and sending that Project
    once per coalition dominated the cost of a run.

    The batch is bounded (`MAX_COALITIONS_PER_BATCH`) rather than unbounded: the
    caller chunks, which is what keeps progress reporting and cancellation
    working and keeps a single request from occupying an engine worker
    indefinitely. Every other field is the single request's, so a batched
    Scenario carries exactly what a single one does.
    """
    coalitions: list[list[str]] = Field(
        ...,
        min_length=1,
        max_length=MAX_COALITIONS_PER_BATCH,
        description=(
            "Element ids (nodes or edges) to fail in each Scenario. An empty "
            "inner list is the untouched baseline. Ids not present in the "
            "Project are ignored, exactly as they are on the single-run path."
        ),
    )


class ElementUpdate(BaseModel):
    """
    Engine's update for a single Element (node or edge) after a Propagation.

    `id` is a globally unique Element ID — look it up directly in
    Project.nodes or Project.edges. No canvas_id needed.

    Optional fields are excluded from serialisation when None so the JSON
    response omits them entirely — Zod `.optional()` accepts absence but not null.
    """
    id: str
    functionality: int = Field(..., ge=1)
    functionality_time: Optional[int] = Field(default=None, ge=0)
    direct_damage: Optional[bool] = None
    expected_repair_time: Optional[int] = Field(default=None, ge=0)
    responsibility_share: Optional[ResponsibilityShare] = Field(
        default=None,
        description=(
            "Keyed by ElementId or EventId. Values are in (0, 1] and sum to 1 — "
            "zero shares are never emitted (a blameless element is simply absent). "
            "Identifies which upstream Elements or Events are directly responsible "
            "for this Element's degradation, and in what proportion."
        ),
    )
    properties: Optional[dict[str, Any]] = None


class StoredAmount(BaseModel):
    """What one storage exchanged with the network in one Propagation (ADR-0020 §1c)."""
    filled: float = Field(..., ge=0)
    drawn: float = Field(..., ge=0)


class RoundChange(BaseModel):
    """One Functionality change an engine round committed, in commit order (ADR-0027).

    `cause` says what decided it: `edge` — an edge took its source's worse level at
    the start of the round (ADR-0004); `flow` — a SourceToDemands flow shortfall;
    `logical` — logical aggregation; `rule` — a specific-rule override; `backup` —
    the drop was deferred into functionality_time, the level holding."""
    id: str
    functionality: int = Field(..., ge=1)
    functionality_time: Optional[int] = Field(default=None, ge=0)
    cause: Literal["edge", "flow", "logical", "rule", "backup"]
    responsibility_share: Optional[ResponsibilityShare] = None


class PropagationRound(BaseModel):
    """One engine round, for the animation (ADR-0027): the flow solved at its start
    and the changes its node pass committed, in order."""
    flows: dict[str, dict[str, float]] = Field(
        default_factory=dict,
        description=(
            "SourceToDemands Category → edge id → amount carried, in model units: one "
            "routing of what this round's flow solve delivered (another routing may "
            "deliver the same amounts)."
        ),
    )
    served_ratio: dict[str, dict[str, float]] = Field(
        default_factory=dict,
        description="Flow consumer → Category → delivered ÷ demand in this round's solve.",
    )
    changes: list[RoundChange] = Field(default_factory=list)


class PropagationResult(BaseModel):
    scope: Literal["local", "global"]
    updates: list[ElementUpdate]
    computed_at: datetime
    iterations: int = Field(..., ge=0)
    warnings: list[str] = Field(
        default_factory=list,
        description="Non-fatal engine warnings, e.g. convergence not reached.",
    )
    served_ratio: dict[str, dict[str, float]] = Field(
        default_factory=dict,
        description=(
            "Delivered ÷ demand per flow consumer and Category, at the converged state "
            "(ADR-0020 §3), fully served consumers included. The cause of a flow "
            "Functionality level; a Rule override or a backup deferral may make the two "
            "disagree."
        ),
    )
    stored: dict[str, dict[str, StoredAmount]] = Field(
        default_factory=dict,
        description="Per storage node and Category: what it filled and drew (ADR-0020 §1c).",
    )
    rounds: Optional[list[PropagationRound]] = Field(
        default=None,
        description="Present only when the request asked for `trace` (ADR-0027): one entry per round.",
    )


class BatchPropagationResult(BaseModel):
    """
    Results for POST /api/propagate/batch, positionally aligned with the request's
    `coalitions`. `results[i]` is the Propagation of `coalitions[i]`.
    """
    results: list[PropagationResult]


# PropagationScorecardEntry.propagation_result references PropagationResult via
# a forward reference. Rebuild now that PropagationResult is defined here.
PropagationScorecardEntry.model_rebuild()
