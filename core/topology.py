"""
core/topology.py — Open graph-topology helpers (OPEN, auditable).

Pure structural queries over a set of edges: who flows into whom. No propagation
logic lives here — these helpers only answer "which elements are upstream of X?".
The propagation algorithm that *uses* these answers stays in engine/propagation.py.

The headline helper is `incoming_closure`, which powers the flow heuristic's
provisional v1 responsibility-share rule (ADR-0003 → Responsibility share):
to blame a starved consumer's shortfall, the engine takes the transitive set of
elements that feed into it and keeps the degraded ones. This module computes that
transitive set; the engine applies the category filter and the degraded filter.

"Incoming" / "upstream" follows edge direction backwards: an edge (source -> target)
means `source` is upstream of `target`. Walking incoming edges from a node yields
its parents, then their parents, and so on.
"""
from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field

from schemas.network import Edge


@dataclass(frozen=True)
class IncomingClosure:
    """The transitive set of elements upstream of a target node.

    `node_ids`  — every node that can reach the target by following edge
                  direction forwards (i.e. every transitive parent). The target
                  itself is NOT included.
    `edge_ids`  — every edge traversed while walking upstream (each such edge
                  lies on a path that ultimately feeds the target).

    Both nodes and edges are returned because the flow blame rule considers
    degraded *elements* (nodes and edges alike) in the closure.
    """
    node_ids: frozenset[str] = field(default_factory=frozenset)
    edge_ids: frozenset[str] = field(default_factory=frozenset)


def build_incoming_index(edges: Iterable[Edge]) -> dict[str, list[Edge]]:
    """Index edges by their target node: target_id -> [edges arriving at target].

    Built once and reused, so repeated closure queries over the same graph don't
    rescan every edge each time. Analogous to an adjacency list, but keyed on the
    *target* because we walk the graph backwards (consumer -> suppliers).
    """
    index: dict[str, list[Edge]] = {}
    for edge in edges:
        index.setdefault(edge.target, []).append(edge)
    return index


def incoming_closure(
    target_id: str,
    edges: Iterable[Edge],
    *,
    index: dict[str, list[Edge]] | None = None,
) -> IncomingClosure:
    """Return all nodes and edges transitively upstream of `target_id`.

    A breadth-first walk backwards along edge direction. We keep a `visited` set
    of nodes so cycles (A -> B -> A) terminate — real infrastructure graphs can
    contain loops, and without this the walk would never finish.

    Pass a prebuilt `index` (from `build_incoming_index`) when calling this for
    many targets over the same edge set, to avoid re-indexing each time.

    The target node itself is excluded from the result: we want what *feeds* it,
    not the node we are explaining.
    """
    if index is None:
        index = build_incoming_index(edges)

    upstream_nodes: set[str] = set()
    traversed_edges: set[str] = set()

    # Nodes whose incoming edges we still need to expand. Seed with the target
    # so we pick up its direct suppliers first, then fan outwards.
    frontier: list[str] = [target_id]
    visited: set[str] = {target_id}

    while frontier:
        current = frontier.pop()
        for edge in index.get(current, ()):  # edges arriving at `current`
            traversed_edges.add(edge.id)
            parent = edge.source
            if parent not in visited:
                visited.add(parent)
                upstream_nodes.add(parent)
                frontier.append(parent)
            else:
                # Parent already seen, but still record it as upstream (it is),
                # without re-expanding it — that is what prevents infinite loops.
                upstream_nodes.add(parent)

    # The target may have appeared as its own ancestor through a cycle; never
    # report the target as upstream of itself.
    upstream_nodes.discard(target_id)

    return IncomingClosure(
        node_ids=frozenset(upstream_nodes),
        edge_ids=frozenset(traversed_edges),
    )


def parents(target_id: str, edges: Iterable[Edge]) -> list[Edge]:
    """Return the direct incoming edges of `target_id` (one hop upstream).

    Convenience for the logical heuristic's stage-1 deliverable computation,
    which only needs immediate parents, not the full transitive closure.
    """
    return [edge for edge in edges if edge.target == target_id]
