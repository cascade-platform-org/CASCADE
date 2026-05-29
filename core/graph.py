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

from schemas.network import Canvas, GraphSnapshot, Node, Edge, Project


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


# ---------------------------------------------------------------------------
# Graph snapshot helpers
# ---------------------------------------------------------------------------

def project_to_snapshot(project: Project) -> GraphSnapshot:
    """Extract a GraphSnapshot from the current project state.

    Used by the service layer to capture before/after states for
    AnyUpdateEntry history without duplicating project meta or history.
    """
    return GraphSnapshot(
        nodes=project.nodes,
        edges=project.edges,
        canvases=project.canvases,
    )


def canvas_graph_type(canvas: Canvas) -> str:
    """Return the graph_type of a Canvas — the engine's subgraph dispatch key."""
    return canvas.graph.graph_type


def canvas_ids(project: Project) -> list[str]:
    """Return the ordered list of canvas ids in a project."""
    return [c.id for c in project.canvases]


def node_ids_for_canvas(canvas: Canvas) -> list[str]:
    """Return the node ids referenced by this Canvas's graph."""
    return list(canvas.graph.node_ids)


def edge_ids_for_canvas(canvas: Canvas) -> list[str]:
    """Return the edge ids referenced by this Canvas's graph."""
    return list(canvas.graph.edge_ids)


def resolve_canvas_nodes(project: Project, canvas: Canvas) -> list[Node]:
    """Resolve a Canvas's node_ids to actual Node objects from the global registry."""
    return [project.nodes[nid] for nid in canvas.graph.node_ids if nid in project.nodes]


def resolve_canvas_edges(project: Project, canvas: Canvas) -> list[Edge]:
    """Resolve a Canvas's edge_ids to actual Edge objects from the global registry."""
    return [project.edges[eid] for eid in canvas.graph.edge_ids if eid in project.edges]
