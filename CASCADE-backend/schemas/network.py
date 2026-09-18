from __future__ import annotations

from typing import TYPE_CHECKING, Annotated, Any, Literal, Optional

from pydantic import BaseModel, BeforeValidator, Field, model_validator

if TYPE_CHECKING:
    from .results import PropagationResult


# ---------------------------------------------------------------------------
# Shared primitives
# ---------------------------------------------------------------------------

# node_type is a free string — valid values are defined in Client Configuration,
# not hardcoded in the schema. This allows new Node Types without a schema change.


def _strip_zero_shares(v: object) -> object:
    """Strip zero-value entries before the per-entry gt(0) check fires.

    Zero shares are semantically absent (a blameless element is not listed).
    The engine never emits 0.0, but external tools or project files created
    before this invariant was enforced may contain them. Filtering here
    provides backward compat without a validation error.
    """
    if isinstance(v, dict):
        return {k: frac for k, frac in v.items() if frac}
    return v


# ElementId | EventId -> share in (0, 1], summing to 1. Zero shares are never
# emitted (a blameless element is simply absent) — enforced here, mirrored by
# Zod's gt(0).lte(1) on the frontend.
ResponsibilityShare = Annotated[
    dict[str, Annotated[float, Field(gt=0, le=1)]],
    BeforeValidator(_strip_zero_shares),
]

# EventId -> vulnerability in 0..N−1 (N = max configured functionality level).
# 0 = immune (equivalent to the key being absent — the inspector UI writes 0
# rather than deleting the key). The event imposes
# functionality = max(1, N − vulnerability_level).
# Upper bound le=100: N is runtime data so the exact N−1 cap is enforced by
# the engine; 100 is a static sanity bound (no realistic scale exceeds it).
VulnerabilityLevels = dict[str, Annotated[int, Field(ge=0, le=100)]]


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
    crs: Optional[str] = Field(default=None, description="Override the parent Canvas CRS for this point. Inherits Canvas.crs when absent.")


# ---------------------------------------------------------------------------
# Per-category block
# ---------------------------------------------------------------------------

class CategoryDependencyProfile(BaseModel):
    """
    Dependency attributes a node carries for one specific Category.

    dependency_level: 1..N (N = len(functionality_scale)). Acts as a GUARD that
    attenuates a proposed Functionality drop by a linear shift:
        P' = min(current, P + (N − dependency_level))
    N = full dependency (drop passes unattenuated); 1 = no dependency
    (shift of N−1 neutralises any possible drop entirely). Intermediate values
    reduce the drop linearly by (N − dependency_level) levels.
    capacity: maximum throughput for this category — degrades proportionally with Functionality.
    demand and priority are SourceToDemands-only; leave absent for Requisite.
    """
    dependency_level: int = Field(..., ge=1)
    capacity: Optional[float] = Field(default=None, ge=0, description="Maximum throughput for this category.")
    backup: Optional[bool] = None
    backup_duration: Optional[int] = Field(default=None, ge=0, description="Hours. Applies when backup is true.")
    demand: Optional[float] = Field(default=None, ge=0, description="Resource amount requested. SourceToDemands only.")
    priority: Optional[int] = Field(default=None, ge=1, le=10, description="Flow allocation priority. SourceToDemands only.")


# ---------------------------------------------------------------------------
# Node
# ---------------------------------------------------------------------------

class Node(BaseModel):
    id: str
    functionality: int = Field(..., ge=1)
    label: Optional[str] = None
    node_type: Optional[str] = None
    node_categories: Optional[list[str]] = None
    functionality_time: Optional[int] = Field(default=None, ge=0, description="Hours")
    direct_damage: Optional[bool] = None
    expected_repair_time: Optional[int] = Field(default=None, ge=0, description="Hours")
    importance: Optional[float] = None
    cost_of_disservice_per_day: Optional[float] = None
    position: Optional[Position] = None
    geo: Optional[GeoCoords] = None
    # Keyed by category name. Present only on Source nodes.
    # Effective supply = supply_capacity[cat] × (functionality / N).
    # Carrying both supply_capacity[c] and category_dependency_profiles[c].demand
    # for the same category is not rejected here or by the engine: flow.py reads
    # the two independently, so the node enters that category's flow graph as a
    # source AND a consumer. The frontend Inspector flags it for the modeller.
    supply_capacity: Optional[dict[str, float]] = None
    category_dependency_profiles: Optional[dict[str, CategoryDependencyProfile]] = None
    vulnerability_levels: Optional[VulnerabilityLevels] = Field(
        default=None,
        description=(
            "Keyed by EventId. Value 0..N−1 (N = max configured functionality level): "
            "higher = more vulnerable, 0 = immune (same as absent). "
            "The event imposes functionality = max(1, N − vulnerability_level)."
        ),
    )
    responsibility_share: Optional[ResponsibilityShare] = Field(
        default=None,
        description=(
            "Persisted last-known responsibility share for this node's current Functionality. "
            "Keyed by ElementId or EventId; values in (0, 1] summing to 1 — zero shares are "
            "never emitted (a blameless element is simply absent). "
            "Set by the engine after each Propagation and stored in the project file."
        ),
    )
    # Raw rule strings — authored with client-side autocomplete; parsed and evaluated by the engine.
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
    functionality_time: Optional[int] = Field(default=None, ge=0, description="Hours")
    direct_damage: Optional[bool] = None
    expected_repair_time: Optional[int] = Field(default=None, ge=0, description="Hours")
    capacity: Optional[float] = None
    vulnerability_levels: Optional[VulnerabilityLevels] = Field(
        default=None,
        description=(
            "Keyed by EventId. Value 0..N−1: higher = more vulnerable, 0 = immune "
            "(same as absent). The event imposes functionality = max(1, N − vulnerability_level)."
        ),
    )
    responsibility_share: Optional[ResponsibilityShare] = Field(
        default=None,
        description=(
            "Persisted last-known responsibility share for this edge's current Functionality. "
            "Keyed by ElementId or EventId; values in (0, 1] summing to 1 — zero shares are "
            "never emitted (a blameless element is simply absent)."
        ),
    )
    # Raw rule strings — authored with client-side autocomplete; parsed and evaluated by the engine.
    rules: Optional[list[str]] = None
    sourceHandle: Optional[str] = Field(
        default=None,
        description=(
            "React Flow handle id on the source node — which connection dot the edge "
            "was drawn from. UI-only; ignored by the engine."
        ),
    )
    targetHandle: Optional[str] = Field(
        default=None,
        description=(
            "React Flow handle id on the target node — which connection dot the edge "
            "attaches to. UI-only; ignored by the engine."
        ),
    )
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

class GeoAnchor(BaseModel):
    """
    One correspondence between a React Flow coordinate and a geographic coordinate,
    plus the zoom levels at which the anchor was established.

    Together with the projection, this defines a bijection between React Flow
    coordinate space and geographic (lng/lat) space. The projection is exact
    Web Mercator — the same one MapLibre uses to draw tiles — so node placement
    and the map background never disagree:

        flow space  ↔  Mercator WORLD coordinates   is a constant affine map
        Mercator world  ↔  lng/lat                  is the standard closed form

    The flow↔world scale is a single constant derived from the anchor zooms:
    worldPerFlowUnit = rf_zoom / (512 · 2^ml_zoom). All latitude curvature lives
    in the exact world↔lng/lat step. (Frontend implementation: lib/geo-utils.ts.)
    """
    flow: Position = Field(description="React Flow coordinate of the anchor point.")
    geo: GeoCoords = Field(description="Geographic coordinate at the anchor point.")
    rf_zoom: float = Field(description="React Flow zoom when the anchor was established.")
    ml_zoom: float = Field(description="MapLibre zoom when the anchor was established.")


class Canvas(BaseModel):
    """
    Named UI container for a Graph. Carries display metadata only.
    The backend identifies subgraphs via Canvas.id and dispatches heuristics
    via Canvas.graph.graph_type.
    """
    id: str
    label: Optional[str] = None
    color: Optional[str] = Field(
        default=None,
        description="Hex colour string for canvas tabs and layer controls, e.g. '#3b82f6'.",
    )
    crs: Optional[str] = Field(
        default=None,
        description="EPSG code for the CRS of node geo fields. Defaults to EPSG:4326.",
    )
    georeferenced: Optional[bool] = None
    map_style: Optional[str] = Field(
        default=None,
        description="Tile style id last used in the geo editor: 'liberty' | 'bright' | 'positron'.",
    )
    map_center: Optional[GeoCoords] = Field(
        default=None,
        description="Last map viewport centre (lng, lat). Restored when the canvas is reopened.",
    )
    map_zoom: Optional[float] = Field(
        default=None,
        description="Last map zoom level. Restored when the canvas is reopened.",
    )
    geo_anchor: Optional[GeoAnchor] = Field(
        default=None,
        description=(
            "Bijective anchor between one React Flow coordinate and one geographic coordinate. "
            "When present, all node positions can be converted to/from geographic coordinates "
            "via the exact Web Mercator projection defined by GeoAnchor. "
            "Absent until the user sets the geo reference in the canvas editor."
        ),
    )
    source_inp_content: Optional[str] = Field(
        default=None,
        description=(
            "Full text of the original .inp file this canvas was imported from, embedded "
            "automatically at import time (the browser already holds the picked file's content; "
            "a filesystem path was rejected as the reference because a browser file picker never "
            "exposes one, and a server-side copy would break the importer's nothing-persisted "
            "property — see ADR-0013). Required for graph_type='epanet' propagation: the backend "
            "rebuilds the WNTR model from this string per request, so the feature is fully "
            "local-first and works on hosted deployments. Costs the .inp's size (tens of KB for "
            "real aqueduct exports) in the project file and in each epanet-mode request."
        ),
    )
    # Same values as core.importers.inp.map.DemandMode — declared as its own
    # Literal because schemas/ cannot import from core/ (map.py already
    # imports schemas.network; reusing its alias would be a circular import).
    source_inp_demand_mode: Optional[Literal["peak", "peak_hour", "base", "avg"]] = Field(
        default=None,
        description=(
            "demand_mode ('peak'|'base'|'avg') this canvas was imported with — reused by "
            "graph_type='epanet' propagation so the live EPANET solve's demand baseline matches "
            "the original import rather than the .inp file's raw time-varying pattern."
        ),
    )
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
# Graph Diff (ADR-0017) — what one Any Graph Update changed
# ---------------------------------------------------------------------------

ABSENT = "__CASCADE_ABSENT__"
"""Sentinel for a field that did not exist on one side of a Graph Diff.

Shared verbatim with the frontend (`lib/event-application.ts`, `lib/graph-diff.ts`).
Applying a diff that names ABSENT DELETES the key rather than writing `null`:
an optional-but-not-nullable field set to `null` fails both this schema and the
Zod mirror, and desyncs the Scorecard dedup hash from the true prior state.
"""


class FieldChange(BaseModel):
    """One field's value on each side of a Graph Diff.

    `key` is set only for `field="properties"`, which is diffed one level deep
    because `ElementUpdate.properties` is MERGED onto an Element rather than
    replaced (`lib/element-update.ts`) — a Rule adding one key to a 20-key
    object would otherwise store the whole object on both sides.

    `field` is carried as data rather than encoded into a string key: the
    `"<elementId>.<field>"` convention used by MutationReversal has to split on
    the last dot, and EPANET element ids contain dots (`J.12.A`).
    """
    field: str
    key: Optional[str] = None
    before: Any = None
    after: Any = None


class RecordDiff(BaseModel):
    """One Element or Canvas added, removed, or changed field-by-field.

    `op="update"` carries `fields`; `op="add"`/`"remove"` carry `record`, the
    whole object — there is no shorter honest encoding of "this did not exist".
    """
    id: str
    op: Literal["add", "remove", "update"]
    fields: list[FieldChange] = Field(default_factory=list)
    record: Optional[dict[str, Any]] = None


class GraphDiff(BaseModel):
    """A field-level, invertible description of what one Any Graph Update changed.

    Schema-agnostic by construction: the differ enumerates the keys actually
    present on each record rather than a known field list, so an attribute a
    Rule gains under ADR-0015 stays undoable without anyone editing the differ.
    Carries both directions, so it applies forwards (redo) and backwards (undo)
    against the live graph — no snapshot is rebuilt.

    Replaces the before/after GraphSnapshot pair that cost 97.6% of a project
    file. See ADR-0017.
    """
    nodes: list[RecordDiff] = Field(default_factory=list)
    edges: list[RecordDiff] = Field(default_factory=list)
    canvases: list[RecordDiff] = Field(default_factory=list)
    canvas_order: Optional[list[str]] = Field(
        default=None,
        description="Canvas order AFTER the update; set only when the order changed.",
    )
    canvas_order_before: Optional[list[str]] = Field(
        default=None,
        description="Canvas order BEFORE the update; set only when the order changed.",
    )


# ---------------------------------------------------------------------------
# Any Update history
# ---------------------------------------------------------------------------

AnyUpdateType = Literal[
    "event_applied",               # Event (Hazard or Disservice) applied to the Scenario
    "event_cleared",               # Event cleared from the Scenario
    "propagation",                 # Propagation result merged into the Scenario
    "manual_functionality_update", # User manually edited Element functionality
    "graph_update",                # Structural change (topology / non-functionality attributes)
    "scenario_reset",              # Reset button — Functionality restored to N; ends the current Situation
    "temporal_jump_revert",        # Temporal Jumps undone — the Scenario is back to its pre-jump state
]


class AnyUpdateEntry(BaseModel):
    """
    One entry in the Any Update history.

    Created for every Any Update. CTRL+Z pops from this list. Capped by the
    store layer at 20 entries (latest first) AND at a byte budget — a count
    alone is the wrong bound when one bulk deletion produces a diff larger than
    twenty ordinary ones.

    Carries a `diff` (ADR-0017). `before`/`after` are legacy: entries written
    before that ADR carry the snapshot pair instead, and are still read. Exactly
    one of the two is present on any entry this app writes.
    """
    id: str
    timestamp: str  # ISO 8601 UTC
    update_type: AnyUpdateType
    label: str
    scope: Optional[Literal["local", "global"]] = None
    canvas_id: Optional[str] = None    # set for local-scope operations
    event_id: Optional[str] = None     # set for event_applied / event_cleared
    temporal_jump_hours: Optional[int] = Field(
        default=None,
        ge=1,
        description=(
            "Set only on the event_applied entry for a Temporal Jump (event_id "
            "starts with 'tj-'): the hours it advanced simulated time by. Read by "
            "clear-event to tell the -Xh revert control how much elapsed time to "
            "drop, without parsing it back out of the human-readable label."
        ),
    )
    reverts_to_entry_id: Optional[str] = Field(
        default=None,
        description=(
            "Set only on temporal_jump_revert entries: the id of the newest history "
            "entry at the moment the pre-jump snapshot was taken. It marks where the "
            "reverted Temporal Jumps begin, so the current Situation can be derived "
            "as the one that was live before them. Absent when that entry has already "
            "been evicted from the capped history."
        ),
    )
    diff: Optional[GraphDiff] = Field(
        default=None,
        description=(
            "What this update changed, field by field, in both directions "
            "(ADR-0017). Absent only on legacy entries, which carry before/after."
        ),
    )
    before: Optional[GraphSnapshot] = Field(
        default=None,
        description="Legacy (pre-ADR-0017) whole-Scenario snapshot. Read, never written.",
    )
    after: Optional[GraphSnapshot] = Field(
        default=None,
        description="Legacy (pre-ADR-0017) whole-Scenario snapshot. Read, never written.",
    )
    propagation_meta: Optional[PropagationMeta] = None  # set for propagation entries
    mutation_reversal: Optional[dict[str, Any]] = Field(
        default=None,
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

class PropagationScorecardEntry(BaseModel):
    """
    Scorecard entry produced by a Propagation run (ADR-0006).

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
    type: Literal["propagation"] = "propagation"
    id: str
    label: str
    created_at: str  # ISO 8601 UTC
    # EventDefinition.id values for every Event applied since the last Propagation
    # (a user may apply several Events before running one Propagation — see
    # requirements.md §12.3a). Empty for Manual What-If entries. Newest-applied first.
    event_ids: list[str] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def _migrate_legacy_event_id(cls, data: Any) -> Any:
        """Pre-multi-event Scorecard entries (synced before this change) store a
        singular `event_id` string instead of `event_ids`. Pydantic's default
        `extra="ignore"` would otherwise silently drop that field before the
        frontend's own Zod migration (lib/schemas/network.ts) ever sees it,
        losing the Scorecard-to-Event association on every legacy synced
        project. Mirrors the Zod-side migration exactly."""
        if isinstance(data, dict) and "event_id" in data and "event_ids" not in data:
            old_id = data.get("event_id")
            data = {**data, "event_ids": [old_id] if isinstance(old_id, str) else []}
        return data

    before_propagation: GraphSnapshot
    after_propagation: Optional[GraphSnapshot] = None
    after_temporal_jump: Optional[GraphSnapshot] = None
    temporal_jump_hours: Optional[int] = Field(default=None, ge=1)
    propagation_result: Optional[PropagationResult] = None
    # Base64-encoded PNG of the GlobalViewCanvas at each snapshot state.
    # Captured once at save time; stored so the Scorecard renders offline.
    before_propagation_image: Optional[str] = None
    after_propagation_image: Optional[str] = None
    after_temporal_jump_image: Optional[str] = None


class AnalysisScorecardEntry(BaseModel):
    """
    Scorecard entry produced by a Topological Analysis run (ADR-0006).

    Stores per-Element scores for a named Analysis Metric plus a GraphSnapshot
    at computation time. The PNG (if present) shows the canvas with Analysis
    Heatmap applied.
    """
    type: Literal["analysis"]
    id: str
    label: str
    created_at: str  # ISO 8601 UTC
    metric: str  # e.g. "betweenness", "vitality", "shapley"
    scope: Literal["local", "global"]
    canvas_id: Optional[str] = None  # set when scope == "local"
    scores: dict[str, float] = Field(
        default_factory=dict,
        description="Per-Element score at computation time. Keys are element IDs.",
    )
    snapshot: GraphSnapshot
    image_png: Optional[str] = None  # Base64-encoded PNG with Analysis Heatmap


# Discriminated union — `type` field selects the variant.
# Backward compat: old project files without a `type` field are handled by
# the Zod preprocessor on the frontend; Pydantic defaults `type` to
# "propagation" via PropagationScorecardEntry's field default.
ScorecardEntry = Annotated[
    PropagationScorecardEntry | AnalysisScorecardEntry,
    Field(discriminator="type"),
]


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
        default=None,
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
