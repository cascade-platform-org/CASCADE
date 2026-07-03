from __future__ import annotations

from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


# ---------------------------------------------------------------------------
# Client-side activity log (mirrors app/lib/schemas/audit.ts)
# ---------------------------------------------------------------------------

def _require_uuid(value: str) -> str:
    """Reject non-UUID strings at the boundary so they never reach the
    `$2::uuid` cast in db/audit_routes.py (an uncaught cast error there would
    surface as a 500 instead of a clean 422)."""
    UUID(value)  # raises ValueError on malformed input → Pydantic 422
    return value


class ActivityLogEntry(BaseModel):
    """
    One action recorded by the client-side activity log.
    Never contains raw graph data — only action metadata.
    """
    id: str                          # UUID generated at log time
    session_id: str                  # UUID shared by all entries in one browser session
    action: str                      # matches ActivityActionSchema enum values
    details: dict[str, Any] = Field(default_factory=dict)
    occurred_at: str                 # ISO 8601 UTC

    _check_id = field_validator("id", "session_id")(_require_uuid)


class ActivityLogUpload(BaseModel):
    """
    Body for POST /api/audit/activity.
    Users may upload their local activity log to share context with support
    or for collaborative debugging. Requires can_sync permission.
    """
    entries: list[ActivityLogEntry]
    # max_length matches the VARCHAR(50) column in db/schema.sql so an
    # over-length value is rejected as a 422, not truncated / errored by the DB.
    app_version: str = Field(..., max_length=50, description="Semver string, e.g. '1.0.0'")
