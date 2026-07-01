"""
schemas/engine.py — Engine algorithm metadata schemas.

These are the shapes returned by GET /api/engine/algorithms.

The endpoint lets the frontend know which graph types and algorithms the
engine supports, so the config UI can present valid choices without
hardcoding any engine internals.  The actual algorithm code lives
exclusively in engine/propagation.py (private IP).

Design notes
------------
- HeuristicMeta.params is a list of HeuristicParamMeta descriptors.
  The frontend uses it to render a typed form for each algorithm's
  parameters.  The engine validates the actual values at runtime;
  the frontend validates shape only.  When the endpoint is unreachable,
  the frontend falls back to a raw JSON textarea.

- GraphTypeMeta.default_heuristics lists the algorithm ids the engine
  applies by default (in order) when no GraphTypeConfig override is present
  in the project config.  This lets the UI show the user what they would
  get before they customise anything.

- applicable_graph_types on HeuristicMeta is empty when an algorithm can be
  applied to any graph type.  Non-empty restricts it to the listed types.
"""
from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field


class HeuristicParamMeta(BaseModel):
    """Describes one tunable parameter of a heuristic algorithm."""
    name: str
    label: str
    description: Optional[str] = None
    type: str = Field(
        ...,
        description="JSON Schema primitive type: 'integer' | 'number' | 'boolean' | 'string'.",
    )
    default: Optional[Any] = None
    minimum: Optional[float] = None   # for numeric types
    maximum: Optional[float] = None   # for numeric types
    enum: Optional[list[Any]] = None  # for constrained strings/integers


class HeuristicMeta(BaseModel):
    """
    Metadata for one engine algorithm (heuristic).

    The frontend uses this to:
    - populate the list of available algorithms for a given graph type
    - render a typed parameter form for enabled algorithms
    - show descriptions in the Config modal Tab 4
    """
    id: str = Field(..., description="Stable identifier used in HeuristicConfig.id.")
    label: str
    description: str
    applicable_graph_types: list[str] = Field(
        default_factory=list,
        description="Graph types this algorithm can be added to. Empty = unrestricted.",
    )
    default_enabled: bool = True
    params: list[HeuristicParamMeta] = Field(
        default_factory=list,
        description="Tunable parameters. Empty = no configurable parameters.",
    )


class GraphTypeMeta(BaseModel):
    """
    Metadata for one engine-known graph type.

    The frontend uses this to:
    - populate the graph_type dropdown when creating a Canvas
    - show the default algorithm pipeline (before any user customisation)
    """
    name: str = Field(..., description="Stable identifier used in Canvas.graph_type.")
    label: str
    description: str
    default_heuristics: list[str] = Field(
        ...,
        description=(
            "Ordered ids of the algorithms the engine applies by default for this type. "
            "Mirrors what the engine would use when no GraphTypeConfig override is present."
        ),
    )


class EngineAlgorithms(BaseModel):
    """
    Returned by GET /api/engine/algorithms.

    A read-only snapshot of what the engine supports.  The frontend uses it
    to render the graph type selector and the algorithm pipeline editor in
    the Config modal Tab 4.

    Requires at minimum viewer role — exposes no sensitive data and does not
    change system state.
    """
    graph_types: list[GraphTypeMeta]
    heuristics: list[HeuristicMeta]
