from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


HazardKind = Literal["hazard", "disservice"]
RuleKind = Literal["specific", "intracategorical", "intercategorical"]


class FunctionalityScaleLevel(BaseModel):
    level: int = Field(..., ge=1)
    label: str
    color: str


class CategoryDefinition(BaseModel):
    name: str
    category_type: str  # "SourceToDemands" | "Requisite" | open string
    color: Optional[str] = None


class DirectDamageEffect(BaseModel):
    expected_repair_time: int = Field(..., ge=0, description="Hours")
    # future: resources_needed


class HazardDefinition(BaseModel):
    id: str
    label: str
    type: HazardKind
    affected: list[str] = Field(default_factory=list)
    frequency_per_10y: float = Field(..., ge=0)
    expected_recovery_time: Optional[int] = Field(
        None, ge=0, description="Hours. Disservices only."
    )
    direct_damage_effects: Optional[dict[str, DirectDamageEffect]] = Field(
        None, description="Per-element effects. Hazards only. Key = ElementId."
    )
    attribute_mutations: dict[str, Any] = Field(
        default_factory=dict,
        description=(
            'Keys are dot-notation strings "<elementId>.<propertyKey>". '
            "Values are any JSON-serialisable type."
        ),
    )


class RuleDefinition(BaseModel):
    id: str
    type: RuleKind
    expression: str
    enabled: bool = True
    is_valid: Optional[bool] = None
    is_applicable: Optional[bool] = None


class ConfigMeta(BaseModel):
    name: str
    description: Optional[str] = None


class ProjectConfig(BaseModel):
    version: str
    meta: ConfigMeta
    functionality_scale: list[FunctionalityScaleLevel]
    categories: list[CategoryDefinition]
    hazards: list[HazardDefinition] = Field(default_factory=list)
    rules: list[RuleDefinition] = Field(default_factory=list)
