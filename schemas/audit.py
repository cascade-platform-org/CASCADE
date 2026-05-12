from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Client-side activity log (mirrors app/lib/schemas/audit.ts)
# ---------------------------------------------------------------------------

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


class ActivityLogUpload(BaseModel):
    """
    Body for POST /api/audit/activity.
    Users may upload their local activity log to share context with support
    or for collaborative debugging. Requires can_sync permission.
    """
    entries: list[ActivityLogEntry]
    app_version: str = Field(..., description="Semver string, e.g. '1.0.0'")
