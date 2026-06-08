from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Shared primitives
# ---------------------------------------------------------------------------

# node_type is a free string — valid values are defined in Client Configuration,
# not hardcoded in the schema. This allows new Node Types without a schema change.

ResponsibilityShare = dict[str, float]  # ElementId | EventId -> share in (0, 1], summing to 1


# ---------------------------------------------------------------------------
# Geographic helpers
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
    crs: Optional[str] = Field(None, description="Override the parent Canvas CRS for this point. Inherits Canvas.crs when absent.")


# ---------------------------------------------------------------------------
# Per-category block
# ---------------------------------------------------------------------------

class CategoryDependencyProfile(BaseModel):
    """
    Dependency attributes a node carries for one specific Category.

    dependency_level: 1..N where N = fully dependent (strict thresholds),
    1 = barely dependent (high tolerance). Inverse of the Functionality scale.
    capacity: maximum throughput for this category — degrades proportionally with Functionality.
    demand and priority are SourceToDemands-only; leave absent for Requisite.
    """
    dependency_level: int = Field(..., ge=1)
    capacity: Optional[float] = Field(None, ge=0, description="Maximum throughput for this category.")
    backup: Optional[bool] = None
    backup_duration: Optional[int] = Field(None, ge=0, description="Hours. SourceToDemands only.")
    demand: Optional[float] = Field(None, ge=0, description="Resource amount requested. SourceToDemands only.")
    priority: Optional[int] = Field(None, ge=1, le=10, description="Flow allocation priority. SourceToDemands only.")


# ---------------------------------------------------------------------------
# Node
# ---------------------------------------------------------------------------

class Node(BaseModel):
    id: str
    functionality: int = Field(..., ge=1)
    label: Optional[str] = None
    node_type: Optional[str] = None
    node_categories: Optional[list[str]] = None
    functionality_time: Optional[int] = Field(None, ge=0, description="Hours")
    direct_damage: Optional[bool] = None
    expected_repair_time: Optional[int] = Field(None, ge=0, description="Hours")
    importance: Optional[float] = None
    cost_of_disservice_per_day: Optional[float] = None
    position: Optional[Position] = None
    geo: Optional[GeoCoords] = None
    # Keyed by category name. Present only on Source nodes.
    # Effective supply = supply_capacity[cat] × (functionality / N).
    # A node must not carry both supply_capacity[c] and category_dependency_profiles[c].demand
    # for the same category — the engine warns and treats it as supply-only.
    supply_capacity: Optional[dict[str, float]] = None
    category_dependency_profiles: Optional[dict[str, CategoryDependencyProfile]] = None
    # Keyed by EventId. value 1..N — higher = more vulnerable (imposed = N − vulnerability_level).
    vulnerability_levels: Optional[dict[str, int]] = None
    responsibility_share: Optional[ResponsibilityShare] = Field(
        None,
        description=(
            "Persisted last-known responsibility share for this node's current Functionality. "
            "Keyed by ElementId or EventId; values in (0, 1] summing to 1. "
            "Set by the engine after each Propagation and stored in the project file."
        ),
    )
    # Raw rule strings — parsed and validated client-side; evaluated by the engine.
    rules: Optional[list[str]] = None
    properties: Optional[dict[str, Any]] = None


# ---------------------------------------------------------------------------
# Edge
# ---------------------------------------------------------------------------

class Edge(BaseModel):
    """
    Edges carry no category or category_dependency_profiles.
    The engine infers which categories flow through an edge from the
    intersection of the source node's supply and the target node's demands.

    Whether an edge is "inter-canvas" is a UI concern only: an edge whose
    target node is not in the currently rendered Canvas's node_ids is drawn
    as an outbound inter-canvas edge. No special type or field is needed.
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
    responsibility_share: Optional[ResponsibilityShare] = Field(
        None,
        description=(
            "Persisted last-known responsibility share for this edge's current Functionality. "
            "Keyed by ElementId or EventId; values in (0, 1] summing to 1."
        ),
    )
    # Raw rule strings — parsed and validated client-side; evaluated by the engine.
    rules: Optional[list[str]] = None
    properties: Optional[dict[str, Any]] = None


# ---------------------------------------------------------------------------
# Graph — mathematical structure for one Entity
# ---------------------------------------------------------------------------

class Graph(BaseModel):
    """
    The mathematical structure of one Entity: a typed set of element references.

    `graph_type` selects the engine's heuristic pipeline for this subgraph and
    associates the Canvas with its Entity type.

    `node_ids` and `edge_ids` are references into the Project-level element
    registry (Project.nodes / Project.edges). The same element ID may appear
    in multiple Graphs — the registry holds the single authoritative state.
    """
    graph_type: str = Field(
        ...,
        description=(
            "Engine-known graph type identifier (e.g. 'water', 'power', 'ict', 'organisation'). "
            "Available types are returned by GET /api/engine/capabilities."
        ),
    )
    node_ids: list[str] = Field(default_factory=list)
    edge_ids: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Canvas — named UI container for one Graph
# ---------------------------------------------------------------------------

class Canvas(BaseModel):
    """
    Named UI container for a Graph. Carries display metadata only.
    The backend identifies subgraphs via Canvas.id and dispatches heuristics
    via Canvas.graph.graph_type.
    """
    id: str
    label: Optional[str] = None
    color: Optional[str] = Field(
        None,
        description="Hex colour string for canvas tabs and layer controls, e.g. '#3b82f6'.",
    )
    crs: Optional[str] = Field(
        None,
        description="EPSG code for the CRS of node geo fields. Defaults to EPSG:4326.",
    )
    georeferenced: Optional[bool] = None
    graph: Graph


# ---------------------------------------------------------------------------
# Graph snapshot (used in Any Update history)
# ---------------------------------------------------------------------------

class GraphSnapshot(BaseModel):
    """
    Point-in-time serialisation of the full project graph state.
    Captures both the element registry and the Canvas membership structure.
    Used as before/after state in AnyUpdateEntry.
    """
    nodes: dict[str, Node] = Field(default_factory=dict)
    edges: dict[str, Edge] = Field(default_factory=dict)
    canvases: list[Canvas] = Field(default_factory=list)


class PropagationMeta(BaseModel):
    """
    Metadata from a Propagation run, stored alongside an AnyUpdateEntry.
    Lighter than PropagationResult — no per-element updates, just run stats.
    """
    scope: Literal["local", "global"]
    iterations: int = Field(..., ge=0)
    warnings: list[str] = Field(default_factory=list)
    computed_at: str  # ISO 8601 UTC string


# ---------------------------------------------------------------------------
# Any Update history
# ---------------------------------------------------------------------------

AnyUpdateType = Literal[
    "event_applied",               # Event (Hazard or Disservice) applied to the Scenario
    "event_cleared",               # Event cleared from the Scenario
    "propagation",                 # Propagation result merged into the Scenario
    "manual_functionality_update", # User manually edited Element functionality
    "graph_update",                # Structural change (topology / non-functionality attributes)
]


class AnyUpdateEntry(BaseModel):
    """
    One entry in the Any Update history: a before/after GraphSnapshot pair.

    Created for every Any Update. CTRL+Z pops from this list.
    Capped at 20 entries (latest first) by the store layer.
    """
    id: str
    timestamp: str  # ISO 8601 UTC
    update_type: AnyUpdateType
    label: str
    scope: Optional[Literal["local", "global"]] = None
    canvas_id: Optional[str] = None    # set for local-scope operations
    event_id: Optional[str] = None     # set for event_applied / event_cleared
    before: GraphSnapshot
    after: GraphSnapshot
    propagation_meta: Optional[PropagationMeta] = None  # set for propagation entries
    mutation_reversal: Optional[dict[str, Any]] = Field(
        None,
        description=(
            "Populated only on event_applied entries. "
            "Keys are '<elementId>.<fieldName>' (same dot-notation as "
            "EventDefinition.attribute_mutations). Values are pre-event field values "
            "captured immediately before the event was applied. "
            "Covers all three effect channels: vulnerability_levels drops "
            "(→ functionality), direct_damage_effects, and attribute_mutations. "
            "Used by clear-event to revert only the mutated fields, preserving "
            "changes made to other fields after the event was applied."
        ),
    )


# ---------------------------------------------------------------------------
# Scorecard
# ---------------------------------------------------------------------------

class ScorecardEntry(BaseModel):
    """
    One entry in the Scorecard: up to three Scenario snapshots explicitly saved
    by the user. The history pattern Event → Propagation → (Temporal Jump →
    Propagation)* maps directly onto the three fields.

    `before_propagation`   — state just before the most recent Propagation
        (post-Event, post-manual-edit). Always present.
    `after_propagation`    — state after the Propagation. Absent when no
        Propagation has been run (Manual What-If entry).
    `after_temporal_jump`  — state after one or more Temporal Jump events +
        Propagations. Absent when no Temporal Jump was run or requested.
    `temporal_jump_hours`  — total hours elapsed across all Temporal Jumps that
        produced `after_temporal_jump`. Absent when `after_temporal_jump` is absent.
    `propagation_result`   — raw engine delta from the Propagation that produced
        `after_propagation`. Absent for Manual What-If entries.

    Derived metrics are computed client-side from the snapshots; never stored.
    """
    id: str
    label: str
    created_at: str  # ISO 8601 UTC
    event_id: Optional[str] = None  # EventDefinition.id; None for Manual What-If entries
    before_propagation: GraphSnapshot
    after_propagation: Optional[GraphSnapshot] = None
    after_temporal_jump: Optional[GraphSnapshot] = None
    temporal_jump_hours: Optional[int] = Field(None, ge=1)
    propagation_result: Optional["PropagationResult"] = None  # type: ignore[name-defined]
    # Base64-encoded PNG of the GlobalViewCanvas at each snapshot state.
    # Captured once at save time; stored so the Scorecard renders offline.
    before_propagation_image: Optional[str] = None
    after_propagation_image: Optional[str] = None
    after_temporal_jump_image: Optional[str] = None


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
    global_graph_type: Optional[str] = Field(
        None,
        description=(
            "Graph type assigned to the Global view (all Canvases rendered together). "
            "References a name in ModelConfiguration.graph_types. "
            "None means no type is assigned — the engine dispatches per-Canvas only."
        ),
    )
    nodes: dict[str, Node] = Field(
        default_factory=dict,
        description="Global element registry. Keys are globally unique node IDs.",
    )
    edges: dict[str, Edge] = Field(
        default_factory=dict,
        description="Global element registry. Keys are globally unique edge IDs.",
    )
    canvases: list[Canvas] = Field(
        default_factory=list,
        description=(
            "Each Canvas holds a Graph whose node_ids/edge_ids reference "
            "the global registry. An element may appear in multiple Canvases."
        ),
    )
    update_history: list[AnyUpdateEntry] = Field(
        default_factory=list,
        description=(
            "Ring buffer of Any Update entries (before/after GraphSnapshots), "
            "latest first. CTRL+Z pops from this list. "
            "Capped at 20 entries by the store layer."
        ),
    )
    scorecard: list[ScorecardEntry] = Field(
        default_factory=list,
        description=(
            "User-curated atlas of named Scenarios and their Propagation results. "
            "Persisted in the project file. Derived metrics are computed client-side "
            "from each entry's snapshot and never stored here."
        ),
    )
