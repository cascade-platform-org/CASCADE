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

from core.importers.xfmv import Semantics
from schemas.sync import ProjectBundle


class ImportXfmvRequest(BaseModel):
    filename: str = Field(..., description="Original file name — used as the project name.")
    content: str = Field(..., min_length=1, max_length=20_000_000, description="The .xfmv file's text.")
    semantics: Semantics = Field(
        default="v2",
        description="v2: one level of damping per coupling and second-worst resonance, "
                    "on a 4-level scale (the FRAM paper's conversion). reachability: every "
                    "deviation reaches everything downstream. fmi: the FMI's binary reading, "
                    "with the file's All/Any/None profiles.",
    )


class ImportXfmvResponse(BaseModel):
    bundle: ProjectBundle
    warnings: list[str] = Field(default_factory=list)
    # Import provenance — surfaced in the UI toast and stored nowhere.
    functions: int
    couplings: int
