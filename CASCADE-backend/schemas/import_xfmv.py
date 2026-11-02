"""
schemas/import_xfmv.py — request/response for the FMV (.xfmv) FRAM importer
(ADR-0026).

The file travels as text inside the JSON body, like the .inp importer; the
client decodes it (UTF-8, else cp1252, which older FMV versions write) before
sending. The response reuses the ProjectBundle envelope that Server Sync and
local file I/O already round-trip.
"""
from __future__ import annotations

from pydantic import BaseModel, Field

from schemas.sync import ProjectBundle


class ImportXfmvRequest(BaseModel):
    filename: str = Field(..., description="Original file name — used as the project name.")
    content: str = Field(..., min_length=1, max_length=20_000_000, description="The .xfmv file's text.")


class ImportXfmvResponse(BaseModel):
    bundle: ProjectBundle
    warnings: list[str] = Field(default_factory=list)
    # Import provenance — surfaced in the UI toast and stored nowhere.
    functions: int
    couplings: int
