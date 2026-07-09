"""
schemas/import_inp.py — request/response for the EPANET .inp importer.

The .inp content travels as plain text inside the JSON body (files are small —
hundreds of KB) so the endpoint stays JSON-in / JSON-out like the rest of the
API, and the response reuses the exact ProjectBundle envelope that Server Sync
and local file I/O already round-trip.

`ImportInpRequest` subclasses `ImportOptions` (core/importers/inp/map.py) — the
mapping knobs are declared exactly once and the request object is passed to
`build_bundle` directly.
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field

from core.importers.inp import ImportOptions
from schemas.sync import ProjectBundle


class ImportInpRequest(ImportOptions):
    filename: str = Field(..., description="Original file name — used as the project name.")
    content: str = Field(..., min_length=1, description="Raw .inp file text.")

    target_nodes: Optional[int] = Field(
        default=None, ge=5,
        description="Skeletonize until the network fits this node budget. "
                    "None = the caller's entitlement max_nodes (unbounded roles: 300).",
    )
    derive_priorities: bool = Field(
        default=True,
        description="Run the WNTR pressure-driven scarcity sweep to derive "
                    "flow-allocation priorities (adds a few seconds).",
    )


class ImportInpResponse(BaseModel):
    bundle: ProjectBundle
    warnings: list[str] = Field(default_factory=list)
    # Import provenance — surfaced in the UI toast and stored nowhere.
    original_nodes: int
    imported_nodes: int
    skeleton_threshold_m: Optional[float] = Field(
        default=None, description="Pipe-diameter threshold used; None = no reduction needed.",
    )
