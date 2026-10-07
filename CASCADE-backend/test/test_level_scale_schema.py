"""ADR-0019 §6: the Level Scale, a Client Configuration display scale for Stocks."""
import pytest
from pydantic import ValidationError


def test_level_scale_defaults_to_five_ascending_bands_and_rejects_disorder():
    from schemas.config import ConfigMeta, FunctionalityScaleLevel, ModelConfiguration

    base = dict(
        version="1", meta=ConfigMeta(name="t"),
        functionality_scale=[FunctionalityScaleLevel(level=i, label=str(i), color="#000") for i in (1, 2)],
        categories=[],
    )
    assert [b.label for b in ModelConfiguration(**base).level_scale] == [
        "large deficit", "deficit", "balanced", "surplus", "large surplus",
    ]
    with pytest.raises(ValidationError, match="must ascend"):
        ModelConfiguration(**base, level_scale=[
            {"label": "a", "below": 0.5, "role": "danger", "step": 500},
            {"label": "b", "below": 0.1, "role": "neutral", "step": 300},
            {"label": "c", "role": "accent", "step": 500},
        ])
    with pytest.raises(ValidationError, match="the last has none"):
        ModelConfiguration(**base, level_scale=[{"label": "a", "below": 1, "role": "danger", "step": 500}])
