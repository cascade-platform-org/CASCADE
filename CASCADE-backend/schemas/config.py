from __future__ import annotations

from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


# hazard: damage and degradation by vulnerability; disservice: degradation by
# vulnerability; restorative: only Attribute Operations, the way a repair or a
# recovery is written (no vulnerability levels). Time passing is no Event: it is
# a Timeline Phase's `advance_hours`, or the Time control (ADR-0019, 2026-10-08).
EventKind = Literal["hazard", "disservice", "restorative"]


class FunctionalityScaleLevel(BaseModel):
    level: int = Field(..., ge=1)
    label: str
    color: str


# The closed set of engine heuristics a category can bind to (ADR-0005):
# "Requisite" = logical aggregation over incoming edges; "SourceToDemands" =
# the capacitated flow pass. A new heuristic means a new literal HERE first
# (schema-first, CLAUDE.md §6), then a matching engine branch — an open
# string would let a typo ("Requsite") silently fall through to no heuristic
# at all, since the engine dispatches on exact string equality.
CategoryType = Literal["Requisite", "SourceToDemands"]


class CategoryDefinition(BaseModel):
    name: str
    category_type: CategoryType
    color: Optional[str] = None  # kept for backward compat; icon takes precedence in the UI
    icon: Optional[str] = None  # Lucide icon name, e.g. "Droplet", "Zap"


class DirectDamageEffect(BaseModel):
    expected_repair_time: int = Field(..., ge=0, description="Hours")
    # future: resources_needed


class ElementFilter(BaseModel):
    """Selects Elements by conditions that must all hold (ADR-0021).

    Resolved when it is used, against the model at that moment, so an Element
    added later is included. `exclude` holds matches unticked by hand.
    """
    model_config = ConfigDict(extra="forbid")

    kind: Literal["node", "edge"] = "node"
    canvas: Optional[str] = Field(default=None, description="Canvas id or label.")
    node_type: Optional[str] = Field(default=None, description="Nodes only.")
    category: Optional[str] = Field(
        default=None,
        description="Nodes: tagged, supplied or demanded. Edges: their source's supply.",
    )
    label_contains: Optional[str] = Field(
        default=None,
        description='Case-insensitive; an edge reads as "source label → target label".',
    )
    exclude: Optional[list[str]] = Field(default=None, description="Matches left out, by Element id.")


AttributeOperationKind = Literal["set", "add", "mul", "at_most", "at_least"]


class AttributeOperation(BaseModel):
    """`new = op(current, value)` at `path`, on one Element or every match of `where` (ADR-0021).

    `at_most` caps the value at `value`; `at_least` raises it to `value`. Applied
    client-side when the Event fires; the engine never reads it.
    """
    model_config = ConfigDict(extra="forbid")

    element: Optional[str] = Field(default=None, min_length=1)
    where: Optional[ElementFilter] = None
    path: list[str] = Field(..., min_length=1, description='Field path, e.g. ["supply_capacity", "water"].')
    op: AttributeOperationKind
    value: float | int | bool | str

    @model_validator(mode="after")
    def _one_target_and_numeric_arithmetic(self) -> "AttributeOperation":
        if (self.element is None) == (self.where is None):
            raise ValueError("give exactly one of `element` (an id) or `where` (a filter)")
        if self.op != "set" and (isinstance(self.value, bool) or not isinstance(self.value, (int, float))):
            raise ValueError("add, mul, at_most and at_least need a number `value`")
        if any(not segment for segment in self.path):
            raise ValueError("a path segment cannot be empty")
        return self


def mutations_to_operations(mutations: dict[str, Any]) -> list[dict[str, Any]]:
    """Retired `attribute_mutations` (`{"<elementId>.<field>": value}`) as `set`
    Attribute Operations, one per scalar leaf (ADR-0021, revised 2026-10-08).

    The key splits on its LAST dot, since an element id may contain dots. An
    object value becomes one operation per nested value, so a profile rewrite
    keeps the profile's other keys. A list or null has no operation form.
    """
    operations: list[dict[str, Any]] = []

    def walk(element: str, path: list[str], value: Any) -> None:
        if isinstance(value, dict):
            for key, inner in value.items():
                walk(element, [*path, str(key)], inner)
        elif isinstance(value, (bool, int, float, str)):
            operations.append({"element": element, "path": path, "op": "set", "value": value})
        else:
            raise ValueError(f"attribute_mutations[{element}.{path[0]}]: a {type(value).__name__} value has no Attribute Operation form")

    for key, value in mutations.items():
        element, _, field = key.rpartition(".")
        if not element or not field:
            raise ValueError(f"attribute_mutations key {key!r} is not '<elementId>.<field>'")
        walk(element, [field], value)
    return operations


class EventDefinition(BaseModel):
    id: str
    label: str
    type: EventKind
    icon: Optional[str] = None  # Lucide icon name shown on the Action Bar button
    frequency_per_10y: float = Field(default=0.0, ge=0)
    expected_recovery_time: Optional[int] = Field(
        default=None, ge=0, description="Hours until self-resolution. Disservices only."
    )
    default_repair_time: Optional[int] = Field(
        default=None,
        ge=0,
        description=(
            "Global default repair time (hours) applied to all elements when this hazard fires. "
            "Elements in direct_damage_effects override this value."
        ),
    )
    direct_damage_effects: Optional[dict[str, DirectDamageEffect]] = Field(
        default=None, description="Per-element repair time overrides. Hazards only. Key = ElementId."
    )
    temporal_simulation_only: bool = Field(
        default=False,
        description=(
            "True for an Event used only inside a Temporal Simulation Phase: it is hidden "
            "from the Action Bar and from the Scorecard's uncovered-Event list. Any type may "
            "be Temporal-Simulation-only. "
            "Client-side only; the engine never reads it."
        ),
    )
    attribute_operations: Optional[list[AttributeOperation]] = Field(
        default=None,
        description=(
            "Ordered operations on the value a field holds when the Event fires, applied "
            "last (ADR-0021). Operations on one Element and path compose in order. A "
            "Restorative Event does nothing else. Client-side only; the engine never reads them."
        ),
    )

    @model_validator(mode="before")
    @classmethod
    def _migrate_attribute_mutations(cls, data: Any) -> Any:
        """A file written before 2026-10-08 carries `attribute_mutations`; they ran
        before the operations, so they become `set` operations ahead of them."""
        if isinstance(data, dict) and "attribute_mutations" in data:
            data = dict(data)
            migrated = mutations_to_operations(data.pop("attribute_mutations") or {})
            if migrated:
                data["attribute_operations"] = [*migrated, *(data.get("attribute_operations") or [])]
        return data


# ---------------------------------------------------------------------------
# Graph-type heuristic pipeline configuration
# ---------------------------------------------------------------------------

class HeuristicConfig(BaseModel):
    """
    One heuristic step in a graph type's propagation pipeline.

    `id` must match a heuristic known to the engine (see GET /api/engine/capabilities).
    `params` is an open dict of heuristic-specific tuning parameters; the engine
    validates keys and value ranges — the config layer treats them as opaque.
    """
    id: str
    enabled: bool = True
    params: Optional[dict[str, Any]] = Field(
        default=None,
        description="Heuristic-specific parameters. Keys and value ranges are engine-defined.",
    )


class GraphTypeConfig(BaseModel):
    """
    Per-graph-type override of the engine's default heuristic pipeline.

    The engine uses this to select and order the heuristics it applies when
    propagating across a canvas whose graph_type matches `name`.
    If a canvas's graph_type has no entry here the engine falls back to its
    built-in default pipeline for that type.

    The ordered `heuristics` list is the full pipeline override — the engine
    runs them in the declared order.  Disable individual steps via `enabled`
    rather than removing them so the intent is legible in saved config files.

    `local_graph_types` is used by the **global** graph type only (the one
    referenced by Project.global_graph_type): it lists the constituent local
    graph type names whose pipelines compose for a global Propagation. The
    engine's effective global pipeline is the merge of those locals' heuristics;
    because heuristic `params` are keyed by category, params from different
    locals coexist without conflict. For a local graph type this is absent and
    `heuristics` is the literal pipeline.
    """
    name: str = Field(..., description="Must match a Canvas.graph_type value used in the project.")
    heuristics: list[HeuristicConfig] = Field(
        default_factory=list,
        description="Ordered heuristic pipeline for this graph type.",
    )
    local_graph_types: Optional[list[str]] = Field(
        default=None,
        description=(
            "Global graph type only: names of the constituent local graph types "
            "whose heuristic pipelines compose for a global Propagation. Absent "
            "for a local graph type."
        ),
    )


BrandRole = Literal["neutral", "danger", "warning", "success", "accent"]
# The steps every brand ramp defines (CASCADE-app/lib/brand.ts RAMP_STEPS).
BrandStep = Literal[50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]


class LevelBand(BaseModel):
    """One band of the Level Scale (ADR-0019 §6): a Stock whose `value / reference`
    is below `below` (and at or above the previous band's bound) shows in this
    band. Colours are brand tokens (a role and a ramp step), never hex literals."""
    model_config = ConfigDict(extra="forbid")

    label: str
    below: Optional[float] = Field(default=None, description="Upper bound of the ratio; absent on the last band.")
    role: BrandRole
    step: BrandStep


def _default_level_scale() -> list[LevelBand]:
    return [
        LevelBand(label="large deficit", below=-0.5, role="danger", step=600),
        LevelBand(label="deficit", below=-0.1, role="danger", step=300),
        LevelBand(label="balanced", below=0.1, role="neutral", step=500),
        LevelBand(label="surplus", below=0.5, role="accent", step=300),
        LevelBand(label="large surplus", role="accent", step=600),
    ]


class ConfigMeta(BaseModel):
    name: str
    description: Optional[str] = None


class ModelConfiguration(BaseModel):
    version: str
    meta: ConfigMeta
    functionality_scale: list[FunctionalityScaleLevel] = Field(..., min_length=2)
    flow_ratio_thresholds: Optional[list[float]] = Field(
        default=None,
        description=(
            "Served-ratio → Functionality level table for the flow pass (ADR-0003). "
            "N−1 ascending upper bounds in [0, 1] for an N-level scale: entry k is "
            "the highest delivered/demand ratio that still reads as level k+1. None "
            "means the linear split max(1, ceil(ratio · N)), which the table "
            "[k/N for k in 1..N−1] reproduces exactly. Sits beside "
            "functionality_scale because it says what those levels MEAN, and is "
            "validated against them by the engine — a table whose length does not "
            "match the scale is ignored and reported in the run's warnings."
        ),
    )
    categories: list[CategoryDefinition]
    events: list[EventDefinition] = Field(
        default_factory=list,
        description=(
            "Every Event definition. A `temporal_jump` Event (possible before "
            "2026-10-08) is dropped on load: time passing is a Phase's advance_hours."
        ),
    )
    graph_types: list[GraphTypeConfig] = Field(
        default_factory=list,
        description=(
            "Per-graph-type heuristic pipeline overrides. "
            "Absent entries use the engine's built-in defaults for that graph type."
        ),
    )
    level_scale: list[LevelBand] = Field(
        default_factory=_default_level_scale,
        min_length=1,
        description=(
            "Client Configuration (ADR-0019 §6): how Level Mode colours a Stock by "
            "value / reference in a Temporal Simulation run. Ascending bounds; only "
            "the last band has none. The engine never reads it."
        ),
    )
    node_defaults: Dict[str, Any] = Field(
        default_factory=dict,
        description=(
            "Named node templates. Key = user-chosen name. "
            "Value = partial Node — any Node field except id and position can be preset."
        ),
    )

    @model_validator(mode="before")
    @classmethod
    def _drop_temporal_jump_events(cls, data: Any) -> Any:
        if isinstance(data, dict) and isinstance(data.get("events"), list):
            data = {**data, "events": [e for e in data["events"] if not (isinstance(e, dict) and e.get("type") == "temporal_jump")]}
        return data

    @model_validator(mode="after")
    def _level_scale_ascends(self) -> "ModelConfiguration":
        bounds = [band.below for band in self.level_scale]
        if bounds[-1] is not None or any(b is None for b in bounds[:-1]):
            raise ValueError("level_scale: every band but the last needs `below`, and the last has none")
        finite = [b for b in bounds if b is not None]
        if any(b <= a for a, b in zip(finite, finite[1:])):
            raise ValueError("level_scale: band bounds must ascend")
        return self
