from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

from .network import Project, ResponsibilityShare, PropagationScorecardEntry
from .config import ModelConfiguration


# ---------------------------------------------------------------------------
# Propagation request / result
# ---------------------------------------------------------------------------

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


MAX_COALITIONS_PER_BATCH = 50


class BatchPropagationRequest(BaseModel):
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
    indefinitely.
    """
    project: Project
    config: ModelConfiguration
    scope: Literal["local", "global"]
    active_canvas_id: Optional[str] = Field(
        default=None, description="Canvas to restrict propagation when scope = local."
    )
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


class PropagationResult(BaseModel):
    scope: Literal["local", "global"]
    updates: list[ElementUpdate]
    computed_at: datetime
    iterations: int = Field(..., ge=0)
    warnings: list[str] = Field(
        default_factory=list,
        description="Non-fatal engine warnings, e.g. convergence not reached.",
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
