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
from engine import guards
from engine.flow import flow_category_candidates
from engine.logical import compose_categories, logical_category_candidates
from engine.rules_eval import RuleContext
from schemas.results import ElementUpdate, PropagationRequest, PropagationResult


def run(request: PropagationRequest) -> PropagationResult:
    nodes = request.project.nodes
    edges = list(request.project.edges.values())

    # --- working state -----------------------------------------------------
    node_func: dict[str, int] = {nid: n.functionality for nid, n in nodes.items()}
    node_ft: dict[str, int] = {nid: (n.functionality_time or 0) for nid, n in nodes.items()}
    edge_intrinsic: dict[str, int] = {e.id: e.functionality for e in edges}
    edge_func: dict[str, int] = dict(edge_intrinsic)
    node_resp: dict[str, dict[str, float]] = {}  # final blame for degraded nodes

    incoming_index = build_incoming_index(edges)
    edges_by_id = {e.id: e for e in edges}
    rules = RuleContext(nodes, edges, request.config)

    # Categories handled by the flow heuristic (SourceToDemands); the rest go
    # logical. Flow categories are skipped in the logical pass so they aren't
    # double-counted, then merged back in per node before composing.
    category_types = {c.name: c.category_type for c in request.config.categories}
    flow_categories = [
        name for name, ctype in category_types.items() if ctype == "SourceToDemands"
    ]
    flow_skip = frozenset(flow_categories)

    # N = the best (highest) Functionality level. Derive it from the maximum
    # configured level, NOT from len(functionality_scale): the scale need not be a
    # contiguous 1..N (the schema only enforces level >= 1), and the guards use N
    # as the ceiling — a wrong N would let dependency_level attenuation clamp a
    # healthy category *below* its real level, originating a degradation a guard
    # must never originate.
    scale_size = max(
        (lvl.level for lvl in request.config.functionality_scale), default=1
    )
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

        # Resolver for specific-rule conditions against the current round's state.
        resolve = _make_resolver(nodes, edges_by_id, node_func, edge_func, node_ft)

        # Propose → guard → commit per node.
        for nid in nodes:
            node = nodes[nid]
            current = node_func[nid]

            # Propose: logical (non-flow categories) ∪ flow candidates.
            # Intracategorical rules may re-parameterise the aggregation operator.
            candidates = logical_category_candidates(
                node, incoming_index.get(nid, []), node_func, edge_func, nodes,
                skip=flow_skip,
                intra_op=lambda category, _nid=nid: rules.intra_operator(_nid, category),
            )
            candidates.update(flow_candidates.get(nid, {}))

            # Guard 1 — dependency_level attenuation, per category.
            for category, (level, shares) in candidates.items():
                dep = guards.dependency_level(node, category, scale_size)
                candidates[category] = (
                    guards.attenuate(level, dep, scale_size),
                    shares,
                )

            # Compose; an intercategorical rule may re-parameterise the operator.
            proposal = compose_categories(
                candidates, rules.inter_override(nid), scale_size
            )

            # Guard 3 — specific-rule override (highest priority): a firing
            # specific rule replaces the proposal outright (blame = the elements
            # its condition references). Still clamped to worsening at commit.
            override = rules.specific_override(nid, resolve)
            if override is not None:
                level, blame = override
                proposal = (level, blame, frozenset())

            if proposal is None:
                continue
            level, responsibility, binding = proposal
            if level >= current:  # monotone commit: only worsening sticks
                continue

            # Guard 2 — backup deferral: if a binding category has backup, the
            # reserve keeps the node fully operational against ANY drop (not just
            # to critical) — the drop is deferred into functionality_time. A node
            # already counting down holds without refreshing its countdown.
            durations = [
                d
                for category in binding
                if (d := guards.backup_duration(node, category)) is not None
            ]
            if durations:
                if node_ft[nid] == 0:
                    node_ft[nid] = max(durations)  # start the countdown
                continue  # hold current Functionality; defer the drop

            node_func[nid] = level
            node_resp[nid] = responsibility
            changed = True

        if not changed:
            converged = True
            break

    # --- assemble updates (only changed elements) -------------------------
    updates: list[ElementUpdate] = []
    for nid, node in nodes.items():
        functionality_changed = node_func[nid] < node.functionality
        ft_changed = node_ft[nid] != (node.functionality_time or 0)
        if functionality_changed or ft_changed:
            updates.append(
                ElementUpdate(
                    id=nid,
                    functionality=node_func[nid],
                    functionality_time=node_ft[nid] if ft_changed else None,
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

    warnings: list[str] = list(rules.warnings)
    if not converged:
        warnings.append("convergence not reached")

    return PropagationResult(
        scope=request.scope,
        updates=updates,
        computed_at=datetime.now(tz=timezone.utc),
        iterations=iterations,
        warnings=warnings,
    )


def _make_resolver(nodes, edges_by_id, node_func, edge_func, node_ft):
    """Build a resolver for rule conditions: (node_type, name, attribute) → value.

    Functionality and functionality_time read the live working state; any other
    attribute reads the element's stored field (those don't change during a run).
    """
    def resolve(node_type, name, attribute):
        if node_type == "edge":
            edge = edges_by_id.get(name)
            if edge is None:
                return None
            if attribute == "functionality":
                return edge_func.get(name)
            return getattr(edge, attribute, None)
        node = nodes.get(name)
        if node is None:
            return None
        if attribute == "functionality":
            return node_func.get(name)
        if attribute == "functionality_time":
            return node_ft.get(name)
        return getattr(node, attribute, None)

    return resolve
