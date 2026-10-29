# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Cristian Curaba
"""
core/importers/xfmv/ — FMV (FRAM Model Visualiser) .xfmv importer (ADR-0026).

Pipeline: parse (parse.py) → translate with a declared semantics (map.py:
v2 by default) → lay out. The FRAM paper's harness (experiments/fram) imports
`translate` and the configs from here, so the conversion it evaluates is the
one the importer ships.
"""

from core.importers.xfmv.map import (
    GRAPH_TYPE_NAME,
    Semantics,
    Translated,
    TranslationConfig,
    build_bundle,
    config_for,
    cumulative_config,
    default_config,
    fmi_config,
    resonance_config,
    translate,
)
from core.importers.xfmv.model import ASPECTS, Coupling, FramModel, Function
from core.importers.xfmv.parse import XfmvParseError, parse_xfmv

__all__ = [
    "GRAPH_TYPE_NAME",
    "Semantics",
    "Translated",
    "TranslationConfig",
    "build_bundle",
    "config_for",
    "cumulative_config",
    "default_config",
    "fmi_config",
    "resonance_config",
    "translate",
    "ASPECTS",
    "Coupling",
    "FramModel",
    "Function",
    "XfmvParseError",
    "parse_xfmv",
]
