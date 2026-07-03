"""
core/graph.py — Open graph utilities for the CASCADE backend.

This module contains only auditable, non-proprietary logic.
Propagation algorithm lives exclusively in engine/propagation.py.

Data shape (ADR-0001):
  Project.nodes  = dict[str, Node]   ← global element registry
  Project.edges  = dict[str, Edge]   ← global element registry
  Canvas.graph   = Graph(graph_type, node_ids[], edge_ids[])

Elements have globally unique IDs. A node may appear in multiple Canvases
via node_ids references without duplication. "Inter-canvas edge" is a UI
concept only — no field exists in the data model.
"""
from __future__ import annotations

from typing import Literal, Optional

from schemas.network import Canvas, Node, Edge, Project


# ---------------------------------------------------------------------------
# Scope filtering
# ---------------------------------------------------------------------------

def filter_project_by_scope(
    project: Project,
    scope: Literal["local", "global"],
    active_canvas_id: Optional[str] = None,
) -> Project:
    """Return a Project restricted to the propagation scope.

    Global scope
    ------------
    All canvases, nodes, and edges are passed through unchanged.
    Returns a shallow copy of the project (original is never mutated).

    Local scope
    -----------
    Only the elements referenced by the active Canvas are included.
    Specifically:
      - canvases: [active_canvas]
      - nodes: only entries in project.nodes whose id appears in
               active_canvas.graph.node_ids
      - edges: only entries in project.edges whose id appears in
               active_canvas.graph.edge_ids

    This gives the engine a self-contained subgraph with no cross-canvas
    connections (inter-canvas edges are a UI concept and are never present
    in the data model).

    Raises
    ------
    ValueError
        If scope is "local" but active_canvas_id is None or does not exist.
    """
    if scope == "global":
        return project.model_copy()

    # --- local scope ---
    if active_canvas_id is None:
        raise ValueError("active_canvas_id is required for local-scope propagation.")

    canvas = _find_canvas(project.canvases, active_canvas_id)
    if canvas is None:
        raise ValueError(
            f"Canvas '{active_canvas_id}' not found in project "
            f"(available: {[c.id for c in project.canvases]})."
        )

    node_ids = set(canvas.graph.node_ids)
    edge_ids = set(canvas.graph.edge_ids)

    filtered_nodes: dict[str, Node] = {
        nid: node for nid, node in project.nodes.items() if nid in node_ids
    }
    filtered_edges: dict[str, Edge] = {
        eid: edge for eid, edge in project.edges.items() if eid in edge_ids
    }

    return project.model_copy(
        update={
            "canvases": [canvas],
            "nodes": filtered_nodes,
            "edges": filtered_edges,
        }
    )


def _find_canvas(canvases: list[Canvas], canvas_id: str) -> Optional[Canvas]:
    for canvas in canvases:
        if canvas.id == canvas_id:
            return canvas
    return None
