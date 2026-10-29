"""
framkit/translate.py — the FRAM → CASCADE conversion (TRANSLATION.md), from the
product's FMV importer (CASCADE-backend/core/importers/xfmv/map.py, ADR-0026).

The harness evaluates exactly the code the importer ships; this module only
re-exports it. Module docstring of map.py: the full mapping.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "CASCADE-backend"))

import schemas.results  # noqa: E402,F401  (defines PropagationResult, which Project references)
from core.importers.xfmv.map import (  # noqa: E402
    Translated,
    TranslationConfig,
    cumulative_config,
    default_config,
    fmi_config,
    resonance_config,
    translate,
)

__all__ = ["Translated", "TranslationConfig", "cumulative_config", "default_config",
           "fmi_config", "resonance_config", "translate"]
