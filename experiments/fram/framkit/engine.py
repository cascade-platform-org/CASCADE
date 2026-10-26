"""
framkit/engine.py — one call into the real CASCADE engine.

Dev-only paper harness importing engine.* directly (as experiments/centrality
does), so that results measure the engine's own logic. The import-linter
contract covers the backend tree only; `experiments/` is outside it.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "CASCADE-backend"))

from engine.propagation import run  # noqa: E402
from schemas.results import PropagationRequest  # noqa: E402

from .translate import Translated  # noqa: E402


def propagate(t: Translated, node_levels: dict[str, int] | None = None,
              edge_levels: dict[str, int] | None = None) -> dict[str, int]:
    """Set the given starting levels, propagate, return every element's level.

    Starting levels are intrinsic: the engine only ever lowers a level
    (commit = worst_of), so a node set to 2 ends at 2 or below.
    """
    node_levels = node_levels or {}
    edge_levels = edge_levels or {}
    nodes = {nid: (n.model_copy(update={"functionality": node_levels[nid]})
                   if nid in node_levels else n)
             for nid, n in t.project.nodes.items()}
    edges = {eid: (e.model_copy(update={"functionality": edge_levels[eid]})
                   if eid in edge_levels else e)
             for eid, e in t.project.edges.items()}
    project = t.project.model_copy(update={"nodes": nodes, "edges": edges})
    result = run(PropagationRequest(project=project, config=t.config, scope="global"))
    level = {nid: n.functionality for nid, n in nodes.items()}
    level.update({eid: e.functionality for eid, e in edges.items()})
    for u in result.updates:
        if u.functionality is not None:
            level[u.id] = u.functionality
    if result.warnings:
        level["__warnings__"] = len(result.warnings)  # type: ignore[assignment]
    return level


def function_levels(t: Translated, levels: dict[str, int]) -> dict[str, int]:
    """Function id -> level (output nodes are plumbing and are dropped)."""
    return {fid: levels[nid] for fid, nid in t.fn_node.items()}
