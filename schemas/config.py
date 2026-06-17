from __future__ import annotations

from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel, Field


EventKind = Literal["hazard", "disservice", "temporal_jump"]


class FunctionalityScaleLevel(BaseModel):
    level: int = Field(..., ge=1)
    label: str
    color: str


class CategoryDefinition(BaseModel):
    name: str
    category_type: str  # "SourceToDemands" | "Requisite" | open string
    color: Optional[str] = None  # kept for backward compat; icon takes precedence in the UI
    icon: Optional[str] = None  # Lucide icon name, e.g. "Droplet", "Zap"


class DirectDamageEffect(BaseModel):
    expected_repair_time: int = Field(..., ge=0, description="Hours")
    # future: resources_needed


class EventDefinition(BaseModel):
    id: str
    label: str
    type: EventKind
    icon: Optional[str] = None  # Lucide icon name shown on the Action Bar button
    frequency_per_10y: float = Field(default=0.0, ge=0)
    expected_recovery_time: Optional[int] = Field(
        None, ge=0, description="Hours until self-resolution. Disservices only."
    )
    duration_hours: Optional[int] = Field(
        None, ge=1,
        description=(
            "Hours to advance the clock. Temporal Jump events only. "
            "Used as the default when saving to Scorecard."
        ),
    )
    default_repair_time: Optional[int] = Field(
        None,
        ge=0,
        description=(
            "Global default repair time (hours) applied to all elements when this hazard fires. "
            "Elements in direct_damage_effects override this value."
        ),
    )
    direct_damage_effects: Optional[dict[str, DirectDamageEffect]] = Field(
        None, description="Per-element repair time overrides. Hazards only. Key = ElementId."
    )
    attribute_mutations: dict[str, Any] = Field(
        default_factory=dict,
        description=(
            'Keys are dot-notation strings "<elementId>.<fieldName>". '
            "Values are any JSON-serialisable type. May overwrite any Element field, "
            "including first-class fields like `functionality` and `direct_damage`. "
            "`direct_damage_effects` is kept as a typed, engine-recognised complement — "
            "do not express physical damage solely via attribute_mutations."
        ),
    )


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
        None,
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
        None,
        description=(
            "Global graph type only: names of the constituent local graph types "
            "whose heuristic pipelines compose for a global Propagation. Absent "
            "for a local graph type."
        ),
    )


class ConfigMeta(BaseModel):
    name: str
    description: Optional[str] = None


class ModelConfiguration(BaseModel):
    version: str
    meta: ConfigMeta
    functionality_scale: list[FunctionalityScaleLevel] = Field(..., min_length=2)
    categories: list[CategoryDefinition]
    events: list[EventDefinition] = Field(
        default_factory=list,
        description="Hazard and Disservice definitions. Both types are Events.",
    )
    graph_types: list[GraphTypeConfig] = Field(
        default_factory=list,
        description=(
            "Per-graph-type heuristic pipeline overrides. "
            "Absent entries use the engine's built-in defaults for that graph type."
        ),
    )
    node_defaults: Dict[str, Any] = Field(
        default_factory=dict,
        description=(
            "Named node templates. Key = user-chosen name. "
            "Value = partial Node — any Node field except id and position can be preset."
        ),
    )
