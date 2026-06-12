from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

from .network import Project, ResponsibilityShare
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
        None, description="Canvas to restrict propagation when scope = local."
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
    functionality_time: Optional[int] = Field(None, ge=0)
    direct_damage: Optional[bool] = None
    expected_repair_time: Optional[int] = Field(None, ge=0)
    responsibility_share: Optional[ResponsibilityShare] = Field(
        None,
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


# ---------------------------------------------------------------------------
# Resolve forward references
# ---------------------------------------------------------------------------

# ScorecardEntry in network.py references PropagationResult via a forward
# reference string. Rebuild after PropagationResult is defined here.
from .network import ScorecardEntry  # noqa: E402
ScorecardEntry.model_rebuild()
