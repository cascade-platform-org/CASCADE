"""
engine/propagation.py — Propagation engine (PRIVATE IP).

Slice 1: the iterative round loop with the **logical heuristic** and monotone
commit (ADR-0003). Flow allocation, guards (`dependency_level`, `backup`), and
rule evaluation are not yet wired — they arrive in later slices. Until flow
exists, every dependency category is handled logically (the dispatch point is
`_proposal_for`, where Slice 3 will route `SourceToDemands` to flow).

Pipeline per round (ADR-0003 → propose → guard → commit):
  - effective edge Functionality is refreshed: worst_of(intrinsic, source) (ADR-0004)
  - each node gets a logical proposal `P`; commit `worst_of(current, P)`
Rounds repeat until no Element worsens (a fixed point). Because Functionality is a
bounded-below integer that only ever decreases, the loop is guaranteed to
terminate; a generous round cap guards against pathological inputs and emits a
"convergence not reached" warning rather than looping forever.

Public interface (the only thing services/ may call):
    run(request: PropagationRequest) -> PropagationResult
"""
from __future__ import annotations

from datetime import datetime, timezone

from core.topology import build_incoming_index
from engine.flow import flow_category_candidates
from engine.logical import compose_categories, logical_category_candidates
from schemas.results import ElementUpdate, PropagationRequest, PropagationResult


def run(request: PropagationRequest) -> PropagationResult:
    nodes = request.project.nodes
    edges = list(request.project.edges.values())

    # --- working state -----------------------------------------------------
    node_func: dict[str, int] = {nid: n.functionality for nid, n in nodes.items()}
    edge_intrinsic: dict[str, int] = {e.id: e.functionality for e in edges}
    edge_func: dict[str, int] = dict(edge_intrinsic)
    node_resp: dict[str, dict[str, float]] = {}  # final blame for degraded nodes

    incoming_index = build_incoming_index(edges)

    # Categories handled by the flow heuristic (SourceToDemands); the rest go
    # logical. Flow categories are skipped in the logical pass so they aren't
    # double-counted, then merged back in per node before composing.
    category_types = {c.name: c.category_type for c in request.config.categories}
    flow_categories = [
        name for name, ctype in category_types.items() if ctype == "SourceToDemands"
    ]
    flow_skip = frozenset(flow_categories)

    scale_size = len(request.config.functionality_scale) or 1
    max_rounds = (len(nodes) + 1) * scale_size + 5

    # --- fixed-point iteration --------------------------------------------
    iterations = 0
    converged = False
    while iterations < max_rounds:
        iterations += 1
        changed = False

        # Refresh effective edge Functionality from current source levels.
        for edge in edges:
            source_level = node_func.get(edge.source)
            edge_func[edge.id] = (
                min(edge_intrinsic[edge.id], source_level)
                if source_level is not None
                else edge_intrinsic[edge.id]
            )

        # Solve flow once per SourceToDemands category; collect per-node candidates.
        flow_candidates: dict[str, dict[str, tuple[int, dict[str, float]]]] = {}
        for category in flow_categories:
            for nid, candidate in flow_category_candidates(
                category, nodes, edges, node_func, edge_func, scale_size
            ).items():
                flow_candidates.setdefault(nid, {})[category] = candidate

        # Propose + commit per node: logical (non-flow categories) ∪ flow candidates.
        for nid in nodes:
            incoming = incoming_index.get(nid, [])
            candidates = logical_category_candidates(
                nodes[nid], incoming, node_func, edge_func, nodes, skip=flow_skip
            )
            candidates.update(flow_candidates.get(nid, {}))
            proposal = compose_categories(candidates)
            if proposal is None:
                continue
            level, responsibility = proposal
            if level < node_func[nid]:  # monotone commit: only worsening sticks
                node_func[nid] = level
                node_resp[nid] = responsibility
                changed = True

        if not changed:
            converged = True
            break

    # --- assemble updates (only changed elements) -------------------------
    updates: list[ElementUpdate] = []
    for nid, node in nodes.items():
        if node_func[nid] < node.functionality:
            updates.append(
                ElementUpdate(
                    id=nid,
                    functionality=node_func[nid],
                    responsibility_share=node_resp.get(nid) or None,
                )
            )
    for edge in edges:
        if edge_func[edge.id] < edge_intrinsic[edge.id]:
            # An edge degrades only because its source did (ADR-0004), so the
            # source carries the responsibility.
            updates.append(
                ElementUpdate(
                    id=edge.id,
                    functionality=edge_func[edge.id],
                    responsibility_share={edge.source: 1.0},
                )
            )

    warnings: list[str] = []
    if not converged:
        warnings.append("convergence not reached")

    return PropagationResult(
        scope=request.scope,
        updates=updates,
        computed_at=datetime.now(tz=timezone.utc),
        iterations=iterations,
        warnings=warnings,
    )
