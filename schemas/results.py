from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

from .network import Project
from .config import ProjectConfig


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
    config: ProjectConfig
    scope: Literal["local", "global"]
    active_canvas_id: Optional[str] = Field(
        None, description="Canvas to restrict propagation when scope = local."
    )


class ElementUpdate(BaseModel):
    id: str
    functionality: int = Field(..., ge=1)
    functionality_time: Optional[int] = Field(None, ge=0)
    direct_damage: Optional[bool] = None
    expected_repair_time: Optional[int] = Field(None, ge=0)
    direct_causes: Optional[list[str]] = None
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
    config: ProjectConfig


class SyncDownloadResponse(BaseModel):
    record: RemoteProjectRecord
    project: Project
    config: ProjectConfig


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
    config: ProjectConfig
    scope: Literal["local", "global"]
    active_canvas_id: Optional[str] = Field(
        None, description="Canvas to restrict propagation when scope = local."
    )


class BatchPropagationRequest(BaseModel):
    items: list[BatchPropagationItem] = Field(..., min_length=1)


class BatchPropagationJobStatus(BaseModel):
    """
    Returned by GET /api/propagate/batch/{job_id} and streamed via SSE.
    `results` and `errors` are populated incrementally as items complete.
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
