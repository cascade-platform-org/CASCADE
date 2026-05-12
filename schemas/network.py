from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Shared primitives
# ---------------------------------------------------------------------------

NodeType = Literal["Source", "Infrastructure", "Service", "Personnel"]

DirectCause = str  # ElementId | HazardId | "Initialization"


# ---------------------------------------------------------------------------
# Geographic & canvas helpers
# ---------------------------------------------------------------------------

class Position(BaseModel):
    x: float
    y: float


class GeoCoords(BaseModel):
    """
    Geographic point in the CRS declared by the parent Canvas.
    Defaults to WGS84 (EPSG:4326): lng/lat in decimal degrees,
    alt in metres on the WGS84 ellipsoid.
    """
    lng: float
    lat: float
    alt: Optional[float] = None


# ---------------------------------------------------------------------------
# Per-category block
# ---------------------------------------------------------------------------

class CategoryBlock(BaseModel):
    """Dependency attributes for one category on a node."""
    dependency_level: int = Field(..., ge=1)
    backup: Optional[bool] = None
    backup_duration: Optional[int] = Field(None, ge=0, description="Hours")
    demand: Optional[float] = Field(None, ge=0, description="SourceToDemands only")
    priority: Optional[int] = Field(None, ge=1, le=10, description="SourceToDemands only")


# ---------------------------------------------------------------------------
# Node
# ---------------------------------------------------------------------------

class Node(BaseModel):
    id: str
    functionality: int = Field(..., ge=1)
    label: Optional[str] = None
    node_type: Optional[NodeType] = None
    node_categories: Optional[list[str]] = None
    functionality_time: Optional[int] = Field(None, ge=0, description="Hours")
    direct_damage: Optional[bool] = None
    expected_repair_time: Optional[int] = Field(None, ge=0, description="Hours")
    importance: Optional[float] = None
    cost_of_disservice_per_day: Optional[float] = None
    position: Optional[Position] = None
    geo: Optional[GeoCoords] = None
    supply_capacity: Optional[dict[str, float]] = None
    capacity: Optional[float] = None
    category_blocks: Optional[dict[str, CategoryBlock]] = None
    vulnerability_levels: Optional[dict[str, int]] = None
    direct_causes: Optional[list[DirectCause]] = None
    properties: Optional[dict[str, Any]] = None


# ---------------------------------------------------------------------------
# Edge
# ---------------------------------------------------------------------------

class Edge(BaseModel):
    """
    Edges carry no category or category_blocks.
    The propagation engine infers which categories flow through an edge from the
    intersection of the source node's supply and the target node's demands.
    """
    id: str
    source: str
    target: str
    functionality: int = Field(..., ge=1)
    functionality_time: Optional[int] = Field(None, ge=0, description="Hours")
    direct_damage: Optional[bool] = None
    expected_repair_time: Optional[int] = Field(None, ge=0, description="Hours")
    capacity: Optional[float] = None
    vulnerability_levels: Optional[dict[str, int]] = None
    direct_causes: Optional[list[DirectCause]] = None
    properties: Optional[dict[str, Any]] = None


# ---------------------------------------------------------------------------
# Inter-canvas edge
# ---------------------------------------------------------------------------

class InterCanvasEdge(Edge):
    """An edge that connects a node on one canvas to a node on another."""
    source_canvas: str
    target_canvas: str


# ---------------------------------------------------------------------------
# Canvas
# ---------------------------------------------------------------------------

class Canvas(BaseModel):
    id: str
    label: Optional[str] = None
    crs: Optional[str] = Field(
        None,
        description="EPSG code for the CRS of node geo fields. Defaults to EPSG:4326.",
    )
    georeferenced: Optional[bool] = None
    nodes: Optional[list[Node]] = None
    edges: Optional[list[Edge]] = None


# ---------------------------------------------------------------------------
# Graph snapshot (used in simulation history — avoids circular imports)
# ---------------------------------------------------------------------------

class GraphSnapshot(BaseModel):
    """
    Lightweight snapshot of the graph state at a point in time.
    Stores only canvas data (nodes, edges, inter-canvas edges), not
    project meta or history, to keep snapshots self-contained and small.
    """
    canvases: list[Canvas]
    inter_canvas_edges: Optional[list[InterCanvasEdge]] = None


class PropagationMeta(BaseModel):
    """
    Metadata captured from a propagation run and stored in simulation history.
    Intentionally lighter than PropagationResult — avoids a circular import
    between network.py and results.py.
    """
    scope: Literal["local", "global"]
    iterations: int = Field(..., ge=0)
    warnings: list[str] = Field(default_factory=list)
    computed_at: str  # ISO 8601 UTC string


# ---------------------------------------------------------------------------
# Simulation history
# ---------------------------------------------------------------------------

class SimulationHistoryEntry(BaseModel):
    """
    One entry in the simulation history: a before/after graph snapshot pair.

    Generated whenever the user applies a hazard, clears a hazard, or
    receives a propagation result. Allows inspecting or restoring any
    past state without re-running the engine.

    The list is capped at 20 entries (latest first) by the store layer —
    this model imposes no limit so that loaded files validate regardless
    of who generated them.
    """
    id: str
    timestamp: str  # ISO 8601 UTC
    event_type: Literal["hazard_applied", "hazard_cleared", "propagation"]
    label: str  # e.g. "Earthquake M7 applied", "Propagation – global scope"
    scope: Optional[Literal["local", "global"]] = None
    canvas_id: Optional[str] = None   # set for local-scope events
    hazard_id: Optional[str] = None   # set for hazard events
    before: GraphSnapshot
    after: GraphSnapshot
    propagation_meta: Optional[PropagationMeta] = None  # set for propagation events


# ---------------------------------------------------------------------------
# Project
# ---------------------------------------------------------------------------

class ProjectMeta(BaseModel):
    name: str
    description: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class Project(BaseModel):
    version: Literal["2.0"]
    meta: ProjectMeta
    canvases: list[Canvas]
    inter_canvas_edges: Optional[list[InterCanvasEdge]] = None
    simulation_history: list[SimulationHistoryEntry] = Field(
        default_factory=list,
        description=(
            "Ring buffer of before/after graph snapshots, latest first. "
            "Capped at 20 entries by the store layer."
        ),
    )
