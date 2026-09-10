"""
schemas/sync.py — Server Sync (requirements.md §13.4, opt-in, gated by can_sync).

The stored `data` bundle is exactly the frontend's ProjectBundle envelope
(project + config) — validated against the existing Project/ModelConfiguration
models so a save can never write malformed data that Load would later choke on.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from schemas.config import ModelConfiguration
from schemas.network import Project


class ProjectBundle(BaseModel):
    project: Project
    config: ModelConfiguration


class SaveProjectRequest(BaseModel):
    name: str
    description: Optional[str] = None
    data: ProjectBundle


class ProjectVersionSummary(BaseModel):
    """One saved version, without the (potentially large) bundle — used for
    the version list. `id` is what Load/Delete address."""
    id: str
    name: str
    description: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class ProjectVersionDetail(ProjectVersionSummary):
    data: ProjectBundle


class SaveWorkingCopyRequest(BaseModel):
    """One auto-save. Carries no description: a Working Copy is the live state of
    a named project, not a labelled point in its history."""
    name: str
    data: ProjectBundle


class WorkingCopyDetail(BaseModel):
    """The Working Copy for one project name, with the bundle.

    `updated_at` is what Load compares against the newest version's `created_at`
    to decide whether to offer it (ADR-0017).
    """
    id: str
    name: str
    created_at: datetime
    updated_at: datetime
    data: ProjectBundle
