"""
framkit/model.py — the FRAM model class, from the product's FMV importer
(CASCADE-backend/core/importers/xfmv/model.py, ADR-0026), plus the two graph
questions only the harness asks.
"""
from __future__ import annotations

import sys
from pathlib import Path

import networkx as nx

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "CASCADE-backend"))

from core.importers.xfmv.model import ASPECTS, PROFILES, Coupling, FramModel, Function  # noqa: E402

__all__ = ["ASPECTS", "PROFILES", "Coupling", "FramModel", "Function", "incoming", "is_acyclic"]


def incoming(model: FramModel, fid: str) -> list[Coupling]:
    return [c for c in model.couplings if c.target == fid]


def is_acyclic(model: FramModel) -> bool:
    return nx.is_directed_acyclic_graph(nx.DiGraph((c.source, c.target) for c in model.couplings))
