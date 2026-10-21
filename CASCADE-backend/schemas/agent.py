"""schemas/agent.py — Agent Bridge personal tokens (ADR-0024)."""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class CreateAgentTokenRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., min_length=1, max_length=100, description="What the token is for, e.g. 'Claude Code on my laptop'.")


class AgentToken(BaseModel):
    """A token as listed: never its value."""

    id: str
    name: str
    created_at: datetime
    last_used_at: Optional[datetime] = None
    expires_at: datetime


class CreatedAgentToken(BaseModel):
    """The one response that carries the token's value."""

    token: str
    record: AgentToken
