from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

from .network import Project
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
    """
    id: str
    functionality: int = Field(..., ge=1)
    functionality_time: Optional[int] = Field(None, ge=0)
    direct_damage: Optional[bool] = None
    expected_repair_time: Optional[int] = Field(None, ge=0)
    responsibility_share: Optional[dict[str, float]] = Field(
        None,
        description=(
            "Keyed by ElementId or EventId. Values are in (0, 1] and sum to 1. "
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
# Server-side project sync
# ---------------------------------------------------------------------------

class RemoteProjectRecord(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class SyncUploadRequest(BaseModel):
    project: Project
    config: ModelConfiguration


class SyncDownloadResponse(BaseModel):
    record: RemoteProjectRecord
    project: Project
    config: ModelConfiguration


# ---------------------------------------------------------------------------
# Batch propagation (async) — POST /api/propagate/batch
# ---------------------------------------------------------------------------

class BatchPropagationItem(BaseModel):
    """
    One propagation job within a batch request.
    `item_id` is caller-assigned and echoed back in the job results so the
    caller can match results to requests without relying on list order.
    """
    item_id: str
    project: Project
    config: ModelConfiguration
    scope: Literal["local", "global"]
    active_canvas_id: Optional[str] = Field(
        None, description="Canvas to restrict propagation when scope = local."
    )


class BatchPropagationRequest(BaseModel):
    items: list[BatchPropagationItem] = Field(..., min_length=1)


class BatchPropagationCreatedResponse(BaseModel):
    """
    Returned immediately by POST /api/propagate/batch.
    The client should connect to `stream_url` to receive live SSE events.
    Polling GET /api/propagate/batch/{job_id} is also supported for clients
    that cannot use SSE.
    """
    job_id: str
    status: Literal["queued"] = "queued"
    total: int
    stream_url: str  # e.g. /api/propagate/batch/{job_id}/stream


class BatchPropagationJobStatus(BaseModel):
    """
    Snapshot of a batch job's state.

    Returned by GET /api/propagate/batch/{job_id} (polling) and streamed as
    SSE events on GET /api/propagate/batch/{job_id}/stream.  Each SSE event
    is a JSON-serialised instance of this model sent as:

        data: <json>\n\n

    The stream closes after the final event where status is "done" or "failed".
    `results` and `errors` are populated incrementally as individual items
    complete, so early events may carry partial data.
    """
    job_id: str
    status: Literal["queued", "running", "done", "failed"]
    created_at: datetime
    completed_at: Optional[datetime] = None
    total: int
    completed: int
    results: dict[str, PropagationResult] = Field(
        default_factory=dict,
        description="Keyed by item_id. Present only for completed items.",
    )
    errors: dict[str, str] = Field(
        default_factory=dict,
        description="Keyed by item_id. Error message for failed items.",
    )


# ---------------------------------------------------------------------------
# Resolve forward references
# ---------------------------------------------------------------------------

# ScorecardEntry in network.py references PropagationResult via a forward
# reference string. Rebuild after PropagationResult is defined here.
from .network import ScorecardEntry  # noqa: E402
ScorecardEntry.model_rebuild()
